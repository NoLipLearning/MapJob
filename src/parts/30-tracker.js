// 30-tracker: owned by Agent T (tracker). See BUILD-PLAN.md section 2.3.
// Exposes app.tracker (storage + API), the "Track this" card section, the "My applications" tab, map marker dots and backup/restore.
// Storage: cloud `db` + `user` capabilities when published (private path data/users/<id>/...), always mirrored to localStorage.
PARTS.push(function (app) {
  const esc = app.esc, KEY = "reston-map-tracker";
  const ORDER = ["interested", "applying", "applied", "interviewing", "offer", "closed"];
  const WORD = { star: "Starred", interested: "Interested", applying: "Applying", applied: "Applied", interviewing: "Interviewing", offer: "Offer", closed: "Closed" };
  const GLYPH = { star: "★", interested: "○", applying: "…", applied: "✓", interviewing: "»", offer: "+", closed: "–" };
  const REASON = { rejected: "Not selected", withdrew: "I withdrew", "no-response": "No response", accepted: "Accepted", "not-a-fit": "Not a fit" };
  const NEXT_TEXT = { interested: "Read the posting", applying: "Send your application", applied: "Follow up if you hear nothing", interviewing: "Send a thank-you note", offer: "Reply to the offer" };
  const ADV = { interested: ["applying", "Mark Applying"], applying: ["applied", "Mark Applied"], applied: ["interviewing", "Mark Interviewing"], interviewing: ["offer", "Mark Offer"], offer: ["closed", "Accepted"], closed: ["reopen", "Reopen"] };
  const TIMING = Object.assign({ timeout: 10000, retry: 15000, flushRetry: 15000 }, window.RESTON_TRACKER_TIMING || {});

  // ---------- helpers ----------
  const nowISO = () => new Date().toISOString();
  const todayISO = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const clone = o => JSON.parse(JSON.stringify(o));
  const emp = id => app.E.find(e => e.id === id);
  const lsGet = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } };
  const lsSet = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* storage blocked: cloud/in-memory still work */ } };

  function normalize(r) {
    r = r || {};
    const st = ORDER.includes(r.status) ? r.status : "interested", d = r.dates || {}, n = r.nextAction || {}, m = r.materials || {};
    return {
      appId: String(r.appId || uuid()), empId: String(r.empId || ""), role: String(r.role || ""), postingUrl: String(r.postingUrl || ""),
      status: st, closedReason: st === "closed" && REASON[r.closedReason] ? r.closedReason : null,
      dates: { interested: d.interested || "", applied: d.applied || "", lastContact: d.lastContact || "", interview: Array.isArray(d.interview) ? d.interview.slice() : [] },
      nextAction: { text: String(n.text || ""), due: n.due || "", doneAt: n.doneAt || null },
      materials: { resume: m.resume || "", coverLetter: !!m.coverLetter, writingSample: !!m.writingSample, references: !!m.references, transcript: !!m.transcript }, postingText: String(r.postingText || ""),
      contacts: Array.isArray(r.contacts) ? r.contacts.map(c => ({ name: c.name || "", role: c.role || "", how: c.how || "", note: c.note || "" })) : [],
      clearanceSponsor: !!r.clearanceSponsor, notes: String(r.notes || ""),
      createdAt: r.createdAt || nowISO(), updatedAt: r.updatedAt || nowISO()
    };
  }

  // ---------- state ----------
  const apps = new Map(), stars = new Map(), pend = {}; // pend: "a:<id>" | "s:<empId>" -> "set" | "del"
  let state = "device", cloud = null, flushing = false, flushTimer = null;
  const remoteJson = {};
  (function loadLocal() {
    const s = lsGet(); if (!s) return;
    (s.apps || []).forEach(r => { const n = normalize(r); if (n.empId) apps.set(n.appId, n); });
    Object.keys(s.stars || {}).forEach(k => { if (s.stars[k] && s.stars[k].starred) stars.set(k, { starred: true, updatedAt: s.stars[k].updatedAt || nowISO() }); });
    Object.assign(pend, s.pend || {});
  })();
  const persist = () => { const st = {}; stars.forEach((v, k) => { st[k] = v; }); lsSet({ v: 1, apps: Array.from(apps.values()), stars: st, pend }); };
  function changed(reason, noFlush) {
    persist();
    app.emit("tracker-changed", { reason: reason || "local" });
    try { app.refresh(); } catch (e) { /* core not started yet */ }
    if (!noFlush) flush();
  }

  // ---------- cloud ----------
  const unsubs = [];
  // Collections. data/users/<id>/apps/<appId> (the plan's path) has 5 segments, which is a collection path, not a document path,
  // so one extra segment ("mine") keeps the shape valid: collection data/users/<id>/apps/mine, document <appId>. Still inside the private data/users/<id> subtree.
  const pathApps = uid => "data/users/" + uid + "/apps/mine";
  const pathStars = uid => "data/users/" + uid + "/stars/mine";
  const starVal = v => ({ starred: true, updatedAt: v.updatedAt });
  function applySnap(snap, kind, first) {
    let did = false; const seen = new Set(), map = kind === "a" ? apps : stars;
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id, key = kind + ":" + id;
      if (ch.type === "removed") { delete remoteJson[key]; if (pend[key] !== "set" && map.has(id)) { map.delete(id); did = true; } return; }
      seen.add(id); const raw = ch.doc.data() || {};
      const r = kind === "a" ? normalize(raw) : starVal(raw);
      remoteJson[key] = JSON.stringify(r);
      if (pend[key] === "del") return;
      if (kind === "s" && raw.starred === false) { if (map.has(id) && pend[key] !== "set") { map.delete(id); did = true; } return; }
      const l = map.get(id);
      if (!l || (r.updatedAt || "") > (l.updatedAt || "")) { map.set(id, r); delete pend[key]; did = true; }
      else if ((l.updatedAt || "") > (r.updatedAt || "")) pend[key] = "set";
      else delete pend[key];
    });
    if (first) map.forEach((v, id) => { if (!seen.has(id)) pend[kind + ":" + id] = "set"; });
    return did;
  }
  function connect(isRetry) {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMING.timeout));
    const attempt = (async () => {
      const db = await claude.use("db"), user = await claude.use("user");
      if (!db || !user) return "none";
      const uid = await user.id(); if (!uid) return "none";
      cloud = { db, uid };
      await new Promise((res, rej) => {
        let got = 0;
        const one = kind => { let first = true; return snap => { const did = applySnap(snap, kind, first); if (first) { first = false; got++; } if (did) changed("sync", true); if (got === 2) res(); flush(); }; };
        const bad = e => rej(e || new Error("db error"));
        unsubs.push(db.collection(pathApps(uid)).onSnapshot(one("a"), bad));
        unsubs.push(db.collection(pathStars(uid)).onSnapshot(one("s"), bad));
      });
      return "cloud";
    })();
    return Promise.race([attempt, timeout]).then(r => r, () => "timeout").then(r => {
      if (r === "cloud") state = "cloud";
      else { unsubs.splice(0).forEach(u => { try { u(); } catch (e) { } }); cloud = null; state = "device"; if (r === "timeout" && !isRetry) setTimeout(() => connect(true), TIMING.retry); }
      changed("sync"); return state;
    });
  }
  async function flush() {
    if (state !== "cloud" || !cloud || flushing) return; flushing = true;
    try {
      for (let key = Object.keys(pend)[0]; key; key = Object.keys(pend)[0]) {
        const op = pend[key], kind = key[0], id = key.slice(2), uid = cloud.uid;
        const ref = cloud.db.collection(kind === "a" ? pathApps(uid) : pathStars(uid)).doc(id);
        const val = kind === "a" ? apps.get(id) : stars.get(id);
        if (op === "del" || !val) { if (remoteJson[key] !== undefined || op === "del") await ref.delete(); delete remoteJson[key]; }
        else {
          const out = kind === "a" ? clone(val) : starVal(val), js = JSON.stringify(out);
          if (remoteJson[key] !== js) { await ref.set(out); remoteJson[key] = js; }
        }
        if (pend[key] === op || !pend[key]) delete pend[key];
        else if (pend[key] !== op) { /* changed while writing: loop picks it up again */ }
        persist();
      }
    } catch (e) { clearTimeout(flushTimer); flushTimer = setTimeout(() => { flushTimer = null; flush(); }, TIMING.flushRetry); }
    flushing = false;
  }

  // ---------- API ----------
  const rankOf = s => ORDER.indexOf(s);
  function stamp(r, to) {
    const t = todayISO(); r.dates = r.dates || {};
    if (!r.dates.interested) r.dates.interested = t;
    if (to === "applied" && !r.dates.applied) r.dates.applied = t;
    if (to === "applied" || to === "interviewing" || to === "offer") r.dates.lastContact = t;
    if (to === "interviewing") { r.dates.interview = r.dates.interview || []; if (!r.dates.interview.includes(t)) r.dates.interview.push(t); }
    if (to !== "closed") r.closedReason = null;
  }
  function put(r, bump) {
    r = normalize(r); if (!r.empId) throw new Error("empId required");
    if (bump) r.updatedAt = nowISO(); apps.set(r.appId, r); pend["a:" + r.appId] = "set"; changed("app"); return clone(r);
  }
  const tracker = {
    ready: null, syncState: () => state,
    all: () => Array.from(apps.values()).map(clone),
    byEmp: id => Array.from(apps.values()).filter(r => r.empId === id).sort((a, b) => a.createdAt < b.createdAt ? -1 : 1).map(clone),
    get: id => apps.has(id) ? clone(apps.get(id)) : null,
    upsert(rec) {
      rec = rec || {}; const ex = rec.appId && apps.get(rec.appId);
      const r = normalize(Object.assign({}, ex || {}, rec, { dates: Object.assign({}, ex && ex.dates, rec.dates), nextAction: Object.assign({}, ex && ex.nextAction, rec.nextAction) }));
      if (!ex) { r.createdAt = nowISO(); stamp(r, r.status); } else if (ex.status !== r.status) stamp(r, r.status);
      return put(r, true);
    },
    update(appId, patch) {
      const ex = apps.get(appId); if (!ex) return null; patch = patch || {};
      const r = clone(ex);
      Object.keys(patch).forEach(k => { if (k === "dates" || k === "nextAction" || k === "materials") r[k] = Object.assign({}, r[k], patch[k]); else if (k !== "appId") r[k] = patch[k]; });
      if (patch.status && patch.status !== ex.status) stamp(r, patch.status);
      return put(r, true);
    },
    remove(appId) { if (!apps.has(appId)) return; apps.delete(appId); pend["a:" + appId] = "del"; changed("app"); },
    star(empId, on) {
      if (!!on === stars.has(empId)) return;
      if (on) stars.set(empId, { starred: true, updatedAt: nowISO() }); else stars.delete(empId);
      pend["s:" + empId] = on ? "set" : "del"; changed("star");
    },
    isStarred: id => stars.has(id),
    statusOf(id) {
      const rs = Array.from(apps.values()).filter(r => r.empId === id);
      if (rs.length) { const act = rs.filter(r => r.status !== "closed"); return act.length ? act.map(r => r.status).sort((a, b) => rankOf(b) - rankOf(a))[0] : "closed"; }
      return stars.has(id) ? "star" : null;
    },
    // backup helpers (also used by tests)
    exportJSON: () => JSON.stringify({ app: "reston-hiring-map", version: 1, exportedAt: nowISO(), apps: tracker.all(), stars: Array.from(stars.keys()) }, null, 2),
    exportCSV() {
      const cols = ["employer", "role", "status", "closedReason", "interested", "applied", "lastContact", "nextAction", "due", "postingUrl", "notes", "updatedAt", "appId", "empId"];
      const q = v => { v = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const rows = tracker.all().map(r => [(emp(r.empId) || {}).name || r.empId, r.role, r.status, r.closedReason || "", r.dates.interested, r.dates.applied, r.dates.lastContact, r.nextAction.text, r.nextAction.due, r.postingUrl, r.notes, r.updatedAt, r.appId, r.empId]);
      return [cols].concat(rows).map(r => r.map(q).join(",")).join("\r\n") + "\r\n";
    },
    importJSON(text) {
      let j; try { j = JSON.parse(text); } catch (e) { throw new Error("That file is not a backup JSON."); }
      const list = Array.isArray(j) ? j : j && j.apps; if (!Array.isArray(list)) throw new Error("No applications found in that file.");
      let added = 0, updated = 0;
      list.forEach(raw => {
        if (!raw || !raw.empId) return; const r = normalize(raw), l = apps.get(r.appId);
        if (!l) { apps.set(r.appId, r); pend["a:" + r.appId] = "set"; added++; }
        else if ((r.updatedAt || "") > (l.updatedAt || "")) { apps.set(r.appId, r); pend["a:" + r.appId] = "set"; updated++; }
      });
      (j && Array.isArray(j.stars) ? j.stars : []).forEach(id => { if (typeof id === "string" && !stars.has(id)) { stars.set(id, { starred: true, updatedAt: nowISO() }); pend["s:" + id] = "set"; added++; } });
      changed("import"); return { added, updated };
    }
  };
  app.tracker = tracker;
  if (typeof claude !== "undefined" && claude && typeof claude.use === "function") { state = "loading"; tracker.ready = connect(false); } else tracker.ready = Promise.resolve("device");

  // ---------- download ----------
  async function download(filename, data, mime) {
    try { if (typeof claude !== "undefined" && claude && claude.use) { const dl = await claude.use("downloads"); if (dl) { await dl.save({ filename, data }); return; } } } catch (e) { if (e && e.code === "declined") return; }
    const a = document.createElement("a"), url = URL.createObjectURL(new Blob([data], { type: mime }));
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // ---------- markers + rows ----------
  const cssColor = st => (getComputedStyle(document.documentElement).getPropertyValue("--st-" + st) || "").trim() || "#2c6bb5";
  app.hooks.markers.push(e => { const s = tracker.statusOf(e.id); return s ? { color: cssColor(s), glyph: GLYPH[s], pos: "tr" } : null; });
  const pill = s => `<span class="pill st-${s}"><span aria-hidden="true">${GLYPH[s]}</span>${WORD[s]}</span>`;
  app.hooks.row.push(e => { const s = tracker.statusOf(e.id); return s ? `<span class="s trk-rowpill">${pill(s)}</span>` : ""; });

  // ---------- wording ----------
  const fmtDate = iso => { if (!iso) return ""; const d = new Date(iso + "T12:00:00"); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
  function nextLine(r) {
    if (r.status === "closed") return r.closedReason ? REASON[r.closedReason] : "Closed";
    const t = r.nextAction.text || NEXT_TEXT[r.status] || "";
    let due = ""; if (r.nextAction.due) due = r.nextAction.due < todayISO() ? "Ready when you are" : "Due " + fmtDate(r.nextAction.due);
    return t + (due ? " · " + due : "");
  }

  // ---------- status changes ----------
  function setStatus(r, to, reason) {
    const prev = tracker.get(r.appId), res = tracker.update(r.appId, { status: to, closedReason: reason || null });
    app.toast("Marked " + WORD[to] + " for " + ((emp(r.empId) || {}).name || "this employer") + ".", { undo: () => put(prev, true) });
    return res;
  }
  function advance(r) {
    const a = ADV[r.status];
    if (a[0] === "reopen") return setStatus(r, r.dates.applied ? "applied" : "interested");
    if (a[0] === "closed") return setStatus(r, "closed", "accepted");
    return setStatus(r, a[0]);
  }

  // ---------- sheet ----------
  let sheetEl = null, sheetFrom = null;
  function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; if (sheetFrom && document.contains(sheetFrom)) sheetFrom.focus(); sheetFrom = null; } }
  function openSheet(empId, appId) {
    closeSheet(); sheetFrom = document.activeElement;
    const e = emp(empId), r = appId ? tracker.get(appId) : null, editing = !!r;
    const back = document.createElement("div"); back.className = "sheet-back";
    const v = r || normalize({ empId });
    back.innerHTML = `<div class="sheet trk-sheet" role="dialog" aria-modal="true" aria-labelledby="trk-h"><h2 id="trk-h">${editing ? "Edit application" : "Track this"}</h2>
      <p class="kit-note" style="margin-top:0">${esc(e ? e.name : empId)}</p>
      <label class="field"><span>Role (required)</span><input type="text" id="trk-role" value="${esc(v.role)}" autocomplete="off" placeholder="Research Assistant, Foreign Policy"></label>
      <label class="field"><span>Posting link (optional)</span><input type="url" id="trk-url" value="${esc(v.postingUrl)}" placeholder="https://"></label>
      <label class="field"><span>Status</span><select id="trk-status">${ORDER.map(s => `<option value="${s}" ${v.status === s ? "selected" : ""}>${WORD[s]}</option>`).join("")}</select></label>
      <label class="field" id="trk-reasonf" ${v.status === "closed" ? "" : "hidden"}><span>Why closed</span><select id="trk-reason"><option value="">Not sure</option>${Object.keys(REASON).map(k => `<option value="${k}" ${v.closedReason === k ? "selected" : ""}>${esc(REASON[k])}</option>`).join("")}</select></label>
      <label class="field"><span>Next step (optional)</span><input type="text" id="trk-next" value="${esc(v.nextAction.text)}" placeholder="${esc(NEXT_TEXT[v.status] || "Email the recruiter")}"></label>
      <label class="field"><span>Do it by (optional)</span><input type="date" id="trk-due" value="${esc(v.nextAction.due)}"></label>
      <details class="trk-more"><summary>More details</summary>
        <label class="field"><span>Notes</span><textarea id="trk-notes">${esc(v.notes)}</textarea></label>
        <label class="field trk-check"><span><input type="checkbox" id="trk-clear" ${v.clearanceSponsor ? "checked" : ""}> Sponsors a security clearance</span></label></details>
      <p class="kit-note" id="trk-err" role="alert" hidden></p>
      <div class="sheet-actions">${editing ? '<button type="button" class="btn quiet" id="trk-del" style="margin-right:auto">Delete</button>' : ""}<button type="button" class="btn" id="trk-cancel">Cancel</button><button type="button" class="btn primary" id="trk-save">Save</button></div></div>`;
    document.body.appendChild(back); sheetEl = back; const $ = id => back.querySelector("#" + id);
    $("trk-status").onchange = () => { $("trk-reasonf").hidden = $("trk-status").value !== "closed"; };
    $("trk-cancel").onclick = closeSheet;
    back.addEventListener("mousedown", ev => { if (ev.target === back) closeSheet(); });
    $("trk-save").onclick = () => {
      const role = $("trk-role").value.trim();
      if (!role) { const m = $("trk-err"); m.hidden = false; m.textContent = "Add the role to save. A few words is enough."; $("trk-role").focus(); return; }
      const st = $("trk-status").value, patch = { role, postingUrl: $("trk-url").value.trim(), status: st, closedReason: st === "closed" ? ($("trk-reason").value || null) : null, notes: $("trk-notes").value, clearanceSponsor: $("trk-clear").checked, nextAction: { text: $("trk-next").value.trim(), due: $("trk-due").value || "", doneAt: null } };
      if (editing) {
        const prev = tracker.get(r.appId); tracker.update(r.appId, patch);
        if (st === "closed" && prev.status !== "closed") app.toast("Closed for " + (e ? e.name : "this employer") + ".", { undo: () => put(prev, true) }); else app.toast("Saved.");
      } else { tracker.upsert(Object.assign({ empId }, patch)); app.toast("Tracking " + role + "."); }
      closeSheet();
    };
    if (editing) $("trk-del").onclick = () => {
      const prev = tracker.get(r.appId); tracker.remove(r.appId); closeSheet();
      app.toast("Deleted " + (prev.role || "application") + ".", { undo: () => put(prev, true) });
    };
    back.addEventListener("keydown", ev => {
      if (ev.key === "Escape") { ev.stopPropagation(); closeSheet(); return; }
      if (ev.key === "Enter" && ev.target.tagName === "INPUT" && ev.target.type !== "checkbox") { ev.preventDefault(); $("trk-save").click(); return; }
      if (ev.key !== "Tab") return;
      const f = Array.from(back.querySelectorAll("button,input,select,textarea,summary")).filter(n => !n.disabled && n.offsetParent !== null); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); } else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });
    $("trk-role").focus();
  }
  // keep Escape inside an open sheet from also closing the employer card
  document.addEventListener("keydown", ev => { if (sheetEl && ev.key === "Escape") { ev.stopImmediatePropagation(); closeSheet(); } }, true);

  const syncNote = () => state === "cloud" ? "Backed up to your account. Changes sync across your devices." : state === "loading" ? "Loading your saved applications…" : "Saved on this device only. Open the published link to sync";

  // ---------- employer card section ----------
  let showAllFor = null;
  app.hooks.card.push(e => {
    const rs = tracker.byEmp(e.id), starred = tracker.isStarred(e.id), more = showAllFor === e.id, shown = more ? rs : rs.slice(0, 2), st = tracker.statusOf(e.id);
    const html = `<section class="kit-sec trk-sec" aria-label="Tracking"><h3><span>Tracking</span>${st ? pill(st) : ""}</h3>
      <div class="btn-row"><button type="button" class="btn" id="trk-star" aria-pressed="${starred}">${starred ? "★ Starred" : "☆ Star"}</button><button type="button" class="btn primary" id="trk-add">Track this</button></div>
      ${shown.map(r => `<div class="kit-row trk-mini" style="margin-top:8px"><span>${pill(r.status)}</span><span class="t">${esc(r.role || "Untitled role")}</span><button type="button" class="btn sm" data-edit="${esc(r.appId)}">Details</button><span class="s">${esc(nextLine(r))}</span></div>`).join("")}
      ${rs.length > 2 && !more ? `<button type="button" class="btn quiet sm" id="trk-showall" style="margin-top:6px">Show ${rs.length - 2} more</button>` : ""}
      ${!rs.length && !starred ? '<p class="kit-note">Star it to remember it, or track a role you are interested in.</p>' : ""}</section>`;
    return {
      slot: "top", html, bind(card) {
        const q = s => card.querySelector(s), sb = q("#trk-star"), ad = q("#trk-add"), sa = q("#trk-showall");
        if (sb) sb.onclick = () => tracker.star(e.id, !tracker.isStarred(e.id));
        if (ad) ad.onclick = () => openSheet(e.id);
        if (sa) sa.onclick = () => { showAllFor = e.id; app.refresh(); };
        card.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openSheet(e.id, b.dataset.edit));
      }
    };
  });

  // ---------- My applications tab ----------
  const GROUPS = ["offer", "interviewing", "applied", "applying", "interested"];
  const newest = (a, b) => a.updatedAt < b.updatedAt ? 1 : -1;
  function rowHTML(r) {
    const e = emp(r.empId), a = ADV[r.status];
    return `<div class="kit-row trk-row" data-app="${esc(r.appId)}"><div class="trk-who"><button type="button" class="trk-name" data-emp="${esc(r.empId)}">${esc(e ? e.name : r.empId)}</button><span class="trk-role">${esc(r.role || "Untitled role")}</span></div>${pill(r.status)}
      <span class="s trk-next">${esc(nextLine(r))}</span><span class="trk-acts"><button type="button" class="btn sm primary" data-adv="${esc(r.appId)}">${esc(a[1])}</button><button type="button" class="btn sm quiet" data-edit="${esc(r.appId)}" aria-label="Details for ${esc(r.role || "application")}">Details</button></span></div>`;
  }
  const trackedEmps = () => { const seen = new Set(), out = []; GROUPS.concat("closed").forEach(g => tracker.all().filter(r => r.status === g).sort(newest).forEach(r => { const e = emp(r.empId); if (e && !seen.has(e.id)) { seen.add(e.id); out.push(e); } })); return out; };
  app.addTab({
    id: "apps", label: "Applications",
    count: () => "", items: () => trackedEmps().map(e => ({ kind: "emp", id: e.id })),
    markers: () => trackedEmps().map((e, i) => ({ e, label: i + 1 })),
    render(el) {
      const all = tracker.all(), starOnly = Array.from(stars.keys()).filter(id => !all.some(r => r.empId === id)).map(emp).filter(Boolean);
      const closed = all.filter(r => r.status === "closed").sort(newest);
      let h = `<p class="intro">Your applications, newest changes first. ${esc(syncNote())}</p>`;
      if (!all.length && !starOnly.length) h += `<div class="kit-empty"><b>Nothing tracked yet.</b>Star an employer to start.</div>`;
      GROUPS.forEach(g => { const rs = all.filter(r => r.status === g).sort(newest); if (rs.length) h += `<section class="trk-group" aria-label="${WORD[g]}"><h3 class="trk-gh">${pill(g)}</h3>${rs.map(rowHTML).join("")}</section>`; });
      if (starOnly.length) h += `<section class="trk-group" aria-label="Starred"><h3 class="trk-gh">${pill("star")}</h3>${starOnly.map(e => `<div class="kit-row trk-row"><div class="trk-who"><button type="button" class="trk-name" data-emp="${esc(e.id)}">${esc(e.name)}</button><span class="trk-role">Not tracking a role yet</span></div><span class="trk-acts"><button type="button" class="btn sm" data-track="${esc(e.id)}">Track this</button></span></div>`).join("")}</section>`;
      if (closed.length) h += `<details class="trk-group trk-closed"><summary>${pill("closed")}</summary>${closed.map(rowHTML).join("")}</details>`;
      h += `<div class="kit-sec"><h3>Backup</h3><div class="btn-row"><button type="button" class="btn" id="trk-dl" ${all.length || stars.size ? "" : "disabled"}>Download backup</button><button type="button" class="btn" id="trk-restore">Restore from backup</button></div><input type="file" id="trk-file" accept="application/json,.json" hidden><p class="kit-note" id="trk-msg" role="status"></p></div>`;
      el.innerHTML = h;
      const msg = t => { const m = el.querySelector("#trk-msg"); if (m) m.textContent = t; };
      el.querySelectorAll("[data-emp]").forEach(b => b.onclick = () => app.select(b.dataset.emp, true));
      el.querySelectorAll("[data-adv]").forEach(b => b.onclick = () => { const r = tracker.get(b.dataset.adv); if (r) advance(r); });
      el.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => { const r = tracker.get(b.dataset.edit); if (r) openSheet(r.empId, r.appId); });
      el.querySelectorAll("[data-track]").forEach(b => b.onclick = () => openSheet(b.dataset.track));
      const dl = el.querySelector("#trk-dl");
      if (dl) dl.onclick = async () => {
        const day = todayISO(); await download("reston-applications-" + day + ".json", tracker.exportJSON(), "application/json"); await download("reston-applications-" + day + ".csv", tracker.exportCSV(), "text/csv");
        msg("Backup saved: one JSON file to restore from and one CSV for spreadsheets.");
      };
      const file = el.querySelector("#trk-file"); el.querySelector("#trk-restore").onclick = () => file.click();
      file.onchange = () => {
        const f = file.files && file.files[0]; if (!f) return;
        f.text().then(t => { const r = tracker.importJSON(t); app.toast("Restored: " + r.added + " added, " + r.updated + " updated."); }).catch(err => msg(err.message || "Could not read that file."));
      };
    }
  });
});
