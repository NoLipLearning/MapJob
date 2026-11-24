"""Build src/directory.json (NoVA employer directory) from candidate files in src/dir_sources/*.json.
Run from src/:  python3 add_directory.py [--in 'dir_sources/phaseA-*.json'] [--cap 1500] [--offline]
Geocodes with Nominatim (1 request/second, cached in dir_geocache.json). A record is placed only when the geocoder
matches its house number; everything else goes to dir_unplaced.json. Spec: docs/superpowers/specs/2026-11-24-more-employers-careers-links-design.md"""
import argparse, datetime, glob, json, os, re, time, urllib.parse, urllib.request
from directory import norm_name, make_id, clean_link, match_emp, validate

NOVA = (38.40, 39.35, -78.15, -76.90)  # lat min/max, lon min/max
UA = {"User-Agent": "reston-hiring-map/1.0 (personal job-search map)"}

def lead_number(addr):
    m = re.match(r"\s*(\d+)", addr or ""); return m.group(1) if m else None

def nominatim(addr):
    q = urllib.parse.urlencode({"q": addr, "format": "jsonv2", "addressdetails": 1, "limit": 1, "countrycodes": "us"})
    with urllib.request.urlopen(urllib.request.Request("https://nominatim.openstreetmap.org/search?" + q, headers=UA), timeout=30) as r:
        res = json.load(r)
    if not res: return {"miss": True}
    a = res[0]; return {"lat": round(float(a["lat"]), 6), "lon": round(float(a["lon"]), 6), "hn": (a.get("address") or {}).get("house_number")}

def cached_geocoder(cache, cap, offline):
    left = [cap]
    def geo(addr):
        if addr in cache: return cache[addr]
        if offline or left[0] <= 0: return None
        left[0] -= 1; time.sleep(1.05)
        try: cache[addr] = nominatim(addr)
        except Exception as x: print("geocode failed:", addr, x); return None
        return cache[addr]
    return geo

def build(cands, emps, geo, today, prev):
    prevd = {r["id"]: r for r in prev}; out, unplaced = {}, []
    for c in cands:
        addr = (c.get("addr") or "").strip() or None
        g = geo(addr) if addr else None
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
