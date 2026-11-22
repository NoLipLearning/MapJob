// Read postings + apply list (Openings): node tests/applylist.js [url]
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const { FAKE } = require('./fake-claude.js');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
const url = process.argv[2] || 'http://localhost:8765/reston-hiring-map.html';
const JOBS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'applylist.json')));
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
const seed = `window.__FAKE_OPTS = {}; window.__FAKE_STORE = { docs: Object.assign({ "meta/refresh": { lastRun: "2026-11-22" } }, ${JSON.stringify(Object.fromEntries(JOBS.map(j => ['jobs/' + j.id, j])))}), subs: [], writes: [] };`;
async function open(ctx) {
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR|favicon/.test(m.text())) p.errs.push(m.text()); });
  await p.goto(url); await p.waitForTimeout(2500);
  await p.evaluate(() => document.getElementById('tab-jobs').click()); await p.waitForTimeout(400); return p;
}
const rows = p => p.evaluate(() => [...document.querySelectorAll('#list .jobrow')].map(r => r.dataset.job));
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') }));
  await ctx.addInitScript(seed); await ctx.addInitScript(FAKE);
  let p = await open(ctx);
  ok(await p.evaluate(() => document.getElementById('sort-jobs').value) === 'apply', 'default sort is Apply order');
  let order = await rows(p);
  ok(order[0] === 'usajobs-likely', 'first row is the likely job: ' + order.join(','));
  ok(order[order.length - 1] === 'usajobs-closed', 'closed job is last');
  ok(await p.evaluate(() => document.querySelector('[data-job="usajobs-closed"]').textContent.includes('Closed')), 'closed job is tagged Closed');
  ok(order.indexOf('usajobs-stretch') < order.indexOf('usajobs-long'), 'stretch before long shot');
  const facts = await p.evaluate(() => document.querySelector('[data-job="usajobs-likely"] .jfacts').textContent.trim());
  ok(facts === '0 yrs · no clearance · Bachelor\'s · apply by Dec 3 · via USAJOBS', 'facts line: ' + facts);
  ok(await p.evaluate(() => document.querySelector('[data-job="usajobs-likely"] .jwhat').textContent.trim()) === 'Review agency programs and write reports for managers.', 'what line shown');
  ok(await p.evaluate(() => !!document.querySelector('[data-job="indeed-noread"] .jtitleonly')), 'unread job tagged title only');
  const can = await p.evaluate(() => { const c = document.querySelector('[data-job="usajobs-long"] .jcan'); return [c.textContent.trim(), c.title]; });
  ok(can[0] === 'Long shot' && can[1] === "5+ years of experience required; a master's degree is required", 'long-shot badge text and why: ' + can);
  ok(await p.evaluate(() => document.querySelector('[data-job="usajobs-likely"] [data-a="apply"]').textContent.trim()) === 'Apply ↗', 'Apply button');
  await p.locator('#list [data-fk="cg:long shot"]').click(); await p.waitForTimeout(250);
  order = await rows(p);
  ok(order.length === 4 && !order.includes('usajobs-long'), 'unticking Long shot hides exactly one row: ' + order.join(','));
  ok(await p.evaluate(() => document.querySelector('.jfs').textContent.includes('4 of 5')), 'count updates');
  ok(p.errs.length === 0, 'no console errors ' + p.errs.slice(0, 2));
  await b.close(); console.log(res.join('\n')); process.exit(res.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
