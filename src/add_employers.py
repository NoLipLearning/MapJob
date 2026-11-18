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
NEW += [
 dict(emp('virginia-hospital-center', 'Virginia Hospital Center', 'education-health', '1701 North George Mason Drive, Arlington, VA 22205', 'Arlington and Alexandria', 'https://www.virginiahospitalcenter.com/', ['Patient access, scheduling and administrative roles (use the Careers link)'], 'none', [2, 5, 4], 'Arlington hospital a few blocks off I-66; non-clinical admin roles hire graduates.'), lat=38.8897796, lon=-77.1275542, gc='osm-name'),
 dict(emp('city-of-falls-church', 'City of Falls Church Government (City Hall)', 'state-local', '300 Park Avenue, Falls Church, VA 22046', 'Tysons, McLean and Fairfax', 'https://www.fallschurchva.gov/', ['City analyst, program and administrative roles (use the Employment link)'], 'none', [4, 5, 3], 'Small city government between East and West Falls Church Metro; local policy and admin work.'), lat=38.885729, lon=-77.1724008, gc='osm-name'),
 dict(emp('fairfax-water', 'Fairfax Water', 'state-local', '8570 Executive Park Avenue, Fairfax, VA 22031', 'Tysons, McLean and Fairfax', 'https://www.fairfaxwater.org/', ['Customer service, administrative and analyst roles (use the Careers link)'], 'none', [2, 5, 3], 'Public water utility in Merrifield; customer service, admin and analyst jobs.'), lat=38.8667776, lon=-77.2381707, gc='osm-name'),
 dict(emp('town-of-vienna', 'Town of Vienna Government (Town Hall)', 'state-local', '127 Center Street South, Vienna, VA 22180', 'Tysons, McLean and Fairfax', 'https://www.viennava.gov/', ['Town program and administrative roles (use the Employment link)'], 'none', [4, 5, 3], 'Town government in central Vienna; local policy and admin work.'), lat=38.9006689, lon=-77.2644509, gc='osm-name'),
 dict(emp('smithsonian-udvar-hazy', 'Smithsonian National Air and Space Museum, Udvar-Hazy Center', 'federal', '14390 Air and Space Museum Parkway, Chantilly, VA 20151', 'Reston, Herndon and Loudoun', 'https://www.si.edu/', ['Museum program, visitor services and admin roles (check USAJOBS and Smithsonian jobs)'], 'none', [3, 5, 3], 'Large Smithsonian museum near Dulles and Rt 28, north of I-66; federal and trust jobs.'), lat=38.9108365, lon=-77.4444613, gc='osm-name'),
 dict(emp('gmu-scitech-manassas', 'George Mason University (Science and Technology Campus, Manassas)', 'education-health', '10900 University Boulevard, Manassas, VA 20110', 'Warrenton and Prince William', 'https://www.gmu.edu/', ['Administrative and program staff roles (use the Jobs link)'], 'none', [3, 5, 3], 'Mason campus near Manassas with program and admin staff jobs.'), lat=38.7581872, lon=-77.5199468, gc='osm-name'),
 dict(emp('nova-manassas', 'Northern Virginia Community College (Manassas Campus)', 'education-health', '10950 Campus Drive, Manassas, VA 20109', 'Warrenton and Prince William', 'https://www.nvcc.edu/', ['Student services, admissions and administrative roles (use the Employment link)'], 'none', [3, 5, 4], 'Community college campus right by I-66 at Manassas; student-services and admin jobs.'), lat=38.8087149, lon=-77.5171186, gc='osm-name'),
 dict(emp('prince-william-medical-center', 'Prince William Medical Center (Manassas)', 'education-health', '8700 Sudley Road, Manassas, VA 20110', 'Warrenton and Prince William', 'https://www.novanthealth.org/', ['Patient access, scheduling and administrative roles (use the Careers link)'], 'none', [2, 5, 4], 'Manassas hospital off Sudley Road; non-clinical admin roles.'), lat=38.7672132, lon=-77.4880504, gc='osm-name'),
 dict(emp('bae-systems-manassas', 'BAE Systems (Manassas)', 'contractor', '9300 Wellington Road, Manassas, VA 20110', 'Warrenton and Prince William', 'https://www.baesystems.com/', ['Business, finance and program support roles (use the Careers link)'], 'most', [2, 1, 3], 'Defense electronics site in Manassas; most roles need a clearance or the ability to get one.'), lat=38.754977, lon=-77.5017197, gc='osm-name'),
 dict(emp('haymarket-medical-center', 'Haymarket Medical Center', 'education-health', '15225 Heathcote Boulevard, Haymarket, VA 20169', 'Warrenton and Prince William', 'https://www.novanthealth.org/', ['Patient access, scheduling and administrative roles (use the Careers link)'], 'none', [2, 5, 4], 'Hospital at the west end of I-66 near Gainesville; non-clinical admin roles.'), lat=38.8210584, lon=-77.6419226, gc='osm-name'),
 dict(emp('kaiser-fair-oaks', 'Kaiser Permanente Fair Oaks Medical Center', 'education-health', '12255 Fair Lakes Parkway, Fairfax, VA 22033', 'Tysons, McLean and Fairfax', 'https://www.kaiserpermanente.org/', ['Member services, scheduling and administrative roles (use the Careers link)'], 'none', [2, 5, 4], 'Large medical center in Fair Lakes right by I-66; member-service and admin jobs.'), lat=38.8587217, lon=-77.3701916, gc='osm-name'),
]
# associations and advocacy HQs (2026-11-18)
NEW += [
 dict(emp('nra-hq', 'National Rifle Association (headquarters, Fairfax)', 'ngo-advocacy', '11250 Waples Mill Road, Fairfax, VA 22030', 'Tysons, McLean and Fairfax', 'https://home.nra.org/', ['Government relations, policy, program and communications roles (use the Careers link)'], 'none', [4, 5, 3], 'Large advocacy HQ in Fair Lakes right by I-66; government relations, communications and member-services roles.'), lat=38.8629981, lon=-77.3355673, gc='osm-name', notes='Location: OpenStreetMap names this organization (or its building) at this address, found through Nominatim 2026-11-18. Ratings are estimates; no posting checked.'),
 dict(emp('nature-conservancy', 'The Nature Conservancy (headquarters, Ballston)', 'ngo-advocacy', '4245 North Fairfax Drive, Arlington, VA 22203', 'Arlington and Alexandria', 'https://www.nature.org/', ['Government relations, policy, program and communications roles (use the Careers link)'], 'none', [4, 5, 3], 'Global conservation nonprofit HQ by Ballston Metro off I-66; policy, program and development roles.'), lat=38.8826, lon=-77.1123, gc='osm-name', notes='Location: OpenStreetMap names this organization (or its building) at this address, found through Nominatim 2026-11-18. Ratings are estimates; no posting checked.'),
 dict(emp('asce', 'American Society of Civil Engineers (headquarters, Reston)', 'ngo-advocacy', '1801 Alexander Bell Drive, Reston, VA 20191', 'Reston, Herndon and Loudoun', 'https://www.asce.org/', ['Government relations, policy, program and communications roles (use the Careers link)'], 'none', [3, 5, 3], 'Professional association HQ in Reston; government relations, membership, events and communications roles.'), lat=38.944081, lon=-77.3212634, gc='osm-name', notes='Location: OpenStreetMap names this organization (or its building) at this address, found through Nominatim 2026-11-18. Ratings are estimates; no posting checked.'),
 dict(emp('ausa', 'Association of the United States Army (Arlington)', 'ngo-advocacy', '2425 Wilson Boulevard, Arlington, VA 22201', 'Arlington and Alexandria', 'https://www.ausa.org/', ['Government relations, policy, program and communications roles (use the Careers link)'], 'none', [4, 5, 3], 'Military advocacy association near Courthouse Metro off I-66; government affairs, events and membership roles.'), lat=38.8908557, lon=-77.088166, gc='osm-name', notes='Location: OpenStreetMap names this organization (or its building) at this address, found through Nominatim 2026-11-18. Ratings are estimates; no posting checked.'),
 dict(emp('nctm', 'National Council of Teachers of Mathematics (Reston)', 'ngo-advocacy', '1906 Association Drive, Reston, VA 20191', 'Reston, Herndon and Loudoun', 'https://www.nctm.org/', ['Government relations, policy, program and communications roles (use the Careers link)'], 'none', [3, 5, 3], 'Education association in Reston; advocacy, programs and membership roles.'), lat=38.945978, lon=-77.346769, gc='osm-name', notes='UNVERIFIED: address is from my own knowledge (not a source page); the map point is that street address in OpenStreetMap. Check the organization site. Ratings are estimates; no posting checked.'),
 dict(emp('nreca', 'National Rural Electric Cooperative Association (Ballston)', 'ngo-advocacy', '4301 Wilson Boulevard, Arlington, VA 22203', 'Arlington and Alexandria', 'https://www.electric.coop/', ['Government relations, policy, program and communications roles (use the Careers link)'], 'none', [4, 5, 3], 'Large trade association in Ballston; government relations, regulatory and communications roles.'), lat=38.8806242, lon=-77.1106159, gc='osm-name', notes='UNVERIFIED: address is from my own knowledge (not a source page); the map point is that street address in OpenStreetMap. Check the organization site. Ratings are estimates; no posting checked.'),
 dict(emp('institute-for-justice', 'Institute for Justice (Ballston)', 'ngo-advocacy', '901 North Glebe Road, Arlington, VA 22203', 'Arlington and Alexandria', 'https://ij.org/', ['Government relations, policy, program and communications roles (use the Careers link)'], 'none', [5, 5, 3], 'Public-interest law and policy nonprofit in Ballston; research, communications and activism roles.'), lat=38.8814225, lon=-77.1151307, gc='osm-name', notes='UNVERIFIED: address is from my own knowledge (not a source page); the map point is that street address in OpenStreetMap. Check the organization site. Ratings are estimates; no posting checked.'),
 dict(emp('mercatus-center', 'Mercatus Center at George Mason University (Arlington)', 'think-tank', '3434 Washington Boulevard, Arlington, VA 22201', 'Arlington and Alexandria', 'https://www.mercatus.org/', ['Government relations, policy, program and communications roles (use the Careers link)'], 'none', [5, 5, 3], 'Policy research center on the Mason Arlington campus near Virginia Square Metro; research assistant and program roles.'), lat=38.8856485, lon=-77.1017448, gc='osm-name', notes='UNVERIFIED: address is from my own knowledge (not a source page); the map point is that street address in OpenStreetMap. Check the organization site. Ratings are estimates; no posting checked.'),
 dict(emp('leadership-institute', 'Leadership Institute (Clarendon)', 'ngo-advocacy', '1101 North Highland Street, Arlington, VA 22201', 'Arlington and Alexandria', 'https://www.leadershipinstitute.org/', ['Government relations, policy, program and communications roles (use the Careers link)'], 'none', [5, 5, 4], 'Political training organization in Clarendon; program, recruiting and events roles that hire recent grads.'), lat=38.8864071, lon=-77.0946046, gc='osm-name', notes='UNVERIFIED: address is from my own knowledge (not a source page); the map point is that street address in OpenStreetMap. Check the organization site. Ratings are estimates; no posting checked.'),
 dict(emp('young-americas-foundation', "Young America's Foundation (Reston)", 'ngo-advocacy', '11480 Commerce Park Drive, Reston, VA 20191', 'Reston, Herndon and Loudoun', 'https://www.yaf.org/', ['Government relations, policy, program and communications roles (use the Careers link)'], 'none', [5, 5, 4], 'Political youth organization in Reston; program, outreach and development roles that hire recent grads.'), lat=38.9461165, lon=-77.3426057, gc='osm-name', notes='UNVERIFIED: address is from my own knowledge (not a source page); the map point is that street address in OpenStreetMap. Check the organization site. Ratings are estimates; no posting checked.'),
 dict(emp('media-research-center', 'Media Research Center (Reston)', 'ngo-advocacy', '1900 Campus Commons Drive, Reston, VA 20191', 'Reston, Herndon and Loudoun', 'https://www.mrc.org/', ['Government relations, policy, program and communications roles (use the Careers link)'], 'none', [4, 5, 3], 'Media watchdog nonprofit in Reston; research analyst and communications roles.'), lat=38.9447967, lon=-77.3367324, gc='osm-name', notes='UNVERIFIED: address is from my own knowledge (not a source page); the map point is that street address in OpenStreetMap. Check the organization site. Ratings are estimates; no posting checked.'),
 dict(emp('americans-for-prosperity', 'Americans for Prosperity (Courthouse, Arlington)', 'ngo-advocacy', '1310 North Courthouse Road, Arlington, VA 22201', 'Arlington and Alexandria', 'https://americansforprosperity.org/', ['Government relations, policy, program and communications roles (use the Careers link)'], 'none', [5, 5, 4], 'Advocacy network near Courthouse Metro off I-66; policy, grassroots and communications roles.'), lat=38.8887046, lon=-77.0841685, gc='osm-name', notes='UNVERIFIED: address is from my own knowledge (not a source page); the map point is that street address in OpenStreetMap. Check the organization site. Ratings are estimates; no posting checked.'),
]
for e in NEW:  # Reston/Dulles sites are not on I-66
    if e['id'] in ['asce', 'media-research-center', 'nctm', 'smithsonian-udvar-hazy', 'young-americas-foundation']: e['why'] = e['why'].replace(I66, '')
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
    ll = (e['lat'], e['lon']) if 'lat' in e else geocode(e['addr'])
    if not ll: print('GEOCODE FAILED', e['id'], e['addr']); continue
    e['lat'], e['lon'], e['gc'], e['us'] = ll[0], ll[1], e.get('gc', 'addr'), ''; pt = P(ll[0], ll[1])
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
