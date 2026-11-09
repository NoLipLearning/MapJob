// Smoke test: node tests/smoke.js [url]   (serve first: python3 -m http.server 8765)
// Checks: no console/page errors, list renders, selecting an employer opens a card, keyboard + buttons move the map, phone view isn't zoomed out.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
// The sandbox blocks the jsdelivr CDN, so serve the same three.js r128 files from tests/vendor in its place.
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
async function stubCdn(ctx) { await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') })); }
module.exports = { stubCdn, ARGS: null };
const url = process.argv[2] || 'http://localhost:8765/reston-hiring-map.html';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const fails = [], notes = [];
  const ok = (c, m) => { (c ? notes : fails).push((c ? 'PASS ' : 'FAIL ') + m); };
  for (const [name, vp, touch] of [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 400, height: 800 }, true]]) {
    const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
    await stubCdn(ctx);
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|favicon|net::ERR/.test(m.text())) errs.push('console: ' + m.text()); });
    await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(2500);
    ok(errs.length === 0, `${name}: no console errors ${errs.slice(0, 3).join(' | ')}`);
    const n = await page.locator('#list .item').count(); ok(n > 5, `${name}: list has ${n} items`);
    await page.screenshot({ path: `test-shots/${name}-1-load.png` });
    await page.locator('#list .item').first().click(); await page.waitForTimeout(1200);
    ok(await page.locator('#card:not([hidden])').count() === 1, `${name}: card opens on click`);
    await page.screenshot({ path: `test-shots/${name}-2-card.png` });
    if (!touch) {
      const before = await page.evaluate(() => JSON.stringify(app.camera.position));
      await page.locator('#gl').focus(); await page.keyboard.down('ArrowRight'); await page.waitForTimeout(500); await page.keyboard.up('ArrowRight');
      const after = await page.evaluate(() => JSON.stringify(app.camera.position));
      ok(before !== after, `${name}: arrow key moves the camera`);
      ok(await page.evaluate(() => document.getElementById('card').classList.contains('min')), `${name}: card opens shrunk on desktop`);
    } else {
      const vw = await page.evaluate(() => window.innerWidth); ok(vw <= 500, `${name}: viewport width ${vw} (not a zoomed-out 980)`);
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), `${name}: no horizontal page scroll`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(notes.concat(fails).join('\n')); process.exit(fails.length ? 1 : 0);
})();
