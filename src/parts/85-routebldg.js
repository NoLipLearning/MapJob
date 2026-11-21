// 85-routebldg: click a building from the route tiles (tiles/rb-*.json) and get a card: name if the county record has one, source, height if known,
// employers on the map and saved openings in or within 60 m of it. Uses the core events "tile-loaded" and "map-click" (no pin was hit),
// and tiles/rb-index.json (written by src/route_buildings.py: source, county name and linked employer ids per building index). Nothing is invented: unnamed stays unnamed.
PARTS.push(function (app) {
  const esc = app.esc, LINK = 60, CELL = 100, grid = new Map(), tilesSeen = new Map(); let index = null, indexAsked = false;
  const loadIndex = () => { if (indexAsked) return; indexAsked = true; fetch("tiles/rb-index.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(j => { index = j; }).catch(() => { indexAsked = false; }); };
  const inPoly = (x, z, p) => { let c = false; for (let i = 0, n = p.length; i < n; i += 2) { const j = (i + n - 2) % n, x1 = p[i], z1 = p[i + 1], x2 = p[j], z2 = p[j + 1]; if ((z1 > z) !== (z2 > z) && x < (x2 - x1) * (z - z1) / (z2 - z1) + x1) c = !c; } return c; };
  const edgeDist = (x, z, p) => { let m = Infinity; for (let i = 0, n = p.length; i < n; i += 2) { const j = (i + n - 2) % n, ax = p[j], az = p[j + 1], dx = p[i] - ax, dz = p[i + 1] - az, L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0; m = Math.min(m, Math.hypot(x - ax - t * dx, z - az - t * dz)); } return m; };
  const linked = (x, z, p) => inPoly(x, z, p) || edgeDist(x, z, p) <= LINK;

  app.on("tile-loaded", d => {
    if (!d || typeof d.id !== "string" || d.id.indexOf("rb-") !== 0 || !Array.isArray(d.list) || tilesSeen.has(d.id)) return;
    tilesSeen.set(d.id, true); loadIndex();
    d.list.forEach((b, i) => { // light copy: outline in metres, bounding box, height in metres, whether the height is a record
      const p = []; for (let k = 2; k + 1 < b.length; k += 2) p.push(b[k] / 10, b[k + 1] / 10);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (let k = 0; k < p.length; k += 2) { x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); z0 = Math.min(z0, p[k + 1]); z1 = Math.max(z1, p[k + 1]); }
      const o = { tile: d.id, i, p, x0, x1, z0, z1, h: b[0] / 10, known: b[1] === 1 };
      for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) { const k = gx + "," + gz; (grid.get(k) || grid.set(k, []).get(k)).push(o); }
    });
  });

  // the building under a click: walk the ray down through the heights so a tall building's wall or roof counts, not only the ground behind it
  function pick(ray) {
    const o = ray.origin, dr = ray.direction; if (!(dr.y < 0)) return null;
    for (let Y = 80; Y >= 0; Y -= 2) {
      const t = (Y - o.y) / dr.y; if (t < 0) continue; const x = o.x + dr.x * t, z = o.z + dr.z * t;
      for (const b of grid.get(Math.floor(x / CELL) + "," + Math.floor(z / CELL)) || []) if (b.h >= Y - 1 && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && inPoly(x, z, b.p)) return b;
    }
    return null;
  }
  const ti = b => index && index.tiles ? index.tiles[b.tile] : null;
  const info = b => { const t = ti(b); return { name: t && t.n && t.n[b.i] || null, src: t && t.s && index.sources ? index.sources[t.s.charCodeAt(b.i) - 48] || null : null, emps: t && t.e && t.e[b.i] || [] }; };
  const empsIn = (b, ids) => { const out = new Map(); ids.forEach(id => { const e = app.E.find(q => q.id === id); if (e) out.set(id, e); }); app.E.forEach(e => { if (!out.has(e.id) && typeof e.x === "number" && linked(e.x, e.z, b.p)) out.set(e.id, e); }); return [...out.values()].sort((a, c) => (c.score || 0) - (a.score || 0)); };
  const jobsIn = b => app.jobs && app.jobs.all ? app.jobs.all().filter(j => { if (j.status === "dismissed" || !j.loc || typeof j.loc.lat !== "number" || typeof j.loc.lon !== "number") return false; const [x, z] = app.toXZ(j.loc.lat, j.loc.lon); return linked(x, z, b.p); })
    .sort((a, c) => (c.fit == null ? -1 : c.fit) - (a.fit == null ? -1 : a.fit)) : [];
  const more = (items, n, label) => items.length <= n ? items.join("") : items.slice(0, n).join("") + `<details class="ofc-more"><summary>Show ${items.length - n} more ${label}</summary>${items.slice(n).join("")}</details>`;

  function html(b, f, emps, jobs) {
    return `<p class="eyebrow">Building on your commute</p><h2 style="padding-right:30px">${esc(f.name || "Office/commercial building")}</h2>
      <p class="addr">${f.src ? "Source: " + esc(f.src) : "Source not available"}${b.known ? " &middot; height about " + Math.round(b.h) + " m" : ""}</p>
      ${f.name ? "" : `<p class="kit-note">The source record lists no name for this building.</p>`}
      <div class="kit-sec ofc"><h3>Employers on your map here</h3>${emps.length ? `<ul class="ofc-list">${more(emps.map(e => `<li><a class="dir" href="#" data-rb-emp="${esc(e.id)}">${esc(e.name)} &middot; match ${esc(e.score)}</a></li>`), 4, "employers")}</ul>` : `<p class="kit-note">No employer on your map is in or next to this building.</p>`}</div>
      <div class="kit-sec ofc"><h3>Open jobs here</h3>${jobs.length ? more(jobs.map(j => `<div class="kit-row ofc-job"><span class="jfit">${j.fit == null ? "–" : j.fit}</span><span class="t">${esc(j.title)}${j.employer ? " &middot; " + esc(j.employer) : ""}</span><button type="button" class="btn sm" data-rb-job="${esc(j.id)}">Open</button></div>`), 3, "jobs") : `<p class="kit-note">No saved opening is at this building.</p>`}</div>
      <p class="kit-note">Employers and jobs count when they sit inside the outline or within ${LINK} m of it.</p>`;
  }
  function open(b) {
    const f = info(b), emps = empsIn(b, f.emps), jobs = jobsIn(b), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    app.openCard({ kind: "rbldg", id: b.tile + ":" + b.i, x: cx, z: cz, go: false, html: html(b, f, emps, jobs), bind: root => {
      root.querySelectorAll("[data-rb-emp]").forEach(a => a.onclick = ev => { ev.preventDefault(); app.select(a.dataset.rbEmp, true); });
      root.querySelectorAll("[data-rb-job]").forEach(x => x.onclick = () => app.jobs.open(x.dataset.rbJob));
    } });
  }
  app.on("map-click", d => { const b = d && d.ray ? pick(d.ray) : null; if (b) open(b); });
  app.routeBuildings = { count: () => [...tilesSeen.keys()].length, at: (x, z) => { for (const b of grid.get(Math.floor(x / CELL) + "," + Math.floor(z / CELL)) || []) if (inPoly(x, z, b.p)) return { tile: b.tile, i: b.i }; return null; }, ready: () => !!index };
});
