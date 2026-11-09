import json, sys, time, re, urllib.parse, urllib.request, subprocess, os
src=sys.argv[1]; out=sys.argv[2]
recs=json.load(open(src)); cache=json.load(open('geocache.json')) if os.path.exists('geocache.json') else {}
def geo(q):
    if q in cache: return cache[q]
    u="https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q="+urllib.parse.quote(q)
    try: d=json.load(urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":"reston-map-research/1.0"}),timeout=20))
    except Exception as e: d=[]
    time.sleep(1.1); r=[float(d[0]['lat']),float(d[0]['lon']),d[0]['display_name'][:80]] if d else None
    cache[q]=r; json.dump(cache,open('geocache.json','w')); return r
def clean(a):
    a=re.sub(r'\b(\d+(st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+floor,?','',a,flags=re.I)
    a=re.sub(r'\b(Suite|Ste\.?|Floor|Fl\.?|Room|Rm\.?|Unit|#)\s*[\w-]+,?','',a,flags=re.I)
    a=re.sub(r'\b(\d{5})-\d{4}\b',r'\1',a); a=re.sub(r'\s+,',',',a); return re.sub(r'\s{2,}',' ',a).strip(' ,')
for r in recs:
    a=clean(r.get('address',''))
    hn=(re.match(r'\s*(\d+)',a) or [None,None])[1]
    ok=lambda g: g and (not hn or hn in g[2]) and 38.5<g[0]<39.3 and -78.2<g[1]<-76.7
    cands=[a, re.sub(r',\s*[A-Z]{2}\s*\d{5}.*$','',a)+', '+(re.findall(r',\s*([A-Z]{2})\s*\d{5}',a) or [''])[0]]
    g=None; conf='addr'
    for q in cands:
        x=geo(q)
        if ok(x): g=x; break
    if not g:
        for q in cands:
            x=geo(q)
            if x and 38.5<x[0]<39.3 and -78.2<x[1]<-76.7: g=x; conf='street'; break
    if not g: conf='none'
    r['geo_conf']=conf
    r['geo']=g; r['geo_q']=a
    try:
        c=subprocess.run(['curl','-sS','-o','/dev/null','-L','-m','15','-A','Mozilla/5.0','-w','%{http_code}',r['careers_url']],capture_output=True,text=True,timeout=25).stdout
    except Exception: c='ERR'
    r['url_status']=c
    print(f"{r['id'][:34]:34} {conf:6} {c:4} {(g[2][:50] if g else a[:50])}")
json.dump(recs,open(out,'w'),indent=1)
