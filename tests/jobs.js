// Openings (70-jobs) test: node tests/jobs.js [url]
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const { FAKE } = require('./fake-claude.js');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
const url = process.argv[2] || 'http://localhost:8765/reston-hiring-map.html';
const JOBS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'jobs.json')));
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
const seed = (opts) => `window.__FAKE_OPTS = ${JSON.stringify(opts || {})}; window.__FAKE_STORE = { docs: Object.assign({ "meta/refresh": { lastRun: "2026-11-10" } }, ${JSON.stringify(Object.fromEntries(JOBS.map(j => ['jobs/' + j.id, j])))}), subs: [], writes: [] };`;
async function open(b, vp, init) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: vp.width < 500, isMobile: vp.width < 500 });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') }));
  if (init) { await ctx.addInitScript(init); await ctx.addInitScript(FAKE); }
  const p = await ctx.newPage(); p.errs = []; p.reqs = [];
  p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR|favicon/.test(m.text())) p.errs.push(m.text()); });
  p.on('request', r => p.reqs.push(r.url()));
  await p.goto(url); await p.waitForTimeout(2500); return p;
}
const tab = p => p.evaluate(() => { document.getElementById('tab-jobs').click(); });
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  let p = await open(b, { width: 1280, height: 800 }, seed());
  ok(await p.evaluate(() => app.jobs.syncState()) === 'cloud', 'cloud: syncState is cloud');
  ok(await p.locator('#tab-jobs').count() === 1, 'Openings tab exists');
  await tab(p); await p.waitForTimeout(400);
  const order = await p.evaluate(() => [...document.querySelectorAll('#list .jobrow')].map(r => r.dataset.job));
  ok(JSON.stringify(order) === JSON.stringify(['indeed-a1', 'indeed-a2', 'linkedin-3', 'web-xss', 'indeed-4']), 'rows sorted by fit, dismissed hidden: ' + order.join(','));
  ok(await p.evaluate(() => document.querySelector('[data-job="indeed-a2"]').textContent.includes('Clearance not stated')), 'unknown clearance shows "Clearance not stated"');
  ok(await p.evaluate(() => document.querySelectorAll('#list img').length === 0 && !window.__pwned && document.querySelector('[data-job="web-xss"]') !== null), 'escapes posting text');
  ok(await p.evaluate(() => document.querySelectorAll('#list .jobrow')[0].querySelectorAll('button').length <= 3), 'at most 3 actions per row');
  ok(await p.evaluate(() => document.querySelector('[data-job="indeed-a1"] .jnew') !== null), 'unseen job shows New');
  // Open sheet: link safety and summary as text
  await p.click('[data-job="web-xss"] [data-a="open"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !document.querySelector('#job-sheet a[href^="javascript"]') && document.querySelector('#job-sheet .jsum').textContent.includes('<img')), 'job sheet: no javascript: link, summary shown as text');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok(await p.locator('#job-sheet').count() === 0, 'Esc closes job sheet');
  // dismiss + undo
  await p.click('[data-job="linkedin-3"] [data-a="dismiss"]'); await p.waitForTimeout(300);
  ok(await p.locator('[data-job="linkedin-3"]').count() === 0, 'Not for me removes the row');
  await p.click('#toast-undo'); await p.waitForTimeout(300);
  ok(await p.locator('[data-job="linkedin-3"]').count() === 1 && await p.evaluate(() => app.jobs.get('linkedin-3').status) === 'new', 'Undo restores it');
  await p.click('[data-job="linkedin-3"] [data-a="dismiss"]'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => window.__FAKE_STORE.docs['jobs/linkedin-3'].status) === 'dismissed', 'dismiss is written to the cloud');
  // save
  await p.click('[data-job="indeed-a2"] [data-a="save"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelector('#list .jsec') && document.querySelector('#list .jsec').textContent === 'Saved by you' && document.querySelector('#list .jobrow').dataset.job === 'indeed-a2'), 'saved job moves under "Saved by you"');
  // markers, card, filter
  ok(await p.evaluate(() => { const e = app.E.find(x => x.id === 'brookings'); return app.hooks.markers.some(fn => { const r = fn(e); return r && r.pos === 'tl' && r.glyph === '2'; }); }), 'employer pin gets a job-count dot (tl)');
  await p.evaluate(() => { document.getElementById('tab-emp').click(); app.select('brookings', true); }); await p.waitForTimeout(600);
  ok(await p.evaluate(() => { const s = document.querySelector('#card .jcard'); return !!s && s.textContent.includes('Open jobs here') && s.textContent.includes('Program Assistant') && !s.textContent.includes('Hidden Job'); }), 'employer card: Open jobs here, dismissed excluded');
  ok(await p.evaluate(() => { app.filters.reset(); document.querySelector('#filters .chip[data-x="openings"]').click(); return app.ranked.length > 0 && app.ranked.every(e => app.jobs.byEmp(e.id).length > 0); }), '"Has openings" filter');
  await p.evaluate(() => app.filters.reset());
  // New clears after leaving the tab
  await tab(p); await p.waitForTimeout(200); await p.evaluate(() => document.getElementById('tab-emp').click()); await tab(p); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelectorAll('#list .jnew').length === 0), 'New clears after leaving and re-entering the tab');
  // Save a job
  await p.click('#job-save'); await p.waitForTimeout(200);
  await p.fill('#js-url', 'http://example.org/job'); await p.click('#js-go'); await p.waitForTimeout(150);
  ok(await p.locator('#jobsave-sheet').count() === 1 && /https/.test(await p.textContent('#js-err')), 'Save a job rejects http://');
  await p.fill('#js-url', 'javascript:alert(1)'); await p.click('#js-go'); await p.waitForTimeout(150);
  ok(await p.locator('#jobsave-sheet').count() === 1, 'Save a job rejects javascript:');
  await p.fill('#js-url', 'https://www.linkedin.com/jobs/view/123'); await p.click('#js-go'); await p.waitForTimeout(400);
  const sv = await p.evaluate(() => app.jobs.all().find(j => j.url === 'https://www.linkedin.com/jobs/view/123'));
  ok(sv && sv.status === 'saved' && sv.source === 'saved-linkedin' && sv.fit === null && sv.verified === false && /^saved-/.test(sv.id), 'saved job record shape');
  ok(await p.evaluate(id => document.querySelector(`[data-job="${id}"]`).textContent.includes('Details not added yet'), sv.id), 'saved job without text shows "Details not added yet"');
  ok(await p.evaluate(id => !!window.__FAKE_STORE.docs['jobs/' + id], sv.id), 'saved job written to the cloud');
  ok(!p.reqs.some(u => /linkedin\.com|joinhandshake\.com/.test(u)), 'no request to linkedin.com or joinhandshake.com');
  await p.screenshot({ path: 'test-shots/jobs-desktop.png' });
  ok(p.errs.length === 0, 'desktop: no console errors ' + p.errs.slice(0, 2));
  await p.context().close();
  // phone
  p = await open(b, { width: 400, height: 800 }, seed());
  await p.evaluate(() => { app.sheet && app.sheet('half'); document.getElementById('tab-jobs').click(); }); await p.waitForTimeout(500);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'phone: no horizontal scroll');
  await p.screenshot({ path: 'test-shots/jobs-phone.png' });
  ok(p.errs.length === 0, 'phone: no console errors ' + p.errs.slice(0, 2));
  await p.context().close();
  // no db: device fallback + empty state
  p = await open(b, { width: 1280, height: 800 }, null);
  await tab(p); await p.waitForTimeout(300);
  ok(await p.evaluate(() => app.jobs.syncState()) === 'device', 'no db: syncState is device');
  ok(await p.evaluate(() => document.getElementById('list').textContent.includes('sync only on the published page')), 'no db: notice shown');
  ok(await p.evaluate(() => document.getElementById('list').textContent.includes('refresh my map')), 'empty state mentions "refresh my map"');
  ok(p.errs.length === 0, 'no db: no console errors ' + p.errs.slice(0, 2));
  await b.close(); console.log(res.join('\n')); process.exit(res.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
