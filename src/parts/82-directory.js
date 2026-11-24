// 82-directory: the NoVA employer directory (app.D.dir, built by src/add_directory.py) as light round "E" pins, clustered
// separately from the researched employers and drawn under them, plus an "All NoVA employers" list (a card opened from the Employers map button), nearest first.
// Each entry links to its careers page ("Careers ↗") or homepage ("Website ↗"); links open only if they are http(s).
// Entries with empId are already on the map as researched employers and draw no pin. No fit score: this is a directory.
PARTS.push(function (app) {
  const esc = app.esc, KEY = "reston-map-dir", MAXROWS = 300;
  let list = Array.isArray(app.D.dir) ? app.D.dir : [];
  if (Array.isArray(window.RESTON_TEST_DIR)) list = window.RESTON_TEST_DIR; // tests only
  const safeUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (_) { return null; } };
  const all = list.filter(d => d && typeof d.id === "string" && typeof d.name === "string" && typeof d.lat === "number" && typeof d.lon === "number");
  all.forEach(d => { [d.x, d.z] = app.toXZ(d.lat, d.lon); d.url = safeUrl(d.link); d.town = ((d.addr || "").split(",").slice(-2, -1)[0] || "").trim(); });
  const shown = all.filter(d => !d.empId), byId = new Map(all.map(d => [d.id, d]));
  let on = app.store.get(KEY) !== false, q = "", more = 0;
  const KIND = { federal: "Federal agency", "state-local": "State or local government", contractor: "Government contractor", "think-tank": "Think tank", "ngo-advocacy": "Association or nonprofit",
    "education-health": "Education or health", corporate: "Company", international: "International organization", media: "Media", consulting: "Consulting", legislative: "Legislative" };
  const mins = d => { const h = app.home; return Math.round(app.miles(h.lat, h.lon, d.lat, d.lon) * 2.4); };
  const linkBtn = d => d.url ? `<a class="btn sm${d.linkType === "careers" ? " primary" : ""}" data-a="dir-open" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${d.linkType === "careers" ? "Careers" : "Website"} ↗</a>` : "";
  const jobsAt = d => app.jobs && app.jobs.all ? app.jobs.all().filter(j => j.status !== "dismissed" && j.empId === d.id).length : 0;

  app.pinProviders.push(() => !on || app.tab === "rank" ? [] : shown.map((d, i) => ({
    key: "dir:" + d.id, kind: "dir", id: d.id, ref: d, x: d.x, y: 12, z: d.z, order: 40000 + i, px: 18, sel: 28, rs: 97,
    badge: c => ["E", app.cssv("--dirpin"), c.ring, "#ffffff", true], tip: () => d.name + (d.town ? " · " + d.town : ""), pick: () => open(d.id, true) })));

  function open(id, go) {
    const d = byId.get(id); if (!d) return; const n = jobsAt(d);
    app.openCard({ kind: "dir", id, x: d.x, z: d.z, go, html: `<p class="eyebrow">${esc(KIND[d.kind] || "Employer")}</p><h2 style="padding-right:30px">${esc(d.name)}</h2>
      <p class="addr">${esc(d.addr || "")} &middot; about ${mins(d)} min drive</p>
      <div class="btn-row">${linkBtn(d) || '<span class="kit-note">No careers page found yet.</span>'}</div>
      ${n ? `<p class="kit-note">${n} ${n === 1 ? "opening" : "openings"} on your map from this employer.</p>` : ""}
      <p class="kit-note">${d.linkType === "website" ? "Homepage: look for a Careers or Jobs link. " : ""}Checked ${esc(d.checked || "")}. ${(d.src || []).map(safeUrl).filter(Boolean).slice(0, 1).map(u => `<a class="dir" href="${esc(u)}" target="_blank" rel="noopener noreferrer">Source &#8599;</a>`).join("")}</p>` });
  }

  const match = d => !q || (d.name + " " + d.addr).toLowerCase().includes(q);
  function rowsHtml() {
    const rows = shown.filter(match).map(d => [mins(d), d]).sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)), cap = MAXROWS + more;
    return (rows.length ? "" : '<p class="kit-note">No employer matches that search.</p>') + rows.slice(0, cap).map(([m, d]) => `<div class="dirrow" data-dir="${esc(d.id)}"><button type="button" class="dir-name" data-a="dir-show">${esc(d.name)}</button><span class="s">${esc(d.town)} &middot; ${m} min</span>${linkBtn(d)}</div>`).join("")
      + (rows.length > cap ? `<button type="button" class="btn sm" id="dir-more">Show ${Math.min(MAXROWS, rows.length - cap)} more</button>` : "");
  }
  function bindRows(root) {
    root.querySelectorAll('[data-a="dir-show"]').forEach(b => b.onclick = () => open(b.closest(".dirrow").dataset.dir, true));
    const m = root.querySelector("#dir-more"); if (m) m.onclick = () => { more += MAXROWS; paint(root.closest("#card") || document); };
  }
  const paint = root => { const box = root.querySelector("#dir-rows"); if (box) { box.innerHTML = rowsHtml(); bindRows(box); } };
  function openList() {
    app.openCard({ kind: "dirlist", id: "all", html: `<p class="eyebrow">Employer directory</p><h2 style="padding-right:30px">All NoVA employers</h2>
      <p class="kit-note">${shown.length} employers across Northern Virginia, nearest first. Tap a name to see it on the map.</p>
      <label class="dir-pins"><input type="checkbox" id="dir-pins"${on ? " checked" : ""}> Show these employers on the map</label>
      <input type="search" id="dir-q" class="dir-q" placeholder="Search employers or towns" aria-label="Search employers or towns" value="${esc(q)}">
      <div id="dir-rows"></div>`, bind: root => {
        paint(root);
        const inp = root.querySelector("#dir-q"); inp.oninput = () => { q = inp.value.trim().toLowerCase(); more = 0; paint(root); };
        root.querySelector("#dir-pins").onchange = ev => { on = ev.target.checked; app.store.set(KEY, on); sync(); app.refresh(); };
      } });
  }

  const places = app.$("places"); let sync = () => {};
  if (shown.length && places) {
    const b = document.createElement("button"); b.type = "button"; b.className = "mbtn"; b.id = "dirbtn"; b.title = "All Northern Virginia employers, with careers links";
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M10 9h4M10 12h3M10 15h4M10 9v6"/></svg>Employers';
    sync = () => b.setAttribute("aria-pressed", String(on));
    b.onclick = openList; sync(); places.insertBefore(b, app.$("jump"));
  }
  app.directory = { all: () => all, get: id => byId.get(id) || null, open, openList, isOn: () => on };
});
