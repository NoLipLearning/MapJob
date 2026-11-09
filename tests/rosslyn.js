// Rosslyn tile check: node tests/rosslyn.js [url]. Jumps to Rosslyn, waits for the tile to load, screenshots it.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
const url = process.argv[2] || 'http://localhost:8765/reston-hiring-map.html';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(url); await p.waitForTimeout(2000);
  await p.click('#jumpbtn'); await p.click('#places [data-p="rosslyn"]'); await p.waitForTimeout(4000);
  await p.screenshot({ path: 'test-shots/rosslyn.png' });
  const info = await p.evaluate(() => ({ tiles: app.D.tiles.map(t => t.id), rankZones: [...new Set(app.RANK.map(r => r.area))] }));
  console.log(JSON.stringify(info), errs.length ? 'ERRORS ' + errs : 'no errors');
  await b.close(); process.exit(errs.length ? 1 : 0);
})();
