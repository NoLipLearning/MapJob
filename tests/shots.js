// Screenshot sweep: node tests/shots.js <prefix> [url]   -> test-shots/<prefix>-<WxH>-<light|dark>-<state>.png
// states: load, card (employer selected), apps (My applications tab with one tracked item)
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
const prefix = process.argv[2] || 'after';
const url = process.argv[3] || 'http://localhost:8776/reston-hiring-map.html';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const SIZES = [[1280, 800], [1024, 700], [400, 800], [320, 640]];
(async () => {
  const b = await chromium.launch({ args: ARGS });
  for (const [w, h] of SIZES) for (const scheme of ['light', 'dark']) {
    const touch = w < 700;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, colorScheme: scheme });
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') }));
    const p = await ctx.newPage();
    await p.goto(url); await p.waitForTimeout(2500);
    const f = s => `test-shots/${prefix}-${w}x${h}-${scheme}-${s}.png`;
    await p.screenshot({ path: f('load') });
    if (w <= 900) { await p.evaluate(() => app.sheet('half')); await p.waitForTimeout(500); await p.screenshot({ path: f('list') }); await p.evaluate(() => app.sheet('peek')); await p.waitForTimeout(400); }
    const id = await p.evaluate(() => app.ranked[0].id);
    await p.evaluate(id => app.select(id, true), id); await p.waitForTimeout(1400);
    await p.screenshot({ path: f('card') });
    await p.evaluate(async id => { if (!app.tracker) return; await app.tracker.ready; const t = new Date().toISOString().slice(0, 10); app.tracker.upsert({ empId: id, role: 'Policy Analyst', status: 'applied', dates: { applied: t }, nextAction: { text: 'Follow up by email', due: t, doneAt: null } }); }, id);
    await p.waitForTimeout(800);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    const tab = p.locator('#tab-apps'); if (await tab.count()) { await tab.click(); await p.waitForTimeout(600); }
    await p.screenshot({ path: f('apps') });
    await ctx.close();
  }
  await b.close();
})();
