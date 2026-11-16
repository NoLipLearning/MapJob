const PARTS = []; // feature parts push function(app){...}; 99-boot.js runs them after the core is defined
const D = __DATA__;
const toXZ = (lat, lon) => [(lon - D.lon0) * D.kx, (D.lat0 - lat) * D.ky];
const toLL = (x, z) => [D.lat0 - z / D.ky, D.lon0 + x / D.kx];
const miles = (a, b, c, d) => { const R = 3958.8, r = Math.PI / 180, dl = (c - a) * r, dn = (d - b) * r; const h = Math.sin(dl / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const $ = id => document.getElementById(id);
const esc = t => String(t == null ? "" : t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };

const AREAS = ["Reston, Herndon and Loudoun", "Tysons, McLean and Fairfax", "Arlington and Alexandria", "Washington, DC", "Maryland suburbs", "Warrenton and Prince William"];
const KINDS = { gov: ["Government", ["federal", "legislative", "state-local"]], policy: ["Think tanks and nonprofits", ["think-tank", "ngo-advocacy", "international", "party-campaign"]],
  media: ["Media and research", ["media", "polling-research"]], firms: ["Consulting and contractors", ["consulting", "contractor"]], corp: ["Companies, health and education", ["corporate", "education-health"]] };
const TYPE_LABEL = { federal: "Federal agency", legislative: "Legislative branch", "state-local": "State or local government", "think-tank": "Think tank", "ngo-advocacy": "Nonprofit", international: "International organization",
  "party-campaign": "Party committee", media: "Media", "polling-research": "Polling and research", consulting: "Consulting", contractor: "Government contractor", corporate: "Company", "education-health": "Education or health" };
const CL_LABEL = { none: "No clearance for entry roles", some: "Some entry roles need a clearance", most: "Most entry roles need a clearance" };
const PLACES = { reston: [38.9585, -77.3578, 3500], tysons: [38.9187, -77.2311, 3500], dc: [38.8977, -77.0300, 5000], warrenton: [38.7135, -77.7953, 3500], rosslyn: [38.8960, -77.0760, 3200], region: [38.83, -77.41, 76000] };
const DEFAULT_HOME = [38.93472, -77.32540]; // Eric's home (Reston); a saved home from "Set my home" overrides it
const W_DEFAULT = [35, 30, 20, 15];

// ---------- State ----------
let home = store.get("reston-map-home") || { lat: DEFAULT_HOME[0], lon: DEFAULT_HOME[1], isDefault: true };
let weights = (store.get("reston-map-weights") || W_DEFAULT).slice(0, 4);
let tab = "emp", query = "", rankArea = "all", showCount = 200;
let selected = null; // {kind:'emp'|'rank', id}
const E = D.emps; const RANK = D.rank;
E.forEach(e => { [e.x, e.z] = toXZ(e.lat, e.lon); e.roof = e.bp ? e.bp[0] / 10 : 0; });
RANK.forEach(r => { r.title = r.name || r.addr || "Unnamed office building"; });
const RANK_AREAS = [...new Set(RANK.map(r => r.area))];

// ---------- Part API ----------
// Feature parts (src/parts/10-*.js ... 50-*.js) talk to the core only through `app`.
//   app.on(evt, fn) / app.emit(evt, data)   events: filters-changed, selection-changed, tracker-changed, home-changed, refreshed
//   app.hooks.filter     [fn(e) -> bool]       extra list/marker filters (all must pass)
//   app.hooks.commute    fn(e) -> 0..1 | null  replace the commute score when it returns a number
//   app.hooks.card       [fn(e) -> {slot:'top'|'main'|'bottom', html, bind(cardEl)} | null]  sections of the employer card
//   app.hooks.markers    [fn(e) -> {color, glyph, pos:"tr"|"tl"} | null]  status dots on an employer's map badge (first per corner wins)
//   app.employers.add(list) -> number   add employers after load (new ids only), then refresh
//   app.hooks.row        [fn(e) -> html]       extra line(s) inside a list row
//   app.addTab({id, label, render(listEl), count(), items(), markers()})  extra list tab
//   app.pinProviders     [fn() -> [pin]]  extra map pins (office buildings). pin = {key, kind, id, ref, x, y, z, order, px, badge(ctx)->[label, fill, ring, txt, round], tip(), pick()}
//   app.openCard({kind, id, html, bind, x, z, go})   show a card for a non-employer thing (selected becomes {kind, id})
//   app.queryMatch(e)    true when the employer passes the search box;  app.cluster  {layout(), stats()} for pin clustering
const app = {
  D, E, RANK, store, esc, miles, toXZ, toLL, $,
  hooks: { filter: [], commute: null, card: [], markers: [], row: [], rankCard: [] }, tabs: {}, _h: {}, pinProviders: [], cssv,
  queryMatch(e) { return qmatchEmp(e); },
  openCard(o) {
    selected = { kind: o.kind, id: o.id }; highlight(null);
    if (o.go && glOK && typeof o.x === "number") flyTo(o.x, o.z, Math.min(Math.max(curDist() * 0.6, 500), 1800), curPolar());
    showCard(o.html); if (o.bind) { try { o.bind(card); } catch (x) { console.error(x); } }
    card.scrollTop = 0; refresh(); app.emit("selection-changed", { kind: o.kind, id: o.id });
  },
  closeCard() { closeCard(); },
  on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); },
  emit(ev, d) { (this._h[ev] || []).forEach(fn => { try { fn(d); } catch (x) { console.error("[" + ev + "]", x); } }); },
  get home() { return home; }, get selected() { return selected; }, get tab() { return tab; }, get ranked() { return ranked; },
  get glOK() { return glOK; }, get scene() { return scene; }, get camera() { return camera; },
  select(id, go) { selectEmp(id, go); }, refresh() { refresh(); }, needsRender() { needs = true; },
  // an employer on the map, or for "job:<jobId>" a stand-in built from that opening (employer not on the map)
  findEmployer(id) {
    const e = E.find(x => x.id === id); if (e || !/^job:/.test(id || "") || !app.jobs) return e || null;
    const j = app.jobs.get(id.slice(4)); if (!j) return null;
    return { id, name: j.employer || "Employer not on your map", type: "", addr: (j.loc && j.loc.text) || "", reg: "", why: "", roles: [j.title], progs: [], cl: { none: "none", sponsor: "some", required: "most" }[j.clearance] || "none", s: [3, 3, 3], src: [], notes: "", fromJob: true };
  },
  commuteMi: e => commuteMi(e), homeLL: () => homeLL(), fmtMi: m => fmtMi(m),
  addTab(t) {
    this.tabs[t.id] = t;
    const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "tab"); b.id = "tab-" + t.id; b.setAttribute("aria-selected", "false"); b.setAttribute("aria-controls", "list");
    b.innerHTML = '<span class="tl">' + esc(t.label) + '</span><span class="c" id="cnt-' + t.id + '"></span>'; b.onclick = () => setTab(t.id); $("tabs").appendChild(b);
  },
  toast(msg, opt) { toast(msg, opt); },
  employers: {
    add(list) {
      let n = 0;
      (list || []).forEach(e => {
        if (!e || !e.id || E.some(x => x.id === e.id) || typeof e.lat !== "number" || typeof e.lon !== "number") return;
        const r = Object.assign({ type: "corporate", addr: "", reg: "", url: "", roles: [], progs: [], cl: "none", s: [3, 3, 3], why: "", src: [], notes: "", metro: false }, e);
        [r.x, r.z] = toXZ(r.lat, r.lon); r.roof = r.bp ? r.bp[0] / 10 : 0; E.push(r); n++;
      });
      if (n) refresh();
      return n;
    }
  }
};

app.cluster = { layout: () => layoutClusters(true), stats: () => Object.assign({}, clusterStats, { dist: glOK ? curDist() : 0, bubbles: clusterStats.bubbles.slice() }),
  // screen position (px, relative to the canvas) of each cluster bubble, for tests and keyboard-free checks
  bubbleAt: () => sprites.filter(s => s.kind === "cluster").map(s => { const p = project(s.sp.position); return p ? { n: s.ref.n, kind: s.ref.kind, x: p[0], y: p[1] } : null; }).filter(Boolean) };

