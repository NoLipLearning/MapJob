"""Add 'local and federal offices on your commute' employers to prep4.json (and prep4.base.json, employers.json). Idempotent by id.
Run from src/ AFTER add_rosslyn.py:  python3 add_employers.py
Addresses come from official pages seen in search (SSA open data, loudoun.gov, dvs.virginia.gov) or are flagged unverified.
Ratings s=[role_fit, clearance_access, entry_access] (1-5) are ESTIMATES, not researched. Nothing here is a confirmed posting."""
import json, math, os, time, urllib.request, urllib.parse
LAT0, LON0 = 38.955, -77.355; KX = 111320 * math.cos(math.radians(LAT0)); P = lambda la, lo: ((lo - LON0) * KX, (LAT0 - la) * 110574)
NEW = [
 dict(id='ssa-reston-field-office', aliases=['SSA', 'Social Security Administration', 'Social Security'], name='Social Security Administration, Reston Field Office', type='federal', addr='10800 Parkridge Blvd, Suite 100, Reston, VA 20191', reg='Reston, Herndon and Loudoun',
  url='https://www.usajobs.gov/search/results/?a=SZ&k=Social%20Security%20Administration', roles=['Claims or service representative and social insurance specialist roles (typical SSA entry titles; confirm current openings on USAJOBS)'],
  progs=[{'name': 'SSA careers', 'url': 'https://www.ssa.gov/careers/'}], cl='none', s=[3, 5, 4],
  why='Public-facing benefits work in a field office near home. SSA entry jobs normally need a background check, not a security clearance.',
  src=['https://www.ssa.gov/careers/', 'https://www.ssa.gov/data/FO-Address-Open-Close-Times.csv'], notes='UNVERIFIED: address from SSA open data seen in a search result (could be out of date); ratings are estimates; no posting checked.'),
 dict(id='ssa-manassas-field-office', aliases=['SSA', 'Social Security Administration', 'Social Security'], name='Social Security Administration, Manassas Field Office', type='federal', addr='9500 Center Street, Manassas, VA 20110', reg='Warrenton and Prince William',
  url='https://www.usajobs.gov/search/results/?a=SZ&k=Social%20Security%20Administration', roles=['Claims or service representative and social insurance specialist roles (typical SSA entry titles; confirm current openings on USAJOBS)'],
  progs=[{'name': 'SSA careers', 'url': 'https://www.ssa.gov/careers/'}], cl='none', s=[3, 5, 4],
  why='Same SSA entry path as Reston, on the Warrenton side of your drive. Background check, not a clearance.',
  src=['https://www.ssa.gov/careers/', 'https://www.ssa.gov/data/FO-Address-Open-Close-Times.csv'], notes='UNVERIFIED: address from SSA open data seen in a search result; ratings are estimates; no posting checked.'),
 dict(id='loudoun-county-government', name='Loudoun County Government (Leesburg)', type='state-local', addr='1 Harrison Street SE, Leesburg, VA 20175', reg='Reston, Herndon and Loudoun',
  url='https://www.loudoun.gov/', roles=['County analyst, program and administrative roles (titles vary; use the county employment page)'], progs=[], cl='none', s=[3, 5, 3],
  why='Large local employer on the Rt 7 corridor with policy, budget and program work and no clearance requirement.',
  src=['https://www.loudoun.gov/'], notes='UNVERIFIED: government center address seen on loudoun.gov search results; careers link is the county home page, look for the Employment link; ratings are estimates.'),
 dict(id='va-dvs-loudoun-benefits-office', name='Virginia Dept. of Veterans Services, Loudoun Benefits Office', type='state-local', addr='44345 Premier Plaza, Suite 200, Ashburn, VA 20147', reg='Reston, Herndon and Loudoun',
  url='https://www.dvs.virginia.gov/', roles=['Veteran benefits and claims-support roles (titles vary; check Virginia state jobs)'], progs=[], cl='none', s=[2, 5, 3],
  why='State benefits office in Ashburn, near the Rt 7 and Dulles route. Service-oriented work, no clearance.',
  src=['https://www.dvs.virginia.gov/?p=8543'], notes='UNVERIFIED: address from the DVS office page seen in a search result; ratings are estimates; no posting checked.'),
]
gc = json.load(open('geocache.json')) if os.path.exists('geocache.json') else {}
def geocode(addr):
    if gc.get(addr): return gc[addr][:2]
    import re; qa = re.sub(r',\s*Suite\s*\w+', '', addr)
    q = urllib.parse.urlencode({'q': qa, 'format': 'json', 'limit': 1, 'countrycodes': 'us'})
    req = urllib.request.Request('https://nominatim.openstreetmap.org/search?' + q, headers={'User-Agent': 'reston-hiring-map/1.0 (personal job-search map)'})
    r = json.load(urllib.request.urlopen(req, timeout=40)); time.sleep(1.1)
    gc[addr] = [float(r[0]['lat']), float(r[0]['lon'])] if r else None; return gc[addr][:2] if gc[addr] else None
stations = json.load(open('stations_list.json'))
for e in NEW:
    ll = geocode(e['addr'])
    if not ll: print('GEOCODE FAILED', e['id'], e['addr']); continue
    e['lat'], e['lon'], e['gc'], e['us'] = ll[0], ll[1], 'addr', ''; pt = P(ll[0], ll[1])
    e['metro'] = any(math.hypot(*(a - b for a, b in zip(P(s[1], s[2]), pt))) < 1000 for s in stations)
    print(e['id'], ll, 'metro', e['metro'])
json.dump(gc, open('geocache.json', 'w'))
ok = [e for e in NEW if 'lat' in e]
for f in ('prep4.json', 'prep4.base.json'):
    if not os.path.exists(f): continue
    D = json.load(open(f)); have = {x['id'] for x in D['emps']}; n = 0
    for e in ok:
        if e['id'] not in have: D['emps'].append(dict(e)); n += 1
    json.dump(D, open(f, 'w'), separators=(',', ':')); print(f, 'added', n, 'total', len(D['emps']))
E = json.load(open('employers.json')); have = {x['id'] for x in E}
for e in ok:
    if e['id'] not in have: E.append({k: v for k, v in e.items() if k != 'metro'})
json.dump(E, open('employers.json', 'w'), indent=1)
