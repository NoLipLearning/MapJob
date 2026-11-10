"""Build reston-hiring-map.html from shell.html + parts/*.css + parts/*.js (filename order) + prep4.json.
Run from src/:  python3 build4.py   (writes ../reston-hiring-map.html)"""
import json, glob, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
shell = open('shell.html').read()
css = '\n'.join(open(f).read() for f in sorted(glob.glob('parts/*.css')))
js = '\n'.join(open(f).read() for f in sorted(glob.glob('parts/*.js')))
try: ap = open('apply_prompt.md').read().strip()
except OSError: ap = ''
if ap: js = js.replace('"__APPLY_PROMPT__"', json.dumps(ap))
D = json.load(open('prep4.json'))
D['offices'] = json.load(open('offices.json')) if os.path.exists('offices.json') else []  # office buildings, see docs/DATA-CONTRACT-v4.md
data = json.dumps(D, separators=(',', ':'))
out = shell.replace('/*__CSS__*/', css).replace('/*__JS__*/', js.replace('__DATA__', data))
open('../reston-hiring-map.html', 'w').write(out)
print('html bytes', len(out), '| parts:', ', '.join(os.path.basename(f) for f in sorted(glob.glob('parts/*.*'))))
