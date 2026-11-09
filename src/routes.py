"""Precompute driving + Metro options from Eric's home to every employer.  Run from src/:  python3 routes.py
Writes routes.json. Every OSRM response is cached in routes_cache.json, so reruns are resumable and free.
Network: router.project-osrm.org only, 1 request/second. No data is invented: employers OSRM could not route get no entry."""
import json, math, os, sys, time, urllib.request, urllib.error

os.chdir(os.path.dirname(os.path.abspath(__file__)))
HOME = (38.93472, -77.32540)  # lat, lon (DEFAULT_HOME in 00-core.js)
OSRM = 'https://router.project-osrm.org'
CACHE_FILE = 'routes_cache.json'
cache = json.load(open(CACHE_FILE)) if os.path.exists(CACHE_FILE) else {}
corr = json.load(open('toll_corridors.json'))
metro = json.load(open('metro_times.json'))
stations = {s[0]: (s[1], s[2]) for s in json.load(open('stations_list.json'))}
emps = json.load(open('prep4.json'))['emps']
M_PER_MI = 1609.344
last = [0.0]
fails = [0]

# Known toll-free roads, used only when OSRM offers no toll-free alternative for a tolled trip. lon, lat (snapped by OSRM).
# Lists of (lat, lon) waypoints on toll-free roads, tried in order when a destination has no toll-free alternative. Points were
# read off OSRM's own geometry (Rt 7 near Reston) or placed on Fairfax Blvd / US-50 by hand. OSRM snaps them to the nearest road.
CHAINS = {
    'west': [[(38.98645, -77.32422)]],                                   # Leesburg Pike (Rt 7) at Reston
    'east': [[(38.8462, -77.3064)], [(38.8462, -77.3064), (38.8650, -77.1535)]],  # Fairfax Blvd; Fairfax Blvd then Seven Corners (US-50)
}
PRETTY = {'VA 7': 'Rt 7', 'VA 123': 'Rt 123', 'VA 28': 'Rt 28', 'VA 267': 'Dulles Toll Rd', 'VA 267 + Greenway': 'Dulles Toll Rd + Greenway', 'I 66': 'I-66', 'I 495': 'I-495', 'I 95': 'I-95', 'I 395': 'I-395', 'US 29': 'US-29', 'US 50': 'US-50', 'US 15': 'US-15', 'US 15 BUS': 'US-15 Bus', 'VA 120': 'Rt 120', 'VA 236': 'Rt 236'}


def fetch(path):
    if path in cache:
        return cache[path]
    wait = 1.1 - (time.time() - last[0])
    if wait > 0:
        time.sleep(wait)
    for attempt in range(3):
        try:
            last[0] = time.time()
            with urllib.request.urlopen(urllib.request.Request(OSRM + path, headers={'User-Agent': 'reston-hiring-map/1.0 (personal job search)'}), timeout=40) as r:
                d = json.load(r)
            if d.get('code') in ('Ok', 'NoRoute'):
                cache[path] = d
                json.dump(cache, open(CACHE_FILE, 'w'), separators=(',', ':'))
                return d
        except Exception as ex:
            print('  retry', attempt, type(ex).__name__, str(ex)[:60], file=sys.stderr)
            time.sleep(2 + attempt * 3)
    fails[0] += 1
    return None


def hav(a, b):
    r = 6371000; p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = p2 - p1; dl = math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def seg_dist(p, a, b):  # metres from point p to segment ab, all (lat, lon), local flat approx
    k = math.cos(math.radians(p[0])) * 111320
    ax, ay, bx, by, px, py = a[1] * k, a[0] * 110540, b[1] * k, b[0] * 110540, p[1] * k, p[0] * 110540
    dx, dy = bx - ax, by - ay
    t = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def simplify(pts, n=50):  # Douglas-Peucker, growing tolerance until <= n points. pts are [lon, lat]
    def dp(p, tol):
        if len(p) < 3:
            return p
        a, b = p[0], p[-1]; md, mi = 0, 0
        for i in range(1, len(p) - 1):
            d = seg_dist((p[i][1], p[i][0]), (a[1], a[0]), (b[1], b[0]))
            if d > md: md, mi = d, i
        if md <= tol:
            return [a, b]
        return dp(p[:mi + 1], tol)[:-1] + dp(p[mi:], tol)
    tol = 20
    out = pts
    while len(out) > n:
        out = dp(pts, tol); tol *= 1.4
    return [[round(x, 5), round(y, 5)] for x, y in out]


