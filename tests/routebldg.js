// Route building click test: node tests/routebldg.js [url]   (serve first: python3 -m http.server 8765)
// Flies to an employer, finds a spot inside a known route building on screen (away from every pin), clicks it and checks the card.
// Cases: a named Fairfax building (Fair Oaks Hospital, county record) and NRA HQ (the county record has no name: the card must say so, not invent one).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
async function stubCdn(ctx) { await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') })); }
const url = process.argv[2] || 'http://localhost:8765/reston-hiring-map.html';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const CASES = [
  { label: 'Fair Oaks Hospital', emp: 'inova-fair-oaks', tile: 'rb--1_1', idx: 15, name: 'FAIR OAKS HOSPITAL', empName: /Inova Fair Oaks Hospital/, shot: null },
  { label: 'NRA HQ', emp: 'nra-hq', tile: 'rb-0_2', idx: 260, name: null, empName: /National Rifle Association/, shot: 'docs/route-shots/click-nra.png' },
];
(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const fails = [], notes = [];
  const ok = (c, m) => { (c ? notes : fails).push((c ? 'PASS ' : 'FAIL ') + m); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await stubCdn(ctx);
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|favicon|net::ERR/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(2500);
  for (const c of CASES) {
    await page.evaluate(id => { app.select(id, true); }, c.emp); await page.waitForTimeout(2500);
    await page.evaluate(() => app.closeCard()); await page.waitForTimeout(600);
    const ready = await page.waitForFunction(([id, idx, tile]) => app.routeBuildings && app.routeBuildings.ready() && app.routeBuildings.count() > 0 &&
      (() => { const e = app.E.find(q => q.id === id); const r = app.routeBuildings.at(e.x, e.z); return !!r; })(), [c.emp, c.idx, c.tile], { timeout: 20000 }).then(() => true, () => false);
    ok(ready, `${c.label}: rb tile + index loaded and the employer sits in a route building`);
    if (!ready) continue;
    // a spot inside the target building that is on screen and at least 34 px from every pin
    const spot = await page.evaluate(async ([tile, idx]) => {
      const list = await (await fetch('tiles/' + tile + '.json')).json(), b = list[idx], pts = []; for (let k = 2; k + 1 < b.length; k += 2) pts.push([b[k] / 10, b[k + 1] / 10]);
      const inP = (x, z) => { let cc = false; for (let i = 0; i < pts.length; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[(i + pts.length - 1) % pts.length]; if ((z1 > z) !== (z2 > z) && x < (x2 - x1) * (z - z1) / (z2 - z1) + x1) cc = !cc; } return cc; };
      const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]), r = document.getElementById('gl').getBoundingClientRect();
      const proj = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(app.camera); return [(v.x * 0.5 + 0.5) * r.width, (-v.y * 0.5 + 0.5) * r.height, v.z]; };
      const pins = []; app.E.forEach(e => [0, 16, 40].forEach(y => pins.push(proj(e.x, y, e.z))));
      let best = null;
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += 2) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 2) {
        if (!inP(x, z)) continue; const p = proj(x, Math.max(b[0] / 10 - 0.5, 0), z); if (p[2] > 1 || p[0] < 10 || p[1] < 10 || p[0] > r.width - 10 || p[1] > r.height - 10) continue;
        const d = Math.min(...pins.map(q => Math.hypot(q[0] - p[0], q[1] - p[1]))); if (!best || d > best.d) best = { d, px: p[0], py: p[1] };
      }
      return Object.assign(best || { d: -1, why: 'none on screen', cam: [app.camera.position.x, app.camera.position.z], ctr: [pts[0][0], pts[0][1]] }, { left: r.left, top: r.top });
    }, [c.tile, c.idx]);
    ok(spot && spot.d >= 34, `${c.label}: found a clickable spot ${spot ? Math.round(spot.d) + ' px from the nearest pin ' + (spot.why ? JSON.stringify(spot) : '') : 'none'}`);
    if (!spot || spot.d < 0) continue;
    await page.mouse.click(spot.left + spot.px, spot.top + spot.py); await page.waitForTimeout(900);
    const sel = await page.evaluate(() => app.selected), card = await page.locator('#card:not([hidden])').innerText().catch(() => '');
    ok(sel && sel.kind === 'rbldg' && sel.id === c.tile + ':' + c.idx, `${c.label}: click selected the route building ${JSON.stringify(sel)}`);
    ok(c.name ? card.includes(c.name) : /Office\/commercial building/.test(card) && /no name for this building/.test(card), `${c.label}: card title ${c.name ? 'is ' + c.name : 'is the generic one and says the record has no name'}`);
    ok(/Source: Fairfax County GIS/.test(card), `${c.label}: card names its source`);
    ok(c.empName.test(card), `${c.label}: card lists the employer`);
    // the employer link selects the employer
    await page.locator('#card [data-rb-emp]').first().click(); await page.waitForTimeout(1200);
    ok(await page.evaluate(id => app.selected && app.selected.kind === 'emp' && app.selected.id === id, c.emp), `${c.label}: employer link opens the employer card`);
    if (c.shot) { // screenshot of the building card: click the building again, then capture
      await page.evaluate(() => app.closeCard()); await page.waitForTimeout(500);
      await page.mouse.click(spot.left + spot.px, spot.top + spot.py); await page.waitForTimeout(1200);
      fs.mkdirSync(path.dirname(c.shot), { recursive: true }); await page.screenshot({ path: c.shot });
    }
  }
  // empty ground still does nothing
  await page.evaluate(() => app.closeCard()); await page.mouse.click(5, 790); await page.waitForTimeout(400);
  ok(await page.evaluate(() => !app.selected), 'a click on empty map selects nothing');
  ok(errs.length === 0, 'no console errors ' + errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(notes.concat(fails).join('\n')); process.exit(fails.length ? 1 : 0);
})();
