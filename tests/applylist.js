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
  ok(order.slice(-2).includes('usajobs-closed') && order.slice(-2).includes('indeed-closed-title'), 'closed jobs are last');
  ok(await p.evaluate(() => document.querySelector('[data-job="usajobs-closed"]').textContent.includes('Closed')), 'closed job is tagged Closed');
  ok(await p.evaluate(() => document.querySelector('[data-job="indeed-closed-title"]').textContent.includes('Closed')), 'title-only closed job is tagged Closed');
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
  ok(order.length === 5 && !order.includes('usajobs-long'), 'unticking Long shot hides exactly one row: ' + order.join(','));
  ok(await p.evaluate(() => document.querySelector('.jfs').textContent.includes('5 of 6')), 'count updates');
  ok(p.errs.length === 0, 'no console errors ' + p.errs.slice(0, 2));
  // ---- Task 4: Apply -> Applied? loop ----
  await p.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  await p.locator('#list [data-fk="cg:long shot"]').click(); await p.waitForTimeout(250); // back to all
  for (const id of ['usajobs-likely', 'usajobs-stretch', 'usajobs-long']) { await p.click(`[data-job="${id}"] [data-a="apply"]`); await p.waitForTimeout(150); }
  ok(JSON.stringify(await p.evaluate(() => JSON.parse(localStorage.getItem('reston-map-apply-pending')))) === JSON.stringify(['usajobs-likely', 'usajobs-stretch', 'usajobs-long']), 'pending list holds the 3 ids');
  ok((await p.evaluate(() => window.__opened[0])) === 'https://www.usajobs.gov/job/likely/apply', 'Apply opens the read applyUrl');
  ok(/Applied this week: \d+ · Unread: \d+/.test(await p.evaluate(() => document.querySelector('#list .jcounter').textContent)), 'header counter shown');
  await p.reload(); await p.waitForTimeout(2500); await p.evaluate(() => document.getElementById('tab-jobs').click()); await p.waitForTimeout(400);
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(300);
  ok(await p.evaluate(() => ['usajobs-likely', 'usajobs-stretch', 'usajobs-long'].every(id => !!document.querySelector(`[data-job="${id}"] .jasked`))), 'after reload all 3 rows ask Applied?');
  await p.click('[data-job="usajobs-likely"] [data-a="applied-yes"]'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => window.__FAKE_STORE.docs['jobs/usajobs-likely'].status) === 'applied', 'Yes writes status applied to the cloud');
  ok(await p.evaluate(() => !document.querySelector('[data-job="usajobs-likely"] .jasked') && document.querySelector('[data-job="usajobs-likely"]').textContent.includes('Applied')), 'row shows Applied, prompt gone');
  ok(await p.evaluate(() => app.tracker.all().some(r => r.jobId === 'usajobs-likely' && r.status === 'applied')), 'tracker has an applied record for the job');
  await p.click('[data-job="usajobs-stretch"] [data-a="applied-no"]'); await p.waitForTimeout(300);
  ok(JSON.stringify(await p.evaluate(() => JSON.parse(localStorage.getItem('reston-map-apply-pending')))) === JSON.stringify(['usajobs-long']), 'Not yet removes only that id');
  ok(await p.evaluate(() => window.__FAKE_STORE.docs['jobs/usajobs-stretch'].status) === 'new', 'Not yet leaves status alone');
  ok(p.errs.length === 0, 'loop: no console errors ' + p.errs.slice(0, 2));
  // ---- final review fixes ----
  ok((await p.evaluate(() => document.querySelector('[data-job="usajobs-stretch"] .jfacts').textContent)).includes('clearance preferred'), 'preferred clearance shown as preferred');
  await p.evaluate(() => app.jobs.setStatus('usajobs-long', 'applied')); await p.waitForTimeout(200);
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(200);
  ok(JSON.stringify(await p.evaluate(() => JSON.parse(localStorage.getItem('reston-map-apply-pending')))) === '[]', 'pending drops a job marked applied elsewhere');
  await p.evaluate(() => { localStorage.setItem('reston-map-apply-pending', JSON.stringify(['usajobs-stretch'])); window.__renders = 0; const o = app.refresh; app.refresh = (...a) => { window.__renders++; return o.apply(app, a); }; });
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await p.waitForTimeout(100); }
  ok(await p.evaluate(() => window.__renders) <= 1, 'returning to the tab re-asks only once for the same pending jobs: ' + await p.evaluate(() => window.__renders));
  await b.close(); console.log(res.join('\n')); process.exit(res.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