def densify(pts, step=150):  # points every ~step metres along [lon,lat] list
    out = []
    for a, b in zip(pts, pts[1:]):
        d = hav((a[1], a[0]), (b[1], b[0])); n = max(1, int(d / step))
        out += [(a[1] + (b[1] - a[1]) * i / n, a[0] + (b[0] - a[0]) * i / n) for i in range(n)]
    out.append((pts[-1][1], pts[-1][0]))
    return out


def geom_toll_km(pts):
    buf = corr['buffer_m']; near = 0
    ds = densify(pts)
    for p in ds:
        for c in corr['corridors']:
            cp = [(y, x) for x, y in c['pts']]
            if any(seg_dist(p, cp[i], cp[i + 1]) <= buf for i in range(len(cp) - 1)):
                near += 1; break
    return near * 0.15


def analyse(rt):
    by = {}; tollstep = 0.0; tagged = False
    for l in rt['legs']:
        for s in l['steps']:
            ref = (s.get('ref') or '').split(';')[0].strip(); name = s.get('name') or ''
            key = name if (ref.startswith('SR ') and name) else (ref or name)
            if key: by[key] = by.get(key, 0) + s['distance']
            if any('toll' in (i.get('classes') or []) for i in s.get('intersections', [])): tagged = True
            full = (s.get('ref') or '') + ' ' + name
            if any(p.lower() in full.lower() for p in corr['ref_patterns']): tollstep += s['distance']
    via = max(by.items(), key=lambda kv: kv[1])[0] if by else 'local roads'
    if via == 'VA 267' and min(p[0] for p in rt['geometry']['coordinates']) < -77.46: via = 'VA 267 + Greenway'
    pts = rt['geometry']['coordinates']
    gkm = geom_toll_km(pts)
    toll = tagged or tollstep / 1000 >= corr['min_step_km'] or gkm >= corr['min_geom_km']
    # name the toll road when it's the headline of a tolled option
    return via, toll, pts


def routes_for(waypoints, alts=3):
    coords = ';'.join('%.5f,%.5f' % (lo, la) for la, lo in waypoints)
    d = fetch('/route/v1/driving/%s?alternatives=%d&steps=true&overview=simplified&geometries=geojson' % (coords, alts))
    return d['routes'] if d and d.get('code') == 'Ok' else None


def options_for(e):
    dest = (e['lat'], e['lon'])
    rs = routes_for([HOME, dest])
    if rs is None:
        return None
    opts = []
    for r in rs:
        via, toll, pts = analyse(r)
        opts.append({'raw': r['duration'] / 60, 'mi': r['distance'] / M_PER_MI, 'via': via, 'toll': toll, 'pts': pts})
    # no toll-free alternative? force a waypoint on a known free road
    if all(o['toll'] for o in opts) and hav(HOME, dest) > 3000:
        region = 'west' if (dest[0] > 38.98 and dest[1] < -77.38) else 'east' if dest[1] > -77.30 else None
        for chain in CHAINS.get(region, []):
            rs2 = routes_for([HOME] + chain + [dest], alts=0)
            for r in rs2 or []:
                via, toll, pts = analyse(r)
                if not toll:
                    opts.append({'raw': r['duration'] / 60, 'mi': r['distance'] / M_PER_MI, 'via': via, 'toll': False, 'pts': pts, 'forced': True})
            if any(not o['toll'] for o in opts): break
    return opts


def pick(opts, toll, via_hint=None):
    c = [o for o in opts if o['toll'] == toll and (not via_hint or via_hint.lower() in o['via'].lower())]
    return min(c, key=lambda o: o['raw']) if c else None


