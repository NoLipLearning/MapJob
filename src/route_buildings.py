"""Add real county building footprints (commercial/office/industrial/public, no houses) along Eric's commute routes as 3D tiles.
Reads routes_corridor.json, pulls footprints inside the 1-mile corridor from each county adapter, writes tiles/rb-<ix>_<iz>.json (4 km cells),
registers them in prep4.json 'tiles' and writes route_building_names.json. Idempotent: re-running replaces its own earlier tiles (ids starting 'rb-').
Run from src/ AFTER add_rosslyn.py / add_employers.py (they rebuild prep4.json from the base copy):  python3 route_buildings.py [--max-bytes N]
Adding a county: write another adapter class (see FairfaxArcGIS) and put it in ADAPTERS. An adapter has .source, .bbox (lon0,lat0,lon1,lat1 rough coverage)
and .fetch(bbox_ll) -> iterable of dict(uid, name, kind, height_m or None, ring=[[lon,lat],...]) for every non-house footprint touching bbox_ll."""
import json, math, os, glob, time, sys, urllib.request, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
LAT0, LON0 = 38.955, -77.355
KX = 111320 * math.cos(math.radians(LAT0)); KY = 110574
P = lambda lon, lat: ((lon - LON0) * KX, (LAT0 - lat) * KY)
CORRIDOR = 1609.0; CELL = 4000; MIN_AREA = 150; EPS = 0.7; PREFIX = 'rb-'
DEF_H = {'C': 9, 'O': 12, 'I': 9, 'P': 8, 'MU': 14, 'MG': 10}
PLACES = {'Reston': (38.9586, -77.3570), 'Herndon': (38.9696, -77.3861), 'Fair Oaks': (38.8580, -77.3580), 'Fair Lakes': (38.8610, -77.3920),
          'Chantilly': (38.8943, -77.4311), 'Centreville': (38.8404, -77.4289), 'Vienna': (38.9012, -77.2653), 'Oakton': (38.8815, -77.3000),
          'Merrifield': (38.8710, -77.2300), 'Dulles': (38.9531, -77.4565), 'Sterling': (39.0062, -77.4286), 'Ashburn': (39.0437, -77.4875),
          'Leesburg': (39.1157, -77.5636), 'Haymarket': (38.8120, -77.6364), 'Gainesville': (38.7940, -77.6140), 'Warrenton': (38.7135, -77.7953),
          'Manassas': (38.7509, -77.4753), 'Falls Church': (38.8823, -77.1711), 'Fairfax': (38.8462, -77.3064), 'Tysons': (38.9187, -77.2311),
          'Dulles Town Center': (39.0270, -77.4170), 'Lorton': (38.7040, -77.2280), 'Lansdowne': (39.0809, -77.4830), 'Brambleton': (38.9917, -77.5300), 'Cascades': (39.0500, -77.3900), 'Buckland': (38.7517, -77.6806), 'New Baltimore': (38.7603, -77.7087), 'Bull Run': (38.80, -77.52), 'Broad Run': (38.7400, -77.6900), 'Catlett': (38.6500, -77.6400), 'Springfield': (38.7893, -77.1872), 'Burke': (38.7934, -77.2717)}

# ---------------- source adapters ----------------
# An adapter has .source (label), .key, .bbox (lon0,lat0,lon1,lat1 rough coverage), .min_area (m2, unnamed footprints below it are dropped),
# .prepare(ctx) (optional, once), .fetch(bbox_ll) -> iterable of dict(uid, ident, name, kind, height_m|None, ring=[[lon,lat],..]),
# .keep(f, c_ll, c_xz, area) -> None to keep or a short reason string to drop, and .default_h(f, area) in meters when the source has no height.
def _http(url, params):
    for att in range(4):
        try:
            with urllib.request.urlopen(url + '?' + urllib.parse.urlencode(params), timeout=90) as r: return json.load(r)
        except Exception:
            if att == 3: raise
            time.sleep(2 * (att + 1))
