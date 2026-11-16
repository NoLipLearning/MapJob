// Tracker test: node tests/tracker.js [url]. Local path (real UI + localStorage) and cloud path (in-memory fake claude.use mimicking db.d.ts).
// The fake is NOT the real platform: real cloud behavior is unverified until the page is published.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
async function stubCdn(ctx) { await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') })); }
const url = process.argv[2] || 'http://localhost:8765/reston-hiring-map.html';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];

// Fake claude: shared store across pages via window.__FAKE (set per test). Shapes follow db.d.ts (collection/doc/onSnapshot/docChanges).
const FAKE = `(() => {
  const store = window.__FAKE_STORE = window.__FAKE_STORE || { docs: {}, subs: [], writes: [] };
  const params = window.__FAKE_OPTS || {};
  const parent = p => p.slice(0, p.lastIndexOf('/'));
  const snapDoc = (path, d) => ({ id: path.split('/').pop(), exists: true, data: () => JSON.parse(JSON.stringify(d)), metadata: { fromCache: false, hasPendingWrites: false } });
  const notify = (changes) => store.subs.forEach(s => { const ch = changes.filter(c => parent(c.path) === s.path); if (ch.length) s.next({ docs: [], size: 0, empty: false, metadata: {}, docChanges: () => ch.map(c => ({ type: c.type, doc: snapDoc(c.path, c.data || {}), oldIndex: -1, newIndex: -1 })) }); });
  const col = path => ({ path, doc: id => ({ id, path: path + '/' + id,
      set: async d => { const p = path + '/' + id; const had = p in store.docs; store.docs[p] = JSON.parse(JSON.stringify(d)); store.writes.push(['set', p]); setTimeout(() => notify([{ type: had ? 'modified' : 'added', path: p, data: d }]), 0); },
      delete: async () => { const p = path + '/' + id; if (p in store.docs) { const d = store.docs[p]; delete store.docs[p]; store.writes.push(['delete', p]); setTimeout(() => notify([{ type: 'removed', path: p, data: d }]), 0); } },
      get: async () => ({ id, exists: path + '/' + id in store.docs, data: () => store.docs[path + '/' + id] }) }),
    onSnapshot(next) { const s = { path, next }; store.subs.push(s); const ch = Object.keys(store.docs).filter(k => parent(k) === path).map(k => ({ type: 'added', path: k, data: store.docs[k] }));
      setTimeout(() => next({ docs: [], size: ch.length, empty: !ch.length, metadata: {}, docChanges: () => ch.map(c => ({ type: 'added', doc: snapDoc(c.path, c.data), oldIndex: -1, newIndex: -1 })) }), params.delay || 0); return () => { store.subs = store.subs.filter(x => x !== s); }; } });
  const caps = { db: { collection: col, doc: () => { throw new Error('unused'); } }, user: { id: async () => params.uid || 'u1', isOwner: async () => true },
    downloads: { save: async r => { (window.__saved = window.__saved || []).push({ filename: r.filename, data: r.data }); return { status: 'saved' }; } } };
  window.claude = { use: async n => { if (params.hang) return new Promise(() => {}); return params.noDb && n === 'db' ? null : (caps[n] || null); } };
})();`;

