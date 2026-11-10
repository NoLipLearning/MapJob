// Start applying from an opening (spec 6): node tests/applyflow.js [url]
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const { FAKE } = require('./fake-claude.js');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
const url = process.argv[2] || 'http://localhost:8765/reston-hiring-map.html';
const JOBS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'jobs.json')));
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
const PROFILE = { v: 1, updatedAt: '2026-11-09T12:00:00.000Z', profile: { name: 'Test Person', synopsis_60_words: 'Fake test profile.', keywords_for_job_matching: ['policy'], target_roles_implied: ['program assistant'] } };
const init = `window.__FAKE_OPTS = {}; window.__FAKE_STORE = window.__FAKE_STORE || { docs: ${JSON.stringify(Object.fromEntries(JOBS.map(j => ['jobs/' + j.id, j])))}, subs: [], writes: [] };
  try { if (!localStorage.getItem('reston-map-profile')) localStorage.setItem('reston-map-profile', ${JSON.stringify(JSON.stringify(PROFILE))}); } catch (e) {}
  window.__copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copied.push(t); } }, configurable: true });`;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') }));
  await ctx.addInitScript(init); await ctx.addInitScript(FAKE);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR|favicon/.test(m.text())) errs.push(m.text()); });
  await p.goto(url); await p.waitForTimeout(2800);
  await p.evaluate(() => app.jobs.open('indeed-a1')); await p.waitForTimeout(300);
  ok(await p.locator('#job-sheet #job-apply').count() === 1, 'job sheet has Start applying');
  await p.click('#job-apply'); await p.waitForTimeout(500);
  const rec = await p.evaluate(() => app.tracker.all().find(r => r.jobId === 'indeed-a1'));
  ok(rec && rec.status === 'applying' && rec.empId === 'brookings' && rec.role === 'Program Assistant' && rec.postingUrl.startsWith('https://'), 'tracker record created from the job');
  ok(await p.evaluate(() => (document.querySelector('#apl-post') || {}).value === 'Support the policy team.'), 'helper opens with the posting filled in');
  await p.click('#apl-copy'); await p.waitForTimeout(300);
  const copied = await p.evaluate(() => window.__copied.join('\n'));
  ok(copied.includes('Program Assistant') && copied.includes('Test Person') && copied.includes('Brookings'), 'copied prompt has job, profile and employer');
  ok(!/__[A-Z_]+__/.test(copied), 'no unreplaced placeholders in the prompt');
  await p.click('#apl-applied'); await p.waitForTimeout(600);
  ok(await p.evaluate(() => app.tracker.all().find(r => r.jobId === 'indeed-a1').status) === 'applied', 'Mark as applied updates the record');
  ok(await p.evaluate(() => app.jobs.get('indeed-a1').status) === 'applied' && await p.evaluate(() => window.__FAKE_STORE.docs['jobs/indeed-a1'].status) === 'applied', 'and marks the job applied, in the cloud too');
  ok(await p.evaluate(() => app.apply.startFromJob('indeed-a1') === app.tracker.all().find(r => r.jobId === 'indeed-a1').appId && app.tracker.all().filter(r => r.jobId === 'indeed-a1').length === 1), 'starting again reuses the same record');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  // job whose employer is not on the map
  await p.evaluate(() => app.apply.startFromJob('linkedin-3')); await p.waitForTimeout(500);
  const r2 = await p.evaluate(() => app.tracker.all().find(r => r.jobId === 'linkedin-3'));
  ok(r2 && r2.empId === 'job:linkedin-3', 'off-map job: record uses job:<id>');
  ok(await p.evaluate(() => document.body.textContent.includes('Sample Policy Group')), 'off-map job: helper shows the employer name');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.evaluate(() => document.getElementById('tab-apps') && document.getElementById('tab-apps').click()); await p.waitForTimeout(400);
  ok(await p.evaluate(() => document.getElementById('list').textContent.includes('Sample Policy Group')), 'off-map job: Applications tab shows the employer name');
  await p.evaluate(() => app.profile.open()); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.body.textContent.includes('Last updated 2026-11-09')), 'profile shows Last updated');
  ok(errs.length === 0, 'no console errors ' + errs.slice(0, 2));
  await b.close(); console.log(res.join('\n')); process.exit(res.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
