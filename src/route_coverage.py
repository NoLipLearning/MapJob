"""Buildings per mile along Eric's commute corridors (1 mile each side). Usage (from src/): python3 route_coverage.py [--label before]
Counts footprints from prep4.json 'b' (meters) and every registered tile (decimeters), by building centroid."""
import json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
LAT0, LON0 = 38.955, -77.355; KX = 111320 * math.cos(math.radians(LAT0)); KY = 110574
P = lambda lon, lat: ((lon - LON0) * KX, (LAT0 - lat) * KY)
MILE = 1609.34
def cents():
    d = json.load(open(os.path.join(HERE, 'prep4.json')))
    for b in d['b']:
        xs, zs = b[2::2], b[3::2]; yield sum(xs) / len(xs), sum(zs) / len(zs)
    for t in d.get('tiles', []):
        for b in json.load(open(os.path.join(ROOT, t['file']))):
            xs, zs = b[2::2], b[3::2]; yield sum(xs) / len(xs) / 10, sum(zs) / len(zs) / 10
def main():
    routes = json.load(open(os.path.join(HERE, 'routes_corridor.json')))['routes']
    C = list(cents()); grid = {}
    for c in C: grid.setdefault((int(c[0] // MILE), int(c[1] // MILE)), []).append(c)
    rep = {}
    for k, v in routes.items():
        pts = [P(*p) for p in v['coords']]; L = [0]
        for a, b in zip(pts, pts[1:]): L.append(L[-1] + math.dist(a, b))
        nm = int(L[-1] // MILE) + 1; per = [0] * nm
        for i, (x, z) in enumerate(pts):  # assign each building to the nearest route point within 1 mile
            pass
        seen = {}
        for i, (x, z) in enumerate(pts):
            gx, gz = int(x // MILE), int(z // MILE)
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for c in grid.get((gx + dx, gz + dz), []):
                        dd = math.dist(c, (x, z))
                        if dd <= MILE and (c not in seen or dd < seen[c][0]): seen[c] = (dd, i)
        for c, (dd, i) in seen.items(): per[min(int(L[i] // MILE), nm - 1)] += 1
        gaps = [m for m, n in enumerate(per) if n == 0]
        rep[k] = {'miles': round(L[-1] / MILE, 1), 'buildings': len(seen), 'per_mile': per, 'zero_miles': gaps}
        print('%-22s %5.1f mi  %6d bldgs  zero-building miles: %s' % (k, L[-1] / MILE, len(seen), gaps or 'none'))
        print('   per mile:', per)
    if len(sys.argv) > 2 and sys.argv[1] == '--label':
        json.dump(rep, open(os.path.join(ROOT, 'docs', 'route-coverage-%s.json' % sys.argv[2]), 'w'), indent=1)
main()
