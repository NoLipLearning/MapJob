// Apply helper test: node tests/apply.js [url]. All profile data below is obviously fake.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const vendor = f => fs.readFileSync(path.join(__dirname, 'vendor', f));
async function stubCdn(ctx) { await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/.*(three\.min|OrbitControls)\.js/, r => r.fulfill({ contentType: 'application/javascript', body: vendor(/OrbitControls/.test(r.request().url()) ? 'OrbitControls.js' : 'three.min.js') })); }
const url = process.argv[2] || 'http://localhost:8765/reston-hiring-map.html';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const FAKE_PROFILE = { name: 'Test Person Zzyzx', education: [{ school: 'Fake State University', degree: 'BA', major: 'Political Science' }], experience: [{ title: 'Fake Intern', org: 'Imaginary Institute', bullets: ['Wrote ZZ-briefing memos'] }], skills: { technical: ['Stata'], software: [], languages: ['Spanish'], methods: [], soft: [] }, writing_sample: { title: 'Fake Policy Memo' }, synopsis_60_words: 'UNKNOWN', gaps_or_questions: ['Which GPA should be listed?'] };
const FAKE_CLOUD = `(() => { const docs = window.__DOCS = window.__DOCS || {};
  const col = p => ({ doc: id => ({ set: async d => { docs[p + '/' + id] = JSON.parse(JSON.stringify(d)); }, delete: async () => { delete docs[p + '/' + id]; }, get: async () => ({ exists: (p + '/' + id) in docs, data: () => docs[p + '/' + id] }) }), onSnapshot(n) { setTimeout(() => n({ docChanges: () => [] }), 0); return () => {}; } });
  const caps = { db: { collection: col }, user: { id: async () => 'u1' } };
  window.claude = { use: async n => caps[n] || null }; })();`;

