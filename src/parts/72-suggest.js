// 72-suggest: employers found through openings but not on the map (spec 5). "Add to my map" or "Ignore".
// Stores collections myEmployers / ignoredEmployers (localStorage reston-map-myemployers / reston-map-ignoredemployers without db).
PARTS.push(function (app) {
  const esc = app.esc, MY = "reston-map-myemployers", IGN = "reston-map-ignoredemployers";
  const SUFFIX = new Set(["inc", "llc", "corp", "corporation", "co", "ltd", "incorporated", "lp", "llp", "pllc"]);
  const norm = n => { let w = String(n || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean); if (w[0] === "the") w = w.slice(1); while (w.length && SUFFIX.has(w[w.length - 1])) w.pop(); return w.join(" "); };
  const slug = k => k.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const CL = { none: "none", sponsor: "some", required: "most" }, CLS = { none: 5, some: 3, most: 1 };
  const load = k => { try { return JSON.parse(localStorage.getItem(k) || "{}") || {}; } catch (_) { return {}; } };
  const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  let my = load(MY), ign = load(IGN), db = null;

  function groups() {
    if (!app.jobs) return [];
    const G = new Map();
    app.jobs.all().forEach(j => {
      if (j.status === "dismissed" || j.empId || !j.employer || !j.loc || typeof j.loc.lat !== "number") return;
      const key = norm(j.employer) + "|" + (j.loc.text || "").toLowerCase().trim();
      if (!norm(j.employer) || ign[key] || my[key]) return;
      if (!G.has(key)) G.set(key, { key, name: j.employer, place: j.loc.text || "", lat: j.loc.lat, lon: j.loc.lon, jobs: [] });
      G.get(key).jobs.push(j);
    });
    return [...G.values()].sort((a, b) => b.jobs.length - a.jobs.length || a.name.localeCompare(b.name));
  }
  function nearestReg(lat, lon) {
    let best = null, d = 1e9; app.E.forEach(e => { if (!e.reg) return; const m = app.miles(lat, lon, e.lat, e.lon); if (m < d) { d = m; best = e.reg; } }); return best || AREAS[0];
  }
  function toEmployer(rec) {
    const cl = rec.cl || "none";
    return { id: rec.id, name: rec.name, type: "corporate", addr: rec.addr, lat: rec.lat, lon: rec.lon, gc: "place", reg: rec.reg, url: rec.url || "", roles: rec.roles || [], progs: [], cl,
      s: [3, CLS[cl] || 3, 3], why: "Found through a job posting.", src: rec.url ? [rec.url] : [], notes: "Added by you from a job posting. Ratings are estimates.", metro: false, added: true };
  }
  async function put(coll, key, val) {
    if (!db) return;
    try { await db.collection(coll).doc(slug(key)).set(val); } catch (e) { console.error("[suggest] write failed", e); }
  }
  function add(key) {
    const g = groups().find(x => x.key === key); if (!g) return null;
    const counts = {}; g.jobs.forEach(j => { if (CL[j.clearance]) counts[CL[j.clearance]] = (counts[CL[j.clearance]] || 0) + 1; });
    const cl = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "none";
    const url = (g.jobs.find(j => /^https:\/\//.test(j.url || "")) || {}).url || "";
    const rec = { id: "my-" + slug(key), key, name: g.name, addr: g.place, lat: g.lat, lon: g.lon, reg: nearestReg(g.lat, g.lon), url, cl, roles: [...new Set(g.jobs.map(j => j.title))].slice(0, 5), source: "suggested", addedAt: new Date().toISOString() };
    my[key] = rec; keep(MY, my); put("myEmployers", key, rec);
    app.employers.add([toEmployer(rec)]);
    app.jobs.assign(g.jobs.map(j => j.id), rec.id);
    app.toast("Added " + g.name + " to your map.");
    return rec.id;
  }
  function ignore(key) {
    const g = groups().find(x => x.key === key); if (!g) return;
    ign[key] = { key, name: g.name, at: new Date().toISOString() }; keep(IGN, ign); put("ignoredEmployers", key, ign[key]);
    app.refresh(); app.toast("Hidden. It will not be suggested again.");
  }

  function drive(g) { const h = app.homeLL(); return Math.round(app.miles(h[0], h[1], g.lat, g.lon) * 2.4) + " min est."; }
  app.on("refreshed", () => {
    if (app.tab !== "jobs") return;
    const list = app.$("list"), G = groups(); if (!list || !G.length || list.querySelector(".sugg")) return;
    const sec = document.createElement("section"); sec.className = "kit-sec sugg";
    sec.innerHTML = `<h3>Suggested employers</h3><p class="kit-note">Places with openings that are not on your map yet.</p>` + G.map(g => `<div class="kit-row" data-key="${esc(g.key)}">
      <span class="t">${esc(g.name)}</span><span></span><span class="s">${[g.place, g.jobs.length + (g.jobs.length === 1 ? " opening" : " openings"), drive(g)].filter(Boolean).map(esc).join(" &middot; ")}</span>
      <div class="btn-row sugg-act"><button type="button" class="btn sm primary" data-s="add">Add to my map</button><button type="button" class="btn sm quiet" data-s="ignore">Ignore</button></div></div>`).join("");
    list.appendChild(sec);
    sec.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { const k = b.closest("[data-key]").dataset.key; b.dataset.s === "add" ? add(k) : ignore(k); });
  });

  // employers added earlier come back on every load
  app.employers.add(Object.values(my).map(toEmployer));
  (async () => {
    if (typeof claude === "undefined" || !claude.use) return;
    try {
      db = await claude.use("db"); if (!db) return;
      const pull = async (coll, into, key) => { const rows = await new Promise((res, rej) => { const out = []; const un = db.collection(coll).onSnapshot(s => { s.docChanges().forEach(c => { if (c.type !== "removed") out.push(c.doc.data()); }); res(out); try { un && un(); } catch (_) {} }, rej); }); rows.forEach(r => { if (r && r.key) into[r.key] = r; }); keep(key, into); };
      await pull("myEmployers", my, MY); await pull("ignoredEmployers", ign, IGN);
      app.employers.add(Object.values(my).map(toEmployer)); app.refresh();
    } catch (e) { db = null; }
  })();
  app.suggest = { groups, add, ignore };
});
