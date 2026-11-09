import json, re, time, urllib.parse, urllib.request
recs=[]
for f in ['v_gov.json','v_policy.json','v_contractors.json','v_corporate.json']:
    for r in json.load(open(f)): r['_src']=f[2:-5]; recs.append(r)
def geo(q):
    u="https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q="+urllib.parse.quote(q)
    d=json.load(urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":"reston-map-research/1.0"}),timeout=20)); time.sleep(1.1)
    return [float(d[0]['lat']),float(d[0]['lon']),d[0]['display_name'][:80]] if d else None
FIX={"wilson-center":[38.8942317,-77.0306901],"us-house-of-representatives":[38.8867704,-77.0100664],"us-senate":[38.8928461,-77.0041747],
 "library-of-congress-crs":[38.8886737,-77.004636],"congressional-budget-office":[38.8845486,-77.0144004],"booz-allen-hamilton":[38.922333,-77.2317266],"mitre":[38.9242952,-77.2076425],"gannett-usa-today":[38.9325446,-77.2178005],"airlie":[38.7627675,-77.7912671]}
QFIX={"abt-global":"Executive Boulevard, Rockville, MD"}
URLFIX={'morning-consult':'https://morningconsult.com/careers/'}
out=[]; dropped=[]
for r in recs:
    g=r.get('geo'); conf=r.get('geo_conf')
    if r['id'] in FIX and FIX[r['id']]: g=FIX[r['id']]+['fixed']; conf='landmark'
    elif r['id'] in QFIX:
        x=geo(QFIX[r['id']]); print('qfix',r['id'],x)
        if x: g=x; conf='street'
    if not g or not (38.55<g[0]<39.25 and -78.1<g[1]<-76.75): dropped.append((r['id'],r.get('address'))); continue
    a=r.get('address','')
    st=(re.findall(r',\s*([A-Z]{2})\s*\d{5}',a) or [''])[0]
    city=a.lower()
    if st=='DC' or 'washington' in city and st!='VA': reg='Washington, DC'
    elif st=='MD': reg='Maryland suburbs'
    elif re.search(r'warrenton|fauquier|remington|manassas|gainesville|woodbridge|prince william|bealeton|marshall|culpeper',city): reg='Warrenton and Prince William'
    elif re.search(r'arlington|alexandria',city): reg='Arlington and Alexandria'
    elif re.search(r'mclean|tysons|vienna|falls church|fairfax|annandale|merrifield',city): reg='Tysons, McLean and Fairfax'
    elif re.search(r'reston|herndon|dulles|sterling|ashburn|leesburg|chantilly|loudoun',city): reg='Reston, Herndon and Loudoun'
    else: reg='Other'
    s=r['scores']
    out.append(dict(id=r['id'],name=r['name'],type=r['org_type'],addr=a,lat=round(g[0],6),lon=round(g[1],6),gc=conf,reg=reg,
      url=URLFIX.get(r['id'],r['careers_url']),us=('200' if r['id'] in URLFIX else r.get('url_status','')),roles=r.get('entry_roles',[]),progs=r.get('programs',[]),cl=r['clearance'],
      s=[s['role_fit'],s['clearance_access'],s['entry_access']],why=r.get('why',''),src=r.get('sources',[]),notes=r.get('notes','')))
ids=[o['id'] for o in out]; assert len(ids)==len(set(ids)), 'dup ids'
print('kept',len(out),'dropped',dropped)
import collections; print(collections.Counter(o['reg'] for o in out))
json.dump(out,open('employers.json','w'),separators=(',',':'))
