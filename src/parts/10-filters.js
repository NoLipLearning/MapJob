// 10-filters: multi-select filters (Agent F). Toggle chips: OR within a group, AND across groups. See BUILD-PLAN.md 2.1.
PARTS.push(function (app) {
  const KEY = "reston-map-filters", E = app.E, esc = app.esc;
  const TYPES = Object.keys(TYPE_LABEL);
  const CLS = [["none", "None needed"], ["some", "Sponsors clearance"], ["most", "Mostly cleared"]];
  const STATUS = [["new", "Not started"], ["interested", "Interested"], ["applied", "Applied"], ["interviewing", "Interviewing"], ["closed", "Closed"]];
  // tracker statuses folded into the five filter buckets
  const BUCKET = { star: "interested", interested: "interested", applying: "applied", applied: "applied", interviewing: "interviewing", offer: "interviewing", closed: "closed" };
  const defaults = () => ({ area: AREAS.slice(), type: TYPES.slice(), cl: ["none", "some"], max: 90, metro: false, toll: false, prog: false, entry: false, status: STATUS.map(s => s[0]), extra: {} });
  const EXTRA = []; // toggles added by other parts through app.filters.addToggle
  let F = defaults();
  (function load() {
    const s = app.store.get(KEY); if (!s || typeof s !== "object") return;
    const sub = (k, all) => { if (Array.isArray(s[k])) F[k] = s[k].filter(v => all.includes(v)); };
    sub("area", AREAS); sub("type", TYPES); sub("cl", CLS.map(c => c[0])); sub("status", STATUS.map(c => c[0]));
    if (typeof s.max === "number" && s.max >= 15 && s.max <= 90) F.max = Math.round(s.max / 5) * 5;
    ["metro", "toll", "prog", "entry"].forEach(k => { if (typeof s[k] === "boolean") F[k] = s[k]; });
    if (s.extra && typeof s.extra === "object") Object.keys(s.extra).forEach(k => { if (s.extra[k] === true) F.extra[k] = true; });
  })();

  const hasRoutes = () => !!(app.routes && app.routes.bestMinutes);
  const hasToll = () => !!(app.routes && app.routes.hasTollFree);
  const hasTracker = () => !!(app.tracker && app.tracker.statusOf);
  const minutes = e => { if (hasRoutes()) { const m = app.routes.bestMinutes(e); if (m != null) return m; } return app.commuteMi(e) * 2.4; };
  const bucket = e => hasTracker() ? (BUCKET[app.tracker.statusOf(e.id)] || "new") : "new";

  function match(e) {
    if (!F.area.includes(e.reg) || !F.type.includes(e.type) || !F.cl.includes(e.cl)) return false;
    if (F.max < 90 && minutes(e) > F.max) return false;
    if (F.metro && !e.metro) return false;
    if (F.toll && hasToll() && app.routes.hasTollFree(e) === false) return false;
    if (F.prog || F.entry) { if (!((F.prog && e.progs && e.progs.length) || (F.entry && e.s[2] >= 4))) return false; }
    if (hasTracker() && !F.status.includes(bucket(e))) return false;
    for (const t of EXTRA) if (F.extra[t.id] && !t.test(e)) return false;
    return true;
  }
  app.hooks.filter.push(match);
  app.hooks.row.push(e => e.cl === "some" ? '<span class="s ftag"><span class="tag">Sponsors clearance</span></span>' : "");

  // each group that differs from its default counts as one filter that is "on"
  const same = (a, b) => a.length === b.length && a.every(v => b.includes(v));
  const D0 = defaults();
  const GROUPS = [
    { id: "area", label: "Area", on: () => !same(F.area, D0.area), off: () => { F.area = D0.area.slice(); } },
    { id: "type", label: "Employer type", on: () => !same(F.type, D0.type), off: () => { F.type = D0.type.slice(); } },
    { id: "cl", label: "Clearance", on: () => !same(F.cl, D0.cl), off: () => { F.cl = D0.cl.slice(); } },
    { id: "commute", label: "Commute", on: () => F.max < 90 || F.metro || F.toll, off: () => { F.max = 90; F.metro = false; F.toll = false; } },
    { id: "entry", label: "Entry path", on: () => F.prog || F.entry, off: () => { F.prog = false; F.entry = false; } },
    { id: "more", label: "More", on: () => EXTRA.some(t => F.extra[t.id]), off: () => { F.extra = {}; } },
    { id: "status", label: "My status", on: () => hasTracker() && !same(F.status, D0.status), off: () => { F.status = D0.status.slice(); } }
  ];
  const activeGroups = () => GROUPS.filter(g => g.on());
  const activeCount = () => activeGroups().length;
  const count = () => E.filter(match).length;

  // ---- DOM ----
  const bar = app.$("filters"), phone = matchMedia("(max-width: 900px)");
  const body = document.createElement("div"); body.className = "fbody";
  const head = document.createElement("div"); head.className = "fhead";
  head.innerHTML = '<button type="button" class="btn fdesk" aria-controls="filters-body"></button><span class="fcount" role="status" aria-live="polite"></span><button type="button" class="btn quiet fres">Reset filters</button>';
  let deskOpen = app.store.get(KEY + "-open") === true; body.id = "filters-body";
  const openBtn = document.createElement("button"); openBtn.type = "button"; openBtn.className = "btn fopen"; openBtn.setAttribute("aria-haspopup", "dialog"); openBtn.setAttribute("aria-expanded", "false");
  const pcount = document.createElement("span"); pcount.className = "fcount";
  const back = document.createElement("div"); back.className = "sheet-back"; back.hidden = true;
  back.innerHTML = '<div class="sheet fsheet" role="dialog" aria-modal="true" aria-labelledby="fsheet-t"><h2 id="fsheet-t">Filters</h2><p class="kit-note" id="fsheet-n"></p><div id="fsheet-body"></div><div class="sheet-actions"><button type="button" class="btn" id="fsheet-reset">Reset filters</button><button type="button" class="btn primary" id="fsheet-done">Show results</button></div></div>';
  document.body.appendChild(back);
  const sheetBody = back.querySelector("#fsheet-body");
  let sig = null, lastFocus = null;

  const chip = (g, v, label, on) => `<button type="button" class="chip" data-g="${g}" data-v="${esc(v)}" aria-pressed="${on}">${esc(label)}</button>`;
  function build() {
    const s = [hasRoutes(), hasToll(), hasTracker(), EXTRA.map(t => t.id)].join();
    if (s === sig) return; sig = s;
    const est = hasRoutes() ? "" : " (est.)";
    let h = "";
    h += `<fieldset class="fgrp"><legend>Area</legend><div class="chips">${AREAS.map(a => chip("area", a, a, F.area.includes(a))).join("")}</div></fieldset>`;
    h += `<fieldset class="fgrp"><legend>Clearance</legend><div class="chips">${CLS.map(c => chip("cl", c[0], c[1], F.cl.includes(c[0]))).join("")}</div></fieldset>`;
    h += `<fieldset class="fgrp"><legend>Commute</legend>
      <div class="field fslide"><label for="f-max">Drive time: <output id="f-maxo"></output>${est}</label><input type="range" id="f-max" min="15" max="90" step="5"></div>
      <div class="chips"><button type="button" class="chip" data-t="metro" aria-pressed="false">Reachable by Metro</button>
      <button type="button" class="chip" data-t="toll" aria-pressed="false" ${hasToll() ? "" : "disabled"}>Toll-free route</button></div>
      ${hasToll() ? "" : '<p class="kit-note">Toll-free needs route data.</p>'}</fieldset>`;
    h += `<fieldset class="fgrp"><legend>Entry path</legend><div class="chips"><button type="button" class="chip" data-t="prog" aria-pressed="false">Has an internship or fellowship</button><button type="button" class="chip" data-t="entry" aria-pressed="false">Easy entry access</button></div></fieldset>`;
    if (EXTRA.length) h += `<fieldset class="fgrp"><legend>More</legend><div class="chips">${EXTRA.map(t => `<button type="button" class="chip" data-x="${esc(t.id)}" aria-pressed="false">${esc(t.label)}</button>`).join("")}</div></fieldset>`;
    if (hasTracker()) h += `<fieldset class="fgrp"><legend>My status</legend><div class="chips">${STATUS.map(c => chip("status", c[0], c[1], F.status.includes(c[0]))).join("")}</div></fieldset>`;
    h += `<fieldset class="fgrp wide"><legend>Employer type</legend><div class="chips">${TYPES.map(t => chip("type", t, TYPE_LABEL[t], F.type.includes(t))).join("")}</div></fieldset>`;
    body.innerHTML = h;
  }
  function place() {
    const mobile = phone.matches;
    bar.classList.toggle("is-phone", mobile);
    if (mobile) { bar.replaceChildren(openBtn, pcount); if (!back.hidden) sheetBody.appendChild(body); }
    else { if (!back.hidden) { back.hidden = true; openBtn.setAttribute("aria-expanded", "false"); } bar.replaceChildren(head, body); body.hidden = !deskOpen; }
  }
  function sync() {
    build();
    body.querySelectorAll(".chip[data-g]").forEach(b => b.setAttribute("aria-pressed", String(F[b.dataset.g].includes(b.dataset.v))));
    body.querySelectorAll(".chip[data-t]").forEach(b => b.setAttribute("aria-pressed", String(!!F[b.dataset.t] && !b.disabled)));
    body.querySelectorAll(".chip[data-x]").forEach(b => b.setAttribute("aria-pressed", String(!!F.extra[b.dataset.x])));
    const r = body.querySelector("#f-max");
    if (r) { r.value = F.max; body.querySelector("#f-maxo").textContent = F.max >= 90 ? "any" : "up to " + F.max + " min"; r.setAttribute("aria-valuetext", F.max >= 90 ? "any" : F.max + " minutes"); }
    const n = activeCount(), c = `Showing ${app.ranked.length} of ${E.length}`;
    head.querySelector(".fcount").textContent = c; pcount.textContent = c;
    head.querySelector(".fres").disabled = n === 0;
    const dk = head.querySelector(".fdesk"); dk.textContent = (deskOpen ? "Hide filters" : "Filters") + (n ? ` (${n} on)` : ""); dk.setAttribute("aria-expanded", String(deskOpen));
    openBtn.textContent = n ? `Filters (${n} on)` : "Filters";
    back.querySelector("#fsheet-n").textContent = c;
    back.querySelector("#fsheet-reset").disabled = n === 0;
  }
  function changed() { app.store.set(KEY, F); app.refresh(); app.emit("filters-changed"); }
  function reset() { F = defaults(); changed(); }

  body.addEventListener("click", ev => {
    const b = ev.target.closest(".chip"); if (!b || b.disabled) return;
    if (b.dataset.g) { const a = F[b.dataset.g], v = b.dataset.v, i = a.indexOf(v); i < 0 ? a.push(v) : a.splice(i, 1); }
    else if (b.dataset.t) F[b.dataset.t] = !F[b.dataset.t];
    else if (b.dataset.x) { if (F.extra[b.dataset.x]) delete F.extra[b.dataset.x]; else F.extra[b.dataset.x] = true; }
    changed();
  });
  body.addEventListener("input", ev => { if (ev.target.id === "f-max") { F.max = +ev.target.value; changed(); } });
  head.querySelector(".fres").onclick = reset;
  head.querySelector(".fdesk").onclick = () => { deskOpen = !deskOpen; app.store.set(KEY + "-open", deskOpen); body.hidden = !deskOpen; sync(); };
  back.querySelector("#fsheet-reset").onclick = reset;

  // sheet (phones)
  function open() {
    lastFocus = document.activeElement; sheetBody.appendChild(body); back.hidden = false; openBtn.setAttribute("aria-expanded", "true");
    (body.querySelector(".chip") || back.querySelector(".btn")).focus();
  }
  function close() { back.hidden = true; openBtn.setAttribute("aria-expanded", "false"); if (lastFocus) lastFocus.focus(); }
  openBtn.onclick = open;
  back.querySelector("#fsheet-done").onclick = close;
  back.addEventListener("mousedown", ev => { if (ev.target === back) close(); });
  back.addEventListener("keydown", ev => {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); return; }
    if (ev.key === "Tab") {
      const f = [...back.querySelectorAll("button:not([disabled]),input")].filter(x => x.offsetParent !== null); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); } else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
  });
  phone.addEventListener("change", place);

  // ---- empty list: say what is filtering, with one-tap fixes ----
  app.on("refreshed", () => {
    sync();
    const el = app.$("list"), p = el && el.querySelector("p.empty");
    if (!p || app.tab !== "emp") return;
    const gs = activeGroups(), q = (app.$("q").value || "").trim();
    if (!gs.length && !q) return;
    p.innerHTML = `<b>No match.</b> Try turning off:<span class="fixes">` +
      gs.map(g => `<button type="button" class="btn sm" data-fix="${g.id}">${esc(g.label)}</button>`).join("") +
      (q ? `<button type="button" class="btn sm" data-fix="search">Search “${esc(q)}”</button>` : "") + `</span>`;
    p.querySelectorAll("[data-fix]").forEach(b => b.onclick = () => {
      if (b.dataset.fix === "search") { const i = app.$("q"); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); return; }
      GROUPS.find(g => g.id === b.dataset.fix).off(); changed();
    });
  });
  app.on("tracker-changed", () => app.refresh());

  function addToggle(t) { if (!t || !t.id || typeof t.test !== "function" || EXTRA.some(x => x.id === t.id)) return; EXTRA.push(t); sig = null; app.refresh(); }
  app.filters = { count, reset, activeCount, match, addToggle };
  place();
  // routes/tracker parts register after this one, so re-check for them once every part has run
  setTimeout(() => { if (sig !== [hasRoutes(), hasToll(), hasTracker(), EXTRA.map(t => t.id)].join()) app.refresh(); }, 0);
});
