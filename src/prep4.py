import json, math, re, os
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
def load(f):
    try:
        d=json.load(open(f)); return d.get('elements',[])
    except Exception: return []
p3=json.load(open('prep3.json')); R=p3['r']
# extra wide roads outside the old wide bbox (38.78..39.10, -77.62..-77.02)
def outside_old(lat,lon): return not (38.78<=lat<=39.10 and -77.62<=lon<=-77.02)
def runs(el,pred):
    out=[];cur=[]
    for p in el['geometry']:
        if pred(p['lat'],p['lon']): cur.append(P(p['lat'],p['lon']))
        else:
            if len(cur)>1: out.append(cur)
            cur=[]
    if len(cur)>1: out.append(cur)
    return out
for f in ['w_west.json','w_se.json']:
    for el in load(f):
        if 'geometry' not in el: continue
        t=el.get('tags',{}); c='wa' if t.get('highway') in ('motorway','trunk') else 'wb'
        for r in runs(el,outside_old): R[c].append(flat(dp(r,18)))
if os.path.exists('osrm_routes.json'):
    for c in json.load(open('osrm_routes.json')):
        el={'geometry':[{'lat':p[1],'lon':p[0]} for p in c]}
        for r in runs(el,outside_old): R['wa'].append(flat(dp(r,18)))
for el in load('w_rail.json'):
    if 'geometry' not in el: continue
    t=el.get('tags',{})
    if 'railway' in t:
        for r in runs(el,outside_old): R['wrail'].append(flat(dp(r,18)))
    elif t.get('waterway')=='river':
        for r in runs(el,outside_old): R['river'].append(flat(dp(r,25)))
for f in ['sec_east.json','sec_warr.json']:
    for el in load(f):
        if 'geometry' not in el: continue
        t=el.get('tags',{}); c='c' if t.get('highway')=='secondary' else 'd'
        R[c].append(flat(dp([P(p['lat'],p['lon']) for p in el['geometry']],4)))
# stations
ST=[]
for el in load('stations.json'):
    t=el.get('tags',{})
    if el.get('type')=='node' and (t.get('station')=='subway' or 'Metro' in t.get('network','') or 'WMATA' in t.get('operator','') or 'Washington Metropolitan' in t.get('operator','')):
        ST.append([t.get('name',''),el['lat'],el['lon']])
if not ST and os.path.exists('stations_list.json'): ST=json.load(open('stations_list.json'))
print('metro stations',len(ST))
# buildings
def num(s):
    m=re.match(r'\s*([\d.]+)',str(s))
    if not m: return None
    try: v=float(m.group(1))
    except: return None
    return v*0.3048 if ('ft' in str(s) or "'" in str(s)) else v
DEF={'house':7,'detached':7,'residential':8,'semidetached_house':7,'terrace':8,'apartments':14,'commercial':11,'office':12,'retail':7,'industrial':9,'hotel':14,'hospital':15,'school':8,'church':8,'garage':3,'garages':3,'shed':3,'roof':4,'carport':3,'parking':8,'yes':8}
OFFICE={'office','commercial','yes','government','civic','hospital','industrial','public'}
def parse(elems,area,seen):
    B=[];M=[]
    for el in elems:
        if el.get('type')!='way' or 'geometry' not in el or el['id'] in seen: continue
        seen.add(el['id']); t=el.get('tags',{})
        g=[P(p['lat'],p['lon']) for p in el['geometry']]
        if len(g)<4 or g[0]!=g[-1]: continue
        raw=g[:-1]; gg=dp(raw,0.7)
        if len(gg)<3: continue
        a=abs(sum(raw[i][0]*raw[(i+1)%len(raw)][1]-raw[(i+1)%len(raw)][0]*raw[i][1] for i in range(len(raw))))/2
        h=None; lv=None; k=0
        if 'building:levels' in t: lv=num(t['building:levels'])
        if 'height' in t: h=num(t['height'])
        if h is None and lv: h=lv*3.3+1
        if h is not None: k=1
        else: h=DEF.get(t.get('building'),8)
        rec=[round(h*10),k]+[round(v*10) for p in gg for v in p]; B.append(rec)
        M.append(dict(rec=rec,t=t,area=a,h=h,k=k,floors=(lv if lv else (round(h/4.0) if k else None)),cx=sum(p[0] for p in raw)/len(raw),cz=sum(p[1] for p in raw)/len(raw),poly=gg,zone=area))
    return B,M
