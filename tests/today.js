// Today panel with openings (spec 7): node tests/today.js [url]
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const { FAKE } = require('./fake-claude.js');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
const url = process.argv[2] || 'http://localhost:8765/reston-hiring-map.html';
const CLOCK = `(() => { window.__NOW = '2026-11-09'; const R = Date; class F extends R { constructor(...a) { if (a.length) super(...a); else super(window.__NOW + 'T12:00:00'); } static now() { return new R(window.__NOW + 'T12:00:00').getTime(); } } window.Date = F; window.RESTON_REMINDERS_TIMING = { undoMs: 1200 }; })();`;
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
const J = (id, fit, st) => ({ id, title: 'Job ' + id, employer: 'Org ' + id, empId: null, loc: { text: 'Reston, VA' }, url: 'https://example.org/' + id, source: 'indeed', clearance: 'none', entry: 'yes', fit, fitWhy: ['Entry level'], summary: 's', status: st || 'new', firstSeen: '2026-11-09', lastSeen: '2026-11-09', verified: true });
const seed = jobs => `window.__FAKE_OPTS = {}; window.__FAKE_STORE = { docs: ${JSON.stringify(Object.fromEntries(jobs.map(j => ['jobs/' + j.id, j])))}, subs: [], writes: [] };`;
async function open(b, jobs) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') }));
  await ctx.addInitScript(CLOCK); await ctx.addInitScript(seed(jobs)); await ctx.addInitScript(FAKE);
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR|favicon/.test(m.text())) p.errs.push(m.text()); });
  await p.goto(url); await p.waitForTimeout(2800); return p;
}
// follow-up due today, created through the tracker so the reminders part owns it
const followup = (p, n) => p.evaluate(n => { for (let i = 0; i < n; i++) { const e = app.E[i]; const r = app.tracker.upsert({ empId: e.id, role: 'Role ' + i, status: 'applied', dates: { applied: '2026-10-20' } }); app.tracker.update(r.appId, { nextAction: { text: 'Follow up by email', due: '2026-11-0' + (i + 1), doneAt: null } }); } app.reminders.sync(); app.reminders.render(); }, n);
const kinds = p => p.evaluate(() => app.reminders.todayItems('2026-11-09').map(i => i.kind + (i.j ? ':' + i.j.fit : '')));
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  let p = await open(b, [J('a', 80), J('b', 70)]);
  await followup(p, 4); await p.waitForTimeout(300);
  let k = await kinds(p);
  ok(k.length === 3 && k.every(x => x === 'followup'), '4 due follow-ups: only 3 items, all follow-ups (' + k + ')');
  ok(await p.evaluate(() => document.querySelectorAll('#today .rem-list > li').length) === 3, 'panel shows 3 items');
  await p.context().close();
  p = await open(b, [J('a', 80), J('b', 70), J('c', 59)]);
  await followup(p, 1);
  await p.evaluate(() => { app.tracker.upsert({ empId: app.E[5].id, role: 'In progress role', status: 'applying' }); app.reminders.render(); }); await p.waitForTimeout(300);
  k = await kinds(p);
  ok(JSON.stringify(k) === JSON.stringify(['followup', 'inprogress', 'newjob:80']), 'order: follow-up, in progress, best job (' + k + ')');
  const txt = await p.evaluate(() => document.getElementById('today').textContent);
  ok(txt.includes('Finish applying to') && txt.includes('Look at: Job a at Org a'), 'item wording');
  ok(!/overdue/i.test(txt), 'never says overdue');
  ok(await p.evaluate(() => [...document.querySelectorAll('#today .rem-list > li')].every(li => li.querySelectorAll(':scope > .rem-acts button').length <= 3)), 'at most 3 buttons per item');
  await p.click('#today [data-jdis="a"]'); await p.waitForTimeout(400);
  k = await kinds(p);
  ok(k[2] === 'newjob:70', '"Not for me" on the job brings in the next best (' + k + ')');
  ok(await p.evaluate(() => app.jobs.get('a').status) === 'dismissed', 'that job is dismissed');
  await p.click('#today [data-jsave="b"]'); await p.waitForTimeout(400);
  k = await kinds(p);
  ok(k.length === 2 && !k.some(x => x.startsWith('newjob')), 'a fit-59 job is never suggested (' + k + ')');
  // snooze the in-progress item
  await p.evaluate(() => { const b = document.querySelector('#today [data-snz^="ip:"]'); b.click(); }); await p.waitForTimeout(200);
  await p.evaluate(() => { document.querySelector('#today [data-hide^="ip:"][data-days="2"]').click(); }); await p.waitForTimeout(300);
  k = await kinds(p);
  ok(JSON.stringify(k) === JSON.stringify(['followup']), 'snoozed in-progress item leaves (' + k + ')');
  await p.evaluate(() => { window.__NOW = '2026-11-12'; app.reminders.render(); });
  k = await p.evaluate(() => app.reminders.todayItems('2026-11-12').map(i => i.kind));
  ok(k.includes('inprogress'), 'and comes back after 2 days');
  ok(p.errs.length === 0, 'no console errors ' + p.errs.slice(0, 2));
  await p.context().close();
  p = await open(b, []);
  ok(await p.evaluate(() => app.reminders.todayItems('2026-11-09').length) === 0 && await p.evaluate(() => document.getElementById('today').textContent.includes('All caught up for today')), 'nothing due and no jobs: All caught up');
  await p.context().close();
  await b.close(); console.log(res.join('\n')); process.exit(res.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
