// Extra screenshots for review: settings, jump menu, help, legend, move pad, large text, calm mode. node tests/menus-shots.js
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
const url = process.argv[2] || 'http://localhost:8765/reston-hiring-map.html';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
(async () => {
  const b = await chromium.launch({ args: ARGS });
  for (const [w, h, scheme] of [[1280, 800, 'light'], [400, 800, 'dark'], [320, 640, 'light']]) {
    const touch = w < 700;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, colorScheme: scheme });
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') }));
    const p = await ctx.newPage(); await p.goto(url); await p.waitForTimeout(2200);
    const f = s => `test-shots/menus-${w}x${h}-${scheme}-${s}.png`;
    await p.click('#gear'); await p.waitForTimeout(200); await p.screenshot({ path: f('settings') }); await p.keyboard.press('Escape');
    await p.click('#jumpbtn'); await p.waitForTimeout(200); await p.screenshot({ path: f('jump') }); await p.keyboard.press('Escape');
    await p.click('#keybtn'); await p.waitForTimeout(200); await p.screenshot({ path: f('legend') }); await p.click('#keybtn');
    await p.click('#helpbtn'); await p.waitForTimeout(200); await p.screenshot({ path: f('help') }); await p.click('#helpx');
    await p.evaluate(() => { app.ui.pad = true; app.ui.size = 'l'; app.ui.calm = true; document.documentElement.classList.add('show-pad', 'calm'); document.documentElement.style.setProperty('--root-fs', '18px'); });
    if (w < 700) await p.evaluate(() => app.sheet('half'));
    await p.waitForTimeout(500); await p.screenshot({ path: f('large-calm-pad') });
    await ctx.close();
  }
  await b.close();
})();
