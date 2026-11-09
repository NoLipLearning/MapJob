import json, math, re
LAT0,LON0=38.955,-77.355
KX=111320*math.cos(math.radians(LAT0)); KY=110574
P=lambda lat,lon:((lon-LON0)*KX,(LAT0-lat)*KY)
def dp(pts,eps):
    if len(pts)<3: return pts
    (x1,y1),(x2,y2)=pts[0],pts[-1]; dx,dy=x2-x1,y2-y1; L=math.hypot(dx,dy) or 1e-9; mi,md=0,0
    for i in range(1,len(pts)-1):
        x,y=pts[i]; dd=abs(dy*x-dx*y+x2*y1-y2*x1)/L
        if dd>md: md,mi=dd,i
    if md>eps: return dp(pts[:mi+1],eps)[:-1]+dp(pts[mi:],eps)
    return [pts[0],pts[-1]]
flat=lambda pts:[round(v) for p in pts for v in p]
CORE=(38.925,-77.425,38.985,-77.305)
incore=lambda lat,lon: CORE[0]<=lat<=CORE[2] and CORE[1]<=lon<=CORE[3]
out={k:[] for k in ['a','b','c','d','rail','river','water','wa','wb','wrail']}
cls={'motorway':'a','trunk':'a','primary':'b','secondary':'c','tertiary':'d'}
for el in json.load(open('rc.json'))['elements']:
    if el['type']!='way' or 'geometry' not in el: continue
    t=el.get('tags',{}); g=[P(p['lat'],p['lon']) for p in el['geometry']]
    if 'highway' in t:
        c=cls.get(t['highway'])
        if c: out[c].append(flat(dp(g,3)))
    elif 'railway' in t: out['rail'].append(flat(dp(g,3)))
    elif t.get('natural')=='water' and g[0]==g[-1]: out['water'].append(flat(dp(g,3)))
def split_outside(el):
    runs=[];cur=[]
    for p in el['geometry']:
        if incore(p['lat'],p['lon']):
            if len(cur)>1: runs.append(cur)
            cur=[]
        else: cur.append(P(p['lat'],p['lon']))
    if len(cur)>1: runs.append(cur)
    return runs
for el in json.load(open('wide.json'))['elements']:
    if el['type']!='way' or 'geometry' not in el: continue
    t=el.get('tags',{})
    if 'highway' in t:
        c='wa' if t['highway'] in('motorway','trunk') else 'wb'
        for r in split_outside(el): out[c].append(flat(dp(r,18)))
    elif 'railway' in t:
        for r in split_outside(el): out['wrail'].append(flat(dp(r,18)))
    elif t.get('waterway')=='river':
        out['river'].append(flat(dp([P(p['lat'],p['lon']) for p in el['geometry']],25)))
def num(s):
    m=re.match(r'\s*([\d.]+)',str(s))
    if not m: return None
    try: v=float(m.group(1))
    except: return None
    return v*0.3048 if ('ft' in str(s) or "'" in str(s)) else v
DEF={'house':7,'detached':7,'residential':8,'semidetached_house':7,'terrace':8,'townhouse':8,'apartments':14,'commercial':11,'office':12,'retail':7,'industrial':9,'hotel':14,'hospital':15,'school':8,'church':8,'garage':3,'garages':3,'shed':3,'roof':4,'carport':3,'parking':8,'yes':8}
OFFICE={'office','commercial','yes','government','civic','hospital','industrial','public'}
seen=set(); B=[]; meta=[]
for f in ['bw.json','be.json']:
    for el in json.load(open(f))['elements']:
        if el['type']!='way' or 'geometry' not in el or el['id'] in seen: continue
        seen.add(el['id']); t=el.get('tags',{}); g=[P(p['lat'],p['lon']) for p in el['geometry']]
        if len(g)<4 or g[0]!=g[-1]: continue
        raw=g[:-1]; g=dp(raw,0.7)
        if len(g)<3: continue
        area=abs(sum(raw[i][0]*raw[(i+1)%len(raw)][1]-raw[(i+1)%len(raw)][0]*raw[i][1] for i in range(len(raw))))/2
        h=None; lv=None; k=0
        if 'building:levels' in t: lv=num(t['building:levels'])
        if 'height' in t: h=num(t['height'])
        if h is None and lv: h=lv*3.3+1
        if h is not None: k=1
        else: h=DEF.get(t.get('building'),8)
        floors=lv if lv else (round(h/4.0) if k else None)
        B.append([round(h*10),k]+[round(v*10) for p in g for v in p])
        cx=sum(p[0] for p in raw)/len(raw); cz=sum(p[1] for p in raw)/len(raw)
        meta.append(dict(i=len(B)-1,t=t,area=area,h=h,k=k,floors=floors,cx=cx,cz=cz,poly=g))
print('buildings',len(B),'tagged',sum(m['k'] for m in meta))
LL=json.load(open('pins_ll.json'))
def inside(pt,poly):
    x,y=pt; c=False
    for i in range(len(poly)):
        x1,y1=poly[i]; x2,y2=poly[i-1]
        if (y1>y)!=(y2>y) and x<(x2-x1)*(y-y1)/(y2-y1)+x1: c=not c
    return c