// ---------- Scoring ----------
const homeLL = () => home ? [home.lat, home.lon] : DEFAULT_HOME;
function commuteMi(e) { const h = homeLL(); return miles(h[0], h[1], e.lat, e.lon); }
function commuteScore(e) { const hv = app.hooks.commute && app.hooks.commute(e); if (hv != null) return hv; const m = commuteMi(e); let s = m <= 5 ? 1 : m <= 10 ? .8 : m <= 18 ? .6 : m <= 28 ? .4 : m <= 40 ? .2 : 0; if (e.metro) s = Math.min(1, s + .15); return s; }
function factors(e) { return [(e.s[0] - 1) / 4, (e.s[1] - 1) / 4, (e.s[2] - 1) / 4, commuteScore(e)]; }
function score(e) { const f = factors(e), tot = weights.reduce((a, b) => a + b, 0) || 1; return Math.round(100 * f.reduce((a, v, i) => a + v * weights[i], 0) / tot); }
const band = s => s >= 80 ? "m1" : s >= 65 ? "m2" : s >= 50 ? "m3" : "m4";
let ranked = [];
const SORT_EMP = [["best", "Best match"], ["near", "Closest"], ["name", "Name"]], SORT_EMP_KEY = "reston-map-sort-emp";
let sortEmp = (v => SORT_EMP.some(o => o[0] === v) ? v : "best")(store.get(SORT_EMP_KEY));
const SORT_FN = {
  best: (a, b) => b.score - a.score || commuteMi(a) - commuteMi(b) || a.name.localeCompare(b.name),
  near: (a, b) => commuteMi(a) - commuteMi(b) || b.score - a.score || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name) || b.score - a.score
};
function computeRanking() {
  E.forEach(e => { e.score = score(e); });
  ranked = E.filter(visEmp).sort(SORT_FN[sortEmp]);
  ranked.forEach((e, i) => e.rank = i + 1);
  E.forEach(e => { if (!ranked.includes(e)) e.rank = null; });
}
function qmatch(s) { const q = query.trim().toLowerCase(); return !q || s.toLowerCase().includes(q); }
const qmatchEmp = e => qmatch([e.name, e.addr, e.reg, TYPE_LABEL[e.type], e.roles.join(" "), e.why].join(" "));
function visEmp(e) { return app.hooks.filter.every(fn => fn(e)) && qmatchEmp(e); }
function visRank(r) { return (rankArea === "all" || r.area === rankArea) && qmatch(r.title + " " + r.addr + " " + r.area + " " + (r.emps || []).map(id => (E.find(e => e.id === id) || {}).name).join(" ")); }

