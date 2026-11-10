"""Independent check of src/offices.json. Usage: python3 src/check_coverage.py   (exit 0 = pass)
1. Schema: every entry matches docs/DATA-CONTRACT-v4.md (fields, types, <= 4000, within 30 mi, unique ids).
2. Coverage: re-download the GSA IOLP records from scratch (no cache) and confirm every federal record within 30 miles is in offices.json.
   Preferred source is the GSA file listed on inventory.data.gov. If that host refuses (its CKAN API answers 403 "Access denied"), this
   falls back to a fresh, differently-filtered download (ArcGIS distance query, not the bounding box offices.py used) and says so."""
import json, math, os, re, sys, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import offices as O

KINDS = {"federal", "government", "office", "nonprofit", "company"}
SOURCES = {"gsa-iolp", "osm"}
ID_RE = re.compile(r"^(gsa-[A-Za-z0-9]+|osm-[a-z]+-\d+|osm-way-\d+)$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate(offices, employer_ids):
    errs = []
    if not isinstance(offices, list): return ["offices.json must be a list"]
    if len(offices) > 4000: errs.append("more than 4000 entries (%d)" % len(offices))
    seen = set()
    for i, e in enumerate(offices):
        w = "entry %d (%s)" % (i, e.get("id") if isinstance(e, dict) else "?")
        if not isinstance(e, dict): errs.append(w + ": not an object"); continue
        extra = set(e) - {"id", "name", "kind", "tenants", "addr", "lat", "lon", "source", "sourceUrl", "empIds", "checked"}
        if extra: errs.append("%s: unexpected keys %s" % (w, sorted(extra)))
        if not (isinstance(e.get("id"), str) and ID_RE.match(e["id"])): errs.append(w + ": bad id")
        if e.get("id") in seen: errs.append(w + ": duplicate id")
        seen.add(e.get("id"))
        if not (isinstance(e.get("name"), str) and e["name"].strip()): errs.append(w + ": name")
        if e.get("kind") not in KINDS: errs.append(w + ": kind")
        if not (isinstance(e.get("tenants"), list) and all(isinstance(t, str) and t for t in e["tenants"])): errs.append(w + ": tenants")
        if not isinstance(e.get("addr"), str): errs.append(w + ": addr")
        if not (isinstance(e.get("lat"), (int, float)) and isinstance(e.get("lon"), (int, float))): errs.append(w + ": lat/lon"); continue
        if O.miles(O.HOME, (e["lat"], e["lon"])) > O.RADIUS_MI: errs.append(w + ": farther than 30 miles")
        if e.get("source") not in SOURCES: errs.append(w + ": source")
        if (e.get("source") == "gsa-iolp") != (e.get("kind") == "federal") and e.get("source") == "gsa-iolp": errs.append(w + ": gsa entry must be federal")
        if not (isinstance(e.get("sourceUrl"), str) and (e["sourceUrl"] == "" or e["sourceUrl"].startswith("https://"))): errs.append(w + ": sourceUrl")
        if not (isinstance(e.get("empIds"), list) and all(x in employer_ids for x in e["empIds"])): errs.append(w + ": empIds not existing employers")
        if not (isinstance(e.get("checked"), str) and DATE_RE.match(e["checked"])): errs.append(w + ": checked")
    return errs


def try_inventory():
    """Ask inventory.data.gov (CKAN) for the GSA IOLP dataset. Returns the reason it could not be used, or None if reachable."""
    url = "https://inventory.data.gov/api/3/action/package_search?" + urllib.parse.urlencode({"q": "owned leased properties gsa iolp", "rows": 5})
    try:
        d = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": O.UA}), timeout=40).read())
        return None if d.get("success") else "answered %s" % (d.get("error") or d)
    except Exception as ex:
        return repr(ex)[:120]


def fresh_gsa_codes():
    """Re-download every layer by a distance query around home, ignoring caches."""
    got = {}
    for svc, layer, code_f, name_f, lat_f, lon_f in O.GSA_LAYERS:
        off = 0
        while True:
            q = urllib.parse.urlencode({"where": "1=1", "geometry": "%s,%s" % (O.HOME[1], O.HOME[0]), "geometryType": "esriGeometryPoint", "inSR": 4326,
                                        "spatialRel": "esriSpatialRelIntersects", "distance": int(O.RADIUS_MI * 1609.344 * 1.02), "units": "esriSRUnit_Meter",
                                        "outFields": "*", "returnGeometry": "false", "orderByFields": "OBJECTID", "resultOffset": off, "f": "json"})
            d = O.http("%s/%s/FeatureServer/%d/query?%s" % (O.GSA_ROOT, svc, layer, q))
            rows = [f["attributes"] for f in d.get("features", [])]
            for a in rows:
                code, lat, lon = (a.get(code_f) or "").strip(), a.get(lat_f), a.get(lon_f)
                if code and isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and O.miles(O.HOME, (lat, lon)) <= O.RADIUS_MI:
                    got.setdefault("gsa-" + code, svc)
            off += len(rows)
            if not rows or not d.get("exceededTransferLimit"): break
    return got


def main():
    offices = json.load(open(os.path.join(HERE, "offices.json")))
    emps = {e["id"] for e in json.load(open(os.path.join(HERE, "prep4.json")))["emps"]}
    errs = validate(offices, emps)
    by_src = {s: sum(1 for e in offices if e.get("source") == s) for s in SOURCES}
    print("offices.json: %d entries %s; schema errors: %d" % (len(offices), by_src, len(errs)))
    for x in errs[:15]: print("  SCHEMA:", x)
    why = try_inventory()
    if why:
        print("inventory.data.gov not usable (%s); stopped using it. Falling back to a fresh ArcGIS distance-query download of the same IOLP layers." % why)
    fresh = fresh_gsa_codes()
    have = {e["id"] for e in offices}
    missing = sorted(set(fresh) - have)
    print("federal records within 30 mi in fresh download: %d; in offices.json: %d; missing: %d" % (len(fresh), len(set(fresh) & have), len(missing)))
    for m in missing[:30]: print("  MISSING:", m, "(%s)" % fresh[m])
    ok = not errs and not missing
    print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
