"""Build src/directory.json (NoVA employer directory) from candidate files in src/dir_sources/*.json.
Run from src/:  python3 add_directory.py [--in 'dir_sources/phaseA-*.json'] [--cap 1500] [--offline]
Geocodes with the US Census geocoder (cached in dir_geocache.json; Nominatim kept as nominatim()). A record is placed only when the geocoder
matches its house number; everything else goes to dir_unplaced.json. Spec: docs/superpowers/specs/2026-11-24-more-employers-careers-links-design.md"""
import argparse, datetime, glob, json, os, re, time, urllib.error, urllib.parse, urllib.request
from directory import norm_name, make_id, clean_link, match_emp, validate

NOVA = (38.40, 39.35, -78.15, -76.90)  # lat min/max, lon min/max
UA = {"User-Agent": "reston-hiring-map/1.0 (personal job-search map)"}

def lead_number(addr):
    m = re.match(r"\s*(\d+)", addr or ""); return m.group(1) if m else None

def parse_census(body):
    m = (body.get("result") or {}).get("addressMatches") or []
    if not m: return {"miss": True}
    c, ma = m[0]["coordinates"], m[0].get("matchedAddress", "")
    return {"lat": round(c["y"], 6), "lon": round(c["x"], 6), "hn": lead_number(ma), "via": "census"}

def census(addr):
    """US Census Bureau geocoder: matches the house number against TIGER address ranges (no bulk-use limit)."""
    q = urllib.parse.urlencode({"address": addr, "benchmark": "Public_AR_Current", "format": "json"})
    with urllib.request.urlopen(urllib.request.Request("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" + q, headers=UA), timeout=40) as r:
        return parse_census(json.load(r))

def nominatim(addr):
    q = urllib.parse.urlencode({"q": addr, "format": "jsonv2", "addressdetails": 1, "limit": 1, "countrycodes": "us"})
    with urllib.request.urlopen(urllib.request.Request("https://nominatim.openstreetmap.org/search?" + q, headers=UA), timeout=30) as r:
        res = json.load(r)
    if not res: return {"miss": True}
    a = res[0]; return {"lat": round(float(a["lat"]), 6), "lon": round(float(a["lon"]), 6), "hn": (a.get("address") or {}).get("house_number")}

def geo_query(addr):
    """The address without suite, floor or room parts, which Nominatim cannot match."""
    parts = [p.strip() for p in addr.split(",")]
    parts = [re.sub(r"\s+(?:suite|ste\.?|#|unit|room|rm\.?)\s*[\w-]+$", "", p, flags=re.I) for p in parts]
    keep = [p for p in parts if p and not re.match(r"^(?:suite|ste\.?|#|unit|room|rm\.?|floor|fl\.?|\d+(?:st|nd|rd|th) floor)\b", p, re.I)]
    return ", ".join(keep)

def cached_geocoder(cache, cap, offline, fetch=None, pause=0.3):
    """Looks up each address once (cached by the cleaned query). Stops for the rest of the run on any HTTP error (rate limit)."""
    fetch = fetch or census; left, stopped = [cap], [False]
    def geo(addr):
        q = geo_query(addr)
        if q in cache: return cache[q]
        if offline or stopped[0] or left[0] <= 0: return None
        left[0] -= 1; time.sleep(pause)
        try: cache[q] = fetch(q)
        except urllib.error.HTTPError as x: print("geocoder refused (HTTP", x.code, ") - stopping lookups for this run"); stopped[0] = True; return None
        except Exception as x: print("geocode failed:", q, x); return None
        return cache[q]
    return geo

def build(cands, emps, geo, today, prev):
    prevd = {r["id"]: r for r in prev}; out, unplaced = {}, []
    for c in cands:
        addr = (c.get("addr") or "").strip() or None
        g = geo(addr) if addr else None
        keep = prevd.get(make_id(c["name"], addr)) if addr and g is None else None
        if keep:  # lookup unavailable this run (rate limit or cap): keep the last good placement
            out.setdefault(keep["id"], keep); continue
        why = ("no address" if not addr else "not geocoded yet" if g is None else "no match" if g.get("miss")
               else "house number not matched" if not g.get("hn") or g["hn"].split("-")[0] != lead_number(addr)
               else "outside NoVA" if not (NOVA[0] <= g["lat"] <= NOVA[1] and NOVA[2] <= g["lon"] <= NOVA[3]) else None)
        if why: unplaced.append({"name": c.get("name"), "addr": addr, "why": why, "src": c.get("src")}); continue
        link = clean_link(c.get("link"))
        r = {"id": make_id(c["name"], addr), "name": c["name"].strip(), "kind": c.get("kind"), "addr": addr, "lat": g["lat"], "lon": g["lon"], "gc": "addr",
             "link": link, "linkType": c.get("linkType") if link else None, "src": list(c.get("src") or []), "via": c.get("via", "list")}
        e = match_emp(r, emps)
        if e: r["empId"] = e
        p = prevd.get(r["id"])
        r["checked"] = p["checked"] if p and p.get("link") == r["link"] else today
        if r["id"] in out: out[r["id"]]["src"] = sorted(set(out[r["id"]]["src"]) | set(r["src"]))
        else: out[r["id"]] = r
    recs = [out[k] for k in sorted(out)]
    stats = {"placed": len(recs), "careers": sum(r["linkType"] == "careers" for r in recs), "website": sum(r["linkType"] == "website" for r in recs),
             "no link": sum(not r["link"] for r in recs), "not placed": len(unplaced)}
    return recs, unplaced, stats

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--in", dest="inp", default="dir_sources/phase*.json")
    ap.add_argument("--cap", type=int, default=1500); ap.add_argument("--offline", action="store_true"); a = ap.parse_args()
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    cands = []
    for f in sorted(glob.glob(a.inp)):
        rows = json.load(open(f)); cands += [dict(r, via=r.get("via") or ("sam" if "sam" in os.path.basename(f) else "list")) for r in rows]
    cache = json.load(open("dir_geocache.json")) if os.path.exists("dir_geocache.json") else {}
    prev = json.load(open("directory.json")) if os.path.exists("directory.json") else []
    emps = json.load(open("prep4.json"))["emps"]
    try: recs, unplaced, stats = build(cands, emps, cached_geocoder(cache, a.cap, a.offline), datetime.date.today().isoformat(), prev)
    finally: json.dump(cache, open("dir_geocache.json", "w"), indent=0, sort_keys=True)
    errs = validate(recs)
    if errs: raise SystemExit("invalid records:\n" + "\n".join(errs[:20]))
    json.dump(recs, open("directory.json", "w"), indent=0, ensure_ascii=False)
    json.dump(unplaced, open("dir_unplaced.json", "w"), indent=1, ensure_ascii=False)
    print(" | ".join(f"{k} {v}" for k, v in stats.items()))

if __name__ == "__main__": main()