// ---------- 3D ----------
const box = $("mapbox"), canvas = $("gl"), card = $("card"), listEl = $("list"), tip = $("tip"), hint = $("hint");
let renderer, scene, camera, controls, glOK = true, needs = true, fly = null, setMode = false, tiltOn = true, W = 800, H = 600;
const held = new Map(); let lastT = 0, overMap = false, dragMode = "move", cardMin = false; // the card is a docked drawer now, so there is no shrunk state
const BOUNDS = { x0: -55000, x1: 50000, z0: -30000, z1: 45000 };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const layers = {}, bld = { est: [], tag: [], tall: [] }, sprites = []; let homeSprite = null, selMesh = null, hoverKey = null;
const tiles = {}; const TILT = 1.0, TOP = 0.06;
function fail(msg) {
  glOK = false; canvas.style.display = "none"; box.querySelectorAll(".places,.zoom,.legend,.hint,.pad,.help").forEach(n => n.hidden = true);
  const d = document.createElement("div"); d.className = "fallback"; d.textContent = msg; box.appendChild(d);
}
function init() {
  if (typeof THREE === "undefined" || !THREE.OrbitControls) return fail("The 3D library could not load. The ranked list still works, with every careers link.");
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch (e) { return fail("This browser could not start 3D graphics. The ranked list still works, with every careers link."); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(45, 1, 30, 260000);
  controls = new THREE.OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.12, screenSpacePanning: false, minDistance: 120, maxDistance: 110000, minPolarAngle: 0.02, maxPolarAngle: 1.45 });
  controls.addEventListener("change", () => { needs = true; });
  setDragMode("move");
  scene.add(new THREE.AmbientLight(0xffffff, 0.78)); const sun = new THREE.DirectionalLight(0xffffff, 0.62); sun.position.set(-0.6, 1, 0.8); scene.add(sun); scene.userData.sun = sun;
  buildWorld(); applyTheme();
  const [x, z] = toXZ(...homeLL()); controls.target.set(x, 0, z);
  camera.position.copy(new THREE.Vector3().setFromSpherical(new THREE.Spherical(3500, TILT, 0)).add(controls.target)); camera.lookAt(controls.target); controls.update();
  new ResizeObserver(resize).observe(box); resize();
  const mq = matchMedia("(prefers-color-scheme: dark)"); mq.addEventListener && mq.addEventListener("change", applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  requestAnimationFrame(loop);
}
const geo = pos => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); return g; };
function ribbon(lines, w) {
  const pos = [];
  for (const L of lines) for (let i = 0; i + 3 < L.length; i += 2) {
    const ax = L[i], az = L[i + 1], bx = L[i + 2], bz = L[i + 3], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz); if (!len) continue;
    const nx = -dz / len * w / 2, nz = dx / len * w / 2;
    pos.push(ax + nx, 0, az + nz, ax - nx, 0, az - nz, bx + nx, 0, bz + nz, ax - nx, 0, az - nz, bx - nx, 0, bz - nz, bx + nx, 0, bz + nz);
  }
  return geo(pos);
}
function segs(lines) { const pos = []; for (const L of lines) for (let i = 0; i + 3 < L.length; i += 2) pos.push(L[i], 0, L[i + 1], L[i + 2], 0, L[i + 3]); return geo(pos); }
function flatPoly(polys) {
  const pos = [];
  for (const L of polys) {
    const pts = []; for (let i = 0; i + 1 < L.length; i += 2) pts.push(new THREE.Vector2(L[i], L[i + 1]));
    if (pts.length > 1 && pts[0].equals(pts[pts.length - 1])) pts.pop(); if (pts.length < 3) continue;
    for (const t of THREE.ShapeUtils.triangulateShape(pts, [])) pos.push(pts[t[0]].x, 0, pts[t[0]].y, pts[t[1]].x, 0, pts[t[1]].y, pts[t[2]].x, 0, pts[t[2]].y);
  }
  return geo(pos);
}
function pushBuilding(pos, b, lift) {
  const h = b[0] / 10 + (lift || 0); const pts = []; for (let i = 2; i + 1 < b.length; i += 2) pts.push([b[i] / 10, b[i + 1] / 10]);
  if (pts.length < 3) return;
  let area = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
  if (area > 0) pts.reverse();
  const n = pts.length;
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; pos.push(p[0], 0, p[1], q[0], 0, q[1], q[0], h, q[1], p[0], 0, p[1], q[0], h, q[1], p[0], h, p[1]); }
  for (const t of THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p[0], p[1])), [])) {
    let a = pts[t[0]], bb = pts[t[1]], c = pts[t[2]];
    if ((bb[0] - a[0]) * (c[1] - a[1]) - (bb[1] - a[1]) * (c[0] - a[0]) > 0) { const tmp = bb; bb = c; c = tmp; }
    pos.push(a[0], h, a[1], bb[0], h, bb[1], c[0], h, c[1]);
  }
}
function addBuildings(list) {
  const groups = { est: [], tag: [], tall: [] };
  for (const b of list) pushBuilding(b[1] && b[0] >= 300 ? groups.tall : b[1] ? groups.tag : groups.est, b);
  for (const k in groups) {
    if (!groups[k].length) continue;
    const g = geo(groups[k]); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: new THREE.Color(cssv({ est: "--bld-est", tag: "--bld", tall: "--bld-tall" }[k])) }));
    m.renderOrder = 5; scene.add(m); bld[k].push(m);
  }
  needs = true;
}
function addLayer(name, g, k, order, y) {
  const mat = k === "line" ? new THREE.LineBasicMaterial({ depthWrite: false }) : new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, depthWrite: false });
  const m = k === "line" ? new THREE.LineSegments(g, mat) : new THREE.Mesh(g, mat); m.renderOrder = order; m.position.y = y; scene.add(m); layers[name] = m;
}
function buildWorld() {
  const r = D.r;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500000, 500000), new THREE.MeshBasicMaterial({ depthWrite: false }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -2; ground.renderOrder = -20; scene.add(ground); layers.ground = ground;
  addLayer("river", ribbon(r.river, 260), "mesh", -10, 0);
  addLayer("water", flatPoly(r.water), "mesh", -9, 0.1);
  addLayer("wrail", segs(r.wrail), "line", -8, 0.2);
  addLayer("wb", segs(r.wb), "line", -7, 0.3);
  addLayer("wa", segs(r.wa), "line", -6, 0.4);
  addLayer("d", ribbon(r.d, 6), "mesh", -5, 0.5);
  addLayer("c", ribbon(r.c, 9), "mesh", -4, 0.6);
  addLayer("b", ribbon(r.b, 13), "mesh", -3, 0.7);
  addLayer("a", ribbon(r.a, 22), "mesh", -2, 0.8);
  addLayer("rail", ribbon(r.rail, 8), "mesh", -1, 0.9);
  addBuildings(D.b);
}
function checkTiles() {
  if (!glOK) return;
  const d = camera.position.distanceTo(controls.target);
  if (d > 18000) return;
  for (const t of D.tiles) {
    if (tiles[t.id]) continue;
    if (Math.hypot(controls.target.x - t.cx, controls.target.z - t.cz) > t.rad + 5000) continue;
    tiles[t.id] = "loading"; const st = $("status"); st.hidden = false; st.textContent = "Loading " + t.name + " buildings…";
    fetch(t.file).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(list => { addBuildings(list); tiles[t.id] = "done"; st.hidden = true; })
      .catch(() => { tiles[t.id] = "failed"; st.textContent = t.name + " buildings could not load"; setTimeout(() => st.hidden = true, 3000); });
  }
}
function highlight(bp) {
  if (selMesh) { scene.remove(selMesh); selMesh.geometry.dispose(); selMesh = null; }
  if (!glOK || !bp) { needs = true; return; }
  const pos = []; pushBuilding(pos, bp, 0.6); const g = geo(pos); g.computeVertexNormals();
  selMesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: new THREE.Color(cssv("--sel")), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const ox = bp[2] / 10, oz = bp[3] / 10; selMesh.scale.set(1.004, 1, 1.004); selMesh.position.set(-ox * 0.004, 0, -oz * 0.004);
  selMesh.renderOrder = 6; scene.add(selMesh); needs = true;
}
function applyTheme() {
  if (!scene) return;
  const c = n => new THREE.Color(cssv(n)); const ground = c("--ground");
  scene.background = ground; scene.fog = new THREE.Fog(ground.getHex(), 8000, 60000); layers.ground.material.color.copy(ground);
  layers.river.material.color.copy(c("--water")); layers.water.material.color.copy(c("--water"));
  layers.wrail.material.color.copy(c("--rail")); layers.wb.material.color.copy(c("--road-line")); layers.wa.material.color.copy(c("--road-a"));
  ["d", "c", "b"].forEach(k => layers[k].material.color.copy(c("--road"))); layers.a.material.color.copy(c("--road-a")); layers.rail.material.color.copy(c("--rail"));
  bld.est.forEach(m => m.material.color.copy(c("--bld-est"))); bld.tag.forEach(m => m.material.color.copy(c("--bld"))); bld.tall.forEach(m => m.material.color.copy(c("--bld-tall")));
  if (selMesh) selMesh.material.color.copy(c("--sel"));
  const dark = document.documentElement.dataset.theme === "dark" || (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  scene.children.forEach(o => { if (o.isAmbientLight) o.intensity = dark ? 0.95 : 0.78; }); scene.userData.sun.intensity = dark ? 0.5 : 0.62;
  rebuildMarkers(); needs = true;
}

// ---------- Markers ----------
function badge(label, fill, ring, txt, round, dots) {
  const s = 96, cv = document.createElement("canvas"); cv.width = cv.height = s; const x = cv.getContext("2d");
  const shape = inset => { x.beginPath(); if (round) x.arc(s / 2, s / 2, s / 2 - inset, 0, 7); else if (x.roundRect) x.roundRect(inset, inset, s - 2 * inset, s - 2 * inset, 14); else x.rect(inset, inset, s - 2 * inset, s - 2 * inset); };
  x.fillStyle = ring; shape(4); x.fill(); x.fillStyle = fill; shape(12); x.fill();
  x.fillStyle = txt; x.font = `600 ${label.length > 2 ? 30 : 40}px 'IBM Plex Mono', monospace`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(label, s / 2, s / 2 + 2);
  (dots || []).forEach(d => { const cx = d.pos === 'tl' ? 22 : s - 22; x.fillStyle = ring; x.beginPath(); x.arc(cx, 22, 20, 0, 7); x.fill(); x.fillStyle = d.color; x.beginPath(); x.arc(cx, 22, 15, 0, 7); x.fill(); x.fillStyle = '#fff'; x.font = "700 20px 'IBM Plex Mono', monospace"; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(d.glyph || '', cx, 23); });
  return new THREE.CanvasTexture(cv);
}
function markerDots(e) {
  const out = {};
  app.hooks.markers.forEach(fn => { let d = null; try { d = fn(e); } catch (x) { console.error(x); } if (d) { const p = d.pos === "tl" ? "tl" : "tr"; if (!out[p]) out[p] = Object.assign({}, d, { pos: p }); } });
  return Object.values(out);
}
function makeSprite(tex, order) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, transparent: true })); sp.renderOrder = order; scene.add(sp); return sp; }
// Pins are described once per rebuild (`pins`); which of them become sprites depends on the camera: pins closer than
// CLUSTER_PX on screen merge into one count bubble (layoutClusters). Clustering is off once the camera is close in.
const pins = [], CLUSTER_PX = 44, CLUSTER_MIN_DIST = 450; let texCache = new Map(), clusterSig = "", camSig = [], clusterT = 0, clusterStats = { pins: 0, inView: 0, sprites: 0, bubbles: [] };
function pinTex(args) { const k = JSON.stringify(args); let t = texCache.get(k); if (!t) { t = badge(...args); texCache.set(k, t); } return t; }
function clearSprites() { sprites.forEach(s => { scene.remove(s.sp); s.sp.material.dispose(); }); sprites.length = 0; }
function clearPins() { clearSprites(); pins.length = 0; texCache.forEach(t => t.dispose()); texCache = new Map(); clusterSig = ""; }
function addPin(p) { pins.push(p); }
function rebuildMarkers() {
  if (!glOK || !scene) return;
  clearPins();
  const ring = cssv("--panel"), dark = ring !== "#fafaf7", txt = dark ? "#0e1517" : "#ffffff";
  const empPin = (e, label, order, withDots) => addPin({ key: "emp:" + e.id, kind: "emp", id: e.id, ref: e, x: e.x, y: Math.max(e.roof, 14) + 10, z: e.z, order, px: 28, sel: 40, rs: 100,
    badge: () => [String(label), cssv("--" + band(e.score)), ring, txt, true, withDots ? markerDots(e) : undefined], tip: () => `${e.name} · ${e.score}`, pick: () => selectEmp(e.id, true) });
  if (tab === "emp") ranked.slice(0, showCount).forEach(e => empPin(e, e.rank, e.rank, true));
  if (tab === "emp" && selected && selected.kind === "emp") {
    const e = E.find(x => x.id === selected.id);
    if (e && !pins.some(p => p.ref === e)) empPin(e, e.rank ? e.rank : "•", 9000, false);
  }
  if (app.tabs[tab] && app.tabs[tab].markers) app.tabs[tab].markers().forEach((m, i) => empPin(m.e, m.label, i + 1, true));
  if (tab === "rank") RANK.filter(visRank).forEach(r => addPin({ key: "rank:" + r.n, kind: "rank", id: r.n, ref: r, x: r.x, y: r.bp[0] / 10 + 10, z: r.z, order: r.n, px: 26, sel: 40, rs: 99,
    badge: () => [String(r.n), cssv("--ink"), ring, cssv("--panel"), false], tip: () => `#${r.n} ${r.title} · ${sqft(r.sqft)} sq ft`, pick: () => selectRank(r.n, true) }));
  app.pinProviders.forEach(fn => { let L = []; try { L = fn() || []; } catch (x) { console.error(x); } L.forEach(p => addPin(Object.assign({ px: 22, sel: 30, rs: 98, order: 50000 }, p, { badge: () => p.badge({ ring, dark, txt }) }))); });
  if (homeSprite) { scene.remove(homeSprite); homeSprite.material.map.dispose(); homeSprite = null; }
  if (home) { const [x, z] = toXZ(home.lat, home.lon); homeSprite = makeSprite(badge("⌂", cssv("--accent"), ring, cssv("--accent-ink"), false), 101); homeSprite.position.set(x, 30, z); }
  layoutClusters(true);
}
const bubbleStyle = { emp: ["--ink", true], rank: ["--ink", false], office: ["--office", false] };
function layoutClusters(force) {
  if (!glOK || !scene || !camera) return;
  camera.updateMatrixWorld();
  const selKey = selected ? selected.kind + ":" + selected.id : null, on = camera.position.distanceTo(controls.target) >= CLUSTER_MIN_DIST;
  const vis = [], M = 80;
  pins.forEach(p => { const pr = project(new THREE.Vector3(p.x, p.y, p.z)); if (pr && pr[0] > -M && pr[0] < W + M && pr[1] > -M && pr[1] < H + M) vis.push({ p, sx: pr[0], sy: pr[1], used: false }); });
  vis.sort((a, b) => a.p.order - b.p.order);
  const out = [], groups = {};
  vis.forEach(v => { (groups[v.p.kind] = groups[v.p.kind] || []).push(v); });
  Object.keys(groups).forEach(kind => {
    const grid = new Map(), cell = v => Math.floor(v.sx / CLUSTER_PX) + "," + Math.floor(v.sy / CLUSTER_PX);
    groups[kind].forEach(v => { if (!on || v.p.key === selKey) { v.used = true; out.push({ one: v.p }); return; } const k = cell(v); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(v); });
    groups[kind].forEach(v => {
      if (v.used) return; v.used = true; const mem = [v], cx = Math.floor(v.sx / CLUSTER_PX), cy = Math.floor(v.sy / CLUSTER_PX);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) (grid.get((cx + i) + "," + (cy + j)) || []).forEach(o => { if (!o.used && Math.hypot(o.sx - v.sx, o.sy - v.sy) < CLUSTER_PX) { o.used = true; mem.push(o); } });
      out.push(mem.length === 1 ? { one: v.p } : { kind, mem: mem.map(m => m.p) });
    });
  });
  const sig = on + "|" + out.map(c => c.one ? c.one.key : "c:" + c.mem.map(m => m.key).join(",")).join(";");
  if (!force && sig === clusterSig) return; clusterSig = sig;
  clearSprites();
  const ring = cssv("--panel"), dark = ring !== "#fafaf7", bubbles = [];
  out.forEach(c => {
    if (c.one) { const p = c.one, sp = makeSprite(pinTex(p.badge()), p.rs); sp.position.set(p.x, p.y, p.z); sprites.push({ key: p.key, kind: p.kind, id: p.id, ref: p.ref, pin: p, sp, tip: p.tip, pick: p.pick }); return; }
    const n = c.mem.length, st = bubbleStyle[c.kind] || bubbleStyle.emp, sp = makeSprite(pinTex([String(n), cssv(st[0]), ring, dark ? "#0e1517" : "#ffffff", st[1]]), 102);
    const cx = c.mem.reduce((a, m) => a + m.x, 0) / n, cy = c.mem.reduce((a, m) => a + m.y, 0) / n, cz = c.mem.reduce((a, m) => a + m.z, 0) / n; sp.position.set(cx, cy, cz);
    const ref = { n, kind: c.kind, members: c.mem, x: cx, z: cz };
    sprites.push({ key: "cluster:" + c.kind + ":" + c.mem[0].key, kind: "cluster", ref, sp, tip: () => `${n} ${c.kind === "office" ? "buildings" : "places"} here. Click to zoom in.`, pick: () => zoomToCluster(ref) });
    bubbles.push({ n, kind: c.kind });
  });
  clusterStats = { pins: pins.length, inView: vis.length, sprites: sprites.length, bubbles };
  sizeMarkers();
}
function zoomToCluster(c) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; c.members.forEach(m => { x0 = Math.min(x0, m.x); x1 = Math.max(x1, m.x); z0 = Math.min(z0, m.z); z1 = Math.max(z1, m.z); });
  const need = Math.max((x1 - x0) / (W / H), (z1 - z0) * 1.35) * 1.2 / (2 * Math.tan(22.5 * Math.PI / 180));
  flyTo((x0 + x1) / 2, (z0 + z1) / 2, clamp(need, 380, Math.max(380, curDist() * 0.7)), curPolar());
}
function sizeMarkers() {
  if (!glOK || !scene) return;
  const k = 1 / (H * 1.207);
  sprites.forEach(s => {
    const isSel = s.pin && selected && selected.kind === s.kind && String(selected.id) === String(s.id);
    const px = s.kind === "cluster" ? 36 : isSel ? s.pin.sel : s.pin.px; s.sp.scale.set(px * k, px * k, 1);
  });
  if (homeSprite) homeSprite.scale.set(36 * k, 36 * k, 1);
  needs = true;
}

