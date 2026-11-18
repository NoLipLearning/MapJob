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
# I-66 corridor (added 2026-11-18). Locations: OpenStreetMap features found through Nominatim by name. Ratings are estimates; no posting checked.
I66 = 'On the I-66 corridor. '
OSMN = 'Location: OpenStreetMap feature found by name through Nominatim (2026-11-18). Ratings are estimates; no posting checked.'
def emp(id, name, type, addr, reg, url, roles, cl, s, why):
    return dict(id=id, name=name, type=type, addr=addr, reg=reg, url=url, roles=roles, progs=[], cl=cl, s=s, why=I66 + why, src=['https://nominatim.openstreetmap.org/'], notes=OSMN)
TF, PW, AA = 'Tysons, McLean and Fairfax', 'Warrenton and Prince William', 'Arlington and Alexandria'
NEW += [
 emp('navy-federal-vienna', 'Navy Federal Credit Union (headquarters, Vienna)', 'corporate', '900 Follin Lane SE, Vienna, VA 22180', TF, 'https://www.navyfederal.org/',
     ['Member service, operations and branch roles (titles vary; use the Careers link)'], 'none', [3, 5, 4], 'Very large employer near the Vienna Metro with member-service and operations entry roles.'),
 emp('george-mason-university', 'George Mason University (Fairfax campus)', 'education-health', '4400 University Drive, Fairfax, VA 22030', TF, 'https://www.gmu.edu/',
     ['Administrative, program coordinator and research staff roles (use the Jobs link)'], 'none', [4, 5, 3], 'Public university with staff jobs in program coordination, research centers and policy schools.'),
 emp('city-of-fairfax', 'City of Fairfax Government (City Hall)', 'state-local', 'Armstrong Street, Fairfax, VA 22030', TF, 'https://www.fairfaxva.gov/',
     ['City analyst, program and administrative roles (use the Employment link)'], 'none', [4, 5, 3], 'Small city government in Old Town Fairfax; local policy and administration work, no clearance.'),
 emp('northrop-grumman-hq', 'Northrop Grumman (global headquarters, Falls Church)', 'contractor', '2980 Fairview Park Drive, Falls Church, VA 22042', TF, 'https://jobs.northropgrumman.com/careers',
     ['Associate business, finance and program analyst roles'], 'most', [2, 1, 3], 'Corporate headquarters next to I-495/US-50; most roles need a clearance or the ability to get one.'),
 emp('inova-fair-oaks', 'Inova Fair Oaks Hospital', 'education-health', '3600 Joseph Siewick Drive, Fairfax, VA 22033', TF, 'https://www.inova.org/',
     ['Patient access, scheduling and administrative roles (use the Careers link)'], 'none', [2, 5, 4], 'Hospital at Fair Oaks by I-66 and US-50; non-clinical admin roles hire graduates.'),
 emp('inova-fairfax', 'Inova Fairfax Hospital', 'education-health', '3300 Gallows Road, Falls Church, VA 22042', TF, 'https://www.inova.org/',
     ['Patient access, scheduling and administrative roles (use the Careers link)'], 'none', [2, 5, 4], 'Largest hospital in Northern Virginia, near Dunn Loring Metro; many non-clinical admin roles.'),
 emp('defense-health-agency', 'Defense Health Agency (headquarters, Falls Church)', 'federal', '7700 Arlington Boulevard, Falls Church, VA 22042', TF, 'https://www.usajobs.gov/search/results/?k=Defense%20Health%20Agency',
     ['Program, management and health-policy analyst roles (check USAJOBS)'], 'some', [3, 3, 3], 'Federal health agency headquarters; analyst roles, some need a clearance.'),
 emp('lockheed-martin-manassas', 'Lockheed Martin (Manassas)', 'contractor', 'Nokesville Road, Manassas, VA 20110', PW, 'https://www.lockheedmartin.com/',
     ['Business, finance and program support roles (use the Careers link)'], 'most', [2, 1, 3], 'Large defense site in Manassas; most roles need a clearance or the ability to get one.'),
 emp('micron-manassas', 'Micron Technology (Manassas)', 'corporate', 'Nokesville Road, Manassas, VA 20110', PW, 'https://www.micron.com/',
     ['Operations, supply-chain and business roles (use the Careers link)'], 'none', [2, 5, 3], 'Big memory-chip plant in Manassas; operations and business roles alongside engineering.'),
 emp('city-of-manassas', 'City of Manassas Government (City Hall)', 'state-local', '9027 Center Street, Manassas, VA 20110', PW, 'https://www.manassasva.gov/',
     ['City analyst, program and administrative roles (use the Employment link)'], 'none', [4, 5, 3], 'City government by the Manassas VRE station; local policy and admin work.'),
 emp('nestle-usa', 'Nestle USA (headquarters, Rosslyn)', 'corporate', '1812 North Moore Street, Arlington, VA 22209', AA, 'https://www.nestleusa.com/',
     ['Corporate analyst, sales and marketing associate roles (use the Careers link)'], 'none', [3, 5, 3], 'US headquarters at the east end of I-66 by Rosslyn Metro; corporate, sales and marketing roles.'),
 emp('marymount-university', 'Marymount University', 'education-health', '2807 North Glebe Road, Arlington, VA 22207', AA, 'https://www.marymount.edu/',
     ['Administrative and program coordinator staff roles (use the Employment link)'], 'none', [3, 5, 3], 'University just off I-66 in Arlington; staff jobs in admissions, programs and administration.'),
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
# two Manassas sites share one street address; use their own OSM feature points (Nominatim, by name)
for e in NEW:
    if e['id'] == 'lockheed-martin-manassas': e['lat'], e['lon'], e['gc'] = 38.7523, -77.5022, 'osm-name'
    if e['id'] == 'micron-manassas': e['lat'], e['lon'], e['gc'] = 38.7483, -77.5050, 'osm-name'
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
