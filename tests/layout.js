// Layout test: node tests/layout.js [url]   (serve first: python3 -m http.server 8776)
// Covers the app shell: no horizontal scroll, map-first phone, bottom sheet snaps (buttons, keyboard, drag), docked drawer, Esc + focus return,
// settings persistence, tabs that never wrap, 44px touch targets.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
const url = process.argv[2] || 'http://localhost:8776/reston-hiring-map.html';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
async function open(b, w, h, touch) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') }));
  const page = await ctx.newPage(); page.errs = [];
  page.on('pageerror', e => page.errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR|favicon/.test(m.text())) page.errs.push(m.text()); });
  await page.goto(url); await page.waitForTimeout(2200); return { ctx, page };
}
const snapH = p => p.evaluate(() => Math.round(document.getElementById('rail').getBoundingClientRect().height));
const settle = p => p.waitForTimeout(450);
(async () => {
  const b = await chromium.launch({ args: ARGS });
  // ---- no horizontal scroll, tabs on one line ----
  for (const [w, h] of [[320, 640], [400, 800], [1024, 700], [1280, 800]]) {
    const { ctx, page } = await open(b, w, h, w < 700);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1), `${w}: no horizontal scroll`);
    if (w < 700) await page.evaluate(() => app.sheet('half'));
    await settle(page);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('#tabs [role=tab]')].map(t => { const l = t.querySelector('.tl'), r = l.getBoundingClientRect(), lh = parseFloat(getComputedStyle(l).lineHeight) || 20; return { h: r.height, lh, fits: t.scrollWidth <= t.clientWidth + 1, txt: l.textContent }; }));
    ok(tabs.length === 3 && tabs.every(t => t.h < t.lh * 1.5 && t.fits), `${w}: three tabs, none wraps or clips (${tabs.map(t => t.txt).join(', ')})`);
    ok(await page.evaluate(() => { const r = document.getElementById('mapbox').getBoundingClientRect(); return r.width > 250 && r.height > 300; }), `${w}: map has a real size`);
    ok(page.errs.length === 0, `${w}: no console errors ${page.errs.slice(0, 2).join('|')}`);
    await ctx.close();
  }
  // ---- phone ----
  for (const [w, h] of [[400, 800], [320, 640]]) {
    const { ctx, page } = await open(b, w, h, true);
    const mapH = await page.evaluate(() => document.getElementById('mapbox').getBoundingClientRect().height);
    ok(mapH >= h * 0.45, `${w}: map is visible at load (${Math.round(mapH)}px of ${h}px)`);
    ok(await page.evaluate(() => app.snap) === 'peek', `${w}: sheet starts at peek`);
    const peek = await snapH(page); ok(peek < h * 0.2, `${w}: peek is small (${peek}px)`);
    ok(await page.evaluate(() => { const t = document.getElementById('tabs').getBoundingClientRect(); const r = document.getElementById('rail').getBoundingClientRect(); return t.bottom <= r.bottom + 1 && t.top >= r.top; }), `${w}: tabs show inside the peek`);
    // targets >= 44px
    const small = await page.evaluate(() => [...document.querySelectorAll('.zoom button, #places .mbtn, #sheetgrab, #gear, #tabs button, #sheetup')].filter(n => n.offsetParent).map(n => { const r = n.getBoundingClientRect(); return { id: n.id || n.textContent.trim() || n.className, w: r.width, h: r.height }; }).filter(x => x.h < 43.5 || (x.w < 43.5 && x.id !== 'sheetgrab')));
    ok(small.length === 0, `${w}: touch targets >= 44px ${JSON.stringify(small)}`);
    // buttons
    await page.click('#sheetup'); await settle(page); const half = await snapH(page); ok(await page.evaluate(() => app.snap) === 'half' && half > peek + 100, `${w}: Show more -> half (${half}px)`);
    await page.click('#sheetup'); await settle(page); const full = await snapH(page); ok(await page.evaluate(() => app.snap) === 'full' && full > half + 50, `${w}: Show more -> full (${full}px)`);
    await page.click('#sheetdn'); await settle(page); ok(await page.evaluate(() => app.snap) === 'half', `${w}: Show less -> half`);
    // keyboard on the handle
    await page.focus('#sheetgrab'); await page.keyboard.press('ArrowUp'); await settle(page); ok(await page.evaluate(() => app.snap) === 'full', `${w}: ArrowUp -> full`);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await settle(page); ok(await page.evaluate(() => app.snap) === 'peek', `${w}: ArrowDown twice -> peek`);
    await page.keyboard.press('End'); await settle(page); ok(await page.evaluate(() => app.snap) === 'full', `${w}: End -> full`);
    await page.keyboard.press('Home'); await settle(page); ok(await page.evaluate(() => app.snap) === 'peek', `${w}: Home -> peek`);
    ok(await page.evaluate(() => document.getElementById('sheetgrab').getAttribute('aria-expanded')) === 'false', `${w}: handle announces collapsed`);
    // drag the handle up
    const g = await page.locator('#sheetgrab').boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + 20); await page.mouse.down(); await page.mouse.move(g.x + g.width / 2, g.y - 150, { steps: 6 }); await page.waitForTimeout(250); await page.mouse.up(); await settle(page);
    ok(['half', 'full'].includes(await page.evaluate(() => app.snap)), `${w}: dragging the handle up opens the sheet (${await page.evaluate(() => app.snap)})`);
    // Esc collapses an open sheet and puts focus back on the handle
    await page.evaluate(() => app.sheet('half')); await page.focus('#q'); await page.keyboard.press('Escape'); await page.focus('#sheetgrab'); await page.keyboard.press('Escape'); await settle(page);
    ok(await page.evaluate(() => app.snap) === 'peek' && await page.evaluate(() => document.activeElement.id) === 'sheetgrab', `${w}: Esc collapses the sheet, focus stays on the handle`);
    // selecting opens the card at half, pin above the sheet
    await page.evaluate(() => app.select(app.ranked[2].id, true)); await page.waitForTimeout(1600);
    ok(await page.evaluate(() => app.snap) === 'half', `${w}: selecting shows the card at half height`);
    ok(await page.evaluate(() => { const c = document.getElementById('card'); return !c.hidden && c.closest('#rail') && c.getBoundingClientRect().height > 100; }), `${w}: card is inside the sheet`);
    const vis = await page.evaluate(() => { const s = sprites.find(q => q.key === 'emp:' + app.selected.id), p = project(s.sp.position), top = document.getElementById('rail').getBoundingClientRect().top; return { y: p && p[1], top, x: p && p[0], W }; });
    ok(vis.y !== null && vis.y > 60 && vis.y < vis.top - 20 && vis.x > 0 && vis.x < vis.W, `${w}: selected pin stays above the sheet (y ${Math.round(vis.y)} < ${Math.round(vis.top)})`);
    await page.focus('#cc'); await page.keyboard.press('Escape'); await settle(page);
    ok(await page.evaluate(() => document.getElementById('card').hidden), `${w}: Esc closes the card`);
    ok(await page.evaluate(() => document.getElementById('rail').getBoundingClientRect().height) > 100, `${w}: list is back after closing the card`);
    ok(page.errs.length === 0, `${w}: no console errors ${page.errs.slice(0, 2).join('|')}`);
    await ctx.close();
  }
  // ---- desktop ----
  {
    const { ctx, page } = await open(b, 1280, 800, false);
    ok(await page.evaluate(() => { const r = document.getElementById('rail').getBoundingClientRect(); return r.left === 0 && r.width >= 380 && r.width <= 440 && r.height >= innerHeight - 1; }), 'desktop: left rail 380-440px, full height');
    ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'desktop: the page itself does not scroll');
    ok(await page.evaluate(() => getComputedStyle(document.getElementById('pad')).display) === 'none', 'desktop: move pad hidden by default');
    const w0 = await page.evaluate(() => document.getElementById('mapbox').getBoundingClientRect().width);
    // keyboard open: focus an item, press Enter
    await page.focus('#list .item'); await page.keyboard.press('Enter'); await page.waitForTimeout(1600);
    ok(await page.evaluate(() => !document.getElementById('card').hidden), 'desktop: drawer opens on select');
    const g = await page.evaluate(() => { const c = document.getElementById('card').getBoundingClientRect(), m = document.getElementById('mapbox').getBoundingClientRect(), s = sprites.find(q => q.key === 'emp:' + app.selected.id), p = project(s.sp.position); return { cl: c.left, cr: c.right, mr: m.right, px: p && p[0], py: p && p[1], mw: m.width, mh: m.height, W: innerWidth }; });
    ok(g.cl >= g.mr - 1 && g.cr <= g.W + 1, 'desktop: drawer is docked at the right edge, beside the map');
    ok(g.mw < w0, 'desktop: map made room for the drawer');
    ok(g.px > 40 && g.px < g.mw - 40 && g.py > 40 && g.py < g.mh - 40, `desktop: selected pin is clear of the drawer (${Math.round(g.px)},${Math.round(g.py)} in ${Math.round(g.mw)}x${Math.round(g.mh)})`);
    ok(await page.evaluate(() => document.activeElement.id) === 'card', 'desktop: keyboard open moves focus into the drawer');
    await page.keyboard.press('Escape'); await settle(page);
    ok(await page.evaluate(() => document.getElementById('card').hidden), 'desktop: Esc closes the drawer');
    ok(await page.evaluate(() => document.activeElement.classList.contains('item')), 'desktop: focus returns to the list row that opened it');
    // menus
    await page.click('#gear'); ok(await page.evaluate(() => !document.getElementById('settings').hidden && document.getElementById('gear').getAttribute('aria-expanded') === 'true'), 'desktop: gear opens settings');
    await page.keyboard.press('Escape'); ok(await page.evaluate(() => document.getElementById('settings').hidden && document.activeElement.id === 'gear'), 'desktop: Esc closes settings and returns focus to the gear');
    await page.click('#jumpbtn'); ok(await page.evaluate(() => !document.getElementById('jump').hidden), 'desktop: Jump to opens');
    await page.keyboard.press('Escape'); ok(await page.evaluate(() => document.getElementById('jump').hidden && document.activeElement.id === 'jumpbtn'), 'desktop: Esc closes Jump to and returns focus');
    // settings persist
    await page.click('#gear');
    await page.click('#settings [data-set=theme] [data-v=dark]'); await page.click('#settings [data-set=size] [data-v=l]'); await page.click('#settings [data-set=calm]'); await page.click('#settings [data-set=pad]');
    ok(await page.evaluate(() => document.documentElement.dataset.theme === 'dark' && getComputedStyle(document.documentElement).fontSize === '18px' && document.documentElement.classList.contains('calm') && getComputedStyle(document.getElementById('pad')).display === 'grid'), 'desktop: theme, text size, calm mode and move pad apply');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('reston-map-ui'))); ok(saved && saved.theme === 'dark' && saved.size === 'l' && saved.calm === true && saved.pad === true, 'desktop: stored in localStorage reston-map-ui');
    await page.reload(); await page.waitForTimeout(2000);
    ok(await page.evaluate(() => document.documentElement.dataset.theme === 'dark' && getComputedStyle(document.documentElement).fontSize === '18px' && document.documentElement.classList.contains('calm') && getComputedStyle(document.getElementById('pad')).display === 'grid'), 'desktop: settings persist after reload');
    ok(await page.evaluate(() => !document.querySelector('#list .item .m') || getComputedStyle(document.querySelector('#list .item .m')).display === 'none'), 'desktop: calm mode trims row details');
    await page.click('#gear'); await page.click('#settings [data-set=theme] [data-v=auto]'); await page.click('#settings [data-set=size] [data-v=m]'); await page.click('#settings [data-set=calm]'); await page.click('#settings [data-set=pad]');
    ok(await page.evaluate(() => !document.documentElement.dataset.theme && getComputedStyle(document.documentElement).fontSize === '16px'), 'desktop: Auto theme and M text restore');
    ok(page.errs.length === 0, `desktop: no console errors ${page.errs.slice(0, 2).join('|')}`);
    await ctx.close();
  }
  await b.close(); console.log(res.join('\n')); process.exit(res.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