// ---------- Loop, picking ----------
let viewInset = 0; // px at the bottom of the map covered by the phone sheet: the camera centres on what is left
function resize() { const r = box.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height); renderer.setSize(W, H, false); camera.aspect = W / H; if (viewInset > 0) camera.setViewOffset(W, H, 0, viewInset / 2, W, H); else camera.clearViewOffset(); camera.updateProjectionMatrix(); sizeMarkers(); }
function setViewInset(px) { viewInset = Math.max(0, Math.min(px, H * 0.6)); if (glOK && renderer) resize(); }
let lastTileCheck = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000)); lastT = t;
  if (held.size) applyHeld(dt);
  if (fly) {
    const k = Math.min(1, (t - fly.t0) / fly.ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    controls.target.lerpVectors(fly.t, fly.t2, e);
    camera.position.copy(new THREE.Vector3().setFromSpherical(new THREE.Spherical(fly.d + (fly.d2 - fly.d) * e, fly.p + (fly.p2 - fly.p) * e, fly.a + (fly.a2 - fly.a) * e)).add(controls.target));
    camera.lookAt(controls.target); if (k >= 1) fly = null; needs = true;
  }
  const changed = controls.update();
  const tg = controls.target, cx = clamp(tg.x, BOUNDS.x0, BOUNDS.x1), cz = clamp(tg.z, BOUNDS.z0, BOUNDS.z1);
  if (cx !== tg.x || cz !== tg.z) { camera.position.x += cx - tg.x; camera.position.z += cz - tg.z; tg.x = cx; tg.z = cz; needs = true; }
  if (changed || needs) {
    const dist = camera.position.distanceTo(controls.target); scene.fog.near = dist * 2.2; scene.fog.far = dist * 7;
    renderer.render(scene, camera); needs = false; placeTip();
    $("needle").style.transform = "rotate(" + controls.getAzimuthalAngle() + "rad)";
    if (!fly) { const on = controls.getPolarAngle() > 0.5; if (on !== tiltOn) setTilt(on); }
  }
  const cam = [camera.position.x, camera.position.y, camera.position.z, controls.target.x, controls.target.z, W, H];
  if (cam.some((v, i) => v !== camSig[i])) { camSig = cam; clusterT = t; }
  if (clusterT && t - clusterT > 140) { clusterT = 0; layoutClusters(false); }
  if (t - lastTileCheck > 500) { lastTileCheck = t; checkTiles(); }
}
function flyTo(x, z, dist, polar, az) {
  if (!glOK) return;
  const sp = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  let a2 = sp.theta; if (az !== undefined) { let d = (az - sp.theta) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; a2 = sp.theta + d; }
  fly = { t0: performance.now(), ms: matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 800, t: controls.target.clone(), t2: new THREE.Vector3(clamp(x, BOUNDS.x0, BOUNDS.x1), 0, clamp(z, BOUNDS.z0, BOUNDS.z1)), d: sp.radius, d2: dist, p: sp.phi, p2: polar === undefined ? sp.phi : polar, a: sp.theta, a2 };
}
// Held actions (buttons and keys): move, rotate, tilt and zoom, frame by frame
function applyHeld(dt) {
  let f = 0, r = 0, rot = 0, tilt = 0, zm = 0;
  held.forEach(h => {
    switch (h.act) {
      case "up": f++; break; case "down": f--; break; case "left": r--; break; case "right": r++; break;
      case "rotL": rot--; break; case "rotR": rot++; break; case "tiltLow": tilt++; break; case "tiltTop": tilt--; break;
      case "zin": zm--; break; case "zout": zm++; break;
    }
  });
  if (!(f || r || rot || tilt || zm)) return;
  fly = null;
  const off = camera.position.clone().sub(controls.target), sp = new THREE.Spherical().setFromVector3(off);
  const n = Math.hypot(f, r) || 1, v = sp.radius * 0.9 * dt, s = Math.sin(sp.theta), c = Math.cos(sp.theta);
  controls.target.x += ((-s * f + c * r) / n) * v * (f || r ? 1 : 0); controls.target.z += ((-c * f - s * r) / n) * v * (f || r ? 1 : 0);
  sp.theta += rot * 1.2 * dt; sp.phi = clamp(sp.phi + tilt * 0.8 * dt, controls.minPolarAngle, controls.maxPolarAngle);
  sp.radius = clamp(sp.radius * Math.exp(zm * 1.3 * dt), controls.minDistance, controls.maxDistance);
  camera.position.setFromSpherical(sp).add(controls.target); camera.lookAt(controls.target); needs = true;
}
function startHeld(key, act) { held.set(key, { act, t0: performance.now() }); fly = null; }
function stopHeld(key) {
  const h = held.get(key); if (!h) return; const left = 220 - (performance.now() - h.t0);
  if (left > 0) setTimeout(() => { if (held.get(key) === h) held.delete(key); }, left); else held.delete(key);
}
function zoomAbout(px, pz, f) {
  const d = camera.position.distanceTo(controls.target), nd = clamp(d * f, controls.minDistance, controls.maxDistance); f = nd / d; if (Math.abs(f - 1) < 1e-4) return;
  const t = controls.target, p = camera.position;
  t.x = px + (t.x - px) * f; t.z = pz + (t.z - pz) * f; p.x = px + (p.x - px) * f; p.z = pz + (p.z - pz) * f; p.y *= f;
  camera.lookAt(t); needs = true;
}
function project(v) { const p = v.clone().project(camera); return p.z > 1 ? null : [(p.x * 0.5 + 0.5) * W, (-p.y * 0.5 + 0.5) * H]; }
function nearest(px, py, max) { let best = null, bd = max; sprites.forEach(s => { const p = project(s.sp.position); if (!p) return; const d = Math.hypot(p[0] - px, p[1] - py); if (d < bd) { bd = d; best = s; } }); return best; }
function groundPoint(px, py) { const r = new THREE.Raycaster(); r.setFromCamera(new THREE.Vector2(px / W * 2 - 1, -(py / H) * 2 + 1), camera); const pt = new THREE.Vector3(); return r.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt) ? pt : null; }
let down = null;
canvas.addEventListener("pointerdown", e => { down = [e.clientX, e.clientY]; fly = null; try { canvas.focus({ preventScroll: true }); } catch (_) {} });
canvas.addEventListener("contextmenu", e => e.preventDefault());
canvas.addEventListener("dblclick", e => {
  if (!glOK || setMode) return; const r = canvas.getBoundingClientRect(), g = groundPoint(e.clientX - r.left, e.clientY - r.top); if (!g) return;
  flyTo(g.x, g.z, clamp(curDist() * (e.shiftKey ? 2.2 : 0.45), 150, 110000), curPolar());
});
// Scroll zooms toward the cursor instead of the screen centre
box.addEventListener("wheel", e => {
  if (e.target !== canvas || !glOK) return; e.preventDefault(); e.stopPropagation(); fly = null;
  const dy = clamp(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1), -300, 300), f = Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0016));
  const r = canvas.getBoundingClientRect(), g = groundPoint(e.clientX - r.left, e.clientY - r.top), d = curDist();
  if (g && Math.hypot(g.x - controls.target.x, g.z - controls.target.z) < d * 3) zoomAbout(g.x, g.z, f); else zoomAbout(controls.target.x, controls.target.z, f);
}, { capture: true, passive: false });
box.addEventListener("mouseenter", () => { overMap = true; }); box.addEventListener("mouseleave", () => { overMap = false; });
canvas.addEventListener("pointerup", e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) { down = null; return; } down = null;
  const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  if (setMode) { const g = groundPoint(px, py); if (g) { const [lat, lon] = toLL(g.x, g.z); home = { lat, lon }; store.set("reston-map-home", home); endSetMode(); homeChip(); refresh(); app.emit("home-changed", home); flyTo(g.x, g.z, 3000, TILT); setTilt(true); } return; }
  const s = nearest(px, py, 20); if (s) s.pick();
});
canvas.addEventListener("pointermove", e => {
  if (e.buttons) { hoverKey = null; placeTip(); return; }
  const r = canvas.getBoundingClientRect(), s = setMode ? null : nearest(e.clientX - r.left, e.clientY - r.top, 18);
  hoverKey = s ? s.key : null; canvas.classList.toggle("pick", !!s); placeTip();
});
canvas.addEventListener("pointerleave", () => { hoverKey = null; placeTip(); });
function placeTip() {
  if (!glOK) return;
  const selKey = selected && window.innerWidth > 900 ? selected.kind + ":" + selected.id : null; const s = sprites.find(q => q.key === (hoverKey || selKey));
  if (!s) { tip.hidden = true; return; } const p = project(s.sp.position); if (!p) { tip.hidden = true; return; }
  tip.hidden = false; tip.textContent = s.tip();
  tip.style.maxWidth = ""; const room = W - p[0] - 28, left = p[0] - 28, flip = tip.offsetWidth > room && left > room; tip.classList.toggle("flip", flip); tip.style.maxWidth = Math.max(90, flip ? left : room) + "px"; tip.style.left = (flip ? p[0] - 12 : p[0] + 12) + "px"; tip.style.top = p[1] + "px";
}

