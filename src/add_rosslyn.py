"""Turn src/osm_raw/{bld,hwy}_*.json (from fetch_osm.py) into tiles/rosslyn.json and patch src/prep4.json:
register the tile, add Arlington streets to prep4.json['r'], give employers a building highlight (bp) where they sit inside a new building,
and add the 20 biggest Rosslyn-Ballston offices to the 'Biggest offices' ranking. Idempotent: re-running replaces earlier Rosslyn output.
Run from src/:  python3 add_rosslyn.py"""
import json, math, re, os, glob
LAT0, LON0 = 38.955, -77.355
KX = 111320 * math.cos(math.radians(LAT0)); KY = 110574
P = lambda lat, lon: ((lon - LON0) * KX, (LAT0 - lat) * KY)
ZONE = 'Rosslyn-Ballston'
def dp(pts, eps):
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]; dx, dy = x2 - x1, y2 - y1; L = math.hypot(dx, dy) or 1e-9; mi, md = 0, 0
    for i in range(1, len(pts) - 1):
        x, y = pts[i]; dd = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / L
        if dd > md: md, mi = dd, i
    if md > eps: return dp(pts[:mi + 1], eps)[:-1] + dp(pts[mi:], eps)
    return [pts[0], pts[-1]]
def num(s):
    m = re.match(r'\s*([\d.]+)', str(s))
    if not m: return None
    try: v = float(m.group(1))
    except Exception: return None
    return v * 0.3048 if ('ft' in str(s) or "'" in str(s)) else v
DEF = {'house': 7, 'detached': 7, 'residential': 8, 'semidetached_house': 7, 'terrace': 8, 'apartments': 14, 'commercial': 11, 'office': 12, 'retail': 7, 'industrial': 9, 'hotel': 14, 'hospital': 15, 'school': 8, 'church': 8, 'garage': 3, 'garages': 3, 'shed': 3, 'roof': 4, 'carport': 3, 'parking': 8, 'yes': 8}
OFFICE = {'office', 'commercial', 'yes', 'government', 'civic', 'hospital', 'industrial', 'public'}
EX = r'garage|parking|church|school|storage|apartment|condo|residen|hotel|hyatt|marriott|westin|hilton|\binn\b|suites|midtown|cosmopolitan|lofts|residences|museum|cathedral|stadium|arena|station|mall|center court|convention|fashion|shopping|market'
def inside(pt, poly):
    x, y = pt; c = False
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c
def elems(kind):
    out = []
    for f in sorted(glob.glob(f'osm_raw/{kind}_*.json')): out += json.load(open(f)).get('elements', [])
    return out
import shutil
if not os.path.exists('prep4.base.json'): shutil.copy('prep4.json', 'prep4.base.json')  # pristine copy so re-runs never duplicate streets
D = json.load(open('prep4.base.json'))
# ---- buildings ----
B = []; M = []; seen = set()
for el in elems('bld'):
    if el.get('type') != 'way' or 'geometry' not in el or el['id'] in seen: continue
    seen.add(el['id']); t = el.get('tags', {}); g = [P(p['lat'], p['lon']) for p in el['geometry']]
    if len(g) < 4 or g[0] != g[-1]: continue
    raw = g[:-1]; gg = dp(raw, 0.7)
    if len(gg) < 3: continue
    a = abs(sum(raw[i][0] * raw[(i + 1) % len(raw)][1] - raw[(i + 1) % len(raw)][0] * raw[i][1] for i in range(len(raw)))) / 2
    h = None; lv = None; k = 0
    if 'building:levels' in t: lv = num(t['building:levels'])
    if 'height' in t: h = num(t['height'])
    if h is None and lv: h = lv * 3.3 + 1
    if h is not None: k = 1
    else: h = DEF.get(t.get('building'), 8)
    rec = [round(h * 10), k] + [round(v * 10) for p in gg for v in p]; B.append(rec)
    M.append(dict(rec=rec, t=t, area=a, h=h, k=k, floors=(lv if lv else (round(h / 4.0) if k else None)), cx=sum(p[0] for p in raw) / len(raw), cz=sum(p[1] for p in raw) / len(raw), poly=gg))
print('buildings', len(B), 'tagged height', sum(m['k'] for m in M))
if B:
    json.dump(B, open('../tiles/rosslyn.json', 'w'), separators=(',', ':'))
    xs = [m['cx'] for m in M]; zs = [m['cz'] for m in M]
    tile = dict(id='rosslyn', name='Rosslyn to Ballston', file='tiles/rosslyn.json', cx=round((min(xs) + max(xs)) / 2), cz=round((min(zs) + max(zs)) / 2), rad=round(max(max(xs) - min(xs), max(zs) - min(zs)) / 2))
    D['tiles'] = [t for t in D['tiles'] if t['id'] not in ('rosslyn', 'arlington')] + [tile]; print('tile', tile)
    # employer building highlights
    n = 0
    for e in D['emps']:
        if 'bp' in e: continue
        pt = P(e['lat'], e['lon'])
        for m in M:
            if abs(m['cx'] - pt[0]) > 250 or abs(m['cz'] - pt[1]) > 250: continue
            if inside(pt, m['poly']): e['bp'] = m['rec']; n += 1; break
    print('employers newly matched to a building', n)
    # ranking: 20 biggest offices in the zone
    cands = []
    for m in M:
        t = m['t']; b = t.get('building'); nm = (t.get('name') or '').strip()
        if b not in OFFICE or not m['floors'] or m['area'] < 400: continue
        if re.search(EX, nm, re.I) or t.get('tourism') or 'resid' in t.get('building:use', '') or t.get('amenity') in ('parking', 'school', 'place_of_worship'): continue
        if b == 'yes' and m['floors'] < 3: continue
        addr = ' '.join(x for x in [t.get('addr:housenumber', ''), t.get('addr:street', '')] if x).strip()
        cands.append((m['area'] * m['floors'] * 10.7639, m, nm, addr, t.get('addr:city', '')))
    cands.sort(key=lambda c: -c[0]); old = [r for r in D['rank'] if r['area'] != ZONE]; new = []
    for sq, m, nm, addr, city in cands[:20]:
        new.append(dict(n=0, name=nm, addr=addr, city=city, area=ZONE, floors=round(m['floors']), h=round(m['h']), sqft=round(sq, -3), x=round(m['cx']), z=round(m['cz']), lat=round(LAT0 - m['cz'] / KY, 6), lon=round(LON0 + m['cx'] / KX, 6), bp=m['rec'], emps=[e['id'] for e in D['emps'] if e.get('bp') is m['rec'] or e.get('bp') == m['rec']]))
    rank = sorted(old + new, key=lambda r: -r['sqft'])
    for i, r in enumerate(rank): r['n'] = i + 1
    D['rank'] = rank; print('rank entries', len(rank), 'new', len(new))
# ---- streets ----
R = D['r']; cls = {'motorway': 'a', 'motorway_link': 'a', 'trunk': 'a', 'trunk_link': 'a', 'primary': 'b', 'primary_link': 'b', 'secondary': 'c', 'secondary_link': 'c', 'tertiary': 'c', 'tertiary_link': 'c'}
ns = 0
for el in elems('hwy'):
    if 'geometry' not in el: continue
    c = cls.get(el.get('tags', {}).get('highway'), 'd')
    line = [(round(v)) for p in dp([P(q['lat'], q['lon']) for q in el['geometry']], 4) for v in p]
    if len(line) >= 4: R[c].append(line); ns += 1
print('street segments added', ns)
json.dump(D, open('prep4.json', 'w'), separators=(',', ':')); print('prep4.json', os.path.getsize('prep4.json'))
