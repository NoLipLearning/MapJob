"""Build reston-hiring-map.html from shell.html + parts/*.css + parts/*.js (filename order) + prep4.json.
Run from src/:  python3 build4.py   (writes ../reston-hiring-map.html)"""
import json, glob, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
shell = open('shell.html').read()
css = '\n'.join(open(f).read() for f in sorted(glob.glob('parts/*.css')))
js = '\n'.join(open(f).read() for f in sorted(glob.glob('parts/*.js')))
data = json.dumps(json.load(open('prep4.json')), separators=(',', ':'))
routes = open('routes.json').read().strip() if os.path.exists('routes.json') else 'null'  # precomputed by routes.py; null = fall back to miles
out = shell.replace('/*__CSS__*/', css).replace('/*__JS__*/', js.replace('__ROUTES__', routes).replace('__DATA__', data))
open('../reston-hiring-map.html', 'w').write(out)
print('html bytes', len(out), '| parts:', ', '.join(os.path.basename(f) for f in sorted(glob.glob('parts/*.*'))))