// ---------- Map controls ----------
const curDist = () => camera.position.distanceTo(controls.target), curPolar = () => controls.getPolarAngle();
function setTilt(on) { tiltOn = on; $("tilt").setAttribute("aria-pressed", String(on)); $("tilt").textContent = on ? "3D" : "2D"; }
function goHome() { if (!glOK) return; if (!home) return beginSetMode(); const [x, z] = toXZ(home.lat, home.lon); flyTo(x, z, 3000, curPolar()); }
function toggleTilt() { if (!glOK) return; setTilt(!tiltOn); flyTo(controls.target.x, controls.target.z, curDist(), tiltOn ? TILT : TOP); }
function northUp() { if (glOK) flyTo(controls.target.x, controls.target.z, curDist(), curPolar(), 0); }
function fitPoints(pts) {
  if (!glOK || !pts.length) return; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  pts.forEach(([x, z]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); });
  const need = Math.max((x1 - x0) / (W / H), (z1 - z0) * 1.35) * 1.2;
  flyTo((x0 + x1) / 2, (z0 + z1) / 2, clamp(need / (2 * Math.tan(22.5 * Math.PI / 180)), 900, 90000), curPolar());
}
const listPts = () => tab === "emp" ? ranked.map(e => [e.x, e.z]) : RANK.filter(visRank).map(r => [r.x, r.z]);
const fitList = () => fitPoints(listPts());
function setDragMode(m) {
  dragMode = m; const b = $("dragmode"); b.textContent = m === "move" ? "Move" : "Turn"; b.setAttribute("aria-pressed", String(m === "turn"));
  const M = THREE.MOUSE, T = THREE.TOUCH;
  controls.mouseButtons = m === "move" ? { LEFT: M.PAN, MIDDLE: M.DOLLY, RIGHT: M.ROTATE } : { LEFT: M.ROTATE, MIDDLE: M.DOLLY, RIGHT: M.PAN };
  controls.touches = m === "move" ? { ONE: T.PAN, TWO: T.DOLLY_PAN } : { ONE: T.ROTATE, TWO: T.DOLLY_ROTATE };
}
$("dragmode").onclick = () => glOK && setDragMode(dragMode === "move" ? "turn" : "move");
$("compass").onclick = northUp;
$("padhome").onclick = goHome;
$("places").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b || !glOK || !b.dataset.p) return;
  if (b.dataset.p === "home") return goHome();
  if (b.dataset.p === "fit") return fitList();
  const p = PLACES[b.dataset.p]; const [x, z] = toXZ(p[0], p[1]); flyTo(x, z, p[2], curPolar());
});
// Press and hold for continuous motion; a quick tap or a keyboard activation still moves a clear step
function bindHold(el, act) {
  const key = "btn:" + act;
  el.addEventListener("pointerdown", e => { if (e.button) return; e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) {} el.classList.add("on"); startHeld(key, act); });
  const up = () => { el.classList.remove("on"); stopHeld(key); };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("lostpointercapture", up);
  el.addEventListener("click", e => { if (e.detail === 0 && glOK) { startHeld(key, act); stopHeld(key); } });
}
$("pad").querySelectorAll("button[data-a]").forEach(b => bindHold(b, b.dataset.a));
bindHold($("zin"), "zin"); bindHold($("zout"), "zout");
$("tilt").onclick = toggleTilt;
function toggleHelp(on) { const h = $("help"); h.hidden = on === undefined ? !h.hidden : !on; $("helpbtn").setAttribute("aria-pressed", String(!h.hidden)); if (!h.hidden) { $("legend").hidden = true; $("keybtn").setAttribute("aria-pressed", "false"); store.set("reston-map-help-seen", true); } }
$("helpbtn").onclick = () => toggleHelp(); $("helpx").onclick = () => toggleHelp(false);
$("keybtn").onclick = () => { const l = $("legend"); l.hidden = !l.hidden; $("keybtn").setAttribute("aria-pressed", String(!l.hidden)); if (!l.hidden) toggleHelp(false); };
function beginSetMode() {
  if (!glOK) return; setMode = true; $("sethome").setAttribute("aria-pressed", "true"); $("sethome").textContent = "Click the map to place home";
  hint.hidden = false; hint.textContent = "Click your street or building. Press Esc to cancel."; canvas.classList.add("set");
  setTilt(false); const [x, z] = toXZ(...homeLL()); flyTo(x, z, 2200, TOP);
}
function endSetMode() { setMode = false; $("sethome").setAttribute("aria-pressed", "false"); $("sethome").textContent = home ? "Move my home" : "Set my home"; hint.hidden = true; canvas.classList.remove("set"); }
$("sethome").onclick = () => setMode ? endSetMode() : beginSetMode();
function homeChip() { $("homechip").textContent = home ? "Commute measured from your home" : "Commute measured from Reston until you set your home"; }

