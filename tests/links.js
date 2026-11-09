// Find-openings links + My pages: node tests/links.js [url]
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
const url = process.argv[2] || 'http://localhost:8765/reston-hiring-map.html';
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR|favicon/.test(m.text())) errs.push(m.text()); });
  await p.goto(url); await p.waitForTimeout(2500);
  await p.evaluate(() => app.select('ssa-reston-field-office', true)); await p.waitForTimeout(800);
  const hrefs = await p.evaluate(() => [...document.querySelectorAll('#card .links-sec a')].map(a => [a.textContent.trim(), a.href]));
  const by = n => (hrefs.find(h => h[0].startsWith(n)) || [])[1] || '';
  ok(/linkedin\.com\/jobs\/search\/\?keywords=Social%20Security%20Administration%2C%20Reston%20Field%20Office&location=Reston%2C%20VA/.test(by('LinkedIn')), 'employer: LinkedIn search has company + Reston, VA');
  ok(/indeed\.com\/jobs\?q=Social%20Security.*&l=Reston%2C%20VA/.test(by('Indeed')), 'employer: Indeed search has company + location');
  ok(/joinhandshake\.com\/stu\/postings\?query=Social%20Security/.test(by('Handshake')), 'employer: Handshake search has company');
  ok(/usajobs\.gov\/search\/results\/\?k=Social/.test(by('USAJOBS')), 'federal employer also gets USAJOBS');
  ok(await p.evaluate(() => [...document.querySelectorAll('#card .links-sec a')].every(a => a.target === '_blank' && /noopener/.test(a.rel))), 'all links open in a new tab with noopener');
  // a non-federal employer has no USAJOBS
  await p.evaluate(() => app.select('loudoun-county-government', true)); await p.waitForTimeout(600);
  ok(!(await p.evaluate(() => [...document.querySelectorAll('#card .links-sec a')].some(a => /USAJOBS/.test(a.textContent)))), 'non-federal employer: no USAJOBS');
  // My pages: invalid then valid
  await p.click('#card [data-mylinks]'); await p.waitForTimeout(300);
  ok(await p.locator('#links-sheet').count() === 1, 'My pages sheet opens');
  await p.fill('#ml-linkedin', 'http://evil.example.com/x'); await p.click('#ml-save'); await p.waitForTimeout(200);
  ok(/linkedin\.com/.test(await p.textContent('#mle-linkedin')) && await p.locator('#links-sheet').count() === 1, 'rejects non-LinkedIn / non-https address with a message');
  await p.fill('#ml-linkedin', 'https://www.linkedin.com/in/test-person/'); await p.fill('#ml-indeed', 'javascript:alert(1)'); await p.click('#ml-save'); await p.waitForTimeout(200);
  ok(await p.locator('#links-sheet').count() === 1, 'javascript: address rejected');
  await p.fill('#ml-indeed', ''); await p.click('#ml-save'); await p.waitForTimeout(600);
  ok(await p.locator('#links-sheet').count() === 0, 'valid save closes the sheet');
  ok(await p.evaluate(() => [...document.querySelectorAll('#card .links-mine a')].some(a => a.textContent.includes('My LinkedIn') && a.href.startsWith('https://www.linkedin.com/in/'))), 'My LinkedIn shows on the card');
  await p.reload(); await p.waitForTimeout(2500); await p.evaluate(() => app.select('loudoun-county-government', true)); await p.waitForTimeout(600);
  ok(await p.evaluate(() => [...document.querySelectorAll('#card .links-mine a')].length === 1), 'saved link persists after reload');
  await p.click('#card [data-mylinks]'); await p.waitForTimeout(200); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok(await p.locator('#links-sheet').count() === 0, 'Esc closes the sheet');
  // building card
  await p.evaluate(() => { document.getElementById('tab-rank').click(); }); await p.waitForTimeout(500);
  await p.locator('#list .item').first().click(); await p.waitForTimeout(800);
  const bl = await p.evaluate(() => [...document.querySelectorAll('#card .links-sec a')].map(a => a.href));
  ok(bl.length === 2 && /indeed\.com\/jobs\?q=&l=.*radius=5/.test(bl[0]) && /linkedin\.com\/jobs\/search\/\?keywords=&location=.*distance=5/.test(bl[1]), 'building card: Indeed + LinkedIn near here');
  await p.screenshot({ path: 'test-shots/links-building.png' });
  ok(errs.length === 0, 'no console errors ' + errs.slice(0, 2));
  await b.close(); console.log(res.join('\n')); process.exit(res.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
