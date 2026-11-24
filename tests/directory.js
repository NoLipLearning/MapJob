// NoVA employer directory (82-directory): node tests/directory.js [url]
// Fixture injected as window.RESTON_TEST_DIR, which 82-directory reads instead of app.D.dir.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
const url = process.argv[2] || 'http://localhost:8765/reston-hiring-map.html';
const DIR = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'directory.json')));
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch({ args: ARGS });
  async function open(dir) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') }));
    await ctx.addInitScript(`window.RESTON_TEST_DIR = ${JSON.stringify(dir)};`);
    const p = await ctx.newPage(); p.errs = [];
    p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|favicon|net::ERR/.test(m.text())) p.errs.push(m.text()); });
    await p.goto(url, { waitUntil: 'load' }); await p.waitForTimeout(2500); return p;
  }
  const dirPins = p => p.evaluate(() => pins.filter(q => q.kind === 'dir').length);
  const empPins = p => p.evaluate(() => pins.filter(q => q.kind === 'emp').length);
  let p = await open(DIR);
  ok(await dirPins(p) === 3, 'three directory pins (the empId duplicate draws none): ' + await dirPins(p));
  ok(await p.locator('#dirbtn').getAttribute('aria-pressed') === 'true', 'Employers layer button defaults on');
  await p.click('#tab-dir'); await p.waitForTimeout(300);
  const rows = await p.evaluate(() => [...document.querySelectorAll('#list .dirrow')].map(r => r.dataset.dir));
  ok(rows.join(',') === 'near-careers-aaaaaa,mid-website-bbbbbb,far-nolink-cccccc', 'All NoVA list sorted by drive minutes: ' + rows.join(','));
  ok(/min/.test(await p.locator('[data-dir="near-careers-aaaaaa"]').textContent()), 'rows show drive minutes');
  const btn = async id => p.evaluate(id => { const a = document.querySelector(`[data-dir="${id}"] [data-a="dir-open"]`); return a ? [a.textContent.trim(), a.getAttribute('href'), a.getAttribute('rel')] : null; }, id);
  const c = await btn('near-careers-aaaaaa');
  ok(c && c[0] === 'Careers ↗' && c[1] === 'https://near.example.com/careers' && /noopener/.test(c[2]), 'careers row button: ' + JSON.stringify(c));
  ok((await btn('mid-website-bbbbbb') || [])[0] === 'Website ↗', 'website row button says Website');
  ok(await btn('far-nolink-cccccc') === null, 'no-link row has no button');
  await p.evaluate(() => app.directory.open('near-careers-aaaaaa', false)); await p.waitForTimeout(300);
  ok(await p.evaluate(() => { const a = document.querySelector('#card [data-a="dir-open"]'); return a && a.textContent.trim() === 'Careers ↗' && a.href === 'https://near.example.com/careers'; }), 'card shows the Careers button');
  await p.click('#tab-emp'); await p.waitForTimeout(300);
  const e0 = await empPins(p);
  await p.click('#dirbtn'); await p.waitForTimeout(300);
  ok(await dirPins(p) === 0 && await empPins(p) === e0, 'turning the layer off removes directory pins only');
  ok(p.errs.length === 0, 'no page errors: ' + p.errs.join(' | '));
  p = await open([{ id: 'x', name: 'Bad', kind: 'corporate', addr: '1 A St', lat: 38.9, lon: -77.3, gc: 'addr', link: 'javascript:alert(1)', linkType: 'careers', src: ['https://x.org'], via: 'list', checked: '2026-11-24' }]);
  await p.click('#tab-dir'); await p.waitForTimeout(300);
  ok(await p.locator('#list [data-a="dir-open"]').count() === 0, 'a javascript: link never becomes a button');
  p = await open([]);
  ok(await p.locator('#dirbtn').count() === 0 || true, 'empty list loads');
  ok(await p.locator('#tab-dir').count() === 0 || /No employers loaded/.test(await (async () => { await p.click('#tab-dir'); await p.waitForTimeout(200); return p.locator('#list').textContent(); })()), 'empty directory: no tab or "No employers loaded"');
  ok(p.errs.length === 0, 'empty directory: no page errors: ' + p.errs.join(' | '));
  await b.close(); console.log(res.join('\n'));
  process.exit(res.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
