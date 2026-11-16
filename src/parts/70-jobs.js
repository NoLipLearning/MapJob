// 70-jobs: real openings (spec 4.2). Reads the `jobs` collection that a Claude refresh fills (docs/REFRESH.md); never calls AI.
// Exposes app.jobs and the event "jobs-changed". Falls back to localStorage `reston-map-jobs` when the db capability is missing.
PARTS.push(function (app) {
  const esc = app.esc, $ = app.$, KEY = "reston-map-jobs", SEEN = "reston-map-jobs-seen";
  const TIMING = Object.assign({ timeout: 10000, retry: 15000 }, window.RESTON_JOBS_TIMING || {});
  const CL_TAG = { none: "No clearance", sponsor: "Clearance can be sponsored", required: "Needs clearance", unknown: "Clearance not stated" };
  const EN_TAG = { yes: "Entry level", maybe: "Some experience asked" };
  const SRC = { indeed: "Indeed", usajobs: "USAJOBS", greenhouse: "Greenhouse", lever: "Lever", careers: "Careers page", web: "Web", linkedin: "LinkedIn alert", handshake: "Handshake alert", "saved-linkedin": "LinkedIn (saved)", "saved-handshake": "Handshake (saved)", "saved-other": "Saved" };
  // ---- facets (Indeed-style filters with counts) and sorting ----
  const FKEY = "reston-map-jobfacets", SKEY = "reston-map-sort-jobs";
  const F_SRC = [["indeed", "Indeed"], ["linkedin", "LinkedIn"], ["handshake", "Handshake"], ["usajobs", "USAJOBS"], ["greenhouse", "Greenhouse"], ["lever", "Lever"], ["careers", "Careers"], ["saved", "Saved"]];
  const F_CL = [["none", "No clearance"], ["sponsor", "Can be sponsored"], ["unknown", "Not stated"], ["required", "Needs clearance"]];
  const F_EN = [["yes", "Entry level"], ["maybe", "Some experience"], ["unknown", "Not stated"], ["no", "Experienced"]];
  const F_POSTED = [["any", "Any"], ["7", "7 days"], ["30", "30 days"]];
  const SORTS = [["fit", "Best fit"], ["new", "Newest"], ["close", "Closing soon"], ["near", "Closest"]];
  const fdefaults = () => ({ src: F_SRC.map(o => o[0]), cl: ["none", "sponsor", "unknown"], en: F_EN.map(o => o[0]), posted: "any", pay: false });
  let FS = fdefaults(), sortBy = "fit", facetsOpen = !matchMedia("(max-width: 900px)").matches, refocus = null; // phones start with the facets folded away
  (function loadFacets() {
    const sub = (k, all, s0) => { if (Array.isArray(s0[k])) FS[k] = s0[k].filter(v => all.includes(v)); };
    try {
      const s0 = JSON.parse(localStorage.getItem(FKEY) || "null");
      if (s0 && typeof s0 === "object") { sub("src", F_SRC.map(o => o[0]), s0); sub("cl", F_CL.map(o => o[0]), s0); sub("en", F_EN.map(o => o[0]), s0); if (F_POSTED.some(o => o[0] === s0.posted)) FS.posted = s0.posted; if (typeof s0.pay === "boolean") FS.pay = s0.pay; }
      const so = JSON.parse(localStorage.getItem(SKEY) || "null"); if (SORTS.some(o => o[0] === so)) sortBy = so;
      const fo = localStorage.getItem(FKEY + "-open"); if (fo === "false" || fo === "true") facetsOpen = fo === "true";
    } catch (_) {}
  })();
  const saveFacets = () => { try { localStorage.setItem(FKEY, JSON.stringify(FS)); } catch (_) {} };
  const srcTags = j => { const s0 = String(j.source || ""), k = s0.indexOf("saved-") === 0 ? "saved" : s0 === "web" ? "careers" : s0, out = F_SRC.some(o => o[0] === k) ? [k] : []; if (j.status === "saved" && k !== "saved") out.push("saved"); return out; };
  const clKey = j => F_CL.some(o => o[0] === j.clearance) ? j.clearance : "unknown";
  const enKey = j => F_EN.some(o => o[0] === j.entry) ? j.entry : "unknown";
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const dayNum = str => { const m = ISO.exec(str || ""); return m ? Math.floor(Date.UTC(+str.slice(0, 4), +str.slice(5, 7) - 1, +str.slice(8, 10)) / 864e5) : null; };
  const ageDays = j => { const d = dayNum(j.posted || j.firstSeen), t = dayNum(today()); return d == null ? null : Math.max(0, t - d); };
  const fmtDate = str => { const m = ISO.exec(str || ""); return m ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+str.slice(5, 7) - 1] + " " + (+str.slice(8, 10)) + ", " + str.slice(0, 4) : String(str || ""); };
  // ov overrides some facet values: "how many openings would I get with only this option?"
  function passes(j, ov) {
    const v = k => ov && k in ov ? ov[k] : FS[k];
    const st = srcTags(j); if (st.length && !st.some(t => v("src").includes(t))) return false;
    if (!v("cl").includes(clKey(j)) || !v("en").includes(enKey(j))) return false;
    const pd = v("posted"); if (pd !== "any") { const a = ageDays(j); if (a == null || a > +pd) return false; }
    if (v("pay") && !j.pay) return false;
    return true;
  }
  const facetsDefault = () => { const d = fdefaults(); return ["src", "cl", "en"].every(k => d[k].length === FS[k].length && d[k].every(x => FS[k].includes(x))) && FS.posted === "any" && !FS.pay; };
  const closeOf = j => ISO.test(j.deadline || "") ? j.deadline : "";
  function distOf(j) {
    const ll = j.loc && typeof j.loc.lat === "number" ? j.loc : (empOf(j) || null); if (!ll) return Infinity;
    const h = app.homeLL(), lon = ll.lon; return typeof lon === "number" ? app.miles(h[0], h[1], ll.lat, lon) : Infinity;
  }
  const newest = (a, b) => String(b.posted || b.firstSeen || "").localeCompare(String(a.posted || a.firstSeen || ""));
  const SORT_FN = {
    fit: (a, b) => byFit(a, b),
    new: (a, b) => newest(a, b) || byFit(a, b),
    close: (a, b) => { const x = closeOf(a), y = closeOf(b); return x && y ? x.localeCompare(y) || byFit(a, b) : x ? -1 : y ? 1 : byFit(a, b); },
    near: (a, b) => { const x = distOf(a), y = distOf(b); return x === y ? byFit(a, b) : x - y; }
  };
  const safeUrl = u => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : null; } catch (_) { return null; } };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const today = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };

  // ---------- storage ----------
  const jobs = new Map(); let meta = null, state = "loading", cloud = null, empFilter = null;
  const loadLocal = () => { try { const s = JSON.parse(localStorage.getItem(KEY) || "{}"); (s.jobs || []).forEach(j => j && j.id && jobs.set(j.id, j)); meta = s.meta || null; } catch (_) {} };
  const saveLocal = () => { try { localStorage.setItem(KEY, JSON.stringify({ jobs: [...jobs.values()], meta })); } catch (_) {} };
  let seen = new Set(); try { seen = new Set(JSON.parse(localStorage.getItem(SEEN) || "[]")); } catch (_) {}
  const saveSeen = () => { try { localStorage.setItem(SEEN, JSON.stringify([...seen].slice(-2000))); } catch (_) {} };
  const changed = () => { saveLocal(); app.emit("jobs-changed"); app.refresh(); };
  // Writes: a new job is `set` whole; a change to an existing one is an `update` of just the changed fields, so it cannot
  // overwrite fields a refresh wrote meanwhile. Until a change is confirmed, `pend` keeps it on top of incoming snapshots.
  const queue = [], pend = new Map(); let writing = false, retried = false;
  function write(op, id, patch) {
    if (op === "update") pend.set(id, Object.assign(pend.get(id) || {}, patch));
    if (!cloud) return; queue.push([op, id, patch]); drain();
  }
  async function drain() {
    if (writing || !cloud) return; writing = true;
    while (queue.length) {
      const [o, i, patch] = queue[0], ref = cloud.db.collection("jobs").doc(i);
      try {
        if (o === "set") await ref.set(jobs.get(i)); else await ref.update(patch);
        queue.shift(); retried = false;
        if (o === "update" && !queue.some(q => q[1] === i)) pend.delete(i);
      } catch (e) {
        console.error("[jobs] write failed", e);
        if (!retried) { retried = true; writing = false; setTimeout(drain, TIMING.retry); return; }
        queue.shift(); retried = false; app.toast("Could not save that change to the cloud. It is kept on this device.");
      }
    }
    writing = false;
  }
  function connect(isRetry) {
    if (typeof claude === "undefined" || !claude.use) { state = "device"; return Promise.resolve(state); }
    const timeout = new Promise(res => setTimeout(() => res("timeout"), TIMING.timeout));
    const attempt = (async () => {
      const db = await claude.use("db"); if (!db) return "none";
      await new Promise((res, rej) => {
        db.collection("jobs").onSnapshot(snap => {
          let did = false;
          snap.docChanges().forEach(ch => { const id = ch.doc.id; if (ch.type === "removed") { if (jobs.delete(id)) did = true; } else { jobs.set(id, Object.assign({ id }, ch.doc.data(), pend.get(id) || {})); did = true; } });
          if (did && state === "cloud") changed(); res();
        }, rej);
      });
      try { const m = await db.collection("meta").doc("refresh").get(); if (m && m.exists) meta = m.data(); } catch (_) {}
      cloud = { db }; return "cloud";
    })().catch(() => "none");
    return Promise.race([attempt, timeout]).then(r => {
      state = r === "cloud" ? "cloud" : "device";
      if (r === "timeout" && !isRetry) setTimeout(() => connect(true), TIMING.retry);
      changed(); return state;
    });
  }

  // ---------- queries ----------
  const visible = j => j && j.status !== "dismissed";
  const byFit = (a, b) => (b.fit == null ? -1 : b.fit) - (a.fit == null ? -1 : a.fit) || String(b.posted || b.firstSeen || "").localeCompare(String(a.posted || a.firstSeen || ""));
  const all = () => [...jobs.values()].map(j => Object.assign({}, j));
  const byEmp = id => [...jobs.values()].filter(j => j.empId === id && visible(j)).sort(byFit);
  const empOf = j => j.empId ? app.E.find(e => e.id === j.empId) : null;
  function drive(j) {
    if (j.minutes != null) return j.minutes + " min est.";
    const ll = j.loc && typeof j.loc.lat === "number" ? j.loc : null;
    if (!ll) return null; const h = app.homeLL(); return Math.round(app.miles(h[0], h[1], ll.lat, ll.lon) * 2.4) + " min est.";
  }
  function setStatus(id, status, opt) {
    const j = jobs.get(id); if (!j || j.status === status) return;
    const prev = j.status; j.status = status; changed(); write("update", id, { status });
    if (status === "dismissed" && !(opt && opt.quiet)) app.toast("Removed from your openings.", { undo: () => setStatus(id, prev, { quiet: true }) });
  }
  function assign(ids, empId) {
    let n = 0; (ids || []).forEach(id => { const j = jobs.get(id); if (j && j.empId !== empId) { j.empId = empId; n++; write("update", id, { empId }); } });
    if (n) changed(); return n;
  }
  function save(raw) {
    const url = safeUrl(raw && raw.url); if (!url) throw new Error("Use a full https:// link");
    const src = ["saved-linkedin", "saved-handshake", "saved-other"].includes(raw.source) ? raw.source : "saved-other";
    const text = String(raw.text || "").trim(), t = today();
    const j = { id: "saved-" + uuid(), title: "Saved job", employer: "", empId: null, loc: { text: "" }, url, source: src, posted: null, pay: null, jobType: null,
      clearance: "unknown", entry: "unknown", fit: null, fitWhy: [], summary: text ? text.slice(0, 280) : null, pasted: text || null, status: "saved", firstSeen: t, lastSeen: t, verified: false };
    jobs.set(j.id, j); changed(); write("set", j.id); return Object.assign({}, j);
  }

  // ---------- rendering ----------
  const tags = j => [CL_TAG[j.clearance] || CL_TAG.unknown, EN_TAG[j.entry]].filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join("");
  const metaLine = j => { const bits = []; if (j.checked) bits.push("Checked " + fmtDate(j.checked)); if (closeOf(j)) bits.push("Closes " + fmtDate(closeOf(j))); return bits.length ? `<div class="jmeta">${bits.map(esc).join(" &middot; ")}</div>` : ""; };
  function row(j) {
    const isNew = j.status === "new" && !seen.has(j.id), d = drive(j);
    const where = [j.employer, j.loc && j.loc.text, d].filter(Boolean).map(esc).join(" &middot; ");
    const title = j.title === "Saved job" && !j.summary ? "Saved job &middot; Details not added yet" : esc(j.title);
    return `<div class="jobrow" data-job="${esc(j.id)}">
      <div class="jt"><b>${title}</b>${isNew ? ' <span class="pill soft jnew">New</span>' : ""}${j.status === "applied" ? ' <span class="pill st-applied">✓ Applied</span>' : ""}</div>
      <div class="jfit" title="Fit with your background (0 to 100)">${j.fit == null ? "–" : j.fit}</div>
      <div class="js">${where || esc(SRC[j.source] || "")}</div>
      <div class="jtags">${tags(j)}${j.pay ? `<span class="tag">${esc(j.pay)}</span>` : ""}</div>
      ${metaLine(j)}
      <div class="btn-row jact"><button type="button" class="btn sm" data-a="open">Open</button>${j.status === "new" ? '<button type="button" class="btn sm" data-a="save">Save</button>' : ""}${j.status !== "applied" ? '<button type="button" class="btn sm quiet" data-a="dismiss">Not for me</button>' : ""}</div>
    </div>`;
  }
  // openings before facets (dismissed hidden, one employer if "Show all N" was tapped), then after facets
  const poolJobs = () => { const emp = empFilter && app.E.find(e => e.id === empFilter); return [...jobs.values()].filter(j => visible(j) && (!emp || j.empId === emp.id)); };
  const shownJobs = () => poolJobs().filter(j => passes(j, null));
  const chipHTML = (g, v, label, on, n) => `<button type="button" class="chip${n === 0 ? " zero" : ""}" data-fg="${g}" data-fv="${esc(v)}" data-fk="${g}:${esc(v)}" aria-pressed="${on}"><span class="cl">${esc(label)}</span> <span class="cn">${n}</span></button>`;
  function facetsHTML(pool, shown) {
    const cnt = ov => pool.filter(j => passes(j, ov)).length;
    const grp = (title, g, opts) => `<fieldset class="fgrp"><legend>${title}</legend><div class="chips">${opts.map(o => chipHTML(g, o[0], o[1], FS[g].includes(o[0]), cnt({ [g]: [o[0]] }))).join("")}</div></fieldset>`;
    return `<details class="jfacets" id="jfacets"${facetsOpen ? " open" : ""}><summary>Filter openings <span class="jfs" role="status">${shown.length} of ${pool.length} shown</span></summary>
      <div class="jfbody">${grp("Source", "src", F_SRC)}${grp("Clearance", "cl", F_CL)}${grp("Entry", "en", F_EN)}
      <fieldset class="fgrp"><legend>Posted</legend><div class="chips">${F_POSTED.map(o => chipHTML("posted", o[0], o[1], FS.posted === o[0], cnt({ posted: o[0] }))).join("")}</div></fieldset>
      <fieldset class="fgrp"><legend>Pay</legend><div class="chips">${chipHTML("pay", "1", "Pay listed", FS.pay, cnt({ pay: true }))}</div></fieldset>
      <div class="btn-row"><button type="button" class="btn quiet sm" id="jf-reset"${facetsDefault() ? " disabled" : ""}>Reset filters</button></div></div></details>`;
  }
  function render(el) {
    const keepFk = refocus; refocus = null; // the core clears the list before calling render, so the control that changed the list says so itself
    const pool = poolJobs(), list = pool.filter(j => passes(j, null)), cmp = SORT_FN[sortBy];
    const emp = empFilter && app.E.find(e => e.id === empFilter);
    const saved = list.filter(j => j.status === "saved").sort(cmp), rest = list.filter(j => j.status !== "saved").sort(cmp);
    const when = meta && meta.lastRun ? "Last refreshed " + esc(meta.lastRun) + "." : "Not refreshed yet.";
    let h = `<div class="jhead"><p class="intro">${when} Ask Claude to “refresh my map” for new openings.</p><button type="button" class="btn sm" id="job-save">Save a job</button></div>`;
    if (state === "device") h += `<p class="kit-note">Openings sync only on the published page. Here they are kept on this device.</p>`;
    if (emp) h += `<p class="jfilter">Jobs at ${esc(emp.name)} <button type="button" class="btn sm quiet" id="job-allemp">Show all openings</button></p>`;
    if (pool.length) h += facetsHTML(pool, list) + `<div class="sortbar"><label for="sort-jobs">Sort by</label><select id="sort-jobs">${SORTS.map(o => `<option value="${o[0]}"${o[0] === sortBy ? " selected" : ""}>${o[1]}</option>`).join("")}</select></div>`;
    if (!pool.length) h += `<div class="kit-empty"><b>No openings loaded yet.</b>Ask Claude to “refresh my map”, or save a job you found.</div>`;
    else if (!list.length) h += `<div class="kit-empty"><b>No openings match these filters.</b>Turn a filter off, or <button type="button" class="btn sm" id="jf-reset2">Reset filters</button></div>`;
    if (saved.length) h += `<h3 class="jsec">Saved by you</h3>` + saved.map(row).join("");
    if (rest.length) h += (saved.length ? `<h3 class="jsec">Openings</h3>` : "") + rest.map(row).join("");
    el.innerHTML = h;
    const fd = el.querySelector("#jfacets"); if (fd) fd.addEventListener("toggle", () => { facetsOpen = fd.open; try { localStorage.setItem(FKEY + "-open", String(fd.open)); } catch (_) {} });
    el.querySelectorAll("[data-fg]").forEach(b => b.onclick = () => {
      const g = b.dataset.fg, v = b.dataset.fv; refocus = b.dataset.fk;
      if (g === "posted") FS.posted = v; else if (g === "pay") FS.pay = !FS.pay; else { const i = FS[g].indexOf(v); i < 0 ? FS[g].push(v) : FS[g].splice(i, 1); }
      saveFacets(); app.refresh();
    });
    const clearF = () => { FS = fdefaults(); saveFacets(); app.refresh(); };
    ["#jf-reset", "#jf-reset2"].forEach(q => { const b = el.querySelector(q); if (b) b.onclick = clearF; });
    const ss = el.querySelector("#sort-jobs"); if (ss) ss.onchange = () => { refocus = "sort-jobs"; sortBy = ss.value; try { localStorage.setItem(SKEY, JSON.stringify(sortBy)); } catch (_) {} app.refresh(); };
    if (keepFk) { const t = [...el.querySelectorAll("[data-fk]")].find(x => x.dataset.fk === keepFk) || el.querySelector("#" + keepFk); if (t) t.focus(); }
    el.querySelector("#job-save").onclick = openSave;
    const ae = el.querySelector("#job-allemp"); if (ae) ae.onclick = () => { empFilter = null; app.refresh(); };
    el.querySelectorAll(".jobrow [data-a]").forEach(b => b.onclick = () => {
      const id = b.closest(".jobrow").dataset.job;
      if (b.dataset.a === "open") openJob(id); else if (b.dataset.a === "save") setStatus(id, "saved"); else setStatus(id, "dismissed");
    });
  }

  // ---------- sheets ----------
  function sheet(id, inner, onReady) {
    let back = document.getElementById(id); if (back) back.remove();
    const opener = document.activeElement;
    back = document.createElement("div"); back.id = id; back.className = "sheet-back";
    back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="${id}-h">${inner}</div>`;
    document.body.appendChild(back);
    const close = () => { back.remove(); if (opener && opener.isConnected) opener.focus(); };
    back.addEventListener("mousedown", ev => { if (ev.target === back) close(); });
    back.addEventListener("keydown", ev => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); } });
    back.querySelectorAll("[data-close]").forEach(b => b.onclick = close);
    onReady(back, close);
    const f = back.querySelector("input, textarea, button.primary, button"); if (f) f.focus();
  }
  function openJob(id) {
    const j = jobs.get(id); if (!j) return;
    const url = safeUrl(j.url), e = empOf(j), d = drive(j);
    const canApply = !!(app.apply && app.apply.startFromJob) && j.status !== "applied";
    sheet("job-sheet", `<h2 id="job-sheet-h">${esc(j.title)}</h2>
      <p class="kit-note">${[j.employer, j.loc && j.loc.text, d].filter(Boolean).map(esc).join(" &middot; ")}</p>
      <div class="jtags">${tags(j)}${j.pay ? `<span class="tag">${esc(j.pay)}</span>` : ""}</div>
      ${j.fit != null ? `<p class="jwhy"><b>Fit ${j.fit}</b>${(j.fitWhy || []).length ? ": " + j.fitWhy.map(esc).join(" · ") : ""}</p>` : ""}
      ${j.summary ? `<p class="jsum">${esc(j.summary)}</p>` : `<p class="kit-note">Details not added yet. The next refresh fills them in from any text you pasted.</p>`}
      <p class="kit-note">From ${esc(SRC[j.source] || j.source || "unknown")}${j.posted ? ", posted " + esc(j.posted) : ""}${j.verified === false ? ". Not checked by a refresh yet" : ""}.</p>
      <div class="sheet-actions"><button type="button" class="btn quiet" data-close>Close</button>
        ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">View posting ↗</a>` : ""}
        ${e ? '<button type="button" class="btn" id="job-map">Show on map</button>' : ""}
        ${canApply ? '<button type="button" class="btn primary" id="job-apply">Start applying</button>' : ""}</div>`, (back, close) => {
      const m = back.querySelector("#job-map"); if (m) m.onclick = () => { close(); app.select(e.id, true); };
      const a = back.querySelector("#job-apply"); if (a) a.onclick = () => { close(); app.apply.startFromJob(j.id); };
    });
  }
  function openSave() {
    sheet("jobsave-sheet", `<h2 id="jobsave-sheet-h">Save a job</h2>
      <p class="kit-note">Paste the link to a job you found. Pasting the posting text helps the next refresh score it.</p>
      <div class="field"><label for="js-url">Job link</label><input type="url" id="js-url" inputmode="url" placeholder="https://"><small id="js-err" class="links-err"></small></div>
      <div class="field"><span>Where you found it</span><div class="seg" role="group" aria-label="Where you found it">
        <button type="button" aria-pressed="true" data-s="saved-linkedin">LinkedIn</button><button type="button" aria-pressed="false" data-s="saved-handshake">Handshake</button><button type="button" aria-pressed="false" data-s="saved-other">Other</button></div></div>
      <div class="field"><label for="js-text">Posting text (optional)</label><textarea id="js-text" placeholder="Paste the job description"></textarea></div>
      <div class="sheet-actions"><button type="button" class="btn quiet" data-close>Cancel</button><button type="button" class="btn primary" id="js-go">Save job</button></div>`, (back, close) => {
      let src = "saved-linkedin";
      back.querySelectorAll(".seg button").forEach(b => b.onclick = () => { src = b.dataset.s; back.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); });
      back.querySelector("#js-go").onclick = () => {
        try { save({ url: back.querySelector("#js-url").value.trim(), text: back.querySelector("#js-text").value, source: src }); close(); app.toast("Saved. It is at the top of Openings."); }
        catch (err) { back.querySelector("#js-err").textContent = "Use a full https:// link."; back.querySelector("#js-url").focus(); }
      };
    });
  }

  // ---------- wiring ----------
  const calm = () => getComputedStyle(document.documentElement).getPropertyValue("--calm").trim() || "#2c6bb5";
  app.hooks.markers.push(e => { const n = byEmp(e.id).length; return n ? { color: calm(), glyph: n > 9 ? "+" : String(n), pos: "tl" } : null; });
  app.hooks.card.push(e => {
    const L = byEmp(e.id); if (!L.length) return null;
    return { slot: "main", html: `<div class="kit-sec jcard"><h3>Open jobs here</h3>${L.slice(0, 3).map(j => `<div class="kit-row"><span class="jfit">${j.fit == null ? "–" : j.fit}</span><span class="t">${esc(j.title)}</span><button type="button" class="btn sm" data-jopen="${esc(j.id)}">Open</button></div>`).join("")}
      ${L.length > 3 ? `<button type="button" class="btn sm quiet" data-jall>Show all ${L.length}</button>` : ""}</div>`,
      bind: root => { root.querySelectorAll("[data-jopen]").forEach(b => b.onclick = () => openJob(b.dataset.jopen)); const a = root.querySelector("[data-jall]"); if (a) a.onclick = () => { empFilter = e.id; const t = $("tab-jobs"); if (t) t.click(); }; } };
  });
  if (app.filters && app.filters.addToggle) app.filters.addToggle({ id: "openings", label: "Has openings", test: e => byEmp(e.id).length > 0 });
  const shownEmpIds = () => [...new Set(shownJobs().filter(j => j.empId).map(j => j.empId))];
  app.addTab({ id: "jobs", label: "Openings", render, count: () => shownJobs().length,
    items: () => shownEmpIds().map(id => ({ kind: "emp", id })),
    markers: () => shownEmpIds().map(id => app.E.find(e => e.id === id)).filter(Boolean).map(e => ({ e, label: shownJobs().filter(j => j.empId === e.id).length })) });
  // "New" clears once Eric leaves the tab after seeing the list
  let wasOn = false;
  app.on("refreshed", () => { const on = app.tab === "jobs"; if (wasOn && !on) { [...jobs.values()].forEach(j => seen.add(j.id)); saveSeen(); empFilter = null; } wasOn = on; });

  // a tracker record started from a job, once applied, marks that job applied too
  app.on("tracker-changed", () => {
    if (!app.tracker) return;
    app.tracker.all().forEach(r => { if (r.jobId && ["applied", "interviewing", "offer"].includes(r.status)) { const j = jobs.get(r.jobId); if (j && j.status !== "applied") { j.status = "applied"; saveLocal(); write("update", r.jobId, { status: "applied" }); app.emit("jobs-changed"); } } });
  });
  loadLocal();
  app.jobs = { facets: { get: () => JSON.parse(JSON.stringify(FS)), reset: () => { FS = fdefaults(); saveFacets(); app.refresh(); } }, shown: () => shownJobs().map(j => j.id), ready: connect(false).then(() => {}), all, byEmp, assign, get: id => jobs.has(id) ? Object.assign({}, jobs.get(id)) : null, setStatus, save, open: openJob,
    lastRefresh: () => meta && meta.lastRun || null, syncState: () => state };
});
