// 40-reminders: owned by Reminders agent. See BUILD-PLAN.md section 3.
// Follow-up rules that create/refresh tracker nextAction records, plus the calm "Today" panel (max 3 items, no counters).
// Idempotent: a rule writes only when the record would actually change, and events caused by our own writes are ignored.
// Clock: uses new Date(), so tests can override Date. Local-only state (settings, "Not now" hides) lives in localStorage.
PARTS.push(function (app) {
  const esc = app.esc, KEY = "reston-map-reminders", tracker = app.tracker;
  if (!tracker) return;
  const TIMING = Object.assign({ undoMs: 10000, recheckMs: 300000 }, window.RESTON_REMINDERS_TIMING || {});
  const T = { FU1: "Follow up by email", FU2: "Second follow-up, or move on", TY: "Send thank-you note", CI: "Check in if no word", APPLY: "Apply or let it go?" };
  const FOLLOWUPS = [T.FU1, T.FU2, T.TY, T.CI];
  const HOLIDAYS = ["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25", "2027-12-24"];
  const DEFAULTS = { followUpDays: 7, secondDays: 10, checkInDays: 7, staleDays: 14, notNowDays: 30, useHolidays: false, holidays: HOLIDAYS.join("\n") };

  // ---------- local state ----------
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null") || {}; } catch (e) { return {}; } };
  const saved = load();
  const S = { settings: Object.assign({}, DEFAULTS, saved.settings), notNow: saved.notNow || {}, iv: saved.iv || {}, fu: saved.fu || {}, hide: saved.hide || {}, open: typeof saved.open === "boolean" ? saved.open : null };
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* blocked: settings last until reload */ } };

  // ---------- dates (ISO strings, UTC arithmetic so time zones never shift a day) ----------
  const pad = n => String(n).padStart(2, "0");
  const todayISO = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  const parse = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  const fmt = ms => new Date(ms).toISOString().slice(0, 10);
  const addDays = (iso, n) => fmt(parse(iso) + n * 864e5);
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const holidaySet = () => S.settings.useHolidays ? new Set(String(S.settings.holidays || "").split(/[\s,]+/).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x))) : new Set();
  const isBiz = (ms, hs) => { const dow = new Date(ms).getUTCDay(); return dow !== 0 && dow !== 6 && !hs.has(fmt(ms)); };
  function addBD(iso, n) {
    let ms = parse(iso); if (isNaN(ms)) return ""; const hs = holidaySet();
    while (n > 0) { ms += 864e5; if (isBiz(ms, hs)) n--; }
    return fmt(ms);
  }
  const nextBD = iso => addBD(iso, 1);
  const day10 = s => String(s || "").slice(0, 10);
  const fmtDay = iso => new Date(parse(iso)).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

  // ---------- rules ----------
  const emp = id => app.E.find(e => e.id === id);
  const empName = r => (emp(r.empId) || {}).name || r.empId;
  const isOpen = r => r.status !== "closed" && r.nextAction.text && !r.nextAction.doneAt;
  const latestIv = r => (r.dates.interview || []).map(day10).filter(Boolean).sort().pop() || "";
  const pendingUndo = new Set();
  let writing = false;
  function write(appId, patch) { writing = true; try { return tracker.update(appId, patch); } finally { writing = false; } }
  const setNext = (r, text, due) => write(r.appId, { nextAction: { text, due, doneAt: null } });

  // Returns true when it wrote something. One decision per record per call.
  function applyRules(r, today) {
    if (r.status === "closed" || pendingUndo.has(r.appId)) return false;
    const t = r.nextAction.text, done = !!r.nextAction.doneAt, open = !!t && !done, st = S.settings;
    const ours = open && (t === T.FU1 || t === T.FU2 || t === T.APPLY);
    const iv = latestIv(r);
    if (iv && r.status !== "offer") {
      const proc = S.iv[r.appId] || ((t === T.TY || t === T.CI) ? iv : "");
      if (proc < iv && (!open || ours)) { S.iv[r.appId] = iv; persist(); setNext(r, T.TY, nextBD(iv)); return true; }
      if (t === T.TY && done && proc === iv) { S.iv[r.appId] = iv; persist(); setNext(r, T.CI, addBD(iv, +st.checkInDays)); return true; }
      return false;
    }
    if (r.status === "applied" && r.dates.applied) {
      if (t === T.FU1 && done) { S.fu[r.appId] = 1; persist(); setNext(r, T.FU2, addBD(day10(r.nextAction.doneAt) || today, +st.secondDays)); return true; }
      if (!open && t !== T.FU1 && t !== T.FU2 && !S.fu[r.appId]) { S.fu[r.appId] = 1; persist(); setNext(r, T.FU1, addBD(day10(r.dates.applied), +st.followUpDays)); return true; }
      return false;
    }
    if (r.status === "interested" && !r.dates.applied && r.dates.interested && !open && !(t === T.APPLY && done)) {
      if (daysBetween(day10(r.dates.interested), today) > +st.staleDays && (S.notNow[r.appId] || "") <= today) { setNext(r, T.APPLY, today); return true; }
    }
    return false;
  }
  function sync() {
    const today = todayISO(); let did = false;
    tracker.all().forEach(r => { try { if (applyRules(r, today)) did = true; } catch (e) { console.error("[reminders]", e); } });
    return did;
  }

  // ---------- items ----------
  const kindOf = r => r.nextAction.text === T.FU2 ? "second" : r.nextAction.text === T.APPLY ? "apply" : "plain";
  function openItems() {
    return tracker.all().filter(isOpen).map(r => ({ r, due: r.nextAction.due || "" })).filter(x => x.due)
      .sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : empName(a.r).localeCompare(empName(b.r)) || (a.r.appId < b.r.appId ? -1 : 1));
  }
  const dueItems = today => openItems().filter(x => x.due <= today);
  const dueWords = (due, today) => due < today ? "Ready when you are" : "Due today";
  // Today (spec 7): due follow-ups first, then one application in progress, then the best new opening (fit 60+). Never more than 3.
  const hidden = (key, today) => S.hide[key] && S.hide[key] > today;
  function todayItems(today) {
    const out = dueItems(today).slice(0, 3).map(x => ({ kind: "followup", x, appId: x.r.appId }));
    if (out.length < 3) {
      const taken = new Set(out.map(o => o.appId));
      const ip = tracker.all().filter(r => r.status === "applying" && !taken.has(r.appId) && !hidden("ip:" + r.appId, today))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
      if (ip) out.push({ kind: "inprogress", r: ip, appId: ip.appId, text: "Finish applying to " + empName(ip), sub: ip.role || "" });
    }
    if (out.length < 3 && app.jobs) {
      const j = app.jobs.all().filter(j => j.status === "new" && j.fit != null && j.fit >= 60 && !hidden("job:" + j.id, today)).sort((a, b) => b.fit - a.fit)[0];
      if (j) out.push({ kind: "newjob", j, text: "Look at: " + j.title + (j.employer ? " at " + j.employer : ""), sub: "Fit " + j.fit + (j.fitWhy && j.fitWhy[0] ? " · " + j.fitWhy[0] : "") });
    }
    return out;
  }

  // ---------- actions ----------
  const snap = r => ({ nextAction: Object.assign({}, r.nextAction), dates: { lastContact: r.dates.lastContact }, status: r.status, closedReason: r.closedReason });
  function restore(appId, s) {
    write(appId, { status: s.status, closedReason: s.closedReason });
    write(appId, { nextAction: s.nextAction, dates: s.dates });
  }
  function holdUndo(appId, ms) { pendingUndo.add(appId); const id = setTimeout(() => { pendingUndo.delete(appId); if (sync()) render(); }, ms); return () => { clearTimeout(id); pendingUndo.delete(appId); }; }
  function act(appId, what, days) {
    const r = tracker.get(appId); if (!r || !isOpen(r)) return;
    const name = empName(r), text = r.nextAction.text, prev = snap(r), today = todayISO();
    let msg, extra = null, release = null;
    if (what === "done") {
      const patch = { nextAction: { doneAt: new Date().toISOString() } };
      if (FOLLOWUPS.includes(text) || /follow|email|thank|check in|reach out/i.test(text)) patch.dates = { lastContact: today };
      release = holdUndo(appId, TIMING.undoMs); write(appId, patch); msg = "Done: " + text + " (" + name + ")";
    } else if (what === "snooze") {
      write(appId, { nextAction: { due: addDays(today, days) } }); msg = "Snoozed " + (days === 2 ? "2 days" : "1 week") + ": " + text + " (" + name + ")";
    } else if (what === "close") {
      write(appId, { status: "closed", closedReason: "no-response", nextAction: { doneAt: new Date().toISOString() } }); msg = "Closed as no response: " + name;
    } else if (what === "start") {
      write(appId, { status: "applying", nextAction: { text: "", due: "", doneAt: null } }); msg = "Started applying: " + name;
    } else if (what === "notnow") {
      const had = S.notNow[appId]; S.notNow[appId] = addDays(today, +S.settings.notNowDays); persist();
      write(appId, { nextAction: { text: "", due: "", doneAt: null } }); msg = "Not now: " + name + ". Back in a month.";
      extra = () => { if (had) S.notNow[appId] = had; else delete S.notNow[appId]; persist(); };
    } else return;
    app.toast(msg, { ms: TIMING.undoMs, undo: () => { if (release) release(); restore(appId, prev); if (extra) extra(); render(); } });
    if (what !== "done") sync();
    render();
  }

  // ---------- ICS ----------
  const icsEsc = s => String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  function fold(line) { // 75 octets per line, continuation lines start with one space
    const out = [], enc = new TextEncoder(); let cur = "", n = 0;
    for (const ch of line) { const b = enc.encode(ch).length; if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; n = 0; } cur += ch; n += b; }
    out.push(cur); return out.join("\r\n ");
  }
  function buildICS() {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""), link = /^https?:/.test(location.href) ? location.href.split("#")[0] : "";
    const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Reston Hiring Map//Reminders//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    openItems().forEach(({ r, due }) => {
      L.push("BEGIN:VEVENT", "UID:" + r.appId + "@reston-hiring-map", "DTSTAMP:" + stamp,
        "DTSTART;VALUE=DATE:" + due.replace(/-/g, ""), "DTEND;VALUE=DATE:" + addDays(due, 1).replace(/-/g, ""),
        "SUMMARY:" + icsEsc(r.nextAction.text + " - " + empName(r)),
        "DESCRIPTION:" + icsEsc((r.role ? "Role: " + r.role + "\n" : "") + (link ? "Open the map: " + link : "Reston Hiring Map")));
      if (link) L.push("URL:" + link);
      L.push("END:VEVENT");
    });
    L.push("END:VCALENDAR"); return L.map(fold).join("\r\n") + "\r\n";
  }
  async function download(filename, data, mime) {
    try { if (typeof claude !== "undefined" && claude && claude.use) { const dl = await claude.use("downloads"); if (dl) { await dl.save({ filename, data }); return; } } } catch (e) { if (e && e.code === "declined") return; }
    const a = document.createElement("a"), url = URL.createObjectURL(new Blob([data], { type: mime }));
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // ---------- panel ----------
  let root = document.getElementById("today");
  if (!root) { root = document.createElement("div"); root.id = "today"; const tabs = document.getElementById("tabs"); if (tabs && tabs.parentNode) tabs.parentNode.insertBefore(root, tabs); else document.body.appendChild(root); }
  let weekView = false, snoozeFor = null, msgText = "", focusKey = null;

  function itemHTML(x, today) {
    const r = x.r, k = kindOf(r), id = esc(r.appId);
    const first = k === "second" ? "Sent it" : k === "apply" ? "Start applying" : "Done";
    const second = k === "second" ? ["close", "Close as no response"] : k === "apply" ? ["notnow", "Not now (hide 30 days)"] : null;
    return `<li class="rem-item" data-app="${id}"><div class="rem-what"><b>${esc(r.nextAction.text)}</b><span>${esc(empName(r))}${r.role ? " · " + esc(r.role) : ""}</span><span class="rem-when">${dueWords(x.due, today)}</span></div>
      <div class="rem-acts"><button type="button" class="btn sm primary" data-act="${k === "apply" ? "start" : "done"}" data-id="${id}">${first}</button>
      <button type="button" class="btn sm" data-snz="${id}" aria-expanded="${snoozeFor === r.appId}">Snooze</button>
      <button type="button" class="btn sm" data-open="${esc(r.empId)}">Open</button></div>
      ${snoozeFor === r.appId ? `<div class="rem-snz" role="group" aria-label="Snooze for"><button type="button" class="btn sm" data-act="snooze2" data-id="${id}">2 days</button><button type="button" class="btn sm" data-act="snooze7" data-id="${id}">1 week</button>${second ? `<button type="button" class="btn sm" data-act="${second[0]}" data-id="${id}">${second[1]}</button>` : ""}</div>` : ""}</li>`;
  }
  function extraHTML(it) {
    const key = it.kind === "inprogress" ? "ip:" + it.appId : "job:" + it.j.id, k = esc(key);
    const acts = it.kind === "inprogress"
      ? `<button type="button" class="btn sm primary" data-ipopen="${esc(it.appId)}" data-emp="${esc(it.r.empId)}">Open</button><button type="button" class="btn sm" data-snz="${k}" aria-expanded="${snoozeFor === key}">Snooze</button>`
      : `<button type="button" class="btn sm primary" data-jopen="${esc(it.j.id)}">Open</button><button type="button" class="btn sm" data-jsave="${esc(it.j.id)}">Save</button><button type="button" class="btn sm" data-jdis="${esc(it.j.id)}">Not for me</button>`;
    return `<li class="rem-item" data-key="${k}"><div class="rem-what"><b>${esc(it.text)}</b><span>${esc(it.sub)}</span></div><div class="rem-acts">${acts}</div>
      ${snoozeFor === key ? `<div class="rem-snz" role="group" aria-label="Snooze for"><button type="button" class="btn sm" data-hide="${k}" data-days="2">2 days</button><button type="button" class="btn sm" data-hide="${k}" data-days="7">1 week</button></div>` : ""}</li>`;
  }
  function weekHTML(today) {
    const end = addDays(today, 7), groups = {};
    openItems().filter(x => x.due <= end).forEach(x => { const k = x.due <= today ? "ready" : x.due; (groups[k] = groups[k] || []).push(x); });
    const keys = Object.keys(groups).sort((a, b) => a === "ready" ? -1 : b === "ready" ? 1 : a < b ? -1 : 1);
    if (!keys.length) return `<p class="kit-note">Nothing planned for the next 7 days.</p>`;
    return keys.map(k => `<section class="rem-day"><h4>${k === "ready" ? "Ready when you are" : fmtDay(k)}</h4><ul class="rem-list">${groups[k].map(x => `<li class="rem-item rem-lite"><div class="rem-what"><b>${esc(x.r.nextAction.text)}</b><span>${esc(empName(x.r))}</span></div><button type="button" class="btn sm" data-open="${esc(x.r.empId)}">Open</button></li>`).join("")}</ul></section>`).join("");
  }
  function settingsHTML() {
    const s = S.settings, n = (id, label, v) => `<label class="field"><span>${label}</span><input type="number" min="1" max="90" id="${id}" value="${+v}"></label>`;
    return `<details class="rem-set"><summary>Reminder settings</summary>
      ${n("rs-fu", "First follow-up after applying (business days)", s.followUpDays)}${n("rs-second", "Second follow-up after that (business days)", s.secondDays)}
      ${n("rs-ci", "Check in after an interview (business days)", s.checkInDays)}${n("rs-stale", "Ask about an interest after (days)", s.staleDays)}${n("rs-nn", "\"Not now\" hides for (days)", s.notNowDays)}
      <label class="field rem-chk"><span><input type="checkbox" id="rs-hol" ${s.useHolidays ? "checked" : ""}> Skip US federal holidays</span></label>
      <label class="field"><span>Holiday dates (YYYY-MM-DD, one per line)</span><textarea id="rs-list" rows="4">${esc(s.holidays)}</textarea></label>
      <div class="btn-row"><button type="button" class="btn sm primary" id="rs-save">Save settings</button><button type="button" class="btn sm quiet" id="rs-reset">Use defaults</button></div></details>`;
  }
  function render() {
    const today = todayISO(), due = dueItems(today), items = todayItems(today), hasDue = items.length > 0;
    const isOpenPanel = S.open === null ? hasDue : S.open;
    const settingsOpen = !!root.querySelector(".rem-set[open]");
    let body = "";
    if (weekView) body += weekHTML(today);
    else if (hasDue) body += `<ul class="rem-list">${items.map(it => it.kind === "followup" ? itemHTML(it.x, today) : extraHTML(it)).join("")}</ul>` + (due.length > 3 ? `<p class="kit-note">Take these first. The rest will wait for you.</p>` : "");
    else body += `<p class="rem-clear"><span aria-hidden="true">✓</span> All caught up for today</p>`;
    body += `<div class="rem-foot"><button type="button" class="btn sm" id="rem-week" aria-pressed="${weekView}">This week</button><button type="button" class="btn sm" id="rem-ics">Add to my calendar</button></div>
      <p class="kit-note" id="rem-msg" role="status">${esc(msgText)}</p>${settingsHTML()}`;
    root.innerHTML = `<details class="rem" ${isOpenPanel ? "open" : ""}><summary id="rem-sum"><span class="rem-title">Today</span><span class="rem-state">${hasDue ? "A few things when you are ready" : "All caught up for today ✓"}</span></summary><div class="rem-body">${body}</div></details>`;
    if (settingsOpen) root.querySelector(".rem-set").open = true;
    bind();
    if (focusKey) { const el = root.querySelector(focusKey) || root.querySelector("#rem-sum"); if (el) el.focus(); focusKey = null; }
  }
  function bind() {
    const q = s => root.querySelector(s), qa = s => root.querySelectorAll(s);
    q("#rem-sum").onclick = ev => { ev.preventDefault(); const cur = q("details.rem").hasAttribute("open"); S.open = !cur; persist(); focusKey = "#rem-sum"; render(); };
    qa("[data-open]").forEach(b => b.onclick = () => app.select(b.dataset.open, true));
    qa("[data-ipopen]").forEach(b => b.onclick = () => { if (app.apply && app.apply.open) app.apply.open(b.dataset.emp, b.dataset.ipopen); else app.select(b.dataset.emp, true); });
    qa("[data-jopen]").forEach(b => b.onclick = () => app.jobs && app.jobs.open(b.dataset.jopen));
    qa("[data-jsave]").forEach(b => b.onclick = () => { focusKey = "#rem-sum"; app.jobs.setStatus(b.dataset.jsave, "saved"); });
    qa("[data-jdis]").forEach(b => b.onclick = () => { focusKey = "#rem-sum"; app.jobs.setStatus(b.dataset.jdis, "dismissed"); });
    qa("[data-hide]").forEach(b => b.onclick = () => { S.hide[b.dataset.hide] = addDays(todayISO(), +b.dataset.days); persist(); snoozeFor = null; focusKey = "#rem-sum"; msgText = "Snoozed. It will be back in " + (b.dataset.days === "2" ? "2 days." : "a week."); render(); });
    qa("[data-snz]").forEach(b => b.onclick = () => { snoozeFor = snoozeFor === b.dataset.snz ? null : b.dataset.snz; focusKey = '[data-snz="' + b.dataset.snz + '"]'; render(); });
    qa("[data-act]").forEach(b => b.onclick = () => {
      const w = b.dataset.act; snoozeFor = null; focusKey = "#rem-sum";
      act(b.dataset.id, w === "snooze2" || w === "snooze7" ? "snooze" : w, w === "snooze2" ? 2 : 7);
    });
    q("#rem-week").onclick = () => { weekView = !weekView; focusKey = "#rem-week"; render(); };
    q("#rem-ics").onclick = async () => {
      if (!openItems().length) { msgText = "Nothing to add yet."; render(); return; }
      await download("reston-follow-ups.ics", buildICS(), "text/calendar"); msgText = "Calendar file saved. Import it into your calendar app."; focusKey = "#rem-ics"; render();
    };
    q("#rs-save").onclick = () => {
      const v = id => Math.max(1, Math.min(90, parseInt(q(id).value, 10) || 1));
      S.settings = { followUpDays: v("#rs-fu"), secondDays: v("#rs-second"), checkInDays: v("#rs-ci"), staleDays: v("#rs-stale"), notNowDays: v("#rs-nn"), useHolidays: q("#rs-hol").checked, holidays: q("#rs-list").value };
      persist(); msgText = "Settings saved. They apply to new reminders."; render();
    };
    q("#rs-reset").onclick = () => { S.settings = Object.assign({}, DEFAULTS); persist(); msgText = "Back to the defaults."; render(); };
  }

  // ---------- employer card: the two-choice actions also live on the card ----------
  app.hooks.card.push(e => {
    const rs = tracker.byEmp(e.id).filter(r => isOpen(r) && (kindOf(r) === "second" || kindOf(r) === "apply"));
    if (!rs.length) return null;
    const html = `<section class="kit-sec rem-card" aria-label="Next step"><h3><span>Next step</span></h3>${rs.map(r => {
      const k = kindOf(r), a = k === "second" ? [["done", "Sent it"], ["close", "Close as no response"]] : [["start", "Start applying"], ["notnow", "Not now"]];
      return `<div class="rem-cardrow"><b>${esc(r.nextAction.text)}</b><span class="kit-note">${esc(r.role || "")}</span><div class="btn-row">${a.map(x => `<button type="button" class="btn sm" data-ract="${x[0]}" data-rid="${esc(r.appId)}">${x[1]}</button>`).join("")}</div></div>`;
    }).join("")}</section>`;
    return { slot: "top", html, bind(card) { card.querySelectorAll("[data-ract]").forEach(b => b.onclick = () => act(b.dataset.rid, b.dataset.ract)); } };
  });

  // ---------- wiring ----------
  app.on("tracker-changed", () => { if (writing) return; sync(); render(); });
  app.on("jobs-changed", () => render());
  render();
  Promise.resolve(tracker.ready).then(() => { sync(); render(); });
  setInterval(() => { sync(); render(); }, TIMING.recheckMs);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { sync(); render(); } });
  app.reminders = { sync, render, addBD, nextBD, buildICS, todayItems, items: () => openItems().map(x => ({ appId: x.r.appId, text: x.r.nextAction.text, due: x.due })), settings: () => Object.assign({}, S.settings), TEXT: T };
});
