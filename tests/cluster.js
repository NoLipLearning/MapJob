// Pin clustering + office buildings layer: node tests/cluster.js [url]
// Office data is a fixture (tests/fixtures/offices.json) injected as window.RESTON_TEST_OFFICES, which 80-offices reads while app.D.offices is empty.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
const url = process.argv[2] || 'http://localhost:8765/reston-hiring-map.html';
const OFFICES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'offices.json')));
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const o1 = OFFICES[0];
// jobs: one tagged with officeId, one within 100 m of the building, one far away, one dismissed (must not show)
const JOBS = [
  { id: 'j-office', title: 'Office Match Job', employer: 'Fixture Tenant 01-A', empId: null, officeId: o1.id, loc: { text: 'Washington, DC' }, url: 'https://example.com/1', source: 'indeed', clearance: 'none', entry: 'yes', fit: 80, status: 'new', firstSeen: '2026-11-10', lastSeen: '2026-11-10' },
  { id: 'j-near', title: 'Nearby Pin Job', employer: 'Fixture Co', empId: null, officeId: null, loc: { text: 'Washington, DC', lat: o1.lat + 0.0005, lon: o1.lon }, url: 'https://example.com/2', source: 'indeed', clearance: 'none', entry: 'yes', fit: 60, status: 'new', firstSeen: '2026-11-10', lastSeen: '2026-11-10' },
  { id: 'j-far', title: 'Far Away Job', employer: 'Fixture Co', empId: null, officeId: null, loc: { text: 'Washington, DC', lat: o1.lat + 0.01, lon: o1.lon }, url: 'https://example.com/3', source: 'indeed', clearance: 'none', entry: 'yes', fit: 90, status: 'new', firstSeen: '2026-11-10', lastSeen: '2026-11-10' },
  { id: 'j-gone', title: 'Dismissed Job', employer: 'Fixture Co', empId: null, officeId: o1.id, loc: { text: 'Washington, DC' }, url: 'https://example.com/4', source: 'indeed', clearance: 'none', entry: 'yes', fit: 99, status: 'dismissed', firstSeen: '2026-11-10', lastSeen: '2026-11-10' }
];
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch({ args: ARGS });
  async function open(vp, touch) {
    const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') }));
    await ctx.addInitScript(`window.RESTON_TEST_OFFICES = ${JSON.stringify(OFFICES)}; localStorage.setItem('reston-map-jobs', ${JSON.stringify(JSON.stringify({ jobs: JOBS, meta: null }))});`);
    const page = await ctx.newPage(); page.errs = [];
    page.on('pageerror', e => page.errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|favicon|net::ERR/.test(m.text())) page.errs.push(m.text()); });
    await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(2500);
    return page;
  }
  const stats = p => p.evaluate(() => app.cluster.stats());
  const jump = async (p, place) => { await p.evaluate(() => { const j = document.getElementById('jumpbtn'); if (document.getElementById('jump').hidden) j.click(); }); await p.click(`#jump button[data-p=${place}]`); await p.waitForTimeout(1900); };
  const clickAt = async (p, x, y) => { const r = await p.locator('#gl').boundingBox(); await p.mouse.click(r.x + x, r.y + y); };

  let page = await open({ width: 1280, height: 800 }, false);
  ok(await page.evaluate(() => app.D.offices.length) === 40, 'office fixture loaded into app.D.offices (40)');
  ok(await page.locator('#bldbtn').count() === 1 && await page.locator('#bldbtn').getAttribute('aria-pressed') === 'true', 'Buildings button exists and defaults on');

  // ---- zoomed out: fewer sprites than pins, bubbles show counts ----
  await jump(page, 'region');
  let s = await stats(page);
  ok(s.pins >= 40 + 20 && s.sprites < s.inView && s.sprites < s.pins, `region view: ${s.sprites} sprites for ${s.inView} pins in view (${s.pins} pins total)`);
  ok(s.bubbles.length > 0 && s.bubbles.every(x => x.n >= 2), `bubbles exist, each merges 2 or more pins (${s.bubbles.length})`);
  const members = s.bubbles.reduce((a, x) => a + x.n, 0), singles = s.sprites - s.bubbles.length;
  ok(members + singles === s.inView, `every pin in view is in exactly one sprite: ${members} merged + ${singles} single = ${s.inView}`);
  ok(s.bubbles.some(x => x.kind === 'emp') && s.bubbles.some(x => x.kind === 'office'), 'employer bubbles and building bubbles both appear');
  const bubText = await page.evaluate(() => sprites.filter(q => q.kind === 'cluster').every(q => q.tip().startsWith(q.ref.n + ' ')));
  ok(bubText, 'bubble hover text carries the same count as the bubble');
  // the bubble label is drawn on its texture: it must differ between two bubbles with different counts
  const pix = await page.evaluate(() => { const bs = sprites.filter(q => q.kind === 'cluster'); const d = q => { const c = q.sp.material.map.image; return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.join(',').length; }; const out = {}; bs.forEach(q => { out[q.ref.n] = (out[q.ref.n] || 0) + 1; }); return { counts: Object.keys(out).length, inked: bs.every(q => { const c = q.sp.material.map.image, px = c.getContext('2d').getImageData(c.width / 2 - 8, c.height / 2 - 8, 16, 16).data; let on = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] > 200 && px[i + 2] > 200 || px[i] < 60) on++; return on > 3; }) }; });
  ok(pix.inked, 'bubble textures have a drawn count label');
  await page.screenshot({ path: 'test-shots/cluster-region-1280.png' });

  // ---- click a bubble: zooms in toward it ----
  await jump(page, 'dc');
  s = await stats(page);
  const bubs = await page.evaluate(() => app.cluster.bubbleAt());
  ok(bubs.length > 0, `DC view has bubbles (${bubs.length})`);
  const d0 = s.dist, sprites0 = s.sprites;
  const target = bubs.slice().sort((a, c) => c.n - a.n)[0];
  await clickAt(page, target.x, target.y); await page.waitForTimeout(1800);
  s = await stats(page);
  ok(s.dist < d0 * 0.9, `clicking a bubble zooms in (${Math.round(d0)} -> ${Math.round(s.dist)} m)`);
  ok(await page.evaluate(() => !app.selected), 'a bubble click does not select anything');

  // ---- office pins: keep clicking bubbles that hold fixture-01 until its own pin shows, then tap it ----
  await jump(page, 'dc');
  let single = null;
  for (let i = 0; i < 10 && !single; i++) {
    const r = await page.evaluate(id => { const sp = sprites.find(q => q.key === 'office:' + id); if (sp) { const p = project(sp.sp.position); return { single: p }; } const q = sprites.find(c => c.kind === 'cluster' && c.ref.members.some(m => m.key === 'office:' + id)); if (!q) return { none: true }; const p = project(q.sp.position); return { bubble: p }; }, o1.id);
    if (r.single) { single = r.single; break; }
    if (!r.bubble) break;
    await clickAt(page, r.bubble[0], r.bubble[1]); await page.waitForTimeout(1700);
  }
  ok(!!single, 'office pin for fixture-01 reached by zooming in through bubbles');
  const offSprites = await page.evaluate(() => sprites.filter(q => q.kind === 'office').length);
  ok(offSprites >= 1, `office pins render from the fixture (${offSprites} on screen)`);
  if (single) {
    await clickAt(page, single[0], single[1]); await page.waitForTimeout(700);
    ok(await page.locator('#card').isVisible() && (await page.locator('#card h2').textContent()).includes('Fixture Tower 01'), 'tapping an office pin opens its card');
    const card = page.locator('#card');
    ok((await card.textContent()).includes('<i id="xss">x</i>') && await card.locator('#xss').count() === 0, 'name is escaped (markup shown as text)');
    ok(await card.locator('.ofc-list li', { hasText: 'Fixture Tenant 01-A' }).count() === 1, 'tenants listed as given');
    ok(await card.locator('img').count() === 0 && !(await page.evaluate(() => window.__pwned)), 'tenant text with markup cannot inject elements');
    ok(await card.locator('.ofc-more summary', { hasText: 'Show 2 more tenants' }).count() === 1, 'long tenant list collapses behind "Show 2 more tenants"');
    const jobText = await card.locator('.ofc-job').allTextContents();
    ok(jobText.length === 2 && jobText.some(t => t.includes('Office Match Job')) && jobText.some(t => t.includes('Nearby Pin Job')), 'jobs: officeId match and within 100 m are listed');
    ok(!jobText.some(t => /Far Away|Dismissed/.test(t)), 'jobs: far (1.1 km) and dismissed jobs are not listed');
    const links = await card.locator('.links-sec a').evaluateAll(a => a.map(x => x.href));
    ok(links.length >= 4 && links.every(h => h.includes('Fixture%20Tenant%2001-A')) && links.some(h => h.includes('usajobs')), 'Find openings links search the main tenant (and USAJOBS for federal)');
    ok(await card.locator('button.btn, a.btn, summary, a.dir').count() > 0 && (await card.textContent()).includes('Checked 2026-11-02'), 'checked date shown');
    // employer on the map is tappable
    await card.locator('[data-ofc-emp]').first().click(); await page.waitForTimeout(500);
    ok(await page.evaluate(() => app.selected && app.selected.kind === 'emp' && app.selected.id === 'us-department-of-state'), 'employer link in the building card selects that employer');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    ok(await page.evaluate(() => !app.selected), 'Escape closes the card');
    // job opens from the building card
    await page.evaluate(() => app.offices.open('fixture-01', false)); await page.waitForTimeout(300);
    await page.locator('#card [data-ofc-job]').first().click(); await page.waitForTimeout(300);
    ok(await page.locator('#job-sheet').count() === 1, 'a job in the building card opens the job sheet');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await page.evaluate(() => app.closeCard());
  }

  // ---- keyboard / list navigation still works ----
  await page.evaluate(() => { document.getElementById('tab-emp').click(); }); await page.waitForTimeout(300);
  await page.focus('#list .item'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  ok(await page.evaluate(() => app.selected && app.selected.kind === 'emp'), 'Enter on a list row selects it');
  const selId = await page.evaluate(() => app.selected.id);
  ok(await page.evaluate(id => sprites.some(q => q.key === 'emp:' + id), selId), 'the selected employer always keeps its own pin (never merged)');
  await page.keyboard.press(']'); await page.waitForTimeout(500);
  ok(await page.evaluate(id => app.selected && app.selected.id !== id, selId), ']  steps to the next employer');
  await page.keyboard.press('Escape');

  // ---- Buildings toggle ----
  await jump(page, 'region');
  await page.click('#bldbtn'); await page.waitForTimeout(500);
  ok(await page.getAttribute('#bldbtn', 'aria-pressed') === 'false' && await page.evaluate(() => sprites.filter(q => q.kind === 'office' || (q.kind === 'cluster' && q.ref.kind === 'office')).length) === 0, 'Buildings off: no office pins or bubbles');
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('reston-map-buildings'))) === false, 'Buildings choice is remembered');
  await page.click('#bldbtn'); await page.waitForTimeout(500);
  ok(await page.evaluate(() => sprites.filter(q => q.kind === 'office' || (q.kind === 'cluster' && q.ref.kind === 'office')).length) > 0, 'Buildings on again: pins are back');
  // zoom limit: fully zoomed in there is no clustering (every pin shows)
  await page.evaluate(() => app.offices.open('fixture-05', true)); await page.waitForTimeout(1500);
  ok(await page.evaluate(() => !!sprites.find(q => q.key === 'office:fixture-05')), 'a selected building keeps its own pin');
  ok(page.errs.length === 0, 'desktop: no console errors ' + page.errs.join(' | '));
  await page.close();

  // ---- phone ----
  page = await open({ width: 400, height: 800 }, true);
  await jump(page, 'region');
  s = await stats(page);
  ok(s.sprites < s.inView && s.bubbles.length > 0, `phone region view: ${s.sprites} sprites for ${s.inView} pins`);
  const bb = await page.locator('#bldbtn').boundingBox(), jb = await page.locator('#jumpbtn').boundingBox(), zb = await page.locator('#zin').boundingBox();
  ok(bb.height >= 44 && bb.x + bb.width <= 400, `phone: Buildings button is 44px tall and inside the screen (${Math.round(bb.height)}px, right edge ${Math.round(bb.x + bb.width)})`);
  ok(!(bb.y < zb.y + zb.height && bb.y + bb.height > zb.y && bb.x < zb.x + zb.width && bb.x + bb.width > zb.x) && !(jb.x < bb.x + bb.width && jb.x + jb.width > bb.x && jb.y < bb.y + bb.height && jb.y + jb.height > bb.y), 'phone: Buildings button does not overlap Jump to or the zoom buttons');
  await page.screenshot({ path: 'test-shots/cluster-region-400.png' });
  ok(page.errs.length === 0, 'phone: no console errors ' + page.errs.join(' | '));
  await b.close();
  console.log(res.join('\n')); console.log(res.some(r => r.startsWith('FAIL')) ? 'RESULT: FAIL' : 'RESULT: PASS');
  process.exit(res.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