roof={}; pinB={}
for pid,(lat,lon) in LL.items():
    pt=P(lat,lon); best=None
    for m in meta:
        if abs(m['cx']-pt[0])>250 or abs(m['cz']-pt[1])>250: continue
        if inside(pt,m['poly']): best=(0,m); break
        d=math.hypot(m['cx']-pt[0],m['cz']-pt[1])
        if d<70 and m['k'] and (best is None or d<best[0]): best=(d,m)
    if best: roof[pid]=[round(best[1]['h']),best[1]['k']]; pinB[pid]=best[1]['i']
    else: roof[pid]=[0,0]
# ranking
def norm(a): 
    a=a.lower().replace(' road',' rd').replace(' drive',' dr').replace(' street',' st').replace(' boulevard',' blvd').replace(' way',' way')
    return re.sub(r'\s+',' ',a).strip()
ALIAS={k:[norm(x) for x in v] for k,v in {
 'fannie':['2000 Opportunity Way'],'leidos':['1750 Presidents Street'],'verisign':['12061 Bluemont Way'],'comscore':['11950 Democracy Drive'],
 'rr':['1875 Explorer Street'],'hosp':['1850 Town Center Parkway'],'ods':['12010 Sunset Hills Road'],'caci':['12021 Sunset Hills Road'],
 'oracle':['1910 Oracle Way'],'nvr':['11700 Plaza America Drive'],'google':['1900 Reston Metro Plaza'],'icf':['1902 Reston Metro Plaza'],
 'booz':['1870 Reston Row Plaza','1800 Reston Row Plaza'],'gd':['11011 Sunset Hills Road'],'usgs':['12201 Sunrise Valley Drive'],'peraton':['12975 Worldgate Drive']}.items()}
NAMES={'oracle':['oracle'],'verisign':['verisign'],'leidos':['leidos'],'fannie':['fannie mae'],'northrop':['northrop grumman space systems','northrop grumman'],'amazon':['amazon web services'],'usgs':['usgs national center','u.s. geological survey']}
for k in NAMES:
    ALIAS.setdefault(k,[])
rank=[]
for m in meta:
    t=m['t']; b=t.get('building')
    if b not in OFFICE or not m['floors'] or m['area']<400: continue
    nm=(t.get('name') or '').strip()
    if re.search(r'garage|parking|church|school|storage|apartment|condo|residen|hotel|hyatt|marriott|westin|hilton|\binn\b|suites|midtown|cosmopolitan|lofts|residences',nm,re.I): continue
    if t.get('tourism') or 'resid' in t.get('building:use','') or 'apartments' in t.get('building:use',''): continue
    if t.get('amenity') in ('parking','school','place_of_worship') or t.get('parking'): continue
    if b=='yes' and m['floors']<3: continue
    addr=' '.join(x for x in [t.get('addr:housenumber',''),t.get('addr:street','')] if x).strip()
    sqft=m['area']*m['floors']*10.7639
    lat=LAT0-m['cz']/KY; lon=LON0+m['cx']/KX
    emps=[pid for pid,bi in pinB.items() if bi==m['i']]
    na=norm(addr)
    for pid,al in ALIAS.items():
        if (na and na in al) or (nm and nm.lower() in NAMES.get(pid,[])):
            if pid not in emps: emps.append(pid)
    rank.append(dict(bi=m['i'],name=nm,addr=addr,city=t.get('addr:city',''),floors=round(m['floors']),h=round(m['h']),fp=round(m['area']*10.7639),sqft=round(sqft,-3),x=round(m['cx']),z=round(m['cz']),lat=round(lat,6),lon=round(lon,6),emps=emps,type=b))
rank.sort(key=lambda r:-r['sqft']); rank=rank[:40]
import time, urllib.request, urllib.parse
for r in rank:
    if r['addr'] and any(ch.isdigit() for ch in r['addr']): continue
    u=f"https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat={r['lat']}&lon={r['lon']}"
    try:
        j=json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'reston-map-research/1.0'}),timeout=20)); a=j.get('address',{})
        hn=a.get('house_number',''); rd=a.get('road','')
        if rd: r['addr']=(hn+' '+rd).strip() if hn else 'Near '+rd; r['geo']=1
        r['city']=r['city'] or a.get('town') or a.get('city') or a.get('hamlet') or ''
    except Exception as e: print('rev err',e)
    time.sleep(1.1)
for i,r in enumerate(rank): print(i+1,r['sqft'],r['floors'],r['name'][:30],'|',r['addr'],r['city'],r['emps'],r['type'])
json.dump({'lat0':LAT0,'lon0':LON0,'kx':KX,'ky':KY,'ll':LL,'roof':roof,'pinB':pinB,'rank':rank,'r':out,'b':B},open('prep3.json','w'),separators=(',',':'))
import os; print(os.path.getsize('prep3.json'))
