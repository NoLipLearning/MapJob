// 80-offices: office buildings from app.D.offices (docs/DATA-CONTRACT-v4.md) as small square map pins, clustered by the core like employer pins.
// A "Buildings" button in the map controls turns the layer on and off. Tapping a pin opens a card: tenants as listed, employers on the map,
// open jobs here, and "Find openings" links. Every text goes through app.esc; links only open if they are https.
PARTS.push(function (app) {
  const esc = app.esc, KEY = "reston-map-buildings", KIND = { federal: "Federal building", government: "Government building", office: "Office building", nonprofit: "Nonprofit offices", company: "Company offices" };
  let list = Array.isArray(app.D.offices) ? app.D.offices : [];
  if (Array.isArray(window.RESTON_TEST_OFFICES)) list = window.RESTON_TEST_OFFICES; // tests only: replaces the real list with a fixture
  const offices = list.filter(o => o && typeof o.id === "string" && typeof o.lat === "number" && typeof o.lon === "number").slice(0, 4000);
  offices.forEach(o => { [o.x, o.z] = app.toXZ(o.lat, o.lon); o.tenants = Array.isArray(o.tenants) ? o.tenants.filter(t => typeof t === "string" && t.trim()) : []; o.empIds = Array.isArray(o.empIds) ? o.empIds : []; o.name = o.name || o.addr || "Office building"; });
  app.D.offices = offices;
  const byId = new Map(offices.map(o => [o.id, o]));
  let on = app.store.get(KEY) !== false;
  const safeUrl = u => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : null; } catch (_) { return null; } };

  // ---- pins ----
  app.pinProviders.push(() => !on || app.tab === "rank" ? [] : offices.map((o, i) => ({
    key: "office:" + o.id, kind: "office", id: o.id, ref: o, x: o.x, y: 16, z: o.z, order: 20000 + i, px: 22, sel: 30, rs: 98,
    badge: c => ["B", app.cssv("--office"), c.ring, "#ffffff", false], tip: () => o.name + " · " + (KIND[o.kind] || "Building"), pick: () => open(o.id, true)
  })));

  // ---- card ----
  const near100 = (j, o) => j.loc && typeof j.loc.lat === "number" && typeof j.loc.lon === "number" && app.miles(o.lat, o.lon, j.loc.lat, j.loc.lon) * 1609.34 <= 100;
  const jobsHere = o => app.jobs ? app.jobs.all().filter(j => j.status !== "dismissed" && (j.officeId === o.id || near100(j, o))).sort((a, b) => (b.fit == null ? -1 : b.fit) - (a.fit == null ? -1 : a.fit)) : [];
  const more = (items, n, label) => items.length <= n ? items.join("") : items.slice(0, n).join("") + `<details class="ofc-more"><summary>Show ${items.length - n} more ${label}</summary>${items.slice(n).join("")}</details>`;
  function html(o) {
    const emps = o.empIds.map(id => app.E.find(e => e.id === id)).filter(Boolean), jobs = jobsHere(o), main = o.tenants[0] || o.name, src = safeUrl(o.sourceUrl);
    const links = app.links && app.links.empLinks ? app.links.empLinks({ name: main, addr: o.addr, type: o.kind === "federal" ? "federal" : "" }) : "";
    return `<p class="eyebrow">${esc(KIND[o.kind] || "Building")}</p><h2 style="padding-right:30px">${esc(o.name)}</h2>
      <p class="addr">${esc(o.addr || "Address not listed")}</p>
      <div class="kit-sec ofc"><h3>Tenants as listed</h3>${o.tenants.length ? `<ul class="ofc-list">${more(o.tenants.map(t => `<li>${esc(t)}</li>`), 6, "tenants")}</ul>` : `<p class="kit-note">The source lists no tenants for this building.</p>`}</div>
      <div class="kit-sec ofc"><h3>Employers on your map here</h3>${emps.length ? `<ul class="ofc-list">${more(emps.map(e => `<li><a class="dir" href="#" data-ofc-emp="${esc(e.id)}">${esc(e.name)} &middot; match ${e.score}</a></li>`), 4, "employers")}</ul>` : `<p class="kit-note">No employer on your map is in this building.</p>`}</div>
      <div class="kit-sec ofc"><h3>Open jobs here</h3>${jobs.length ? more(jobs.map(j => `<div class="kit-row ofc-job"><span class="jfit">${j.fit == null ? "–" : j.fit}</span><span class="t">${esc(j.title)}${j.employer ? " &middot; " + esc(j.employer) : ""}</span><button type="button" class="btn sm" data-ofc-job="${esc(j.id)}">Open</button></div>`), 3, "jobs") : `<p class="kit-note">No saved opening is at this address.</p>`}</div>
      ${links ? `<div class="kit-sec links-sec"><h3>Find openings</h3><div class="btn-row">${links}</div><p class="kit-note">Searches for ${esc(main)}. Opens in your own browser.</p></div>` : ""}
      <p class="kit-note">${o.checked ? "Checked " + esc(o.checked) + ". " : ""}${src ? `<a class="dir" href="${esc(src)}" target="_blank" rel="noopener noreferrer">Source &#8599;</a>` : ""} Tenant lists can be out of date.</p>`;
  }
  function open(id, go) {
    const o = byId.get(id); if (!o) return;
    app.openCard({ kind: "office", id, x: o.x, z: o.z, go, html: html(o), bind: root => {
      root.querySelectorAll("[data-ofc-emp]").forEach(a => a.onclick = ev => { ev.preventDefault(); app.select(a.dataset.ofcEmp, true); });
      root.querySelectorAll("[data-ofc-job]").forEach(b => b.onclick = () => app.jobs.open(b.dataset.ofcJob));
    } });
  }

  // ---- Buildings button ----
  const places = app.$("places");
  if (offices.length && places) {
    const b = document.createElement("button"); b.type = "button"; b.className = "mbtn"; b.id = "bldbtn"; b.title = "Show or hide office building pins";
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="16" rx="1.5"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h6"/></svg>Buildings<span class="bk" aria-hidden="true"></span>';
    const sync = () => { b.setAttribute("aria-pressed", String(on)); b.querySelector(".bk").textContent = on ? "✓" : ""; };
    b.onclick = () => { on = !on; app.store.set(KEY, on); sync(); if (!on && app.selected && app.selected.kind === "office") app.closeCard(); else app.refresh(); };
    sync(); places.insertBefore(b, app.$("jump"));
  }
  app.offices = { all: () => offices, get: id => byId.get(id) || null, open, isOn: () => on, jobsHere };
});
