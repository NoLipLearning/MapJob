"""Spot checks for route buildings. Run from src/ after route_buildings.py:  python3 route_spotcheck.py
A check passes when its point is inside a building outline (tiles registered in prep4.json, plus the base buildings 'b') or the nearest outline is within 100 m.
Points are employer coordinates from prep4.json where Eric's map has the employer (id given), otherwise a landmark lat/lon written here."""
import json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
LAT0, LON0 = 38.955, -77.355; KX = 111320 * math.cos(math.radians(LAT0)); KY = 110574
P = lambda lon, lat: ((lon - LON0) * KX, (LAT0 - lat) * KY)
NEAR = 100.0
EMP = 'emp:'
CHECKS = [  # the ten from docs/AGENT-PROMPT-ROUTE-BUILDINGS.md
    ('NRA HQ, 11250 Waples Mill Rd', EMP + 'nra-hq'),
    ('Fair Lakes Center', (38.8613, -77.3917)),
    ('Inova Fair Oaks Hospital', EMP + 'inova-fair-oaks'),
    ('Reston Town Center', (38.9586, -77.3590)),
    ('Loudoun County Government Center, Leesburg', EMP + 'loudoun-county-government'),
    ('Dulles Town Center', (39.0263, -77.4143)),
    ('NOVA Community College, Manassas', EMP + 'nova-manassas'),
    ('Haymarket Medical Center', EMP + 'haymarket-medical-center'),
    ('Fauquier County Courthouse, Warrenton', (38.7140, -77.7955)),
    ('Navy Federal HQ, Vienna', EMP + 'navy-federal-vienna'),
    # employer-pad checks
    ('NOVA Manassas (pad)', EMP + 'nova-manassas'),
    ('Haymarket Medical Center (pad)', EMP + 'haymarket-medical-center'),
    ('GMU Science and Technology, Manassas', EMP + 'gmu-scitech-manassas'),
    ('Prince William Medical Center', EMP + 'prince-william-medical-center'),
    ('BAE Systems, Manassas', EMP + 'bae-systems-manassas'),
    ('Micron, Manassas', EMP + 'micron-manassas'),
]
def inside(pt, poly):
    x, y = pt; c = False
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c
def seg_dist(p, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dz * dz
    t = 0 if not L2 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz)
def outlines():  # yields (source, polygon in metres)
    d = json.load(open(os.path.join(HERE, 'prep4.json')))
    for b in d['b']: yield 'base', [(b[i], b[i + 1]) for i in range(2, len(b), 2)]
    for t in d['tiles']:
        for b in json.load(open(os.path.join(ROOT, t['file']))): yield t['id'], [(b[i] / 10, b[i + 1] / 10) for i in range(2, len(b), 2)]
def run():
    d = json.load(open(os.path.join(HERE, 'prep4.json'))); emp = {e['id']: (e['lat'], e['lon']) for e in d['emps']}
    pts = [(n, emp[w[len(EMP):]] if isinstance(w, str) else w) for n, w in CHECKS]
    xz = [P(lon, lat) for n, (lat, lon) in pts]; best = [(1e9, None)] * len(pts); hit = [None] * len(pts)
    for src, poly in outlines():
        xs = [p[0] for p in poly]; zs = [p[1] for p in poly]
        for i, p in enumerate(xz):
            if hit[i] or p[0] < min(xs) - NEAR or p[0] > max(xs) + NEAR or p[1] < min(zs) - NEAR or p[1] > max(zs) + NEAR: continue
            if inside(p, poly): hit[i] = src; continue
            dd = min(seg_dist(p, poly[k - 1], poly[k]) for k in range(len(poly)))
            if dd < best[i][0]: best[i] = (dd, src)
    fails = 0
    for i, (n, _) in enumerate(pts):
        if hit[i]: print('PASS  %-46s inside an outline (%s)' % (n, hit[i]))
        elif best[i][0] <= NEAR: print('PASS  %-46s nearest outline %.0f m (%s)' % (n, best[i][0], best[i][1]))
        else: fails += 1; print('FAIL  %-46s nearest outline %s' % (n, '%.0f m' % best[i][0] if best[i][1] else 'none within %d m' % NEAR))
    print('%d of %d pass' % (len(pts) - fails, len(pts))); return fails
if __name__ == '__main__': sys.exit(1 if run() else 0)