(async () => {
  const browser = await chromium.launch({ args: ARGS }); const fails = [], notes = [];
  const ok = (c, m) => { (c ? notes : fails).push((c ? 'PASS ' : 'FAIL ') + m); };
  async function open(ctxOpts, init, opts = {}) {
    const ctx = opts.ctx || await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 }, acceptDownloads: true }, ctxOpts)); await stubCdn(ctx);
    const page = await ctx.newPage(); const errs = []; page.errs = errs;
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|favicon|net::ERR/.test(m.text())) errs.push('console: ' + m.text()); });
    if (init) await page.addInitScript(init);
    await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(1800); return { ctx, page };
  }

  // ===== LOCAL PATH =====
  let { ctx, page } = await open({});
  const first = await page.evaluate(() => app.E[0].id), second = await page.evaluate(() => app.E[1].id);
  ok(await page.evaluate(() => app.tracker.syncState()) === 'device', 'local: syncState is device');
  ok(await page.evaluate(() => !!document.querySelector('#tab-apps')), 'local: third tab exists');
  await page.click('#tab-apps'); await page.waitForTimeout(300);
  ok(/Nothing tracked yet\./.test(await page.locator('#list').innerText()) && /Star an employer to start/.test(await page.locator('#list').innerText()), 'local: empty state wording');
  ok(/Saved on this device only\. Open the published link to sync/.test(await page.locator('#list').innerText()), 'local: device-only note visible');
  await page.screenshot({ path: 'test-shots/tracker-1-empty.png' });
  await page.click('#tab-emp'); await page.evaluate(id => app.select(id, false), first); await page.waitForTimeout(500);
  ok(await page.locator('#trk-star').count() === 1 && await page.locator('#trk-add').count() === 1, 'local: card has Star + Track this');
  await page.click('#trk-star'); await page.waitForTimeout(300);
  ok(await page.evaluate(id => app.tracker.statusOf(id) === 'star' && app.tracker.isStarred(id), first), 'local: star -> statusOf star');
  await page.click('#trk-add'); await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-shots/tracker-2-sheet.png' });
  ok(await page.evaluate(() => !document.getElementById('trk-role').required), 'local: role is optional');
  await page.fill('#trk-role', 'Research Assistant'); await page.click('#trk-save'); await page.waitForTimeout(400);
  let recs = await page.evaluate(id => app.tracker.byEmp(id), first);
  ok(recs.length === 1 && recs[0].status === 'interested' && /^\d{4}-\d\d-\d\d$/.test(recs[0].dates.interested) && recs[0].appId, 'local: created record, interested date stamped');
  const appId = recs[0].appId;
  // a second application at the same employer
  await page.click('#trk-add'); await page.fill('#trk-role', 'Policy Intern'); await page.click('#trk-save'); await page.waitForTimeout(300);
  ok(await page.evaluate(id => app.tracker.byEmp(id).length, first) === 2, 'local: one employer, several applications');
  // board
  await page.click('#tab-apps'); await page.waitForTimeout(400);
  const txt = await page.locator('#list').innerText();
  ok(/Research Assistant/.test(txt) && /Policy Intern/.test(txt) && /Interested/.test(txt), 'local: board shows rows + status words');
  ok(await page.locator('#list .trk-row').first().locator('button').count() <= 3, 'local: max 3 actions per row');
  await page.screenshot({ path: 'test-shots/tracker-3-board.png' });
  // advance twice -> applied with date
  await page.locator(`#list [data-adv="${appId}"]`).click(); await page.waitForTimeout(300);
  await page.locator(`#list [data-adv="${appId}"]`).click(); await page.waitForTimeout(300);
  let r = await page.evaluate(id => app.tracker.get(id), appId);
  ok(r.status === 'applied' && r.dates.applied && r.dates.lastContact, 'local: Mark Applied stamps applied + lastContact');
  ok(!/Submitted|overdue/i.test(await page.locator('#list').innerText()), 'local: no "Submitted"/"overdue" wording');
  // undo the last change
  await page.click('#toast-undo'); await page.waitForTimeout(300);
  ok(await page.evaluate(id => app.tracker.get(id).status, appId) === 'applying', 'local: undo restores previous status');
  // close via sheet, then undo
  await page.locator(`#list [data-edit="${appId}"]`).click(); await page.waitForTimeout(200);
  await page.selectOption('#trk-status', 'closed'); await page.selectOption('#trk-reason', 'not-a-fit'); await page.click('#trk-save'); await page.waitForTimeout(300);
  r = await page.evaluate(id => app.tracker.get(id), appId);
  ok(r.status === 'closed' && r.closedReason === 'not-a-fit', 'local: close with reason');
  ok(await page.locator('#toast.on #toast-undo').count() === 1, 'local: closing shows undo toast');
  await page.click('#toast-undo'); await page.waitForTimeout(300);
  ok(await page.evaluate(id => app.tracker.get(id).status, appId) === 'applying', 'local: undo of close');
  // delete + undo
  await page.locator(`#list [data-edit="${appId}"]`).click(); await page.click('#trk-del'); await page.waitForTimeout(300);
  ok(await page.evaluate(id => app.tracker.get(id), appId) === null, 'local: delete removes');
  await page.click('#toast-undo'); await page.waitForTimeout(300);
  ok(await page.evaluate(id => !!app.tracker.get(id), appId), 'local: undo of delete');
  // markers
  const third = await page.evaluate(() => app.E[2].id);
  const mk = await page.evaluate(([a, b]) => { app.tracker.star(b, true); const s = ['star', 'interested', 'applying', 'applied', 'interviewing', 'offer', 'closed'], out = {};
    const t = app.tracker.upsert({ empId: a, role: 'x' }); s.slice(1).forEach(st => { app.tracker.update(t.appId, { status: st }); out[st] = app.hooks.markers[0](app.E.find(e => e.id === a)); }); out.star = app.hooks.markers[0](app.E.find(e => e.id === b)); app.tracker.remove(t.appId); return out; }, [third, second]);
  const gl = Object.values(mk).map(m => m && m.glyph); ok(gl.every(Boolean) && new Set(gl).size === 7 && Object.values(mk).every(m => /\S/.test(m.color)), 'marker hook: 7 distinct glyphs + colors ' + gl.join(' '));
  ok(await page.evaluate(() => app.hooks.markers[0]({ id: 'zzz-none' })) === null, 'marker hook: null when untracked');
  // reload persistence
  await page.evaluate(() => app.tracker.update(app.tracker.all()[0].appId, { notes: 'persist me' }));
  const before = await page.evaluate(() => JSON.stringify(app.tracker.all().map(r => r.appId).sort()));
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1800);
  ok(await page.evaluate(() => JSON.stringify(app.tracker.all().map(r => r.appId).sort())) === before && await page.evaluate(id => app.tracker.isStarred(id), second), 'local: persists across reload');
  // events
  ok(await page.evaluate(() => { let n = 0; app.on('tracker-changed', () => n++); app.tracker.star('x1', true); app.tracker.star('x1', false); return n === 2; }), 'tracker-changed emitted on each change');
  // export
  const json = JSON.parse(await page.evaluate(() => app.tracker.exportJSON())), csv = await page.evaluate(() => app.tracker.exportCSV());
  ok(json.version === 1 && json.apps.length === await page.evaluate(() => app.tracker.all().length) && json.apps[0].appId, 'export: JSON valid');
  const lines = csv.trim().split('\r\n'); ok(lines[0].split(',')[0] === 'employer' && lines.length === json.apps.length + 1, 'export: CSV header + one row per app');
  await page.click('#tab-apps'); await page.waitForTimeout(300);
  const [d1] = await Promise.all([page.waitForEvent('download'), page.click('#trk-dl')]); ok(/\.json$/.test(d1.suggestedFilename()), 'export: Download backup triggers a file locally (' + d1.suggestedFilename() + ')');
  // restore merge
  const ex = JSON.parse(json && await page.evaluate(() => app.tracker.exportJSON())); const target = ex.apps[0];
  const old = Object.assign({}, target, { role: 'OLD ROLE', updatedAt: '2000-01-01T00:00:00.000Z' }), newer = Object.assign({}, target, { role: 'NEWER ROLE', updatedAt: '2999-01-01T00:00:00.000Z' }), fresh = Object.assign({}, target, { appId: 'fresh-1', role: 'Fresh', updatedAt: '2025-01-01T00:00:00.000Z' });
  let res = await page.evaluate(b => app.tracker.importJSON(b), JSON.stringify({ apps: [old, fresh] }));
  ok(res.added === 1 && res.updated === 0 && await page.evaluate(id => app.tracker.get(id).role, target.appId) === target.role, 'restore: older ignored, new added');
  res = await page.evaluate(b => app.tracker.importJSON(b), JSON.stringify({ apps: [newer] }));
  ok(res.updated === 1 && await page.evaluate(id => app.tracker.get(id).role, target.appId) === 'NEWER ROLE', 'restore: newer updatedAt wins');
  fs.writeFileSync('/tmp/_trk_restore.json', JSON.stringify({ apps: [Object.assign({}, target, { appId: 'file-1', role: 'From file', updatedAt: '2026-01-01T00:00:00.000Z' })] }));
  await page.setInputFiles('#trk-file', '/tmp/_trk_restore.json'); await page.waitForTimeout(500);
  ok(await page.evaluate(() => !!app.tracker.get('file-1')), 'restore: UI file input imports');
  let bad = false; try { await page.evaluate(() => app.tracker.importJSON('not json')); } catch (e) { bad = true; } ok(bad, 'restore: bad file rejected cleanly');
  // card for tracked employer + phone-less screenshots
  await page.click('#tab-emp'); await page.evaluate(id => app.select(id, false), first); await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-shots/tracker-4-card.png' });
  await page.click('#tab-apps'); await page.waitForTimeout(500); await page.screenshot({ path: 'test-shots/tracker-5-board-desktop.png' });
  ok(page.errs.length === 0, 'local: no console errors ' + page.errs.slice(0, 3).join(' | ')); await ctx.close();

  // phone screenshots
  ({ ctx, page } = await open({ viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }, `localStorage.setItem('reston-map-tracker', ${JSON.stringify(JSON.stringify({ v: 1, apps: [], stars: {}, pend: {} }))})`));
  const ids = await page.evaluate(() => app.E.slice(0, 4).map(e => e.id));
  await page.evaluate(ids => { const t = app.tracker; t.upsert({ empId: ids[0], role: 'Research Assistant, Foreign Policy', status: 'applied', nextAction: { text: 'Email recruiter to follow up', due: '2020-01-01' } }); t.upsert({ empId: ids[1], role: 'Policy Intern', status: 'interviewing' }); t.upsert({ empId: ids[2], role: 'Fellow', status: 'interested' }); t.star(ids[3], true); }, ids);
  await page.click('#tab-apps'); await page.waitForTimeout(500); await page.screenshot({ path: 'test-shots/tracker-6-board-phone.png' });
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'phone: no horizontal scroll on board');
  await page.click('#tab-emp'); await page.evaluate(id => app.select(id, false), ids[0]); await page.waitForTimeout(600); await page.locator('#trk-add').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-shots/tracker-7-card-phone.png' });
  await page.click('#trk-add'); await page.waitForTimeout(400); await page.screenshot({ path: 'test-shots/tracker-8-sheet-phone.png' });
  const h = await page.evaluate(() => Array.from(document.querySelectorAll('.sheet button,.sheet input,.sheet select')).filter(n => n.offsetParent && n.getBoundingClientRect().height < 40 && n.type !== 'checkbox').length);
  ok(h === 0, 'phone: sheet controls >= 40px tall (' + h + ' short)');
  ok(page.errs.length === 0, 'phone: no console errors ' + page.errs.join('|')); await ctx.close();

  // ===== CLOUD PATH (fake) =====
  ({ ctx, page } = await open({}, FAKE));
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => app.tracker.syncState()) === 'cloud', 'cloud(fake): syncState cloud');
  await page.evaluate(() => app.select(app.E[0].id, false)); await page.click('#tab-apps'); await page.waitForTimeout(300);
  ok(!/Saved on this device only/.test(await page.locator('#list').innerText()), 'cloud(fake): device note hidden');
  await page.evaluate(async () => { const t = app.tracker, id = app.E[0].id; window.__r = t.upsert({ empId: id, role: 'Cloud role' }); t.star(app.E[1].id, true); }); await page.waitForTimeout(500);
  let st = await page.evaluate(() => ({ keys: Object.keys(window.__FAKE_STORE.docs), writes: window.__FAKE_STORE.writes.length }));
  ok(st.keys.some(k => k === 'data/users/u1/apps/mine/' + 0 || /^data\/users\/u1\/apps\/mine\/.+/.test(k)) && st.keys.some(k => /^data\/users\/u1\/stars\/mine\/.+/.test(k)), 'cloud(fake): docs written under private data/users/<id>/ ' + st.keys.length);
  const w0 = st.writes; await page.evaluate(() => app.tracker.update(window.__r.appId, { notes: 'a' })); await page.waitForTimeout(400);
  const w1 = await page.evaluate(() => window.__FAKE_STORE.writes.length); ok(w1 === w0 + 1, 'cloud(fake): one write per change (' + w0 + '->' + w1 + ')');
  await page.waitForTimeout(500); ok(await page.evaluate(() => window.__FAKE_STORE.writes.length) === w1, 'cloud(fake): no echo/extra writes when idle');
  // second device sync: same store, new page
  const store = await page.evaluate(() => window.__FAKE_STORE);
  const p2 = await open({}, `window.__FAKE_STORE=${JSON.stringify({ docs: store.docs, subs: [], writes: [] })};` + FAKE);
  ok(await p2.page.evaluate(() => app.tracker.all().length === 1 && app.tracker.all()[0].role === 'Cloud role' && app.tracker.isStarred(app.E[1].id)), 'cloud(fake): second device loads cloud data');
  await p2.ctx.close();
  // onSnapshot live update + remote removal
  await page.evaluate(() => { const S = window.__FAKE_STORE, p = Object.keys(S.docs).find(k => /apps\/mine\//.test(k)), d = Object.assign({}, S.docs[p], { role: 'Edited elsewhere', updatedAt: '2999-01-01T00:00:00.000Z' }); S.docs[p] = d; S.subs.filter(s => p.startsWith(s.path + '/')).forEach(s => s.next({ docChanges: () => [{ type: 'modified', doc: { id: p.split('/').pop(), data: () => d } }] })); });
  await page.waitForTimeout(300); ok(await page.evaluate(() => app.tracker.all()[0].role) === 'Edited elsewhere', 'cloud(fake): onSnapshot update applied');
  await page.evaluate(() => app.tracker.remove(app.tracker.all()[0].appId)); await page.waitForTimeout(400);
  ok(await page.evaluate(() => !Object.keys(window.__FAKE_STORE.docs).some(k => /apps\/mine\//.test(k))), 'cloud(fake): delete removes cloud doc');
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('reston-map-tracker')).apps.length) === 0, 'cloud(fake): local mirror kept in step');
  // downloads capability
  await page.evaluate(() => app.tracker.upsert({ empId: app.E[0].id, role: 'D' })); await page.click('#tab-emp'); await page.click('#tab-apps'); await page.waitForTimeout(300);
  await page.click('#trk-dl'); await page.waitForTimeout(500); const saved = await page.evaluate(() => (window.__saved || []).map(s => s.filename));
  ok(saved.length === 2 && /json$/.test(saved[0]) && /csv$/.test(saved[1]), 'cloud(fake): downloads.save used for JSON + CSV');
  ok(page.errs.length === 0, 'cloud(fake): no console errors ' + page.errs.join('|')); await ctx.close();

  // cloud: db null -> device; hang -> timeout -> device, then quiet retry succeeds
  ({ ctx, page } = await open({}, `window.__FAKE_OPTS={noDb:true};` + FAKE));
  ok(await page.evaluate(() => app.tracker.syncState()) === 'device', 'cloud(fake): db null falls back to device');
  await ctx.close();
  ({ ctx, page } = await open({}, `window.RESTON_TRACKER_TIMING={timeout:400,retry:700};window.__FAKE_OPTS={delay:1000};` + FAKE));
  ok(await page.evaluate(() => app.tracker.syncState()) === 'device', 'cloud(fake): slow load times out to local copy');
  await page.evaluate(() => app.tracker.upsert({ empId: app.E[0].id, role: 'Offline made' }));
  await page.waitForTimeout(3000);
  ok(await page.evaluate(() => app.tracker.all().length) === 1, 'cloud(fake): local data kept through timeout');
  await ctx.close();

  await browser.close();
  console.log(notes.concat(fails).join('\n')); process.exit(fails.length ? 1 : 0);
})();