(async () => {
  const browser = await chromium.launch({ args: ARGS }); const fails = [], notes = [];
  const ok = (c, m) => { (c ? notes : fails).push((c ? 'PASS ' : 'FAIL ') + m); };
  async function open(vp, init, ctx0) {
    const ctx = ctx0 || await browser.newContext({ viewport: vp || { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'], hasTouch: !!(vp && vp.width < 500), isMobile: !!(vp && vp.width < 500) });
    if (!ctx0) await stubCdn(ctx);
    const page = await ctx.newPage(); page.errs = [];
    page.on('pageerror', e => page.errs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|favicon|net::ERR/.test(m.text())) page.errs.push('console: ' + m.text()); });
    if (init) await page.addInitScript(init);
    await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(1800); return { ctx, page };
  }
  fs.mkdirSync('test-shots', { recursive: true });
  let { ctx, page } = await open();
  const id = await page.evaluate(() => app.E[0].id);
  await page.evaluate(id => app.select(id, false), id); await page.waitForTimeout(500);
  ok(/Start applying/.test(await page.locator('#apl-open').innerText()), 'card: untracked shows "Start applying"');

  // profile panel
  await page.click('#apl-myprof'); await page.waitForTimeout(200);
  await page.click('#apl-save');
  ok(/Paste your profile first/.test(await page.locator('#apl-err').innerText()), 'profile: empty -> plain message');
  await page.fill('#apl-json', '{ not json'); await page.click('#apl-save');
  ok(/does not read as a profile/.test(await page.locator('#apl-err').innerText()), 'profile: bad JSON -> plain message');
  await page.fill('#apl-json', '{"foo": 1}'); await page.click('#apl-save');
  ok(/does not look like a profile/.test(await page.locator('#apl-err').innerText()), 'profile: wrong shape -> plain message');
  ok(await page.evaluate(() => localStorage.getItem('reston-map-profile')) === null, 'profile: nothing stored from invalid input');
  await page.fill('#apl-json', '```json\n' + JSON.stringify(FAKE_PROFILE) + '\n```'); await page.click('#apl-save'); await page.waitForTimeout(300);
  const txt = await page.locator('.apl-sheet').innerText();
  ok(/still empty/i.test(txt) && /a short summary of you/.test(txt) && /Which GPA/.test(await page.locator('.apl-sheet').innerHTML()), 'profile: shows missing fields and gaps_or_questions');
  await page.screenshot({ path: 'test-shots/apply-1-profile.png' });
  await page.fill('#apl-name', 'Test Person Edited'); await page.fill('#apl-syn', 'I study fake policy.'); await page.fill('#apl-skills', 'Stata, R, Zzfake');
  await page.click('#apl-save'); await page.waitForTimeout(200);
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('reston-map-profile')).profile);
  ok(stored.name === 'Test Person Edited' && stored.synopsis_60_words === 'I study fake policy.' && stored.skills.technical.join() === 'Stata,R,Zzfake' && stored.skills.languages[0] === 'Spanish', 'profile: edits saved, other fields kept');
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1800);
  ok(await page.evaluate(() => app.profile.get() && app.profile.get().name) === 'Test Person Edited', 'profile: persists after reload');

  // start applying + helper
  await page.evaluate(id => app.select(id, false), id); await page.waitForTimeout(500);
  await page.click('#apl-open'); await page.waitForTimeout(200);
  await page.click('#apl-go');
  ok(await page.locator('#apl-err:not([hidden])').count() === 1, 'start: role required');
  await page.fill('#apl-role', 'Research Assistant (fake)'); await page.click('#apl-go'); await page.waitForTimeout(400);
  let rec = (await page.evaluate(id => app.tracker.byEmp(id), id))[0];
  ok(rec && rec.role === 'Research Assistant (fake)' && rec.status === 'applying', 'start: record created via tracker');
  ok(/Next: paste the posting/.test(await page.locator('#apl-ready').innerText()), 'helper: shows what is left');
  await page.screenshot({ path: 'test-shots/apply-2-helper.png' });
  await page.check('[data-mat=coverLetter]'); await page.check('[data-mat=references]'); await page.check('[data-mat=resume]'); await page.waitForTimeout(200);
  rec = (await page.evaluate(id => app.tracker.byEmp(id), id))[0];
  ok(rec.materials.coverLetter === true && rec.materials.references === true && !!rec.materials.resume && rec.materials.writingSample === false, 'checklist writes to tracker materials');
  await page.uncheck('[data-mat=coverLetter]'); await page.waitForTimeout(100);
  ok((await page.evaluate(id => app.tracker.byEmp(id), id))[0].materials.coverLetter === false, 'checklist un-tick writes back');
  await page.fill('#apl-post', 'ZZ-POSTING-TEXT: Analyst needed for fake duties.'); await page.locator('#apl-post').blur(); await page.waitForTimeout(200);
  ok((await page.evaluate(id => app.tracker.byEmp(id), id))[0].postingText.includes('ZZ-POSTING-TEXT'), 'posting text saved on record');
  ok(/Everything's ready\. Copy the prompt, then apply\./.test(await page.locator('#apl-ready').innerText()), 'helper: finish state wording');
  ok(await page.locator('.apl-sheet .btn.primary:visible').count() === 1, 'helper: one primary button');
  await page.click('#apl-copy'); await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const e0 = await page.evaluate(id => { const e = app.E.find(x => x.id === id); return { name: e.name, role0: e.roles[0] }; }, id);
  ok(clip.includes('Test Person Edited') && clip.includes(e0.name) && clip.includes('ZZ-POSTING-TEXT') && clip.includes('Research Assistant (fake)') && (!e0.role0 || clip.includes(e0.role0)), 'copy: prompt has profile + employer + posting');
  ok(/cover letter/i.test(clip) && /three bullets/i.test(clip) && /writing sample/i.test(clip) && /three good questions/i.test(clip) && /do not invent/i.test(clip), 'copy: instruction block present');
  ok(!/__[A-Z_]+__|\{\{|undefined|\[object|null/.test(clip), 'copy: no unreplaced placeholders');
  ok(/Copied/.test(await page.locator('#toast').innerText()), 'copy: toast says Copied');
  // clipboard blocked fallback
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) }, configurable: true }); });
  await page.click('#apl-copy'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => { const t = document.getElementById('apl-fallback'); return !!t && t.readOnly && t.value.includes('ZZ-POSTING-TEXT') && t.selectionEnd - t.selectionStart === t.value.length; }), 'copy: fallback selects text in readonly textarea');
  await page.screenshot({ path: 'test-shots/apply-3-fallback.png' });

  // mark applied
  await page.click('#apl-applied'); await page.waitForTimeout(300);
  rec = (await page.evaluate(id => app.tracker.byEmp(id), id))[0];
  ok(rec.status === 'applied' && /^\d{4}-\d\d-\d\d$/.test(rec.dates.applied), 'mark applied: status and date set');
  ok(/Applied/.test(await page.locator('#toast').innerText()), 'mark applied: wording "Applied"');
  ok(page.errs.length === 0, 'desktop: no console errors ' + page.errs.join('|'));
  await ctx.close();

  // profile button on My applications tab + cloud doc
  ({ ctx, page } = await open(null, FAKE_CLOUD));
  await page.click('#tab-apps'); await page.waitForTimeout(300);
  ok(await page.locator('#apl-tabprof').count() === 1, 'tab: profile button near sync note');
  await page.click('#apl-tabprof'); await page.fill('#apl-json', JSON.stringify(FAKE_PROFILE)); await page.click('#apl-save'); await page.waitForTimeout(400);
  ok(await page.evaluate(() => { const k = Object.keys(window.__DOCS); return k.length === 1 && /^data\/users\/u1\/profile\/mine\/main$/.test(k[0]) && JSON.parse(window.__DOCS[k[0]].json).name === 'Test Person Zzyzx'; }), 'cloud(fake): profile doc written under data/users/u1');
  ok(page.errs.length === 0, 'cloud(fake): no console errors ' + page.errs.join('|'));
  await ctx.close();

  // phone
  ({ ctx, page } = await open({ width: 400, height: 800 }));
  await page.evaluate(p => localStorage.setItem('reston-map-profile', JSON.stringify({ v: 1, updatedAt: new Date().toISOString(), profile: p })), FAKE_PROFILE);
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1800);
  await page.evaluate(id => app.select(id, false), id); await page.waitForTimeout(500);
  await page.locator('#apl-open').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-shots/apply-4-card-phone.png' });
  await page.click('#apl-open'); await page.fill('#apl-role', 'Fake Role'); await page.click('#apl-go'); await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-shots/apply-5-helper-phone.png' });
  const short = await page.evaluate(() => Array.from(document.querySelectorAll('.apl-sheet button,.apl-sheet input:not([type=checkbox]),.apl-sheet select')).filter(n => n.offsetParent && n.getBoundingClientRect().height < 40 && !n.classList.contains('sm')).length);
  ok(short === 0, 'phone: sheet controls >= 40px (' + short + ' short)');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'phone: no horizontal scroll');
  ok(page.errs.length === 0, 'phone: no console errors ' + page.errs.join('|'));
  await ctx.close();

  await browser.close();
  console.log(notes.concat(fails).join('\n')); process.exit(fails.length ? 1 : 0);
})();