def main():
    byid = {e['id']: e for e in emps}
    raw = {}
    t0 = time.time()
    for i, e in enumerate(emps):
        raw[e['id']] = options_for(e)
        if i % 10 == 0: print('%d/%d  %.0fs' % (i, len(emps), time.time() - t0), flush=True)
    # ---- calibration against Eric's Apple Maps screenshots (docs/route-screenshots/NOTES.md) ----
    checks = [  # label, employer id, toll?, via hint, Apple Maps minutes
        ('Reston to Leesburg via Rt 7 (no toll)', 'loudoun-county-government', False, 'Rt 7', 29),
        ('Reston to Leesburg via Toll Rd (toll)', 'loudoun-county-government', True, None, 24),
        ('Reston to Leesburg via Toll Rd + Greenway (toll)', 'loudoun-county-government', True, None, 25),
        ('Reston to Warrenton, Fairfax County Pkwy + US-29 (no toll)', 'town-of-warrenton', False, None, 47),
    ]
    rows = []
    for label, eid, toll, hint, apple in checks:
        for oo in raw.get(eid) or []: oo.setdefault('pv', PRETTY.get(oo['via'], oo['via']))
        o = pick([dict(oo, via=oo['pv']) for oo in raw.get(eid) or []], toll, hint)
        rows.append({'label': label, 'apple_min': apple, 'osrm_raw_min': round(o['raw'], 1) if o else None, 'osrm_via': o['via'] if o else None, 'toll_free_check': not toll})
    free = [r for r in rows if r['toll_free_check'] and r['osrm_raw_min']]
    factor = round(sum(r['apple_min'] / r['osrm_raw_min'] for r in free) / len(free), 3) if free else 1.0
    for r in rows:
        if r['osrm_raw_min']:
            r['scaled_min'] = round(r['osrm_raw_min'] * factor, 1); r['error_min'] = round(r['scaled_min'] - r['apple_min'], 1)
            print('CAL %-62s apple %2d | osrm raw %5.1f -> x%.3f = %5.1f | error %+.1f min' % (r['label'], r['apple_min'], r['osrm_raw_min'], factor, r['scaled_min'], r['error_min']))
    # note: the factor is fitted on the toll-free checkpoints only; toll checkpoints are an out-of-sample check.

    # ---- assemble ----
    mt = metro['from_wiehle_min']
    wie = stations['Wiehle-Reston East']
    # OSRM snapped the station (on the Toll Rd median) to a far-off road, so use a plain estimate: 1.4 x straight line at 25 mph + 3 min to park and walk in
    drive_to_wiehle = int(round(hav(HOME, wie) * 1.4 / M_PER_MI / 25 * 60 + 3))
    out = {}
    for e in emps:
        opts = raw.get(e['id'])
        if opts is None:
            continue
        # drop duplicate (via, toll) pairs, keep fastest; toll-free first
        best = {}
        for o in opts:
            k = (o['via'], o['toll'])
            if k not in best or o['raw'] < best[k]['raw']: best[k] = o
        lst = sorted(best.values(), key=lambda o: (o['toll'], o['raw']))
        fastest = min(o['raw'] for o in lst)
        keep = [o for o in lst if o['raw'] <= fastest * 1.6]
        free1 = next((o for o in lst if not o['toll']), None)
        if free1 is not None and free1 not in keep: keep.append(free1)  # always show the toll-free one, however slow
        lst = sorted(keep, key=lambda o: (o['toll'], o['raw']))[:3]
        res = [{'min': max(5, int(round(o['raw'] * factor / 5.0)) * 5), 'mi': round(o['mi'], 1), 'via': PRETTY.get(o['via'], o['via']), 'toll': o['toll'],
                'verified': False, 'geom': simplify(o['pts'])} for o in lst]
        # metro: nearest station in the timetable
        cand = [(hav((e['lat'], e['lon']), stations[s]), s) for s in mt if s in stations]
        d, st = min(cand)
        walk = d * metro['walk_factor'] / 1609.344 / metro['walk_mph'] * 60
        item = {'options': res}
        if drive_to_wiehle is not None:
            ok = walk <= metro['max_walk_min']
            item['metro'] = {'station': st, 'walk_ok': ok, 'verified': False}
            if ok: item['metro'].update(walk_min=int(round(walk)), min=int(round(drive_to_wiehle + metro['wait_min'] + mt[st] + walk)))
        out[e['id']] = item
    missing = [e['id'] for e in emps if e['id'] not in out]
    res = {'meta': {'home': {'lat': HOME[0], 'lon': HOME[1]}, 'source': 'router.project-osrm.org (public OSRM, no traffic), scaled by the calibration factor',
                    'generated': time.strftime('%Y-%m-%d'), 'count': len(out), 'missing': missing, 'home_to_wiehle_drive_min': drive_to_wiehle,
                    'metro_verified': metro['verified'], 'metro_source': metro['source_url']},
           'calibration': {'factor': factor, 'note': 'OSRM raw minutes x factor. Fitted as the mean Apple/OSRM ratio on the toll-free checkpoints; the toll checkpoints are an out-of-sample check. Final minutes are rounded to 5.', 'checkpoints': rows},
           'employers': out}
    json.dump(res, open('routes.json', 'w'), separators=(',', ':'))
    print('routes.json: %d employers, %d missing, factor %s, failed requests %d' % (len(out), len(missing), factor, fails[0]))


if __name__ == '__main__':
    main()
