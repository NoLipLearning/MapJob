// 70-jobs: real openings (spec 4.2). Reads the `jobs` collection that a Claude refresh fills (docs/REFRESH.md); never calls AI.
// Exposes app.jobs and the event "jobs-changed". Falls back to localStorage `reston-map-jobs` when the db capability is missing.
PARTS.push(function (app) {
  const esc = app.esc, $ = app.$, KEY = "reston-map-jobs", SEEN = "reston-map-jobs-seen";
  const TIMING = Object.assign({ timeout: 10000, retry: 15000 }, window.RESTON_JOBS_TIMING || {});
  const CL_TAG = { none: "No clearance", sponsor: "Clearance can be sponsored", required: "Needs clearance", unknown: "Clearance not stated" };
  const EN_TAG = { yes: "Entry level", maybe: "Some experience asked" };
  const SRC = { indeed: "Indeed", usajobs: "USAJOBS", careers: "Careers page", web: "Web", linkedin: "LinkedIn alert", handshake: "Handshake alert", "saved-linkedin": "LinkedIn (saved)", "saved-handshake": "Handshake (saved)", "saved-other": "Saved" };
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
  const queue = []; let writing = false;
  async function write(op, id) {
    if (!cloud) return; queue.push([op, id]); if (writing) return; writing = true;
    try { while (queue.length) { const [o, i] = queue.shift(), ref = cloud.db.collection("jobs").doc(i); if (o === "del") await ref.delete(); else if (jobs.has(i)) await ref.set(jobs.get(i)); } }
    catch (e) { console.error("[jobs] write failed", e); app.toast("Could not save that change to the cloud. It is kept on this device."); }
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
          snap.docChanges().forEach(ch => { const id = ch.doc.id; if (ch.type === "removed") { if (jobs.delete(id)) did = true; } else { jobs.set(id, Object.assign({ id }, ch.doc.data())); did = true; } });
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
    const e = empOf(j), m = e && app.routes && app.routes.bestMinutes ? app.routes.bestMinutes(e) : null;
    if (m != null) return m + " min";
    if (j.minutes != null) return j.minutes + " min est.";
    const ll = j.loc && typeof j.loc.lat === "number" ? j.loc : null;
    if (!ll) return null; const h = app.homeLL(); return Math.round(app.miles(h[0], h[1], ll.lat, ll.lon) * 2.4) + " min est.";
  }
  function setStatus(id, status, opt) {
    const j = jobs.get(id); if (!j || j.status === status) return;
    const prev = j.status; j.status = status; changed(); write("set", id);
    if (status === "dismissed" && !(opt && opt.quiet)) app.toast("Removed from your openings.", { undo: () => setStatus(id, prev, { quiet: true }) });
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
  function row(j) {
    const isNew = j.status === "new" && !seen.has(j.id), d = drive(j);
    const where = [j.employer, j.loc && j.loc.text, d].filter(Boolean).map(esc).join(" &middot; ");
    const title = j.title === "Saved job" && !j.summary ? "Saved job &middot; Details not added yet" : esc(j.title);
    return `<div class="jobrow" data-job="${esc(j.id)}">
      <div class="jt"><b>${title}</b>${isNew ? ' <span class="pill soft jnew">New</span>' : ""}${j.status === "applied" ? ' <span class="pill st-applied">✓ Applied</span>' : ""}</div>
      <div class="jfit" title="Fit with your background (0 to 100)">${j.fit == null ? "–" : j.fit}</div>
      <div class="js">${where || esc(SRC[j.source] || "")}</div>
      <div class="jtags">${tags(j)}</div>
      <div class="btn-row jact"><button type="button" class="btn sm" data-a="open">Open</button>${j.status === "new" ? '<button type="button" class="btn sm" data-a="save">Save</button>' : ""}${j.status !== "applied" ? '<button type="button" class="btn sm quiet" data-a="dismiss">Not for me</button>' : ""}</div>
    </div>`;
  }
  function render(el) {
    let list = [...jobs.values()].filter(visible);
    const emp = empFilter && app.E.find(e => e.id === empFilter);
    if (emp) list = list.filter(j => j.empId === emp.id);
    const saved = list.filter(j => j.status === "saved").sort(byFit), rest = list.filter(j => j.status !== "saved").sort(byFit);
    const when = meta && meta.lastRun ? "Last refreshed " + esc(meta.lastRun) + "." : "Not refreshed yet.";
    let h = `<div class="jhead"><p class="intro">${when} Ask Claude to “refresh my map” for new openings.</p><button type="button" class="btn sm" id="job-save">Save a job</button></div>`;
    if (state === "device") h += `<p class="kit-note">Openings sync only on the published page. Here they are kept on this device.</p>`;
    if (emp) h += `<p class="jfilter">Jobs at ${esc(emp.name)} <button type="button" class="btn sm quiet" id="job-allemp">Show all openings</button></p>`;
    if (!list.length) h += `<div class="kit-empty"><b>No openings loaded yet.</b>Ask Claude to “refresh my map”, or save a job you found.</div>`;
    if (saved.length) h += `<h3 class="jsec">Saved by you</h3>` + saved.map(row).join("");
    if (rest.length) h += (saved.length ? `<h3 class="jsec">Openings</h3>` : "") + rest.map(row).join("");
    el.innerHTML = h;
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
  app.addTab({ id: "jobs", label: "Openings", render, count: () => [...jobs.values()].filter(visible).length,
    items: () => [...new Set([...jobs.values()].filter(j => visible(j) && j.empId).map(j => j.empId))].map(id => ({ kind: "emp", id })),
    markers: () => { const ids = [...new Set([...jobs.values()].filter(j => visible(j) && j.empId).map(j => j.empId))]; return ids.map(id => app.E.find(e => e.id === id)).filter(Boolean).map(e => ({ e, label: byEmp(e.id).length })); } });
  // "New" clears once Eric leaves the tab after seeing the list
  let wasOn = false;
  app.on("refreshed", () => { const on = app.tab === "jobs"; if (wasOn && !on) { [...jobs.values()].forEach(j => seen.add(j.id)); saveSeen(); empFilter = null; } wasOn = on; });

  loadLocal();
  app.jobs = { ready: connect(false).then(() => {}), all, byEmp, get: id => jobs.has(id) ? Object.assign({}, jobs.get(id)) : null, setStatus, save, open: openJob,
    lastRefresh: () => meta && meta.lastRun || null, syncState: () => state };
});
