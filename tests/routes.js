// Route detail test: node tests/routes.js [url]   (serve first: python3 -m http.server 8772)
// Checks: "Getting there" section, toll-free listed first, ribbon added on select and removed on deselect, the commute score uses route minutes,
// moved-home and routes.json-missing fallbacks work, no console errors.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
async function stubCdn(ctx) { await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') })); }
const url = process.argv[2] || 'http://localhost:8772/reston-hiring-map.html';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const out = [], bad = [];
  const ok = (c, m) => (c ? out : bad).push((c ? 'PASS ' : 'FAIL ') + m);
  async function open(vp, { noRoutes = false, home = null } = {}) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    await stubCdn(ctx);
    if (home) await ctx.addInitScript(h => localStorage.setItem('reston-map-home', JSON.stringify(h)), home);
    if (noRoutes) await ctx.route(/reston-hiring-map\.html/, async r => {
      const resp = await r.fetch(); let b = await resp.text();
      b = b.replace(/const ROUTES = [\s\S]*?;\nPARTS\.push/, 'const ROUTES = null;\nPARTS.push'); r.fulfill({ response: resp, body: b });
    });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|favicon|net::ERR/.test(m.text())) errs.push('console: ' + m.text()); });
    await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(2200);
    return { ctx, page, errs };
  }
  const ribbonCount = page => page.evaluate(() => { const g = app.scene.getObjectByName('route-ribbon'); return g ? g.children.length : 0; });

  // 1) normal data, desktop
  let { ctx, page, errs } = await open({ width: 1280, height: 800 });
  ok(await page.evaluate(() => !!(app.routes && app.routes.ready)), 'app.routes exposed and ready');
  await page.evaluate(() => app.select('loudoun-county-government', true)); await page.waitForTimeout(900);
  const html = await page.locator('#card').innerHTML();
  ok(/Getting there/.test(html), 'card shows a Getting there section');
  const lines = await page.locator('#card .rt-opt').allInnerTexts();
  ok(lines.length >= 2 && !/\(toll\)/.test(lines[0]) && /no tolls/.test(lines[0]) && /\(toll\)/.test(lines[1]), 'toll-free option listed first, tolled one marked (toll): ' + JSON.stringify(lines));
  const opts = await page.evaluate(() => app.routes.options(app.E.find(e => e.id === 'loudoun-county-government')));
  ok(opts.length >= 2 && opts[0].toll === false, 'options() returns toll-free first');
  ok(await page.evaluate(() => app.routes.bestMinutes(app.E.find(e => e.id === 'loudoun-county-government'))) === opts[0].min, 'bestMinutes is the fastest toll-free option');
  ok(await ribbonCount(page) === 1, 'ribbon added to scene on select');
  await page.locator('#card .rt-alt').click(); await page.waitForTimeout(300);
  ok(await ribbonCount(page) === opts.length, 'Show other routes draws the alternatives too');
  await page.screenshot({ path: 'test-shots/routes-desktop.png' });
  await page.locator('#cc').click(); await page.waitForTimeout(300);
  ok(await ribbonCount(page) === 0, 'ribbon removed on deselect');
  await page.evaluate(() => app.select('town-of-warrenton', true)); await page.waitForTimeout(500);
  await page.evaluate(() => app.select('icf', true)); await page.waitForTimeout(500);
  ok(await ribbonCount(page) >= 1 && await page.evaluate(() => app.scene.children.filter(c => c.name === 'route-ribbon').length) === 1, 'only one ribbon group after changing selection');
  const sc = await page.evaluate(() => { const e = app.E.find(x => x.id === 'town-of-warrenton'); return [app.routes.bestMinutes(e), app.hooks.commute(e)]; });
  ok(sc[0] != null && sc[1] === (sc[0] <= 45 ? .4 : .2) , 'commute score from minutes (band 35-45 = 0.4): ' + JSON.stringify(sc));
  ok(errs.length === 0, 'no console errors (data) ' + errs.slice(0, 2).join(' | ')); await ctx.close();

  // 2) phone
  ({ ctx, page, errs } = await open({ width: 400, height: 800 }));
  await page.evaluate(() => app.select('mitre', true)); await page.waitForTimeout(900);
  ok(/Getting there/.test(await page.locator('#card').innerHTML()), 'phone: Getting there present');
  await page.screenshot({ path: 'test-shots/routes-phone.png' });
  ok(errs.length === 0, 'phone: no console errors ' + errs.slice(0, 2).join(' | ')); await ctx.close();

  // 3) routes.json missing
  ({ ctx, page, errs } = await open({ width: 1280, height: 800 }, { noRoutes: true }));
  ok(await page.evaluate(() => app.routes.ready === false && app.routes.bestMinutes(app.E[0]) === null && app.routes.hasTollFree(app.E[0]) === null), 'missing data: ready false, bestMinutes null');
  await page.evaluate(() => app.select('loudoun-county-government', true)); await page.waitForTimeout(700);
  const h3 = await page.locator('#card').innerHTML();
  ok(/Getting there/.test(h3) && /estimate/.test(h3), 'missing data: card shows labelled estimate');
  ok(await ribbonCount(page) === 0, 'missing data: no ribbon');
  ok(await page.locator('#list .item').count() > 5, 'missing data: list still renders');
  ok(errs.length === 0, 'missing data: no console errors ' + errs.slice(0, 2).join(' | ')); await ctx.close();

  // 4) moved home
  ({ ctx, page, errs } = await open({ width: 1280, height: 800 }, { home: { lat: 38.88, lon: -77.2 } }));
  await page.evaluate(() => app.select('loudoun-county-government', true)); await page.waitForTimeout(700);
  const h4 = await page.locator('#card').innerHTML();
  ok(/Routes are from your saved home/.test(h4), 'moved home: shows "Routes are from your saved home"');
  ok(await page.evaluate(() => app.routes.bestMinutes(app.E.find(e => e.id === 'loudoun-county-government'))) === null, 'moved home: bestMinutes null (miles fallback)');
  ok(errs.length === 0, 'moved home: no console errors ' + errs.slice(0, 2).join(' | ')); await ctx.close();

  await browser.close();
  console.log(out.concat(bad).join('\n')); process.exit(bad.length ? 1 : 0);
})();