// ---------- Filters and tuning ----------
$("q").addEventListener("input", e => { query = e.target.value; refresh(); });
function syncWeights() {
  weights.forEach((w, i) => { $("w" + i).value = w; });
  const tot = weights.reduce((a, b) => a + b, 0) || 1;
  weights.forEach((w, i) => { $("o" + i).textContent = Math.round(w / tot * 100) + "%"; });
  const same = weights.every((w, i) => w === W_DEFAULT[i]);
  $("wsum").textContent = same ? "Using your defaults" : "Custom weights";
}
[0, 1, 2, 3].forEach(i => $("w" + i).addEventListener("input", e => { weights[i] = +e.target.value; store.set("reston-map-weights", weights); syncWeights(); refresh(); }));
$("wreset").onclick = () => { weights = W_DEFAULT.slice(); store.set("reston-map-weights", weights); syncWeights(); refresh(); };
$("rankareas").innerHTML = ["all", ...RANK_AREAS].map(a => `<button type="button" data-a="${esc(a)}" aria-pressed="${a === "all"}">${a === "all" ? "All areas" : esc(a)}</button>`).join("");
$("rankareas").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return; rankArea = b.dataset.a;
  $("rankareas").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); refresh();
});
function setTab(t) {
  tab = t; document.querySelectorAll("#tabs [role=tab]").forEach(b => b.setAttribute("aria-selected", String(b.id === "tab-" + t)));
  $("list").setAttribute("aria-labelledby", "tab-" + t);
  document.querySelectorAll("[data-tab-only]").forEach(n => { n.hidden = n.dataset.tabOnly.split(" ").indexOf(t) < 0; });
  $("rankareas").hidden = t !== "rank";
  refresh();
}
$("tab-emp").onclick = () => setTab("emp"); $("tab-rank").onclick = () => setTab("rank");

// ---------- Lists ----------
const sqft = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : Math.round(n / 1000) + "k";
const fmtMi = m => m < 10 ? m.toFixed(1) + " mi" : Math.round(m) + " mi";
function empRow(e) {
  const isSel = selected && selected.kind === "emp" && selected.id === e.id;
  return `<button type="button" class="item" data-kind="emp" data-id="${esc(e.id)}" ${isSel ? 'aria-current="true"' : ""}>
    <span class="num ${band(e.score)}">${e.rank}</span><span class="t">${esc(e.name)}</span><span class="m">${e.score}<small>/100</small></span>
    <span class="s">${esc(TYPE_LABEL[e.type] || "")} &middot; ${esc(e.reg)} &middot; ${fmtMi(commuteMi(e))}</span>${app.hooks.row.map(fn => fn(e) || "").join("")}</button>`;
}
function rankRow(r) {
  const isSel = selected && selected.kind === "rank" && selected.id === r.n, maxSq = RANK[0].sqft;
  return `<button type="button" class="item" data-kind="rank" data-id="${r.n}" ${isSel ? 'aria-current="true"' : ""}>
    <span class="num rk">${r.n}</span><span class="t">${esc(r.title)}</span><span class="m">${sqft(r.sqft)} ft²</span>
    <span class="s">${esc(r.name && r.addr ? r.addr + " · " : "")}${r.floors} floors &middot; ${esc(r.area)}</span>
    <span class="bar" aria-hidden="true"><i style="width:${(r.sqft / maxSq * 100).toFixed(1)}%"></i></span></button>`;
}
let listLimit = 40;
const sortSelect = (id, label, opts, cur) => `<div class="sortbar"><label for="${id}">${label}</label><select id="${id}">${opts.map(o => `<option value="${o[0]}"${o[0] === cur ? " selected" : ""}>${esc(o[1])}</option>`).join("")}</select></div>`;
function refresh() {
  computeRanking();
  const sortFocus = document.activeElement && document.activeElement.id === "sort-emp";
  let html = "";
  if (tab === "emp") {
    const shown = ranked.slice(0, listLimit);
    html = `<p class="intro">${sortEmp === "best" ? "Ranked for you by the weights above." : sortEmp === "near" ? "Closest to your home first." : "In alphabetical order."} Numbers on the map match this list.</p>` + sortSelect("sort-emp", "Sort by", SORT_EMP, sortEmp);
    html += shown.length ? `<div class="items">${shown.map(empRow).join("")}</div>` : `<p class="empty">No employers match. Clear the search or widen the filters.</p>`;
    if (ranked.length > listLimit) html += `<button type="button" class="more" id="more">Show all ${ranked.length}</button>`;
  } else if (app.tabs[tab]) {
    listEl.innerHTML = ""; app.tabs[tab].render(listEl); html = null;
  } else {
    const items = RANK.filter(visRank);
    html = `<p class="intro">The largest office buildings by estimated floor area (footprint times floors). Click one to see it in 3D.</p>` +
      (items.length ? `<div class="items">${items.map(rankRow).join("")}</div>` : `<p class="empty">No buildings match the search.</p>`);
  }
  if (html !== null) listEl.innerHTML = html;
  const ss = $("sort-emp"); if (ss) { ss.onchange = () => { sortEmp = ss.value; store.set(SORT_EMP_KEY, sortEmp); refresh(); }; if (sortFocus) ss.focus(); }
  const mb = $("more"); if (mb) mb.onclick = () => { listLimit = 1000; refresh(); };
  $("cnt-emp").textContent = ranked.length; $("cnt-rank").textContent = RANK.filter(visRank).length;
  Object.values(app.tabs).forEach(t => { const c = $("cnt-" + t.id); if (c && t.count) c.textContent = t.count(); });
  app.emit("refreshed");
  if (selected && selected.kind === "emp") { const e = E.find(x => x.id === selected.id); if (e) renderEmpCard(e); }
  rebuildMarkers();
}
listEl.addEventListener("click", e => {
  const i = e.target.closest(".item"); if (!i) return;
  i.dataset.kind === "emp" ? selectEmp(i.dataset.id, true) : selectRank(+i.dataset.id, true);
});

