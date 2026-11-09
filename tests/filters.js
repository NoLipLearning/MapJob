// Filters test: node tests/filters.js [url]   (serve first: python3 -m http.server 8771)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
async function stubCdn(ctx) { await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') })); }
const url = process.argv[2] || 'http://localhost:8771/reston-hiring-map.html';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const out = []; const ok = (c, m) => out.push((c ? 'PASS ' : 'FAIL ') + m);
  async function open(vp, touch, keepStorage, ctx0) {
    const ctx = ctx0 || await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
    if (!ctx0) await stubCdn(ctx);
    const page = await ctx.newPage(); page.errs = [];
    page.on('pageerror', e => page.errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|favicon|net::ERR/.test(m.text())) page.errs.push(m.text()); });
    await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(1800);
    return page;
  }
  const fakes = page => page.evaluate(() => {
    app.routes = { bestMinutes: e => 10 + (e.rank || 0) % 70, hasTollFree: e => e.id.length % 2 === 0 };
    const st = ['star', 'applied', 'interviewing', 'closed', null];
    app.tracker = { statusOf: id => st[id.length % 5] };
    app.refresh();
  });
  const total = page => page.evaluate(() => app.filters.count());
  const shown = page => page.evaluate(() => app.ranked.length);
  const click = (page, sel) => page.locator('#filters ' + sel).first().click();

  // ---- desktop ----
  let page = await open({ width: 1280, height: 800 }, false);
  await fakes(page); await page.waitForTimeout(300);
  ok(await page.locator('#filters .fbody').isHidden(), 'desktop: bar starts collapsed');
  await page.locator('#filters .fdesk').click();
  ok(await page.locator('#filters .fbody').isVisible(), 'desktop: Filters button expands the bar');
  const base = await total(page); ok(base === await shown(page), `default count ${base} equals list`);
  ok(await page.locator('#area, #kind, #hideclear').count() === 0, 'old controls removed');
  ok(await page.locator('#filters .fcount').first().textContent() === `Showing ${base} of 95`, 'live count text');
  await click(page, '.chip[data-g=cl][data-v=none]'); await page.waitForTimeout(150);
  const tag = await page.locator('#list .item .tag', { hasText: 'Sponsors clearance' }).count(); ok(tag > 0, `"Sponsors clearance" tag on rows (${tag})`);
  await page.evaluate(() => app.filters.reset());

  async function changes(label, sel, expectLess) {
    const b = await total(page); await click(page, sel); await page.waitForTimeout(100);
    const a = await total(page); ok(expectLess ? a < b : a !== b, `${label}: ${b} -> ${a}`);
    return [b, a];
  }
  await changes('Area (turn one off)', '.chip[data-g=area]', true); await page.evaluate(() => app.filters.reset());
  await changes('Type (turn one off)', '.chip[data-g=type]', true); await page.evaluate(() => app.filters.reset());
  await changes('Clearance (turn Sponsors off)', '.chip[data-g=cl][data-v=some]', true); await page.evaluate(() => app.filters.reset());
  await changes('Clearance (turn Mostly on)', '.chip[data-g=cl][data-v=most]', false); await page.evaluate(() => app.filters.reset());
  await changes('Metro', '.chip[data-t=metro]', true); await page.evaluate(() => app.filters.reset());
  await changes('Toll-free', '.chip[data-t=toll]', true); await page.evaluate(() => app.filters.reset());
  await changes('Internship/fellowship', '.chip[data-t=prog]', true); await page.evaluate(() => app.filters.reset());
  await changes('Easy entry', '.chip[data-t=entry]', true); await page.evaluate(() => app.filters.reset());
  await changes('My status (Closed off)', '.chip[data-g=status][data-v=closed]', true); await page.evaluate(() => app.filters.reset());
  { const b = await total(page); await page.locator('#f-max').fill('30'); const a = await total(page); ok(a < b, `Drive-time slider 30: ${b} -> ${a}`); await page.evaluate(() => app.filters.reset()); }

  // OR within a group, AND across groups
  const nAll = await total(page);
  await page.evaluate(() => { app.filters.reset(); });
  const counts = await page.evaluate(() => {
    const R = app.D.emps.filter(e => e.reg === AREAS[0]).filter(app.filters.match).length, T = app.D.emps.filter(e => e.reg === AREAS[1]).filter(app.filters.match).length; return [R, T];
  });
  // keep only area 0 and 1 by turning others off
  const areas = await page.locator('#filters .chip[data-g=area]').count();
  for (let i = 2; i < areas; i++) await page.locator('#filters .chip[data-g=area]').nth(i).click();
  ok(await total(page) === counts[0] + counts[1], `OR within group: ${counts[0]} + ${counts[1]} = ${await total(page)}`);
  await click(page, '.chip[data-t=metro]');
  const and = await page.evaluate(() => app.D.emps.filter(e => (e.reg === AREAS[0] || e.reg === AREAS[1]) && e.metro && e.cl !== 'most').length);
  ok(await total(page) === and, `AND across groups: ${and}`);
  // empty state with fixes
  await page.evaluate(() => { app.filters.reset(); });
  await page.locator('#q').fill('zzzzqq'); await page.waitForTimeout(200);
  ok(await page.locator('#list .empty [data-fix=search]').count() === 1, 'empty list offers "Search" fix');
  await page.locator('#q').fill(''); await page.waitForTimeout(100);
  await click(page, '.chip[data-g=cl][data-v=none]'); await click(page, '.chip[data-g=cl][data-v=some]'); await page.waitForTimeout(200);
  ok(await shown(page) === 0 && await page.locator('#list .empty [data-fix=cl]').count() === 1, 'empty list names Clearance with a fix button');
  await page.locator('#list [data-fix=cl]').click(); await page.waitForTimeout(150);
  ok(await shown(page) > 0, 'one-tap fix restores results');
  await page.screenshot({ path: 'test-shots/filters-desktop.png' });

  // keyboard: Tab to a chip, Space toggles, focus ring visible
  await page.evaluate(() => app.filters.reset());
  await page.locator('#filters .chip[data-t=metro]').focus(); const b0 = await total(page);
  await page.keyboard.press('Space'); await page.waitForTimeout(100);
  ok(await total(page) < b0 && await page.locator('#filters .chip[data-t=metro]').getAttribute('aria-pressed') === 'true', 'chip toggles with keyboard');
  ok(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), 'focus ring visible');
  ok(await page.evaluate(() => app.filters.activeCount()) === 1, 'activeCount 1');

  // persistence after reload (same context keeps localStorage)
  const ctx = page.context(); const saved = await total(page);
  ok(!!(await page.evaluate(() => localStorage.getItem('reston-map-filters'))), 'state saved under reston-map-filters');
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1800);
  ok(await total(page) === saved && await page.locator('#filters .chip[data-t=metro]').getAttribute('aria-pressed') === 'true', 'filters persist after reload');
  await click(page, '.fres'); await page.waitForTimeout(150);
  ok(await total(page) === nAll || await total(page) > saved, 'Reset filters works');
  ok(await page.evaluate(() => app.filters.activeCount()) === 0, 'reset leaves 0 active');
  ok(page.errs.length === 0, 'desktop: no console errors ' + page.errs.slice(0, 2));
  await ctx.close();

  // fallbacks with no routes / tracker
  page = await open({ width: 1280, height: 800 }, false);
  ok(await page.locator('#filters .chip[data-t=toll]').isDisabled(), 'no routes: Toll-free disabled with note');
  ok(await page.locator('#filters legend', { hasText: 'My status' }).count() === 0, 'no tracker: My status hidden');
  ok(/est\./.test(await page.locator('#filters .fslide label').textContent()), 'no routes: slider labeled est.');
  await page.context().close();

  // ---- phone ----
  page = await open({ width: 400, height: 800 }, true);
  await fakes(page); await page.waitForTimeout(300);
  const ob = page.locator('#filters .fopen');
  ok(/^Filters$/.test((await ob.textContent()).trim()), 'phone: collapsed "Filters" button');
  ok((await ob.boundingBox()).height >= 44, 'phone: button >= 44px tall');
  ok(await page.locator('#filters .fbody').count() === 0, 'phone: chips not inline');
  await ob.click(); await page.waitForTimeout(200);
  ok(await page.locator('.sheet-back:not([hidden]) .fsheet').count() === 1, 'phone: sheet opens');
  const chipBox = await page.locator('.fsheet .chip').first().boundingBox(); ok(chipBox.height >= 40, `phone: chip height ${chipBox.height}`);
  await page.locator('.fsheet .chip[data-t=metro]').click(); await page.waitForTimeout(150);
  ok(/Filters \(1 on\)/.test(await ob.textContent()), 'phone: "Filters (1 on)"');
  await page.screenshot({ path: 'test-shots/filters-phone-sheet.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  ok(await page.locator('.sheet-back:not([hidden])').count() === 0, 'phone: Esc closes sheet');
  ok(await page.evaluate(() => document.activeElement.classList.contains('fopen')), 'phone: focus returns to button');
  await page.screenshot({ path: 'test-shots/filters-phone.png' });
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'phone: no horizontal scroll');
  ok(page.errs.length === 0, 'phone: no console errors ' + page.errs.slice(0, 2));
  await browser.close();
  console.log(out.join('\n')); process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
