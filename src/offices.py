"""Build src/offices.json (docs/DATA-CONTRACT-v4.md): federal buildings/leases (GSA IOLP) + named OSM offices within 30 miles of home.
Usage: python3 src/offices.py [--refresh] [--no-osm]
  Raw downloads are cached in src/gsa_raw/ and src/osm_raw/ (delete them or pass --refresh to refetch).
Nothing is invented: `tenants` holds only names a source states. The IOLP records state no occupant, so GSA tenants are [] unless an
OSM feature at the same building names one."""
import argparse, json, math, os, re, sys, time, urllib.parse, urllib.request
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = (38.93472, -77.32540)
RADIUS_MI = 30.0
CAP = 4000
UA = "mapjob-offices/1.0"
GSA_ROOT = "https://services1.arcgis.com/eBupDfPlEJK3mdAm/ArcGIS/rest/services"
# (service, layer, code field, name field, lat field, lon field). IOLP_combined3 is the fuller set (every active owned and leased record);
# IOLP_NEW is the newer-schema release; both are read and merged on LOCATION_CODE.
GSA_LAYERS = [("IOLP_combined3", 0, "LOCATION_CODE", "NAME", "LATITUDE", "LONGITUDE"), ("IOLP_combined3", 1, "LOC_CODE", "NAME", "LATITUDE", "LONGITUDE"),
              ("IOLP_NEW", 0, "LOCATION_CODE", "Real_Property_Asset_Name", "Latitude", "Longitude"), ("IOLP_NEW", 1, "LOCATION_CODE", "Real_Property_Asset_Name", "Latitude", "Longitude")]
OVERPASS = "https://overpass-api.de/api/interpreter"
GSA_DIR, OSM_DIR = os.path.join(HERE, "gsa_raw"), os.path.join(HERE, "osm_raw")
GENERIC = {"the", "and", "of", "for", "inc", "llc", "building", "bldg", "office", "offices", "center", "centre", "plaza", "park", "suite", "street", "st",
           "avenue", "ave", "road", "rd", "drive", "dr", "federal", "united", "states", "us", "department", "corp", "company", "group", "tower", "towers"}