// ---------- Cards ----------
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return u; } };
const curList = () => app.tabs[tab] ? (app.tabs[tab].items ? app.tabs[tab].items() : []) : tab === "emp" ? ranked.map(e => ({ kind: "emp", id: e.id })) : RANK.filter(visRank).map(r => ({ kind: "rank", id: r.n }));
function stepSel(dir) {
  const L = curList(); if (!L.length) return;
  let i = selected ? L.findIndex(x => x.kind === selected.kind && x.id === selected.id) : -1;
  i = i < 0 ? (dir > 0 ? 0 : L.length - 1) : (i + dir + L.length) % L.length;
  const n = L[i]; n.kind === "emp" ? selectEmp(n.id, true) : selectRank(n.id, true);
}
function stepperHTML() {
  const L = curList(), i = selected ? L.findIndex(x => x.kind === selected.kind && x.id === selected.id) : -1;
  return `<div class="stepper"><button type="button" id="prevb" aria-label="Previous in the list" title="Previous ([)">&lsaquo; Prev</button><span>${i >= 0 ? i + 1 + " of " + L.length : ""}</span><button type="button" id="nextb" aria-label="Next in the list" title="Next (])">Next &rsaquo;</button><button type="button" class="cmin" id="cminb" aria-pressed="${cardMin}" title="Shrink the card to see more map">${cardMin ? "Expand" : "Shrink"}</button><button type="button" class="close" id="cc" aria-label="Close details">&times;</button></div>`;
}
function showCard(html) {
  card.hidden = false; card.classList.toggle("min", cardMin);
  card.innerHTML = stepperHTML() + html;
  $("cc").onclick = closeCard; $("prevb").onclick = () => stepSel(-1); $("nextb").onclick = () => stepSel(1);
  $("cminb").onclick = () => { cardMin = !cardMin; card.classList.toggle("min", cardMin); $("cminb").textContent = cardMin ? "Expand" : "Shrink"; $("cminb").setAttribute("aria-pressed", String(cardMin)); };
}
function renderEmpCard(e) {
  const f = factors(e), mi = commuteMi(e), keep = card.scrollTop;
  const X = app.hooks.card.map(fn => { try { return fn(e); } catch (x) { console.error(x); return null; } }).filter(Boolean), slot = s => X.filter(x => x.slot === s).map(x => x.html).join("");
  const rows = [["Role fit", f[0], e.s[0] + " / 5"], ["No-clearance access", f[1], e.s[1] + " / 5"], ["Entry-level access", f[2], e.s[2] + " / 5"], ["Commute", f[3], fmtMi(mi) + (e.metro ? " · Metro" : "")]];
  showCard(`<div class="chead"><div class="score ${band(e.score)}">${e.score}<small>MATCH</small></div>
      <div><p class="eyebrow">${e.rank ? "#" + e.rank + " · " : ""}${esc(TYPE_LABEL[e.type] || "")}</p><h2>${esc(e.name)}</h2></div></div>
    <p class="addr">${esc(e.addr)}${e.gc === "street" ? " (pin at street level)" : ""}</p>
    ${slot("top")}
    <p class="why">${esc(e.why)}</p>
    <div class="factors">${rows.map(([l, v, t]) => `<div class="factor"><span>${l}</span><span class="fb"><i style="width:${Math.round(v * 100)}%"></i></span><b>${t}</b></div>`).join("")}</div>
    <p class="note">${esc(CL_LABEL[e.cl] || "")}. Distance is from ${home ? "your home" : "Reston"}, straight-line.</p>
    ${slot("main")}
    ${e.roles.length ? `<p class="sect">Entry roles they post</p><div class="roles">${e.roles.map(r => `<span>${esc(r)}</span>`).join("")}</div>` : ""}
    ${e.progs.length ? `<p class="sect">Programs</p><ul class="plist">${e.progs.map(p => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a></li>`).join("")}</ul>` : ""}
    <div class="actions"><a class="go" href="${esc(e.url)}" target="_blank" rel="noopener">Careers page &#8599;</a>
      <a class="dir" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.name + " " + e.addr)}" target="_blank" rel="noopener">Directions &#8599;</a></div>
    ${slot("bottom")}
    ${e.src.length ? `<p class="sect">Research sources</p><div class="srcs">${e.src.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(host(u))}</a>`).join("")}</div>` : ""}
    ${e.notes ? `<p class="note">Research notes: ${esc(e.notes)}</p>` : ""}`);
  X.forEach(x => { if (x.bind) try { x.bind(card); } catch (err) { console.error(err); } });
  card.scrollTop = keep;
}
function selectEmp(id, go) {
  const e = E.find(x => x.id === id); if (!e) return;
  const fresh = !(selected && selected.kind === "emp" && selected.id === id); selected = { kind: "emp", id };
  if (tab !== "emp" && !app.tabs[tab]) setTab("emp");
  highlight(e.bp); if (go && glOK) flyTo(e.x, e.z, Math.min(Math.max(curDist() * 0.6, 700), 2200), curPolar());
  renderEmpCard(e); if (fresh) card.scrollTop = 0;
  refresh(); scrollToItem(); app.emit("selection-changed", { kind: "emp", id });
}
function selectRank(n, go) {
  const r = RANK.find(x => x.n === n); if (!r) return; selected = { kind: "rank", id: n };
  if (tab !== "rank") setTab("rank");
  highlight(r.bp); if (go && glOK) flyTo(r.x, r.z, Math.min(Math.max(curDist() * 0.6, 700), 1800), curPolar());
  const emps = (r.emps || []).map(id => E.find(e => e.id === id)).filter(Boolean);
  showCard(`<p class="eyebrow">#${r.n} by floor area &middot; ${esc(r.area)}</p><h2 style="padding-right:30px">${esc(r.title)}</h2>
    <p class="addr">${esc(r.name ? r.addr : "")}${r.city ? (r.name && r.addr ? ", " : "") + esc(r.city) : ""}</p>
    <div class="facts"><div><b>${sqft(r.sqft)}</b><span>sq ft (est.)</span></div><div><b>${r.floors}</b><span>floors</span></div><div><b>${Math.round(r.h * 3.281)} ft</b><span>height</span></div></div>
    ${emps.length ? `<p class="sect">Employers on this map here</p>${emps.map(e => `<p class="note"><a class="dir" href="#" data-emp="${esc(e.id)}">${esc(e.name)} &middot; match ${e.score}</a></p>`).join("")}` : `<p class="note">No researched employer on this map is matched to this building yet.</p>`}
    ${(app.hooks.rankCard || []).map(fn => { try { return fn(r) || ""; } catch (x) { return ""; } }).join("")}
    <div class="actions"><a class="dir" href="https://www.google.com/search?q=${encodeURIComponent((r.name || r.addr) + " " + (r.city || "") + " office tenants")}" target="_blank" rel="noopener">Look up tenants &#8599;</a>
    <a class="dir" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((r.name ? r.name + " " : "") + r.addr + " " + (r.city || ""))}" target="_blank" rel="noopener">Directions &#8599;</a></div>`);
  card.querySelectorAll("[data-emp]").forEach(a => a.onclick = ev => { ev.preventDefault(); selectEmp(a.dataset.emp, true); });
  card.scrollTop = 0; refresh(); scrollToItem();
}
function scrollToItem() { if (window.innerWidth <= 900) return; const it = listEl.querySelector('[aria-current="true"]'); if (it && it.scrollIntoView) it.scrollIntoView({ block: "nearest" }); }
function closeCard() { selected = null; card.hidden = true; highlight(null); refresh(); app.emit("selection-changed", null); }
// ---------- Toast (shared) ----------
let toastTimer = null;
function toast(msg, opt) {
  opt = opt || {}; let t = $("toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); document.body.appendChild(t); }
  t.innerHTML = '<span>' + esc(msg) + '</span>' + (opt.undo ? '<button type="button" id="toast-undo">Undo</button>' : ""); t.classList.add("on");
  if (opt.undo) $("toast-undo").onclick = () => { opt.undo(); t.classList.remove("on"); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), opt.ms || 10000);
}
// ---------- Keyboard ----------
const KEYACT = { arrowup: "up", w: "up", arrowdown: "down", s: "down", arrowleft: "left", a: "left", arrowright: "right", d: "right", q: "rotL", e: "rotR", r: "tiltLow", f: "tiltTop", "+": "zin", "=": "zin", "-": "zout", "_": "zout" };
const typing = t => t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { if (shell.escape()) return; if (!$("help").hidden) toggleHelp(false); else if (setMode) endSetMode(); else if (selected) closeCard(); else if (document.activeElement === $("q")) $("q").blur(); else shell.collapse(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey || !glOK) return;
  const t = e.target;
  if (typing(t)) return;
  if (t && t.tagName === "BUTTON" && (e.key === "Enter" || e.key === " ")) return;
  const k = e.key.toLowerCase(), act = KEYACT[k];
  const mapFocus = t === canvas || overMap || t === document.body;
  if (act && mapFocus) { e.preventDefault(); if (!e.repeat && !held.has("key:" + e.code)) startHeld("key:" + e.code, act); return; }
  if (k === "n") northUp(); else if (k === "t") toggleTilt(); else if (k === "h") goHome();
  else if (k === "?" ) toggleHelp(); else if (k === "[") stepSel(-1); else if (k === "]") stepSel(1);
  else if (k === "/") { e.preventDefault(); $("q").focus(); } else return;
  e.preventDefault();
});
document.addEventListener("keyup", e => { stopHeld("key:" + e.code); });
window.addEventListener("blur", () => { held.clear(); });
$("q").addEventListener("keydown", e => {
  if (e.key !== "Enter") return; e.preventDefault();
  const L = curList(); if (!L.length) return; const n = L[0]; n.kind === "emp" ? selectEmp(n.id, true) : selectRank(n.id, true); $("q").blur();
});


