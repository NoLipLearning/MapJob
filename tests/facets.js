// Facet counts, sorting, Openings facets, week counter: node tests/facets.js [url]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
const url = process.argv[2] || 'http://localhost:8765/reston-hiring-map.html';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);

// ---------- openings fixture (dates are relative to the day the test runs) ----------
const pad = n => String(n).padStart(2, '0');
const iso = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const mk = (id, o) => Object.assign({ id, title: 'Job ' + id, employer: 'Fixture Co ' + id, empId: null, loc: { text: 'Somewhere, VA' }, url: 'https://example.com/' + id, source: 'indeed', clearance: 'none', entry: 'yes', fit: 50, fitWhy: [], summary: 's', status: 'new', firstSeen: iso(-1), lastSeen: iso(0), verified: true }, o);
const at = (lat, lon) => ({ text: 'Somewhere, VA', lat, lon });
const JOBS = [
  mk('a1', { source: 'indeed', clearance: 'none', entry: 'yes', posted: iso(-2), pay: '$50k', deadline: iso(10), fit: 90, loc: at(38.96, -77.35), checked: iso(0) }),
  mk('a2', { source: 'indeed', clearance: 'unknown', entry: 'maybe', posted: iso(-20), fit: 70, loc: at(38.90, -77.04) }),
  mk('a3', { source: 'linkedin', clearance: 'sponsor', entry: 'yes', posted: iso(-5), pay: '$55k', deadline: iso(3), fit: 85, loc: at(38.97, -77.39) }),
  mk('a4', { source: 'linkedin', clearance: 'required', entry: 'no', posted: iso(-3), fit: 95, loc: at(39.10, -76.74) }),
  mk('a5', { source: 'handshake', clearance: 'none', entry: 'yes', posted: iso(-40), deadline: iso(30), fit: 60, loc: at(38.93, -77.30) }),
  mk('a6', { source: 'usajobs', clearance: 'sponsor', entry: 'unknown', posted: iso(-1), pay: '$60-70k', deadline: iso(5), fit: 75, loc: at(38.90, -77.04), checked: iso(-1) }),
  mk('a7', { source: 'greenhouse', clearance: 'none', entry: 'maybe', posted: iso(-8), fit: 55, loc: at(38.92, -77.23) }),
  mk('a8', { source: 'lever', clearance: 'unknown', entry: 'yes', posted: iso(-28), fit: 65, loc: at(38.95, -77.45) }),
  mk('a9', { source: 'careers', clearance: 'none', entry: 'no', posted: iso(-60), deadline: iso(1), fit: 50, loc: { text: 'No coordinates' } }),
  mk('a10', { source: 'web', clearance: 'unknown', entry: 'unknown', posted: iso(-4), fit: 45, loc: at(38.88, -77.10) }),
  mk('a11', { source: 'saved-linkedin', status: 'saved', clearance: 'unknown', entry: 'unknown', fit: null, firstSeen: iso(0), loc: { text: '' } }),
  mk('a12', { source: 'indeed', clearance: 'required', entry: 'yes', posted: iso(-6), pay: '$70k', fit: 30, loc: at(38.99, -77.40) }),
  mk('a13', { source: 'usajobs', clearance: 'required', entry: 'no', posted: iso(-12), deadline: iso(2), fit: 20, loc: at(38.89, -77.03) }),
  mk('a14', { source: 'indeed', clearance: 'none', entry: 'yes', posted: iso(-15), fit: 88, loc: at(38.94, -77.33), checked: iso(-2) })
];
// annual minimum pay as the pipeline would set it; one job under $50k so every pay band is exercised
JOBS.forEach(j => { const m = /\$(\d+)k/.exec(j.pay || ""); if (m) j.payMin = +m[1] * 1000; });
JOBS[1].pay = "$40k"; JOBS[1].payMin = 40000;
const SRC_OF = j => /^saved-/.test(j.source) ? ['saved'] : j.source === 'web' ? ['careers'] : [j.source].concat(j.status === 'saved' ? ['saved'] : []);
const age = j => { const a = new Date(String(j.posted || j.firstSeen) + 'T00:00:00'), t = new Date(iso(0) + 'T00:00:00'); return Math.round((t - a) / 864e5); };
// independent model of the Openings filters: f = {src, cl, en, posted, pay}
const DEF = () => ({ src: ['indeed', 'linkedin', 'handshake', 'usajobs', 'greenhouse', 'lever', 'careers', 'saved'], cl: ['none', 'sponsor', 'unknown'], en: ['yes', 'maybe', 'unknown', 'no'], posted: 'any', pb: ['50', 'unk'] });
const PAYK = j => j.payMin == null ? 'unk' : j.payMin >= 50000 ? '50' : 'low';
const pass = (j, f) => SRC_OF(j).some(s => f.src.includes(s)) && f.cl.includes(j.clearance) && f.en.includes(j.entry) && (f.posted === 'any' || age(j) <= +f.posted) && f.pb.includes(PAYK(j));
const ids = f => JOBS.filter(j => pass(j, f)).map(j => j.id);
const HOME = [38.93472, -77.32540];
const mi = (a, b, c, d) => { const R = 3958.8, r = Math.PI / 180, dl = (c - a) * r, dn = (d - b) * r; const h = Math.sin(dl / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const byFit = (a, b) => (b.fit == null ? -1 : b.fit) - (a.fit == null ? -1 : a.fit) || String(b.posted || b.firstSeen).localeCompare(String(a.posted || a.firstSeen));
const dist = j => j.loc && typeof j.loc.lat === 'number' ? mi(HOME[0], HOME[1], j.loc.lat, j.loc.lon) : Infinity;
const SORTS = {
  fit: byFit,
  new: (a, b) => String(b.posted || b.firstSeen).localeCompare(String(a.posted || a.firstSeen)) || byFit(a, b),
  close: (a, b) => a.deadline && b.deadline ? a.deadline.localeCompare(b.deadline) : a.deadline ? -1 : b.deadline ? 1 : byFit(a, b),
  near: (a, b) => dist(a) === dist(b) ? byFit(a, b) : dist(a) - dist(b)
};
// the list shows "Saved by you" first, then the rest, each in the chosen order
const order = (f, k) => { const L = JOBS.filter(j => pass(j, f)).sort(SORTS[k]); return L.filter(j => j.status === 'saved').concat(L.filter(j => j.status !== 'saved')).map(j => j.id); };

(async () => {
  const b = await chromium.launch({ args: ARGS });
  async function ctxFor(vp) {
    const ctx = await b.newContext({ viewport: vp, hasTouch: vp.width < 500, isMobile: vp.width < 500 });
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') }));
    await ctx.addInitScript(`localStorage.setItem('reston-map-jobs', ${JSON.stringify(JSON.stringify({ jobs: JOBS, meta: { lastRun: '2026-11-10' } }))});`);
    return ctx;
  }
  async function open(ctx) {
    const page = await ctx.newPage(); page.errs = [];
    page.on('pageerror', e => page.errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|favicon|net::ERR/.test(m.text())) page.errs.push(m.text()); });
    await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(2000);
    return page;
  }
  const ctx = await ctxFor({ width: 1280, height: 800 });
  let page = await open(ctx);

  // =================== 1. Matches: facet counts ===================
  await page.locator('#filters .fdesk').click();
  const cn = (sel) => page.locator('#filters ' + sel + ' .cn').first().textContent().then(t => +t);
  // independent model, computed in the page from the raw employer list
  const model = (extra) => page.evaluate(ex => {
    const cl = ex.cl || ['none', 'some'], maxMin = ex.max || 90;
    const base = e => cl.includes(e.cl) && (maxMin >= 90 || app.commuteMi(e) * 2.4 <= maxMin) && (!ex.metro || e.metro) && (!ex.q || ex.q(e));
    const types = {}, areas = {}, cls = {};
    app.E.forEach(e => { if (base(e)) types[e.type] = (types[e.type] || 0) + 1; });
    app.E.forEach(e => { if (cl.includes(e.cl) && (maxMin >= 90 || app.commuteMi(e) * 2.4 <= maxMin) && (!ex.metro || e.metro)) areas[e.reg] = (areas[e.reg] || 0) + 1; });
    return { types, areas, total: app.E.filter(base).length };
  }, extra);
  async function typeCountsMatch(label, ex) {
    const m = await model(ex); let bad = [];
    const types = await page.evaluate(() => Object.keys(TYPE_LABEL));
    for (const t of types) { const got = await cn(`.chip[data-g=type][data-v="${t}"]`); if (got !== (m.types[t] || 0)) bad.push(`${t}: shows ${got}, expected ${m.types[t] || 0}`); }
    ok(bad.length === 0, `${label}: every Employer type chip shows its own count ${bad.join('; ')}`);
    return m;
  }
  const tt = await page.evaluate(() => app.E.filter(e => e.type === 'think-tank' && ['none', 'some'].includes(e.cl)).length);
  ok(tt > 0 && await cn('.chip[data-g=type][data-v=think-tank]') === tt, `default: "Think tank" chip shows ${tt}`);
  const t0 = await typeCountsMatch('default filters', {});
  const labelText = await page.locator('#filters .chip[data-g=type][data-v=think-tank]').textContent();
  ok(/Think tank\s+\d+/.test(labelText), `chip reads like "${labelText.trim()}"`);
  // area counts use the other filters too (not the Area group itself)
  { let bad = 0; for (const [a, n] of Object.entries(t0.areas)) { const got = await cn(`.chip[data-g=area][data-v="${a}"]`); if (got !== n) bad++; } ok(bad === 0, 'default: Area chips show their counts'); }
  // turning Clearance "Mostly cleared" on raises counts; the Clearance chips themselves keep showing "this option alone"
  await page.locator('#filters .chip[data-g=cl][data-v=most]').click(); await page.waitForTimeout(150);
  await typeCountsMatch('after adding Mostly cleared', { cl: ['none', 'some', 'most'] });
  const clMost = await cn('.chip[data-g=cl][data-v=most]'), clMostExp = await page.evaluate(() => app.E.filter(e => e.cl === 'most').length);
  ok(clMost === clMostExp, `Clearance "Mostly cleared" chip counts that option alone (${clMost})`);
  // add Metro on top: counts shrink further
  await page.locator('#filters .chip[data-t=metro]').click(); await page.waitForTimeout(150);
  const m2 = await typeCountsMatch('Mostly cleared + Metro', { cl: ['none', 'some', 'most'], metro: true });
  ok(m2.total === await page.evaluate(() => app.ranked.length), 'combined filters: total equals the list length');
  ok(m2.total < await page.evaluate(() => app.E.length), `combined filters narrow the list (${m2.total})`);
  // a chip with 0 results is dimmed but still toggleable
  const zero = await page.evaluate(() => [...document.querySelectorAll('#filters .chip[data-g=type]')].find(c => c.querySelector('.cn').textContent === '0'));
  const zeroSel = await page.evaluate(() => { const c = [...document.querySelectorAll('#filters .chip[data-g=type]')].find(c => c.querySelector('.cn').textContent === '0'); return c ? c.dataset.v : null; });
  if (zeroSel) {
    const chip = page.locator(`#filters .chip[data-g=type][data-v="${zeroSel}"]`);
    ok(await chip.evaluate(c => c.classList.contains('zero') && !c.disabled && +getComputedStyle(c).opacity < 0.9), `zero-result chip "${zeroSel}" is dimmed but not disabled`);
    const was = await chip.getAttribute('aria-pressed'); await chip.click(); await page.waitForTimeout(100);
    ok(await chip.getAttribute('aria-pressed') !== was, 'zero-result chip still toggles');
    await chip.click();
  } else ok(false, 'found a zero-result chip to test (Metro + Mostly cleared should empty some type)');
  await page.evaluate(() => app.filters.reset()); await page.waitForTimeout(150);
  // slider and search feed the counts too
  await page.locator('#f-max').fill('30'); await page.waitForTimeout(150);
  await typeCountsMatch('drive time up to 30 min (est.)', { max: 30 });
  ok(/est\./.test(await page.locator('#filters .fslide label').textContent()), 'drive time is labelled est.');
  await page.evaluate(() => app.filters.reset()); await page.waitForTimeout(100);
  await page.fill('#q', 'zzzzqqqq'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => [...document.querySelectorAll('#filters .chip .cn')].every(c => c.textContent === '0')), 'search with no hits: every chip shows 0');
  await page.fill('#q', 'institute'); await page.waitForTimeout(200);
  { const exp = await page.evaluate(() => app.E.filter(e => ['none', 'some'].includes(e.cl) && app.queryMatch(e)).length), n = await page.evaluate(() => app.ranked.length);
    ok(exp === n && exp > 0, `search "institute" narrows the list (${n}) and counts follow it`);
    const sum = await page.evaluate(() => [...document.querySelectorAll('#filters .chip[data-g=area] .cn')].reduce((a, c) => a + +c.textContent, 0)); ok(sum === n, `Area counts add up to the searched list (${sum})`); }
  await page.fill('#q', '');
  ok(await page.evaluate(() => app.routes === undefined), 'no route object on app (drive time is the straight-line estimate)');

  // =================== 2. Matches: sorting ===================
  await page.evaluate(() => app.filters.reset()); await page.waitForTimeout(200);
  ok(await page.locator('#sort-emp').count() === 1 && (await page.locator('#sort-emp option').allTextContents()).join() === 'Best match,Closest,Name', 'Matches has a sort control: Best match, Closest, Name');
  const rows = () => page.evaluate(() => [...document.querySelectorAll('#list .item')].map(i => ({ n: i.querySelector('.t').textContent, num: i.querySelector('.num').textContent, id: i.dataset.id })));
  const info = id => page.evaluate(id => { const e = app.E.find(x => x.id === id); return { score: e.score, mi: app.commuteMi(e), name: e.name }; }, id);
  let R = await rows(), S = await Promise.all(R.map(r => info(r.id)));
  ok(S.every((s, i) => i === 0 || s.score <= S[i - 1].score), 'Best match: scores never increase down the list');
  await page.selectOption('#sort-emp', 'near'); await page.waitForTimeout(200);
  R = await rows(); S = await Promise.all(R.map(r => info(r.id)));
  ok(R.length > 5 && S.every((s, i) => i === 0 || s.mi >= S[i - 1].mi - 1e-9), 'Closest: distance never decreases down the list');
  ok(R.map(r => r.num).join() === R.map((_, i) => i + 1).join(), 'map numbers follow the list order (1, 2, 3 ...)');
  await page.locator('#sort-emp').focus(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250);
  R = await rows();
  ok(await page.locator('#sort-emp').inputValue() === 'name' && R.every((r, i) => i === 0 || R[i - 1].n.localeCompare(r.n) <= 0), 'Name (picked with the keyboard): alphabetical');
  ok(await page.evaluate(() => document.activeElement.id) === 'sort-emp', 'sort select keeps keyboard focus after it re-sorts');
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1800);
  ok(await page.locator('#sort-emp').inputValue() === 'name' && (await rows()).every((r, i, a) => i === 0 || a[i - 1].n.localeCompare(r.n) <= 0), 'Matches sort choice is remembered after reload');
  await page.selectOption('#sort-emp', 'best'); await page.waitForTimeout(200);

  // =================== 3. Openings facets ===================
  await page.click('#tab-jobs'); await page.waitForTimeout(400);
  const shown = () => page.evaluate(() => [...document.querySelectorAll('#list .jobrow')].map(r => r.dataset.job));
  const jcn = k => page.locator(`#list [data-fk="${k}"] .cn`).textContent().then(t => +t);
  const chipOn = k => page.locator(`#list [data-fk="${k}"]`).getAttribute('aria-pressed').then(v => v === 'true');
  let f = DEF();
  ok(!(await shown()).includes('a4') && !(await shown()).includes('a12') && !(await shown()).includes('a13'), 'Needs clearance jobs are hidden by default');
  ok(JSON.stringify((await shown()).slice().sort()) === JSON.stringify(ids(f).slice().sort()), `default list is every job except Needs clearance (${(await shown()).length})`);
  ok(!(await chipOn('cl:required')) && await chipOn('cl:none') && await chipOn('cl:sponsor') && await chipOn('cl:unknown'), 'Clearance chips: Needs clearance off, the other three on');
  ok(await jcn('cl:required') === 3, 'Needs clearance chip still counts its 3 jobs while off');
  const labels = g => page.locator(`#list [data-fg=${g}] .cl`).allTextContents();
  ok((await labels('src')).join() === 'Indeed,LinkedIn,Handshake,USAJOBS,Greenhouse,Lever,Careers,Saved', 'Source facet options');
  ok((await labels('cl')).join() === 'No clearance,Can be sponsored,Not stated,Needs clearance', 'Clearance facet options');
  ok((await labels('en')).join() === 'Entry level,Some experience,Not stated,Experienced', 'Entry facet options');
  ok((await labels('posted')).join() === 'Any,7 days,30 days' && (await labels('pb')).join() === '$50k+,Under $50k,Not listed', 'Posted and Pay facet options');
  async function countsMatch(label, f) {
    const bad = [];
    const groups = { src: DEF().src, cl: DEF().cl.concat('required'), en: DEF().en, posted: ['any', '7', '30'] };
    for (const g of Object.keys(groups)) for (const v of groups[g]) { const exp = JOBS.filter(j => pass(j, Object.assign({}, f, { [g]: g === 'posted' ? v : [v] }))).length, got = await jcn(g + ':' + v); if (got !== exp) bad.push(`${g}:${v} shows ${got}, expected ${exp}`); }
    for (const b of ['50', 'low', 'unk']) { const e = JOBS.filter(j => pass(j, Object.assign({}, f, { pb: [b] }))).length; if (await jcn('pb:' + b) !== e) bad.push('pay ' + b); }
    ok(bad.length === 0, `${label}: every Openings chip count matches ${bad.join('; ')}`);
  }
  await countsMatch('default', f);
  const sumTxt = await page.locator('#list .jfs').textContent(); ok(sumTxt.trim() === `${ids(f).length} of ${JOBS.length} shown`, `summary reads "${sumTxt.trim()}"`);
  const clickChip = async (k) => { await page.locator(`#list [data-fk="${k}"]`).click(); await page.waitForTimeout(150); };
  const check = async (label) => { const got = (await shown()).slice().sort().join(), exp = ids(f).slice().sort().join(); ok(got === exp, `${label}: list is ${exp.split(',').length} jobs ${got === exp ? '' : '(got ' + got + ' expected ' + exp + ')'}`); await countsMatch(label, f); };
  // Source
  await clickChip('src:indeed'); f.src = f.src.filter(s => s !== 'indeed'); await check('Source: Indeed off');
  await clickChip('src:saved'); f.src = f.src.filter(s => s !== 'saved'); await check('Source: Saved off');
  await clickChip('src:careers'); f.src = f.src.filter(s => s !== 'careers'); ok(!(await shown()).includes('a10') && !(await shown()).includes('a9'), 'Source: "web" jobs count under Careers'); await check('Source: Careers off');
  await page.evaluate(() => app.jobs.facets.reset()); await page.waitForTimeout(200); f = DEF();
  // Clearance
  await clickChip('cl:required'); f.cl.push('required'); await check('Clearance: Needs clearance on');
  ok((await shown()).includes('a4'), 'Needs clearance job appears once turned on');
  await clickChip('cl:none'); f.cl = f.cl.filter(c => c !== 'none'); await check('Clearance: No clearance off');
  await clickChip('cl:sponsor'); f.cl = f.cl.filter(c => c !== 'sponsor'); await check('Clearance: Can be sponsored off');
  await page.evaluate(() => app.jobs.facets.reset()); await page.waitForTimeout(200); f = DEF();
  // Entry
  await clickChip('en:no'); f.en = f.en.filter(c => c !== 'no'); await check('Entry: Experienced off');
  await clickChip('en:maybe'); f.en = f.en.filter(c => c !== 'maybe'); await check('Entry: Some experience off');
  await clickChip('en:unknown'); f.en = f.en.filter(c => c !== 'unknown'); await check('Entry: Not stated off');
  await page.evaluate(() => app.jobs.facets.reset()); await page.waitForTimeout(200); f = DEF();
  // Posted, Pay
  await clickChip('posted:7'); f.posted = '7'; await check('Posted: 7 days');
  await clickChip('posted:30'); f.posted = '30'; await check('Posted: 30 days');
  ok(!(await shown()).includes('a5') && (await shown()).includes('a14'), 'Posted 30 days: 40-day-old job gone, 15-day-old job stays');
  await clickChip('posted:any'); f.posted = 'any'; await check('Posted: Any');
  await clickChip('pb:low'); f.pb = ['50', 'unk', 'low']; await check('Under $50k turned on');
  ok((await shown()).some(id => PAYK(JOBS.find(j => j.id === id)) === 'low'), 'Under $50k jobs appear once turned on');
  // combination
  await clickChip('src:usajobs'); f.src = f.src.filter(s => s !== 'usajobs'); await clickChip('posted:30'); f.posted = '30'; await check('combined: Pay + no USAJOBS + 30 days');
  // everything off -> calm empty state with a way out
  await page.evaluate(() => app.jobs.facets.reset()); await page.waitForTimeout(150);
  for (const k of ['cl:none', 'cl:sponsor', 'cl:unknown']) await clickChip(k);
  ok(await page.locator('#list .kit-empty', { hasText: 'No openings match these filters' }).count() === 1, 'no match: calm message');
  await page.locator('#jf-reset2').click(); await page.waitForTimeout(200);
  ok((await shown()).length === ids(DEF()).length, 'Reset filters brings the default list back');
  ok(await page.locator('#jf-reset').isDisabled(), 'Reset filters is disabled when nothing is changed');
  // keyboard focus survives a facet change
  await page.locator('#list [data-fk="src:lever"]').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.activeElement && document.activeElement.dataset.fk) === 'src:lever', 'facet chip keeps keyboard focus after it re-renders');
  await page.evaluate(() => app.jobs.facets.reset()); await page.waitForTimeout(200);
  // persistence
  await clickChip('cl:required'); await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1800); await page.click('#tab-jobs'); await page.waitForTimeout(300);
  ok(await chipOn('cl:required'), 'Openings facet choice is remembered after reload');
  await page.evaluate(() => app.jobs.facets.reset());

  // ---- row details: Checked date and deadline ----
  await page.waitForTimeout(200);
  const row = id => page.locator(`#list [data-job="${id}"]`).textContent();
  const dfmt = s => { const [y, m, d] = s.split('-').map(Number); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] + ' ' + d + ', ' + y; };
  const r1 = await row('a1');
  ok(r1.includes('Checked ' + dfmt(iso(0))) && r1.includes('Closes ' + dfmt(iso(10))), 'row shows "Checked <date>" and the deadline');
  const r8 = await row('a8'); ok(!/Checked|Closes/.test(r8), 'row without checked or deadline shows neither');
  ok((await row('a14')).includes('Checked') && !(await row('a14')).includes('Closes'), 'checked without a deadline shows only Checked');
  ok(await page.evaluate(() => [...document.querySelectorAll('#list .jobrow')].every(r => r.querySelectorAll('button').length <= 3)), 'at most 3 actions per row');

  // =================== 4. Openings: sorting ===================
  ok((await page.locator('#sort-jobs option').allTextContents()).join() === 'Best fit,Newest,Closing soon,Closest', 'Openings has a sort control');
  for (const k of ['fit', 'new', 'close', 'near']) {
    await page.selectOption('#sort-jobs', k); await page.waitForTimeout(250);
    const got = (await shown()).join(), exp = order(DEF(), k).join();
    ok(got === exp, `Openings sort "${k}": ${got === exp ? exp : 'got ' + got + ' expected ' + exp}`);
  }
  await page.selectOption('#sort-jobs', 'close'); await page.waitForTimeout(250);
  { const L = (await shown()).filter(id => JOBS.find(j => j.id === id).status !== 'saved'), dl = L.map(id => JOBS.find(j => j.id === id).deadline || '');
    const firstNone = dl.findIndex(d => !d);
    ok(dl.filter(Boolean).length >= 3 && firstNone > 0 && dl.slice(firstNone).every(d => !d) && dl.slice(0, firstNone).every((d, i, a) => i === 0 || a[i - 1] <= d), 'Closing soon: deadlines ascending, jobs without a deadline last'); }
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1800); await page.click('#tab-jobs'); await page.waitForTimeout(300);
  ok(await page.locator('#sort-jobs').inputValue() === 'close', 'Openings sort choice is remembered after reload');
  await page.selectOption('#sort-jobs', 'fit');
  ok(await page.evaluate(() => document.getElementById('cnt-jobs').textContent) === String(ids(DEF()).length), 'Openings tab count follows the facets');

  // =================== 5. Applications header ===================
  await page.evaluate(([t, w, ww]) => {
    const a = app.E[0].id, b = app.E[1].id, c = app.E[2].id, d = app.E[3].id, e = app.E[4].id;
    app.tracker.upsert({ empId: a, role: 'r1', status: 'applied', dates: { applied: t } });
    app.tracker.upsert({ empId: b, role: 'r2', status: 'applied', dates: { applied: t } });
    app.tracker.upsert({ empId: c, role: 'r3', status: 'applied', dates: { applied: w } });
    app.tracker.upsert({ empId: d, role: 'r4', status: 'applied', dates: { applied: ww } });
    app.tracker.upsert({ empId: e, role: 'r5', status: 'interested' });
  }, [iso(0), iso(-7), iso(-14)]);
  await page.click('#tab-apps'); await page.waitForTimeout(400);
  const hd = (await page.locator('#trk-weeks').textContent()).trim();
  ok(hd === 'Applied this week: 2 · last week: 1', `Applications header: "${hd}"`);
  ok(await page.locator('#trk-weeks').evaluate(n => n.tagName === 'P' && n.querySelectorAll('*').length === 0), 'header is plain text (no badge)');
  await page.screenshot({ path: 'test-shots/facets-apps-1280.png' });
  ok(page.errs.length === 0, 'desktop: no console errors ' + page.errs.join(' | '));

  // screenshots for review
  await page.click('#tab-jobs'); await page.waitForTimeout(300); await page.screenshot({ path: 'test-shots/facets-openings-1280.png' });
  await page.click('#tab-emp'); await page.waitForTimeout(300); await page.locator('#filters .fdesk').click().catch(() => {}); await page.screenshot({ path: 'test-shots/facets-matches-1280.png' });
  await page.close(); await ctx.close();

  // =================== phone ===================
  const pctx = await ctxFor({ width: 400, height: 800 });
  page = await open(pctx);
  await page.click('#tab-jobs'); await page.waitForTimeout(500);
  await page.evaluate(() => app.sheet('full')); await page.waitForTimeout(500);
  ok(await page.evaluate(() => !document.querySelector('#list .jfacets').open), 'phone: Openings facets start folded away');
  await page.screenshot({ path: 'test-shots/facets-openings-400-folded.png' });
  await page.locator('#list .jfacets summary').click(); await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-shots/facets-openings-400.png' });
  const small = await page.evaluate(() => [...document.querySelectorAll('#list .jfacets .chip, #list .sortbar select, #list .jfacets summary')].filter(c => c.offsetParent && c.getBoundingClientRect().height < 43).length);
  ok(small === 0, `phone: facet chips, summary and sort select are at least 44px tall (${small} smaller)`);
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!over, 'phone: no horizontal page scroll');
  await page.click('#tab-emp'); await page.waitForTimeout(300);
  await page.locator('#filters .fopen').click(); await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-shots/facets-filters-400.png' });
  const small2 = await page.evaluate(() => [...document.querySelectorAll('#fsheet-body .chip')].filter(c => c.offsetParent && c.getBoundingClientRect().height < 43).length);
  ok(small2 === 0, 'phone: filter sheet chips are 44px tall');
  ok(page.errs.length === 0, 'phone: no console errors ' + page.errs.join(' | '));
  await b.close();
  console.log(res.join('\n')); console.log(res.some(r => r.startsWith('FAIL')) ? 'RESULT: FAIL' : 'RESULT: PASS');
  process.exit(res.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
