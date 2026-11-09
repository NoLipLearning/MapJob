import json
t=open('template4.html').read(); d=json.load(open('prep4.json'))
open('reston-hiring-map.html','w').write(t.replace('__DATA__',json.dumps(d,separators=(',',':'))))
print('html bytes',len(t)+len(json.dumps(d,separators=(',',':'))))