// ---------- App shell: settings menu, jump menu, phone bottom sheet, desktop drawer ----------
const shell = (() => {
  const root = document.documentElement, rail = $("rail"), stage = $("stage"), railScroll = $("railscroll"), phone = matchMedia("(max-width: 900px)");
  const UI_KEY = "reston-map-ui", ui = Object.assign({ theme: "auto", size: "m", calm: false, pad: false }, store.get(UI_KEY) || {});
  const FS = { s: "15px", m: "16px", l: "18px" }, ORDER = ["peek", "half", "full"];
  let snap = "peek", savedScroll = 0, opener = null, viaKey = false, live = null;
  // ----- settings -----
  function applyUI() {
    if (ui.theme === "light" || ui.theme === "dark") root.dataset.theme = ui.theme; else if (root.dataset.theme) delete root.dataset.theme;
    root.style.setProperty("--root-fs", FS[ui.size] || FS.m);
    root.classList.toggle("calm", !!ui.calm); root.classList.toggle("show-pad", !!ui.pad);
    document.querySelectorAll("#settings .seg").forEach(g => g.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(ui[g.dataset.set] === b.dataset.v))));
    document.querySelectorAll("#settings .switch").forEach(b => { const on = !!ui[b.dataset.set]; b.setAttribute("aria-checked", String(on)); b.querySelector("em").textContent = on ? "On" : "Off"; });
  }
  $("settings").addEventListener("click", e => {
    const v = e.target.closest(".seg button"), sw = e.target.closest(".switch");
    if (v) ui[v.parentNode.dataset.set] = v.dataset.v; else if (sw) ui[sw.dataset.set] = !ui[sw.dataset.set]; else if (e.target.closest("#setdone")) return closeMenu(menus[0], true);
    else return;
    store.set(UI_KEY, ui); applyUI(); setTimeout(() => { if (glOK && renderer) resize(); }, 0);
  });
  // ----- menus -----
  const menus = [{ btn: $("gear"), el: $("settings") }, { btn: $("jumpbtn"), el: $("jump") }];
  function closeMenu(m, focus) { if (m.el.hidden) return false; m.el.hidden = true; m.btn.setAttribute("aria-expanded", "false"); if (focus) m.btn.focus(); return true; }
  function openMenu(m) {
    menus.forEach(o => o !== m && closeMenu(o, false)); m.el.hidden = false; m.btn.setAttribute("aria-expanded", "true");
    const f = m.el.querySelector('[aria-pressed="true"], button'); if (f) f.focus();
  }
  menus.forEach(m => { m.btn.addEventListener("click", () => m.el.hidden ? openMenu(m) : closeMenu(m, false)); });
  document.addEventListener("pointerdown", e => { menus.forEach(m => { if (!m.el.hidden && !m.el.contains(e.target) && !m.btn.contains(e.target)) closeMenu(m, false); }); }, true);
  $("jump").addEventListener("click", e => { if (e.target.closest("button[data-p]")) closeMenu(menus[1], e.detail === 0); });
  $("sethome").addEventListener("click", () => { closeMenu(menus[1], false); if (phone.matches) setSnap("peek"); });
  $("settings").addEventListener("keydown", e => {
    if (e.key !== "Tab") return; const f = [...$("settings").querySelectorAll("button, summary")].filter(n => n.offsetParent !== null); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  function escape() { let any = false; menus.forEach(m => { if (closeMenu(m, true)) any = true; }); return any; }
  // ----- bottom sheet (phone) -----
  const heights = () => { const sb = parseFloat(getComputedStyle(rail).paddingBottom) || 0; return { peek: 112 + sb, half: Math.round(window.innerHeight * 0.52), full: window.innerHeight - 76 }; };
  function setSnap(s) {
    const g = $("sheetgrab");
    if (!phone.matches) { rail.style.height = ""; root.style.setProperty("--inset-b", "0px"); setViewInset(0); return; }
    snap = s; rail.dataset.snap = s; const h = heights()[s]; rail.style.height = h + "px";
    root.style.setProperty("--inset-b", Math.min(h, window.innerHeight * 0.6) + "px"); setViewInset(h);
    g.setAttribute("aria-expanded", String(s !== "peek")); g.setAttribute("aria-label", "List panel is " + (s === "peek" ? "collapsed" : s === "half" ? "half open" : "fully open") + ". Arrow up or down to resize.");
  }
  const stepSnap = d => setSnap(ORDER[Math.max(0, Math.min(2, ORDER.indexOf(snap) + d))]);
  $("sheetup").onclick = () => stepSnap(1); $("sheetdn").onclick = () => stepSnap(-1);
  let drag = null, moved = false;
  const head = $("sheethead");
  head.addEventListener("pointerdown", e => {
    if (!phone.matches || e.target.closest(".iconbtn") || e.button) return;
    drag = { y: e.clientY, h: rail.getBoundingClientRect().height, t: performance.now(), cur: 0 }; moved = false; try { head.setPointerCapture(e.pointerId); } catch (_) {}
  });
  head.addEventListener("pointermove", e => {
    if (!drag) return; const dy = e.clientY - drag.y; if (Math.abs(dy) > 5) { moved = true; rail.classList.add("dragging"); }
    if (!moved) return; const H = heights(); drag.cur = Math.max(H.peek, Math.min(H.full, drag.h - dy)); rail.style.height = drag.cur + "px";
  });
  const endDrag = () => {
    if (!drag) return; rail.classList.remove("dragging");
    if (moved) {
      const H = heights(), v = (drag.cur - drag.h) / Math.max(1, performance.now() - drag.t), proj = drag.cur + v * 140; // px/ms: a flick carries on a little
      setSnap(ORDER.reduce((a, b) => Math.abs(H[b] - proj) < Math.abs(H[a] - proj) ? b : a)); setTimeout(() => { moved = false; }, 50);
    }
    drag = null;
  };
  head.addEventListener("pointerup", endDrag); head.addEventListener("pointercancel", endDrag);
  $("sheetgrab").addEventListener("click", () => { if (moved) return; setSnap(snap === "peek" ? "half" : snap === "half" ? "full" : "peek"); });
  $("sheetgrab").addEventListener("keydown", e => {
    const k = e.key; if (k === "ArrowUp") stepSnap(1); else if (k === "ArrowDown") stepSnap(-1); else if (k === "Home") setSnap("peek"); else if (k === "End") setSnap("full"); else return; e.preventDefault();
  });
  function collapse() { if (phone.matches && snap !== "peek") { setSnap("peek"); $("sheetgrab").focus(); } }
  // ----- drawer / card placement -----
  function placeCard() {
    if (phone.matches) { if (card.parentNode !== rail) rail.insertBefore(card, railScroll); } else if (card.parentNode !== stage) stage.appendChild(card);
    rail.classList.toggle("card-open", phone.matches && !card.hidden);
  }
  const selFor = el => {
    if (!el) return null; if (el.classList.contains("item")) return `.item[data-kind="${el.dataset.kind}"][data-id="${el.dataset.id}"]`; if (el.id) return "#" + el.id;
    const a = [...el.attributes].find(x => /^data-(open|emp|id)$/.test(x.name)); return a ? `${el.tagName.toLowerCase()}[${a.name}="${a.value}"]` : null;
  };
  document.addEventListener("click", e => { const b = e.target.closest("button, a"); viaKey = e.detail === 0; if (b && !card.contains(b)) opener = selFor(b); }, true);
  app.on("selection-changed", s => {
    if (s) {
      if (phone.matches) { if (!rail.classList.contains("card-open")) savedScroll = railScroll.scrollTop; placeCard(); if (snap === "peek") setSnap("half"); }
      if (viaKey) { card.focus({ preventScroll: true }); viaKey = false; }
    } else {
      rail.classList.remove("card-open"); railScroll.scrollTop = savedScroll;
      const a = document.activeElement;
      if (!a || a === document.body || card.contains(a)) {
        const t = (opener && document.querySelector(opener)) || (canvas.offsetParent ? canvas : null); if (t) t.focus({ preventScroll: true });
      }
    }
  });
  $("tabs").addEventListener("click", e => { if (phone.matches && e.target.closest("[role=tab]") && snap === "peek") setSnap("half"); });
  $("q").addEventListener("input", () => { if (phone.matches) { if (snap === "peek") setSnap("half"); if (selected) closeCard(); } });
  phone.addEventListener("change", () => { placeCard(); setSnap(snap); });
  window.addEventListener("resize", () => { if (phone.matches) setSnap(snap); });
  app.on("refreshed", () => {
    clearTimeout(live); live = setTimeout(() => { const c = $("cnt-" + tab); $("livecount").textContent = c && c.textContent ? c.textContent + " shown" : ""; }, 500);
  });
  function init() { applyUI(); placeCard(); setSnap("peek"); app.sheet = setSnap; Object.defineProperty(app, "snap", { get: () => snap }); app.ui = ui; }
  return { init, escape, collapse, setSnap };
})();
