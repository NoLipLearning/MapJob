// 20-routes: "Getting there" (driving options, Metro line, map ribbon) and the route-based commute score. Data comes from src/routes.py -> routes.json,
// baked in at build time. No runtime network calls. If routes.json is missing the part still works from straight-line miles (labelled estimate).
const ROUTES = __ROUTES__;
PARTS.push(function (app) {
  const R = ROUTES && ROUTES.employers ? ROUTES : null;
  const EST_MIN_PER_MI = 2.2; // fallback only: straight-line miles x road factor at ~35 mph blended
  let showAlt = false, group = null;
  const movedHome = () => {
    if (!R) return false; const h = app.home; if (!h) return false;
    return app.miles(h.lat, h.lon, R.meta.home.lat, R.meta.home.lon) > 0.1;
  };
  const rec = e => (R && !movedHome() && R.employers[e.id]) || null;
  const options = e => { const r = rec(e); return r ? r.options.map(o => ({ min: o.min, mi: o.mi, via: o.via, toll: o.toll, verified: !!o.verified })) : []; };
  const bestMinutes = e => { const f = options(e).filter(o => !o.toll); return f.length ? Math.min.apply(null, f.map(o => o.min)) : null; };
  const hasTollFree = e => { const r = rec(e); return r ? r.options.some(o => !o.toll) : null; };
  const metro = e => {
    const r = rec(e); if (!r || !r.metro) return null; const m = r.metro;
    return { station: m.station, walkMin: m.walk_min == null ? null : m.walk_min, walkOk: !!m.walk_ok, min: m.walk_ok ? m.min : null, verified: !!m.verified };
  };
  app.routes = { ready: !!R, bestMinutes, hasTollFree, options, metro };

  // commute score: fastest toll-free minutes, bands 15/25/35/45/60, +0.15 for Metro; null falls back to the core's miles score
  app.hooks.commute = e => {
    const m = bestMinutes(e); if (m == null) return null;
    let s = m <= 15 ? 1 : m <= 25 ? .8 : m <= 35 ? .6 : m <= 45 ? .4 : m <= 60 ? .2 : 0;
    if (e.metro) s = Math.min(1, s + .15);
    return s;
  };

  const roadWord = o => o.via === 'local roads' ? 'local roads' : o.via;
  function card(e) {
    const opts = options(e), mt = metro(e), esc = app.esc;
    let body = "";
    if (opts.length) {
      const tf = opts.some(o => !o.toll);
      body += '<ul class="rt-list">' + opts.map((o, i) => '<li class="rt-opt"><span class="rt-sw' + (i === 0 ? '' : ' alt') + '" aria-hidden="true"></span><span><b>' + o.min + ' min</b> via ' + esc(roadWord(o)) + ' &middot; ' + (o.toll ? '<span class="rt-toll">(toll)</span>' : 'no tolls') + '</span></li>').join("") + '</ul>';
      if (!tf) body += '<p class="kit-note">No toll-free route found for this one.</p>';
      if (mt) body += '<p class="rt-metro">' + (mt.walkOk && mt.min != null ? '<b>about ' + mt.min + ' min</b> by Metro (Silver Line to ' + esc(mt.station) + ', ' + mt.walkMin + ' min walk) <span class="tag">estimate</span>' : 'Metro plus a long walk or bus') + '</p>';
      body += '<p class="kit-note">Drive times are estimates from road data, adjusted to match your Apple Maps trips, with no live traffic.</p>';
      if (opts.length > 1) body += '<div class="btn-row"><button type="button" class="chip plain rt-alt" aria-pressed="' + showAlt + '">Show other routes</button></div>';
    } else {
      const est = Math.round(app.commuteMi(e) * EST_MIN_PER_MI);
      if (R && movedHome()) body += '<p class="kit-note"><b>Routes are from your saved home.</b> Rebuild to refresh.</p>';
      else body += '<p class="kit-note">Route details have not been built yet.</p>';
      body += '<p class="rt-opt"><span><b>about ' + est + ' min</b> by car <span class="tag">estimate from straight-line distance</span></span></p>';
    }
    return { slot: 'main', html: '<div class="kit-sec rt-sec"><h3>Getting there</h3>' + body + '</div>', bind(el) { const b = el.querySelector('.rt-alt'); if (b) b.onclick = () => { showAlt = !showAlt; b.setAttribute('aria-pressed', String(showAlt)); draw(); }; } };
  }
  app.hooks.card.push(e => card(e));

  // ----- map ribbon -----
  function clear() {
    if (!group) return;
    group.parent && group.parent.remove(group);
    group.children.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    group = null; app.needsRender();
  }
  // geometry as dashes: walk the path, emit "on" stretches, hand them to the core ribbon() as 2-point pieces
  function dashed(pts, on, off) {
    const lines = []; let cur = [], draw = true, left = on;
    for (let i = 0; i + 1 < pts.length; i++) {
      let [ax, az] = pts[i]; const [bx, bz] = pts[i + 1]; let len = Math.hypot(bx - ax, bz - az);
      while (len > 0) {
        const step = Math.min(left, len), t = step / len;
        const nx = ax + (bx - ax) * t, nz = az + (bz - az) * t;
        if (draw) { lines.push([ax, az, nx, nz]); }
        ax = nx; az = nz; len -= step; left -= step;
        if (left <= 1e-6) { draw = !draw; left = draw ? on : off; }
      }
    }
    return lines;
  }
  function mesh(opt, color, width, opacity, order, solid) {
    const xz = opt.geom.map(p => app.toXZ(p[1], p[0]));
    const lines = solid ? [xz.reduce((a, p) => a.concat(p), [])] : dashed(xz, 140, 90);
    const m = new THREE.Mesh(ribbon(lines, width), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
    m.position.y = 3; m.renderOrder = order; return m;
  }
  function draw() {
    clear();
    const s = app.selected; if (!s || s.kind !== 'emp' || !app.glOK || !app.scene || typeof THREE === 'undefined') return;
    const e = app.E.find(x => x.id === s.id), r = e && rec(e); if (!r || !r.options.length) return;
    group = new THREE.Group(); group.name = 'route-ribbon';
    if (showAlt) r.options.slice(1).forEach(o => group.add(mesh(o, 0x8a8f98, 14, .55, 7, false)));
    group.add(mesh(r.options[0], new THREE.Color(cssv("--route")), 22, .95, 8, false));
    app.scene.add(group); app.needsRender();
  }
  app.on('selection-changed', draw);
  app.on('home-changed', () => { clear(); app.refresh(); });
});