def _outer(rings): return max(rings, key=lambda r: abs(sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))))
class ArcGISBase:
    min_area = MIN_AREA; default_height = None
    def __init__(self): self.cache = os.path.join(HERE, self.cache_dir); os.makedirs(self.cache, exist_ok=True)
    def prepare(self, ctx): pass
    def keep(self, f, c_ll, c_xz, area): return None
    def default_h(self, f, area): return DEF_H.get(f['kind'], 9)
    def pages(self, url, params, tag, size):  # cached, paginated ArcGIS query -> features
        off = 0; page = 0
        while True:
            fn = os.path.join(self.cache, '%s_%d.json' % (tag, page))
            if os.path.exists(fn): d = json.load(open(fn))
            else:
                d = _http(url, dict(params, resultOffset=off, resultRecordCount=size, f='json'))
                if 'error' in d: raise RuntimeError(d['error'])
                json.dump(d, open(fn, 'w'), separators=(',', ':')); time.sleep(0.3)  # polite pause between live pages
            for f in d.get('features', []): yield f
            if not d.get('exceededTransferLimit'): break
            off += len(d.get('features', [])) or size; page += 1
    def fetch(self, bb):
        env = dict(geometry='%f,%f,%f,%f' % bb, geometryType='esriGeometryEnvelope', spatialRel='esriSpatialRelIntersects', inSR=4326, outSR=4326, geometryPrecision=6, returnGeometry='true')
        for f in self.pages(self.url, dict(env, where=self.where, outFields=self.fields), 'q_%.4f_%.4f_%.4f_%.4f' % bb, self.page_size):
            rings = (f.get('geometry') or {}).get('rings') or []
            if rings: yield self.parse(f['attributes'], _outer(rings))
class FairfaxArcGIS(ArcGISBase):
    source = 'Fairfax County GIS Buildings'; key = 'fairfax'; cache_dir = 'fairfax_raw'; page_size = 2000
    url = 'https://services1.arcgis.com/ioennV6PpG5Xodq0/ArcGIS/rest/services/Buildings/FeatureServer/0/query'
    bbox = (-77.55, 38.60, -77.04, 39.07)
    where = "TYPE IN ('C','O','I','P','MU','MG')"
    fields = 'OBJECTID,NAME,TYPE,BLDG_HEIGHT,TOP_ELEV,GROUND_ELEV,BLDG_CM_TYPE,BLDGIDENT'
    def parse(self, a, ring):
        h = a.get('BLDG_HEIGHT')
        if h is None and a.get('TOP_ELEV') is not None and a.get('GROUND_ELEV') is not None: h = a['TOP_ELEV'] - a['GROUND_ELEV']
        return dict(uid='fairfax:%s' % a['OBJECTID'], ident=a.get('BLDGIDENT'), name=(a.get('NAME') or '').strip() or None, kind=a.get('TYPE'), height_m=(h * 0.3048 if h and h > 0 else None), ring=ring)  # heights are feet
class LoudounArcGIS(ArcGISBase):
    """Footprints only (no use, name or height): keep by the zoning district under the centroid, or by size. Needs Zoning layer 3."""
    source = 'Loudoun County GIS'; key = 'loudoun'; cache_dir = 'loudoun_raw'; page_size = 5000
    url = 'https://logis.loudoun.gov/gis/rest/services/COL/LoudounMEGDS/MapServer/16/query'
    zurl = 'https://logis.loudoun.gov/gis/rest/services/COL/Zoning/MapServer/3/query'
    bbox = (-77.99, 38.84, -77.33, 39.33)
    where = 'SHAPE_Area>=1600'  # layer is in sq ft (wkid 2924); 1600 ft2 ~ 150 m2
    fields = 'OBJECTID,SHAPE_Area'
    # districts read from ZD_ZONE_NAME/DESC: office, commercial, industrial, town/transit center, mixed-use business. Everything residential/rural (R*, CR*, TR*, AR*, A*, JLMA*, PDH*, PDAAAR, SCN*, PUD, PDRV, RC) is left out.
    NONRES = {'C1', 'CCCC', 'CCNC', 'CCSC', 'CLI', 'GB', 'GI', 'IP', 'MRHI', 'OP', 'PDCCRC', 'PDCH', 'PDGI', 'PDIP', 'PDMUB', 'PDOP', 'PDRDP', 'PDSA', 'PDSC', 'TC', 'TRC'}
    BIG = 2500; TOWN_MIN = 600  # footprints this big are never houses; in towns/unzoned land (Leesburg, federal land) fall back to the size rule
    def parse(self, a, ring): return dict(uid='loudoun:%s' % a['OBJECTID'], ident=None, name=None, kind=None, height_m=None, ring=ring)
    def prepare(self, ctx):
        bb = (max(self.bbox[0], min(c[0] for c in ctx['cells_ll'])), max(self.bbox[1], min(c[1] for c in ctx['cells_ll'])), min(self.bbox[2], max(c[2] for c in ctx['cells_ll'])), min(self.bbox[3], max(c[3] for c in ctx['cells_ll'])))
        self.zones = []; self.stat = {}
        for f in self.pages(self.zurl, dict(where='1=1', geometry='%f,%f,%f,%f' % bb, geometryType='esriGeometryEnvelope', spatialRel='esriSpatialRelIntersects', inSR=4326, outSR=4326, geometryPrecision=6, outFields='ZO_ZONE,ZD_ZONE_NAME', returnGeometry='true'), 'zoning', 1000):
            rings = (f.get('geometry') or {}).get('rings') or []
            if not rings: continue
            xs = [p[0] for r in rings for p in r]; ys = [p[1] for r in rings for p in r]
            self.zones.append((min(xs), min(ys), max(xs), max(ys), f['attributes']['ZO_ZONE'], rings))
        print('loudoun zoning polygons', len(self.zones))
    def zone(self, c):
        for x0, y0, x1, y1, z, rings in self.zones:
            if x0 <= c[0] <= x1 and y0 <= c[1] <= y1:
                n = False
                for r in rings:
                    if inside(c, r): n = not n
                if n: return z
        return None
    def keep(self, f, c_ll, c_xz, area):
        z = self.zone(c_ll); k = z if z in self.NONRES else (z if z == 'TOWNS' else 'unzoned' if z is None else 'res')
        self.stat.setdefault(k, [0, 0]); r = None
        if z in self.NONRES or area >= self.BIG: pass
        elif z in (None, 'TOWNS') and area >= self.TOWN_MIN: pass
        else: r = 'zone'
        self.stat[k][0 if r is None else 1] += 1
        return r
    def default_h(self, f, area): return 6 if area < 400 else 8 if area < 1500 else 10 if area < 5000 else 12  # no height in the source
