// Reminders test: node tests/reminders.js [url]. Uses a controllable clock (window.__NOW = "YYYY-MM-DD", local noon) by overriding Date.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
async function stubCdn(ctx) { await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitC/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') })); }
const url = process.argv[2] || 'http://localhost:8775/reston-hiring-map.html';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const CLOCK = `(() => { window.__NOW = '2026-11-09'; const R = Date; class F extends R { constructor(...a) { if (a.length) super(...a); else super(window.__NOW + 'T12:00:00'); } static now() { return new R(window.__NOW + 'T12:00:00').getTime(); } } window.Date = F; window.RESTON_REMINDERS_TIMING = { undoMs: 1200 }; })();`;

(async () => {
  const browser = await chromium.launch({ args: ARGS }); const fails = [], notes = [];
  const ok = (c, m) => { (c ? notes : fails).push((c ? 'PASS ' : 'FAIL ') + m); };
  async function open(vp) {
    const ctx = await browser.newContext({ viewport: vp || { width: 1280, height: 800 }, acceptDownloads: true }); await stubCdn(ctx);
    const page = await ctx.newPage(); page.errs = [];
    page.on('pageerror', e => page.errs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|favicon|net::ERR/.test(m.text())) page.errs.push('console: ' + m.text()); });
    await page.addInitScript(CLOCK); await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(1800); return { ctx, page };
  }
  const clock = (page, d) => page.evaluate(x => { window.__NOW = x; app.reminders.sync(); app.reminders.render(); }, d);
  const rec = (page, id) => page.evaluate(i => app.tracker.get(i), id);
  const mk = (page, r) => page.evaluate(r => { const x = app.tracker.upsert(r); return x.appId; }, r);
  const todayText = page => page.locator('#today').innerText();

  // ===== business-day math =====
  let { ctx, page } = await open();
  const bd = (a, n) => page.evaluate(([a, n]) => app.reminders.addBD(a, n), [a, n]);
  ok(await bd('2026-11-06', 1) === '2026-11-09', 'bd: Friday + 1 = Monday');
  ok(await bd('2026-11-07', 1) === '2026-11-09', 'bd: Saturday + 1 = Monday');
  ok(await bd('2026-11-09', 7) === '2026-11-18', 'bd: Monday + 7 = next Wednesday');
  ok(await bd('2026-11-04', 10) === '2026-11-18', 'bd: Wed + 10 = two weeks later');
  ok(await bd('2026-11-10', 1) === '2026-11-11', 'bd: holidays off by default');
  const emps = await page.evaluate(() => app.E.slice(0, 8).map(e => e.id));
  ok(await page.locator('#today').count() === 1 && await page.evaluate(() => document.getElementById('today').nextElementSibling.id === 'tabs'), 'panel mounted right above #tabs');
  ok(/All caught up for today/.test(await todayText(page)), 'empty state wording');
  // holidays on via settings UI
  await page.click('#rem-sum'); await page.click('.rem-set summary'); await page.check('#rs-hol'); await page.click('#rs-save');
  ok(await bd('2026-11-10', 1) === '2026-11-12', 'bd: Veterans Day skipped when enabled');
  await page.click('#rs-reset'); ok(await bd('2026-11-10', 1) === '2026-11-11', 'bd: defaults restore');

  // ===== applied -> follow-up chain, Done + undo, snooze =====
  let a1 = await mk(page, { empId: emps[0], role: 'Analyst', status: 'applied', dates: { applied: '2026-10-26' } });
  await page.waitForTimeout(200);
  let r = await rec(page, a1);
  ok(r.nextAction.text === 'Follow up by email' && r.nextAction.due === '2026-11-04', 'applied: follow-up due 7 business days after applying');
  let events = 0; await page.evaluate(() => { window.__ev = 0; app.on('tracker-changed', () => window.__ev++); });
  for (let i = 0; i < 5; i++) await page.evaluate(() => { app.reminders.sync(); app.reminders.render(); });
  ok(await page.evaluate(() => window.__ev) === 0, 'no loop: repeated sync causes 0 tracker writes');
  const t1 = await todayText(page);
  ok(/Follow up by email/.test(t1) && /Ready when you are/.test(t1) && !/overdue/i.test(t1), 'due item shown with calm wording');
  ok(await page.locator('#today details.rem[open]').count() === 1, 'panel open by default when something is due');
  ok(await page.locator('#today .rem-item').first().locator('.rem-acts button').count() === 3, 'item has exactly three buttons');
  await page.screenshot({ path: 'test-shots/reminders-1-desktop.png' });
  await page.evaluate(i => app.tracker.update(i, { dates: { lastContact: '2026-10-26' } }), a1);
  await page.click('#today [data-act="done"]'); await page.waitForTimeout(150);
  r = await rec(page, a1);
  ok(r.nextAction.doneAt && r.dates.lastContact === '2026-11-09', 'Done ticks and stamps lastContact');
  ok(await page.locator('#toast-undo').count() === 1 && /All caught up for today/.test(await todayText(page)), 'Done: undo toast shown, item gone');
  await page.click('#toast-undo'); await page.waitForTimeout(150);
  r = await rec(page, a1);
  ok(!r.nextAction.doneAt && r.nextAction.text === 'Follow up by email' && r.dates.lastContact === '2026-10-26', 'Undo restores item and lastContact');
  await page.waitForTimeout(1500);
  r = await rec(page, a1); ok(r.nextAction.text === 'Follow up by email' && !r.nextAction.doneAt, 'Undo cancels the pending chain');
  await page.click('#today [data-snz]'); await page.click('#today [data-act="snooze2"]'); await page.waitForTimeout(150);
  r = await rec(page, a1); ok(r.nextAction.due === '2026-11-11' && /All caught up/.test(await todayText(page)), 'Snooze 2 days moves due and hides item');
  await page.click('#toast-undo'); await page.waitForTimeout(100);
  ok((await rec(page, a1)).nextAction.due === '2026-11-04', 'Undo snooze restores due');
  await page.click('#today [data-act="done"]'); await page.waitForTimeout(1900);
  r = await rec(page, a1);
  ok(r.nextAction.text === 'Second follow-up, or move on' && r.nextAction.due === '2026-11-23', 'after Done: second follow-up due 10 business days later (fires once)');
  await page.evaluate(() => { window.__ev = 0; app.reminders.sync(); app.reminders.sync(); });
  ok(await page.evaluate(() => window.__ev) === 0, 'no second write after chaining');
  await clock(page, '2026-11-23');
  ok(await page.locator('#today [data-act="done"]').innerText() === 'Sent it', 'second follow-up shows "Sent it"');
  await page.click('#today [data-snz]');
  ok(await page.locator('#today [data-act="close"]').innerText() === 'Close as no response', 'snooze menu offers "Close as no response"');
  await page.click('#today [data-act="snooze7"]'); await page.waitForTimeout(100);
  ok((await rec(page, a1)).nextAction.due === '2026-11-30', 'Snooze 1 week');
  await clock(page, '2026-11-30'); await page.click('#today [data-snz]'); await page.click('#today [data-act="close"]'); await page.waitForTimeout(150);
  r = await rec(page, a1); ok(r.status === 'closed' && r.closedReason === 'no-response', 'Close as no response closes the record');
  ok(await page.evaluate(() => app.reminders.items().length) === 0, 'closed record has no open actions');
  ok(page.errs.length === 0, 'no console errors (chain) ' + page.errs.join('|'));
  await ctx.close();

  // ===== interview thank-you + check-in, stale interest, Not now =====
  ({ ctx, page } = await open());
  const e2 = await page.evaluate(() => app.E.slice(0, 8).map(e => e.id));
  let b1 = await mk(page, { empId: e2[1], role: 'Intern', status: 'applied', dates: { applied: '2026-10-20', interview: ['2026-11-06'] } });
  await page.waitForTimeout(150); r = await rec(page, b1);
  ok(r.nextAction.text === 'Send thank-you note' && r.nextAction.due === '2026-11-09', 'interview: thank-you due next business day');
  await page.click('#today [data-act="done"]'); await page.waitForTimeout(1900); r = await rec(page, b1);
  ok(r.nextAction.text === 'Check in if no word' && r.nextAction.due === '2026-11-17' && r.dates.lastContact === '2026-11-09', 'interview: check-in 7 business days after interview');
  let n = 0; await page.evaluate(() => { window.__ev = 0; app.reminders.sync(); app.reminders.sync(); }); n = await page.evaluate(() => window.__ev); ok(n === 0, 'interview rules do not refire');
  let c1 = await mk(page, { empId: e2[2], role: 'Fellow', status: 'interested', dates: { interested: '2026-10-20' } });
  await page.waitForTimeout(150); r = await rec(page, c1);
  ok(r.nextAction.text === 'Apply or let it go?' && /Start applying/.test(await todayText(page)), 'stale interest: "Apply or let it go?" with Start applying');
  await page.click('#today [data-app="' + c1 + '"] [data-snz]'); await page.click('#today [data-act="notnow"]'); await page.waitForTimeout(150);
  r = await rec(page, c1); ok(r.nextAction.text === '' && r.status === 'interested', 'Not now clears the item');
  await page.evaluate(() => { app.reminders.sync(); app.reminders.sync(); });
  ok((await rec(page, c1)).nextAction.text === '', 'Not now hides it (no refire same day)');
  await clock(page, '2026-12-05'); ok((await rec(page, c1)).nextAction.text === '', 'still hidden at 26 days');
  await clock(page, '2026-12-10'); r = await rec(page, c1); ok(r.nextAction.text === 'Apply or let it go?', 'returns after 30 days');
  await page.click('#today [data-app="' + c1 + '"] [data-act="start"]'); await page.waitForTimeout(150);
  ok((await rec(page, c1)).status === 'applying', 'Start applying sets status');
  ok(page.errs.length === 0, 'no console errors (interview) ' + page.errs.join('|'));
  await ctx.close();

  // ===== max 3, week view, ics, mobile =====
  ({ ctx, page } = await open());
  const e3 = await page.evaluate(() => app.E.slice(0, 8).map(e => e.id));
  for (let i = 0; i < 5; i++) await mk(page, { empId: e3[i], role: 'Role ' + i, status: 'applying', nextAction: { text: 'Email contact ' + i, due: '2026-11-0' + (i + 1) } });
  await mk(page, { empId: e3[5], role: 'Later', status: 'applying', nextAction: { text: 'Send writing sample', due: '2026-11-12' } });
  await page.waitForTimeout(200);
  ok(await page.locator('#today .rem-item').count() === 3, 'at most 3 items shown');
  const txt = await page.locator('#today .rem-item b').allInnerTexts();
  ok(txt.join() === 'Email contact 0,Email contact 1,Email contact 2', 'earliest due first');
  ok(!/overdue/i.test(await todayText(page)) && !/\d+ (items|tasks|due|more)/i.test(await todayText(page)), 'no overdue word or counters');
  await page.click('#today [data-open]'); await page.waitForTimeout(500);
  ok(await page.evaluate(() => !!app.selected && app.selected.id) === e3[0], 'Open selects the employer');
  await page.click('#rem-week'); await page.waitForTimeout(100);
  const wk = await todayText(page); ok(/Thu, Nov 12/i.test(wk) && /Send writing sample/.test(wk) && /Ready when you are/i.test(wk), 'This week groups by day');
  await page.click('#rem-week');
  const ics = await page.evaluate(() => app.reminders.buildICS());
  ok(/^BEGIN:VCALENDAR\r\n/.test(ics) && /END:VCALENDAR\r\n$/.test(ics) && /VERSION:2\.0/.test(ics), 'ics: calendar wrapper');
  ok((ics.match(/BEGIN:VEVENT/g) || []).length === 6 && (ics.match(/END:VEVENT/g) || []).length === 6, 'ics: one VEVENT per open action');
  ok(/DTSTART;VALUE=DATE:20261112/.test(ics) && /SUMMARY:Send writing sample - /.test(ics) && /URL:http/.test(ics), 'ics: all-day event, title, link');
  ok(ics.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75), 'ics: lines folded <= 75 octets');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rem-ics')]);
  const body = fs.readFileSync(await dl.path(), 'utf8');
  ok(dl.suggestedFilename() === 'reston-follow-ups.ics' && /BEGIN:VCALENDAR/.test(body), 'calendar button downloads .ics');
  await page.screenshot({ path: 'test-shots/reminders-2-three.png' });
  ok(page.errs.length === 0, 'no console errors (list) ' + page.errs.join('|'));
  await ctx.close();

  ({ ctx, page } = await open({ width: 400, height: 800 }));
  const e4 = await page.evaluate(() => app.E.slice(0, 3).map(e => e.id));
  await mk(page, { empId: e4[0], role: 'Analyst', status: 'applied', dates: { applied: '2026-10-26' } });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-shots/reminders-3-mobile.png' });
  await page.click('#today [data-snz]'); await page.screenshot({ path: 'test-shots/reminders-4-mobile-snooze.png' });
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile: no horizontal scroll');
  ok(page.errs.length === 0, 'no console errors (mobile) ' + page.errs.join('|'));
  await ctx.close();

  await browser.close();
  console.log(notes.concat(fails).join('\n')); console.log(fails.length ? 'RESULT: FAIL (' + fails.length + ')' : 'RESULT: PASS');
  process.exit(fails.length ? 1 : 0);
})();
