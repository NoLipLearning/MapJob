// Find-openings links + My pages: node tests/links.js [url]
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
const url = process.argv[2] || 'http://localhost:8765/reston-hiring-map.html';
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR|favicon/.test(m.text())) errs.push(m.text()); });
  await p.goto(url); await p.waitForTimeout(2500);
  await p.evaluate(() => app.select('ssa-reston-field-office', true)); await p.waitForTimeout(800);
  ok(await p.evaluate(() => Array.isArray(app.hooks.markers)), 'hooks.markers is a list');
  ok(await p.evaluate(() => typeof app.hooks.marker === 'undefined'), 'old single marker hook is gone');
  ok(await p.evaluate(() => { app.hooks.markers.push(() => ({ color: '#123456', glyph: 'J', pos: 'tl' })); app.hooks.markers.push(() => ({ color: '#654321', glyph: 'X', pos: 'tl' })); return markerDots(app.E[0]).filter(d => d.pos === 'tl').length === 1 && markerDots(app.E[0]).find(d => d.pos === 'tl').glyph === 'J'; }), 'first dot per corner wins');
  await p.evaluate(() => app.filters.addToggle({ id: 't1', label: 'Test toggle', test: e => e.type === 'federal' }));
  ok(await p.evaluate(() => !!document.querySelector('#filters .chip[data-x="t1"]')), 'addToggle renders a chip');
  ok(await p.evaluate(() => { document.querySelector('#filters .chip[data-x="t1"]').click(); return app.ranked.length > 0 && app.ranked.every(e => e.type === 'federal'); }), 'toggle filters the list');
  ok(await p.evaluate(() => app.filters.activeCount() >= 1), 'toggle counts as an active filter');
  ok(await p.evaluate(() => { app.filters.reset(); return app.filters.activeCount() === 0 && app.ranked.some(e => e.type !== 'federal'); }), 'reset clears extra toggles');
  const n0 = await p.evaluate(() => app.E.length);
  ok(await p.evaluate(() => app.employers.add([{ id: 'zz-test', name: 'ZZ Test Org', type: 'corporate', addr: '1 Test St, Reston, VA 20190', lat: 38.95, lon: -77.35, reg: 'Reston, Herndon and Loudoun', url: 'https://example.org', roles: [], progs: [], cl: 'none', s: [3, 3, 3], why: '', src: [], notes: '' }])) === 1, 'employers.add returns 1');
  ok(await p.evaluate(() => app.E.length) === n0 + 1 && await p.evaluate(() => app.employers.add([{ id: 'zz-test', lat: 1, lon: 1 }])) === 0, 'duplicate id is ignored');
  ok(await p.evaluate(() => app.ranked.some(e => e.id === 'zz-test')), 'added employer is ranked');
  ok(errs.length === 0, 'no console errors ' + errs.slice(0, 2));
  await b.close(); console.log(res.join('\n')); process.exit(res.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