class MicrosoftBuildings:
    """Microsoft US Building Footprints (Virginia). Fallback for stretches with no reachable county layer: footprints only, use unknown, so only big ones (>= 600 m2) are kept."""
    source = 'Microsoft US Building Footprints (use unknown)'; key = 'ms'; min_area = 600
    bbox = (-77.86, 38.68, -77.52, 38.87)  # Prince William / Fauquier part of the US-29 route, west of the Fairfax line (Bull Run)
    route = 'warrenton_us29'; zip = os.path.join(HERE, 'ms_raw', 'Virginia.geojson.zip'); cache = os.path.join(HERE, 'ms_raw', 'ms_region.json')
    def prepare(self, ctx):
        self.cor = ctx['cors'][self.route]
        if not os.path.exists(self.cache):
            import zipfile, re
            rx = re.compile(r'"coordinates":\[\[\[(-?[\d.]+),(-?[\d.]+)'); out = []; n = 0
            z = zipfile.ZipFile(self.zip)
            with z.open(z.namelist()[0]) as fh:  # one feature per line: stream, pre-filter on the first vertex before parsing JSON
                for line in fh:
                    n += 1; m = rx.search(line.decode('ascii', 'ignore')[:200])
                    if not m: continue
                    lon, lat = float(m.group(1)), float(m.group(2))
                    if not (self.bbox[0] - .01 <= lon <= self.bbox[2] + .01 and self.bbox[1] - .01 <= lat <= self.bbox[3] + .01): continue
                    ring = json.loads(line.strip().rstrip(b',').decode())['geometry']['coordinates'][0]
                    raw = [P(*p) for p in ring[:-1]]
                    if len(raw) < 3: continue
                    a = abs(sum(raw[i][0] * raw[(i + 1) % len(raw)][1] - raw[(i + 1) % len(raw)][0] * raw[i][1] for i in range(len(raw)))) / 2
                    if a >= self.min_area: out.append(ring)
            json.dump(out, open(self.cache, 'w'), separators=(',', ':')); print('ms: scanned', n, 'lines, kept', len(out), 'big footprints in the region')
        self.feats = json.load(open(self.cache)); self.idx = {}
        for i, ring in enumerate(self.feats): self.idx.setdefault((int(ring[0][0] * 100), int(ring[0][1] * 100)), []).append(i)
    def fetch(self, bb):
        for gx in range(int(bb[0] * 100) - 1, int(bb[2] * 100) + 2):
            for gy in range(int(bb[1] * 100) - 1, int(bb[3] * 100) + 2):
                for i in self.idx.get((gx, gy), []):
                    ring = self.feats[i]; yield dict(uid='ms:%d' % i, ident=None, name=None, kind=None, height_m=None, ring=ring)
    def keep(self, f, c_ll, c_xz, area):
        if not (self.bbox[0] <= c_ll[0] <= self.bbox[2] and self.bbox[1] <= c_ll[1] <= self.bbox[3]): return 'region'
        return None if self.cor.near(c_xz) else 'corridor'
    def default_h(self, f, area): return 6 if area < 400 else 8 if area < 1500 else 10 if area < 5000 else 12