seen=set(); allM=[]
coreB,coreM=parse(load('bw.json')+load('be.json'),'Reston and Herndon',seen); allM+=coreM
TILES=[('tysons','Tysons','t_tysons.json'),('arlington','Rosslyn-Ballston',['t_rb.json','t_rb1.json','t_rb2.json']),('crystal','Crystal City and Pentagon','t_crystal.json'),('dc','Downtown DC','t_dc.json'),('warrenton','Warrenton','t_warrenton.json')]
os.makedirs('tiles',exist_ok=True); tiles=[]
for tid,name,files in TILES:
    files=files if isinstance(files,list) else [files]
    el=[]; [el.extend(load(f)) for f in files]
    if not el:
        cache=f'tiles_{tid}_cached.json'
        if os.path.exists(cache):
            B=json.load(open(cache)); json.dump(B,open(f'tiles/{tid}.json','w'),separators=(',',':'))
            xs=[v/10 for b in B for v in b[2::2]]; zs=[v/10 for b in B for v in b[3::2]]
            tiles.append(dict(id=tid,name=name,file=f'tiles/{tid}.json',cx=round((min(xs)+max(xs))/2),cz=round((min(zs)+max(zs))/2),rad=round(max(max(xs)-min(xs),max(zs)-min(zs))/2)))
            print(tid,'from cache',len(B))
        else: print('no data for',tid)
        continue
    B,M=parse(el,name,seen); allM+=M
    xs=[m['cx'] for m in M]; zs=[m['cz'] for m in M]
    cx,cz=(min(xs)+max(xs))/2,(min(zs)+max(zs))/2; rad=max(max(xs)-min(xs),max(zs)-min(zs))/2
    json.dump(B,open(f'tiles/{tid}.json','w'),separators=(',',':'))
    tiles.append(dict(id=tid,name=name,file=f'tiles/{tid}.json',cx=round(cx),cz=round(cz),rad=round(rad)))
    print(tid,len(B),'tagged',sum(m['k'] for m in M),os.path.getsize(f'tiles/{tid}.json'))
# ranking per zone
def inside(pt,poly):
    x,y=pt; c=False
    for i in range(len(poly)):
        x1,y1=poly[i]; x2,y2=poly[i-1]
        if (y1>y)!=(y2>y) and x<(x2-x1)*(y-y1)/(y2-y1)+x1: c=not c
    return c
EX=r'garage|parking|church|school|storage|apartment|condo|residen|hotel|hyatt|marriott|westin|hilton|\binn\b|suites|midtown|cosmopolitan|lofts|residences|museum|cathedral|stadium|arena|station|mall|center court|convention|fashion|shopping|market'
cands=[]
for m in allM:
    t=m['t']; b=t.get('building'); nm=(t.get('name') or '').strip()
    if b not in OFFICE or not m['floors'] or m['area']<400: continue
    if re.search(EX,nm,re.I) or t.get('tourism') or 'resid' in t.get('building:use','') or t.get('amenity') in ('parking','school','place_of_worship'): continue
    if b=='yes' and m['floors']<3: continue
    addr=' '.join(x for x in [t.get('addr:housenumber',''),t.get('addr:street','')] if x).strip()
    cands.append(dict(m=m,name=nm,addr=addr,city=t.get('addr:city',''),sqft=m['area']*m['floors']*10.7639))
rank=[]
for zone in ['Reston and Herndon']+[t[1] for t in TILES]:
    z=[c for c in cands if c['m']['zone']==zone]; z.sort(key=lambda c:-c['sqft']); rank+=z[:20]
rank.sort(key=lambda c:-c['sqft'])
EM=json.load(open('employers.json'))
for e in EM:
    pt=P(e['lat'],e['lon']); e['metro']=any(math.hypot(*(a-b for a,b in zip(P(s[1],s[2]),pt)))<1000 for s in ST)
    best=None
    for m in allM:
        if abs(m['cx']-pt[0])>250 or abs(m['cz']-pt[1])>250: continue
        if inside(pt,m['poly']): best=m; break
    if best: e['bp']=best['rec']
RANK=[]
for i,c in enumerate(rank):
    m=c['m']; lat=LAT0-m['cz']/KY; lon=LON0+m['cx']/KX
    emps=[e['id'] for e in EM if e.get('bp') is m['rec']]
    RANK.append(dict(n=i+1,name=c['name'],addr=c['addr'],city=c['city'],area=m['zone'],floors=round(m['floors']),h=round(m['h']),sqft=round(c['sqft'],-3),x=round(m['cx']),z=round(m['cz']),lat=round(lat,6),lon=round(lon,6),bp=m['rec'],emps=emps))
print('rank',len(RANK),[ (r['n'],r['name'][:25],r['area'],r['sqft']) for r in RANK[:12]])
print('emps with building',sum(1 for e in EM if 'bp' in e),'metro',sum(1 for e in EM if e['metro']))
D=dict(lat0=LAT0,lon0=LON0,kx=KX,ky=KY,r=R,b=coreB,rank=RANK,tiles=tiles,emps=EM)
json.dump(D,open('prep4.json','w'),separators=(',',':')); print('prep4',os.path.getsize('prep4.json'))
