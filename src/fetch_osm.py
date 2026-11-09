"""Fetch OSM buildings + streets for the Rosslyn-Ballston corridor via Overpass, in small boxes, with retries.
Usage: python3 fetch_osm.py   (writes src/osm_raw/*.json; skips boxes already fetched)"""
import json, os, sys, time, urllib.request, urllib.parse
HOSTS = ["https://overpass-api.de/api/interpreter"]
UA = "reston-hiring-map/1.0 (personal job-search map; contact ericbally92@gmail.com)"
S, N, W, E = 38.872, 38.905, -77.118, -77.058
COLS, ROWS = 3, 2
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "osm_raw"); os.makedirs(out, exist_ok=True)
def q(kind, s, w, n, e):
    if kind == "bld": body = f'way["building"]({s},{w},{n},{e});out tags geom;'
    else: body = f'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|service|living_street|pedestrian)$"]({s},{w},{n},{e});out tags geom;'
    return f"[out:json][timeout:90];{body}"
def post(query):
    data = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for attempt in range(8):
        host = HOSTS[attempt % len(HOSTS)]
        try:
            req = urllib.request.Request(host, data=data, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read())
        except Exception as ex:
            last = ex; wait = min(60, 5 * 2 ** attempt); print("  retry", attempt, repr(ex)[:120], "wait", wait, flush=True); time.sleep(wait)
    raise SystemExit(f"giving up: {last!r}")
ds, dw = (N - S) / ROWS, (E - W) / COLS
for kind in ("bld", "hwy"):
    for r in range(ROWS):
        for c in range(COLS):
            f = os.path.join(out, f"{kind}_{r}{c}.json")
            if os.path.exists(f): continue
            s, w = S + r * ds, W + c * dw
            print("fetch", kind, r, c, flush=True)
            res = post(q(kind, round(s, 5), round(w, 5), round(s + ds, 5), round(w + dw, 5)))
            json.dump(res, open(f, "w")); print("  ok", len(res.get("elements", [])), flush=True); time.sleep(3)
print("DONE")