def miles(a, b):
    r = math.pi / 180; dl, dn = (b[0] - a[0]) * r, (b[1] - a[1]) * r
    h = math.sin(dl / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin(dn / 2) ** 2
    return 2 * 3958.8 * math.asin(math.sqrt(h))


def meters(a, b):
    kx = 111320 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((a[1] - b[1]) * kx, (a[0] - b[0]) * 110574)


def http(url, data=None, tries=6, timeout=150):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as ex:  # flaky host: back off and retry
            last = ex; wait = min(60, 4 * 2 ** i)
            print("  retry %d (%s) wait %ds" % (i + 1, repr(ex)[:90], wait), flush=True); time.sleep(wait)
    raise RuntimeError("giving up on %s: %r" % (url[:80], last))


# ---------------------------------------------------------------- GSA
def fetch_gsa(refresh=False):
    os.makedirs(GSA_DIR, exist_ok=True); rows = []
    dlat = RADIUS_MI / 69.0 * 1.02; dlon = dlat / math.cos(math.radians(HOME[0]))
    for svc, layer, code_f, name_f, lat_f, lon_f in GSA_LAYERS:
        path = os.path.join(GSA_DIR, "%s_%d.json" % (svc, layer))
        if os.path.exists(path) and not refresh:
            feats = json.load(open(path))
        else:
            where = "%s > %.5f AND %s < %.5f AND %s > %.5f AND %s < %.5f" % (lat_f, HOME[0] - dlat, lat_f, HOME[0] + dlat, lon_f, HOME[1] - dlon, lon_f, HOME[1] + dlon)
            feats, off = [], 0
            while True:
                q = urllib.parse.urlencode({"where": where, "outFields": "*", "returnGeometry": "false", "orderByFields": "OBJECTID", "resultOffset": off, "f": "json"})
                d = http("%s/%s/FeatureServer/%d/query?%s" % (GSA_ROOT, svc, layer, q))
                if "error" in d: raise RuntimeError("GSA %s/%d: %s" % (svc, layer, d["error"]))
                got = [f["attributes"] for f in d.get("features", [])]
                feats += got; off += len(got)
                if not got or not d.get("exceededTransferLimit"): break
            json.dump(feats, open(path, "w"))
        print("GSA %s layer %d: %d records in bounding box" % (svc, layer, len(feats)))
        rows += [((svc, layer, code_f, name_f, lat_f, lon_f), a) for a in feats]
    return rows


def title(s):
    s = re.sub(r"\s+", " ", (s or "").strip())
    if s and s.upper() == s:
        s = s.title()
        s = re.sub(r"\b(Fb|Gsa|Irs|Fbi|Nasa|Usda|Hhs|Epa|Dc|Va|Md|Sw|Nw|Ne|Se|Us|Ii|Iii|Iv)\b", lambda m: m.group(1).upper(), s)
    return s


def gsa_entries(rows, today):
    by = {}
    for (svc, layer, code_f, name_f, lat_f, lon_f), a in rows:
        code = (a.get(code_f) or "").strip()
        lat, lon = a.get(lat_f), a.get(lon_f)
        if not code or not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)): continue
        if miles(HOME, (lat, lon)) > RADIUS_MI: continue
        name = (a.get(name_f) or "").strip()
        if name.upper() in ("", "N/A", "NA"): name = (a.get("STREET_ADDRESS") or code).strip()
        zip5 = a.get("ZIPCODE5"); zip5 = ("%05d" % zip5) if isinstance(zip5, int) else (zip5 or "")
        addr = ", ".join(p for p in [title(a.get("STREET_ADDRESS")), title(a.get("CITY")), ((a.get("STATE_CD") or "") + " " + zip5).strip()] if p)
        if code in by: continue  # first listed layer wins; later ones only matter for codes it lacks
        q = urllib.parse.urlencode({"where": "%s='%s'" % (code_f, code), "outFields": "*", "f": "json"})
        by[code] = {"id": "gsa-" + code, "name": title(name), "kind": "federal", "tenants": [], "addr": addr, "lat": round(lat, 6), "lon": round(lon, 6),
                    "source": "gsa-iolp", "sourceUrl": "%s/%s/FeatureServer/%d/query?%s" % (GSA_ROOT, svc, layer, q), "empIds": [], "checked": today}
    return list(by.values())


# ---------------------------------------------------------------- OSM
def bbox_tiles(n=8):
    dlat = RADIUS_MI / 69.0; dlon = dlat / math.cos(math.radians(HOME[0]))
    S, N, W, E = HOME[0] - dlat, HOME[0] + dlat, HOME[1] - dlon, HOME[1] + dlon
    out = []
    for r in range(n):
        for c in range(n):
            t = (S + (N - S) * r / n, W + (E - W) * c / n, S + (N - S) * (r + 1) / n, W + (E - W) * (c + 1) / n)
            # keep tiles whose nearest point to home is inside the radius
            cl = (min(max(HOME[0], t[0]), t[2]), min(max(HOME[1], t[1]), t[3]))
            if miles(HOME, cl) <= RADIUS_MI: out.append(t)
    return out


def osm_query(t):
    bb = "%.5f,%.5f,%.5f,%.5f" % t
    return ('[out:json][timeout:120];(nwr["office"]["name"](%s);nwr["government"]["name"](%s);'
            'nwr["building"~"^(office|government|commercial)$"]["name"](%s););out center tags;' % (bb, bb, bb))


