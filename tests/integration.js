// Cross-part check: node tests/integration.js [url]. One flow through tracker + routes + apply helper + reminders + filters.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
const url = process.argv[2] || 'http://localhost:8765/reston-hiring-map.html';
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  for (const [name, vp, touch] of [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 400, height: 800 }, true]]) {
    const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') }));
    const p = await ctx.newPage(); const errs = []; let refreshes = 0;
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR|favicon/.test(m.text())) errs.push(m.text()); });
    await p.goto(url); await p.waitForTimeout(2500);
    await p.evaluate(() => { window.__ref = 0; app.on('refreshed', () => window.__ref++); });
    const id = await p.evaluate(() => app.ranked[0].id);
    await p.evaluate(id => app.select(id, true), id); await p.waitForTimeout(800);
    const card = await p.evaluate(() => document.getElementById('card').innerText);
    ok(/Commute/.test(card) && / mi/.test(card), `${name}: card shows straight-line commute`);
    ok(/Track this|Star/i.test(card), `${name}: card has tracker controls`);
    ok(/Apply helper|Start applying/i.test(card), `${name}: card has apply helper entry`);
    await p.evaluate(async id => { await app.tracker.ready; const t = new Date().toISOString().slice(0, 10); app.tracker.upsert({ empId: id, role: 'Test Analyst', status: 'applied', dates: { applied: t }, nextAction: { text: 'Follow up by email', due: t, doneAt: null } }); }, id);
    await p.waitForTimeout(1200);
    const today = await p.evaluate(() => { const t = document.getElementById('today'); return t ? t.innerText : null; });
    ok(today && /Follow up by email/.test(today), `${name}: Today panel shows the due follow-up`);
    const labs = await p.evaluate(() => [...document.querySelectorAll('#today button')].map(b => b.innerText.trim()));
    ok(['Done', 'Snooze', 'Open'].every(l => labs.filter(x => x === l).length === 1), `${name}: item has exactly Done / Snooze / Open (${labs.join(', ')})`);
    ok(!/overdue/i.test(today || ''), `${name}: no "overdue" wording`);
    const refs = await p.evaluate(() => window.__ref); await p.waitForTimeout(1500); const refs2 = await p.evaluate(() => window.__ref);
    ok(refs2 - refs <= 1, `${name}: no refresh loop (${refs} -> ${refs2})`);
    const tabText = await p.evaluate(() => document.getElementById('tab-mine') ? document.getElementById('tab-mine').innerText : [...document.querySelectorAll('#tabs [role=tab]')].map(x => x.innerText).join('|'));
    ok(/application/i.test(tabText), `${name}: My applications tab present`);
    ok(await p.evaluate(() => app.tracker.statusOf(app.ranked[0] ? app.ranked[0].id : '') !== undefined), `${name}: statusOf works`);
    await p.screenshot({ path: `test-shots/integration-${name}.png` });
    ok(errs.length === 0, `${name}: no console errors ${errs.slice(0, 3).join(' | ')}`);
    await ctx.close();
  }
  await b.close(); console.log(res.join('\n')); process.exit(res.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