ADAPTERS = [FairfaxArcGIS, LoudounArcGIS, MicrosoftBuildings]

# ---------------- geometry helpers ----------------
def dp(pts, eps):
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]; dx, dy = x2 - x1, y2 - y1; L = math.hypot(dx, dy) or 1e-9; mi, md = 0, 0
    for i in range(1, len(pts) - 1):
        x, y = pts[i]; dd = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / L
        if dd > md: md, mi = dd, i
    if md > eps: return dp(pts[:mi + 1], eps)[:-1] + dp(pts[mi:], eps)
    return [pts[0], pts[-1]]
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
class Corridor:
    def __init__(self, routes, w):
        self.w = w; self.segs = []; self.grid = {}
        for v in routes.values():
            pts = [P(*p) for p in v['coords']]
            for a, b in zip(pts, pts[1:]): self.segs.append((a, b))
        for i, (a, b) in enumerate(self.segs):
            for gx in range(int((min(a[0], b[0]) - w) // 2000), int((max(a[0], b[0]) + w) // 2000) + 1):
                for gz in range(int((min(a[1], b[1]) - w) // 2000), int((max(a[1], b[1]) + w) // 2000) + 1): self.grid.setdefault((gx, gz), []).append(i)
    def near(self, p, w=None):
        w = w or self.w
        return any(seg_dist(p, *self.segs[i]) <= w for i in self.grid.get((int(p[0] // 2000), int(p[1] // 2000)), []))

def main():
    maxb = int(sys.argv[sys.argv.index('--max-bytes') + 1]) if '--max-bytes' in sys.argv else None
    routes = json.load(open(os.path.join(HERE, 'routes_corridor.json')))['routes']
    D = json.load(open(os.path.join(HERE, 'prep4.json')))
    for f in glob.glob(os.path.join(ROOT, 'tiles', PREFIX + '*.json')): os.remove(f)
    D['tiles'] = [t for t in D['tiles'] if not t['id'].startswith(PREFIX)]
    existing = D['tiles']  # real tiles only; buildings whose centroid is inside one are already drawn
    bg = {}
    for b in D['b']:
        xs, zs = b[2::2], b[3::2]; c = (sum(xs) / len(xs), sum(zs) / len(zs)); bg.setdefault((int(c[0] // 30), int(c[1] // 30)), []).append((c, [(b[i], b[i + 1]) for i in range(2, len(b), 2)]))
    def dup_b(c):
        for gx in (-1, 0, 1):
            for gz in (-1, 0, 1):
                for cc, poly in bg.get((int(c[0] // 30) + gx, int(c[1] // 30) + gz), []):
                    if math.dist(c, cc) <= 15 or inside(c, poly): return True
        return False
    cors = {k: Corridor({k: v}, CORRIDOR) for k, v in routes.items()}; cor = Corridor(routes, CORRIDOR)
    cells = set()  # 4 km cells that touch the corridor
    for a, b in cor.segs:
        n = max(1, int(math.dist(a, b) // 500) + 1)
        for k in range(n + 1):
            x, z = a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n
            for ix in range(int((x - CORRIDOR) // CELL), int((x + CORRIDOR) // CELL) + 1):
                for iz in range(int((z - CORRIDOR) // CELL), int((z + CORRIDOR) // CELL) + 1): cells.add((ix, iz))
    def cell_ll(ix, iz):
        x0, z0 = ix * CELL, iz * CELL
        return (LON0 + x0 / KX, LAT0 - (z0 + CELL) / KY, LON0 + (x0 + CELL) / KX, LAT0 - z0 / KY)  # lon0, lat0, lon1, lat1
    ctx = dict(cors=cors, cor=cor, cells_ll=[cell_ll(*c) for c in sorted(cells)])
    out = {}; seen = set(); sts = {}
    for AD in ADAPTERS:
        ad = AD(); st = sts[ad.key] = dict(raw=0, outside=0, small=0, intile=0, dupb=0, rule=0, kept=0)
        cl = [c for c in sorted(cells) if not (cell_ll(*c)[2] < ad.bbox[0] or cell_ll(*c)[0] > ad.bbox[2] or cell_ll(*c)[3] < ad.bbox[1] or cell_ll(*c)[1] > ad.bbox[3])]
        ctx['cells_ll'] = [cell_ll(*c) for c in cl]
        if not cl: continue
        ad.prepare(ctx)
        for ix, iz in cl:
            lon0, lat0, lon1, lat1 = cell_ll(ix, iz)
            for f in ad.fetch((round(lon0, 5), round(lat0, 5), round(lon1, 5), round(lat1, 5))):
                if f['uid'] in seen: continue
                raw = [P(*p) for p in f['ring']]
                if raw[0] == raw[-1]: raw = raw[:-1]
                if len(raw) < 3: continue
                c = (sum(p[0] for p in raw) / len(raw), sum(p[1] for p in raw) / len(raw))
                if (int(c[0] // CELL), int(c[1] // CELL)) != (ix, iz): continue  # belongs to another cell's pass
                seen.add(f['uid']); st['raw'] += 1
                if not cor.near(c): st['outside'] += 1; continue
                area = abs(sum(raw[i][0] * raw[(i + 1) % len(raw)][1] - raw[(i + 1) % len(raw)][0] * raw[i][1] for i in range(len(raw)))) / 2
                if area < ad.min_area and not f['name']: st['small'] += 1; continue
                c_ll = (LON0 + c[0] / KX, LAT0 - c[1] / KY)
                if ad.keep(f, c_ll, c, area): st['rule'] += 1; continue
                if any(math.hypot(c[0] - t['cx'], c[1] - t['cz']) <= t['rad'] for t in existing): st['intile'] += 1; continue
                if dup_b(c): st['dupb'] += 1; continue
                gg = dp(raw, EPS)
                if len(gg) < 3: continue
                h = f['height_m']; k = 1 if h else 0
                if not h: h = ad.default_h(f, area)
                rec = [round(max(h, 3) * 10), k] + [round(v * 10) for p in gg for v in p]
                f['source'] = ad.source; st['kept'] += 1
                out.setdefault((ix, iz), []).append((rec, c, area, f))
        if hasattr(ad, 'stat'): print(ad.key, 'zone stats [kept, dropped]:', ad.stat)
    total = sum(len(v) for v in out.values())
    if maxb:  # size cap: drop the smallest unnamed buildings first
        est = lambda: sum(len(json.dumps(r[0], separators=(',', ':'))) + 1 for v in out.values() for r in v)
        cand = sorted(((r[2], ix_iz, r) for ix_iz, v in out.items() for r in v if not r[3]['name']), key=lambda t: t[0]); dropped = 0
        while est() > maxb and cand:
            _, key, r = cand.pop(0); out[key].remove(r); dropped += 1
        print('size cap dropped', dropped)
    nm_file = {'sources': [AD.source for AD in ADAPTERS], 'tiles': {}}; used = {}; tiles = []
    for (ix, iz), recs in sorted(out.items()):
        if not recs: continue
        tid = '%s%d_%d' % (PREFIX, ix, iz)
        mx = sum(r[1][0] for r in recs) / len(recs); mz = sum(r[1][1] for r in recs) / len(recs)
        pl = min(PLACES, key=lambda n: math.dist(P(PLACES[n][1], PLACES[n][0]), (mx, mz))); used[pl] = used.get(pl, 0) + 1
        nm = 'Route: ' + pl + ('' if used[pl] == 1 else ' %d' % used[pl])
        json.dump([r[0] for r in recs], open(os.path.join(ROOT, 'tiles', tid + '.json'), 'w'), separators=(',', ':'))
        xs = [r[1][0] for r in recs]; zs = [r[1][1] for r in recs]
        tiles.append(dict(id=tid, name=nm, file='tiles/%s.json' % tid, cx=round((min(xs) + max(xs)) / 2), cz=round((min(zs) + max(zs)) / 2), rad=round(math.hypot(max(xs) - min(xs), max(zs) - min(zs)) / 2) + 50))
        for i, r in enumerate(recs):
            if r[3]['name']: nm_file['tiles'].setdefault(tid, {})[str(i)] = dict(name=r[3]['name'], id=r[3].get('ident'), uid=r[3]['uid'], source=r[3]['source'])
        by = {}
        for r in recs: by[r[3]['source'].split()[0]] = by.get(r[3]['source'].split()[0], 0) + 1
        print('%-22s %-24s %5d bldgs %s' % (tid, nm, len(recs), by))
    D['tiles'] += tiles
    json.dump(D, open(os.path.join(HERE, 'prep4.json'), 'w'), separators=(',', ':'))
    json.dump(nm_file, open(os.path.join(HERE, 'route_building_names.json'), 'w'), indent=0)
    for k, v in sts.items(): print('stats', k, v)
    print('kept', sum(len(r) for r in out.values()), 'of', total, 'tiles', len(tiles), 'named', sum(len(v) for v in nm_file['tiles'].values()))
main()