def fetch_osm_tile(t, refresh, depth=0):
    key = "tile_%.4f_%.4f_%.4f_%.4f.json" % t
    path = os.path.join(OSM_DIR, key)
    if os.path.exists(path) and not refresh: return json.load(open(path))["elements"]
    try:
        d = http(OVERPASS, urllib.parse.urlencode({"data": osm_query(t)}).encode(), tries=3)
        json.dump(d, open(path, "w")); time.sleep(2)
        return d["elements"]
    except RuntimeError as ex:
        if depth >= 2: raise
        print("  splitting tile after failure:", str(ex)[:80])
        mla, mlo = (t[0] + t[2]) / 2, (t[1] + t[3]) / 2
        els = []
        for sub in ((t[0], t[1], mla, mlo), (t[0], mlo, mla, t[3]), (mla, t[1], t[2], mlo), (mla, mlo, t[2], t[3])):
            els += fetch_osm_tile(sub, refresh, depth + 1)
        return els


def fetch_osm(refresh=False):
    os.makedirs(OSM_DIR, exist_ok=True); seen, els, failed, streak = set(), [], 0, 0
    tiles = bbox_tiles()
    for i, t in enumerate(tiles):
        if streak >= 3:  # the host keeps refusing: stop hammering it, keep what is cached, report
            failed += len(tiles) - i; print("Overpass kept failing; skipping the remaining %d tiles (rerun later; cached tiles are kept)" % (len(tiles) - i)); break
        try:
            for e in fetch_osm_tile(t, refresh):
                k = (e["type"], e["id"])
                if k not in seen: seen.add(k); els.append(e)
            streak = 0
        except RuntimeError as ex:
            failed += 1; streak += 1; print("tile %d/%d failed: %s" % (i + 1, len(tiles), str(ex)[:100]))
    print("OSM: %d named elements from %d/%d tiles" % (len(els), len(tiles) - failed, len(tiles)))
    return els, failed


GOV_AMENITY = {"townhall", "courthouse", "police", "fire_station", "post_office", "public_building"}


def osm_entry(e, today):
    tg = e.get("tags") or {}
    name = (tg.get("name") or "").strip()
    lat, lon = (e.get("lat"), e.get("lon")) if e["type"] == "node" else ((e.get("center") or {}).get("lat"), (e.get("center") or {}).get("lon"))
    if not name or lat is None or miles(HOME, (lat, lon)) > RADIUS_MI: return None
    office, gov, bld = tg.get("office", ""), tg.get("government", ""), tg.get("building", "")
    if bld == "commercial" and not (office or gov) and any(k in tg for k in ("shop", "amenity", "tourism", "leisure", "craft", "healthcare")): return None
    if gov or office == "government" or bld == "government": kind, pri = "government", 0
    elif office in ("ngo", "association", "foundation", "charity", "political_party"): kind, pri = "nonprofit", 0
    elif office == "company": kind, pri = "company", 0
    elif office or bld == "office": kind, pri = "office", 1
    else: kind, pri = "company", 2
    parts = [tg.get("addr:housenumber", ""), tg.get("addr:street", "")]
    street = " ".join(p for p in parts if p)
    addr = ", ".join(p for p in [street, tg.get("addr:city", ""), (tg.get("addr:state", "") + " " + tg.get("addr:postcode", "")).strip()] if p)
    tenants = [t for t in {tg.get("operator", "").strip(), tg.get("brand", "").strip()} if t and t.lower() != name.lower()]
    pre = {"node": "node", "way": "way", "relation": "relation"}[e["type"]]
    return {"id": "osm-%s-%d" % (pre, e["id"]) if pre != "way" else "osm-way-%d" % e["id"], "name": name, "kind": kind, "tenants": sorted(tenants), "addr": addr,
            "lat": round(lat, 6), "lon": round(lon, 6), "source": "osm", "sourceUrl": "https://www.openstreetmap.org/%s/%d" % (e["type"], e["id"]),
            "empIds": [], "checked": today, "_pri": pri}


# ---------------------------------------------------------------- merge
def words(s):
    return {w for w in re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower()).split() if len(w) >= 3 and w not in GENERIC}


def street_key(addr):
    m = re.match(r"\s*(\d+)\s+([^,]+)", addr or "")
    if not m: return None
    w = re.sub(r"\b(street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|court|ct|way|place|pl)\b", "", m.group(2).lower())
    w = re.sub(r"\b(north|south|east|west|n|s|e|w|ne|nw|se|sw)\b", "", w)
    return m.group(1) + " " + " ".join(sorted(re.sub(r"[^a-z0-9 ]", "", w).split()))


def same_place(a, b):
    if meters((a["lat"], a["lon"]), (b["lat"], b["lon"])) > 60: return False
    ka, kb = street_key(a["addr"]), street_key(b["addr"])
    if ka and ka == kb: return True
    return bool(words(" ".join([a["name"]] + a["tenants"])) & words(" ".join([b["name"]] + b["tenants"])))


class Grid:
    def __init__(self): self.g = {}
    def _k(self, e): return (int(e["lat"] / 0.001), int(e["lon"] / 0.0013))
    def near(self, e):
        k0 = self._k(e)
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                yield from self.g.get((k0[0] + i, k0[1] + j), [])
    def add(self, e): self.g.setdefault(self._k(e), []).append(e)


def merge(gsa, osm):
    grid, out, merged = Grid(), [], 0
    for e in gsa: grid.add(e); out.append(e)
    for e in sorted(osm, key=lambda x: (x["_pri"], miles(HOME, (x["lat"], x["lon"])))):
        hit = next((o for o in grid.near(e) if same_place(o, e)), None)
        if hit:
            merged += 1
            names = {hit["name"].lower()} | {t.lower() for t in hit["tenants"]}
            for n in [e["name"]] + e["tenants"]:
                if n.lower() not in names: hit["tenants"].append(n); names.add(n.lower())
            if not hit["addr"]: hit["addr"] = e["addr"]
            continue
        grid.add(e); out.append(e)
    print("merged %d OSM features into existing entries" % merged)
    return out


def fill_emp_ids(entries):
    sys.path.insert(0, os.path.join(HERE, "refresh"))
    from normalize import match_employer
    emps = json.load(open(os.path.join(HERE, "prep4.json")))["emps"]
    for e in entries:
        ids = [m["id"] for m in emps if "lat" in m and meters((e["lat"], e["lon"]), (m["lat"], m["lon"])) <= 100]
        for nm in [e["name"]] + e["tenants"]:
            r = match_employer({"employer": nm, "loc": {"lat": e["lat"], "lon": e["lon"], "text": e["addr"]}}, emps)
            if r: ids.append(r)
        e["empIds"] = sorted(set(ids))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--refresh", action="store_true"); ap.add_argument("--no-osm", action="store_true")
    o = ap.parse_args(); today = date.today().isoformat()
    gsa = gsa_entries(fetch_gsa(o.refresh), today)
    print("GSA entries within %d mi (unique LOCATION_CODE): %d" % (RADIUS_MI, len(gsa)))
    osm = []
    if not o.no_osm:
        els, failed = fetch_osm(o.refresh)
        osm = [x for x in (osm_entry(e, today) for e in els) if x]
        if failed: print("WARNING: %d OSM tiles failed; rerun to fill them (cached tiles are kept)" % failed)
    out = merge(gsa[:CAP], osm)[:CAP]
    fill_emp_ids(out)
    for e in out: e.pop("_pri", None)
    json.dump(out, open(os.path.join(HERE, "offices.json"), "w"), indent=0, ensure_ascii=False)
    n = lambda s: sum(1 for e in out if e["source"] == s)
    print("wrote %d offices (gsa-iolp %d, osm %d); with empIds %d" % (len(out), n("gsa-iolp"), n("osm"), sum(1 for e in out if e["empIds"])))


if __name__ == "__main__":
    main()
