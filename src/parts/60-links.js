// 60-links: "Find openings" searches on LinkedIn, Indeed, Handshake (and USAJOBS for federal) for each employer and building,
// plus a place to save Eric's own profile links. Plain links that open in the viewer's own signed-in browser; nothing is scraped or sent anywhere.
PARTS.push(function (app) {
  const KEY = "reston-map-mylinks", HOSTS = { linkedin: /(^|\.)linkedin\.com$/, handshake: /(^|\.)joinhandshake\.com$/, indeed: /(^|\.)indeed\.com$/ };
  const DOM = { linkedin: "linkedin.com", handshake: "joinhandshake.com", indeed: "indeed.com" };
  const NAMES = { linkedin: "LinkedIn", handshake: "Handshake", indeed: "Indeed" };
  const q = encodeURIComponent, esc = app.esc;
  const clean = n => String(n || "").replace(/\s*\([^)]*\)/g, "").trim();
  const place = addr => { const m = /,\s*([^,]+),\s*([A-Z]{2})\s*\d{5}/.exec(addr || ""); return m ? m[1] + ", " + m[2] : "Washington, DC"; };
  const goodUrl = (k, u) => { try { const x = new URL(u); return x.protocol === "https:" && HOSTS[k].test(x.hostname) ? x.href : ""; } catch (_) { return ""; } };
  let mine = {}; try { mine = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mine)); } catch (_) {} };
  const A = (href, label, title) => `<a class="btn sm" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(title || label)}">${esc(label)} &#8599;</a>`;
  const empLinks = e => {
    const n = clean(e.name), loc = place(e.addr);
    const l = [A(`https://www.linkedin.com/jobs/search/?keywords=${q(n)}&location=${q(loc)}`, "LinkedIn", "Search LinkedIn jobs at " + n),
      A(`https://www.indeed.com/jobs?q=${q(n)}&l=${q(loc)}`, "Indeed", "Search Indeed jobs at " + n),
      A(`https://app.joinhandshake.com/stu/postings?query=${q(n)}`, "Handshake", "Search Handshake (sign in with your school)")];
    if (e.type === "federal") l.push(A(`https://www.usajobs.gov/search/results/?k=${q(n)}`, "USAJOBS"));
    return l.join("");
  };
  const mineLinks = () => ["linkedin", "handshake", "indeed"].filter(k => mine[k]).map(k => A(mine[k], "My " + NAMES[k], "Open your " + NAMES[k] + " page")).join("");
  const section = (title, body, note) => `<div class="kit-sec links-sec"><h3>${title}<button type="button" class="btn quiet sm" data-mylinks>My pages</button></h3><div class="btn-row">${body}</div>${mineLinks() ? `<div class="btn-row links-mine">${mineLinks()}</div>` : ""}${note ? `<p class="kit-note">${note}</p>` : ""}</div>`;
  app.hooks.card.push(e => ({ slot: "bottom", html: section("Find openings", empLinks(e), "Opens a search in your own browser. LinkedIn and Handshake may ask you to sign in."), bind: root => root.querySelectorAll("[data-mylinks]").forEach(b => b.onclick = openSheet) }));
  app.hooks.rankCard.push(r => {
    const loc = r.city ? r.city + ", VA" : "Washington, DC", where = encodeURIComponent((r.addr ? r.addr + ", " : "") + (r.city || r.area || ""));
    void loc;
    const body = A(`https://www.indeed.com/jobs?q=&l=${where}&radius=5`, "Indeed near here") + A(`https://www.linkedin.com/jobs/search/?keywords=&location=${where}&distance=5`, "LinkedIn near here");
    return `<div class="kit-sec links-sec"><h3>Find more employers here</h3><div class="btn-row">${body}</div><p class="kit-note">Jobs within about 5 miles of this building. Handy for spotting tenants not yet on the map.</p></div>`;
  });
  function openSheet() {
    let back = document.getElementById("links-sheet"); if (back) back.remove();
    back = document.createElement("div"); back.id = "links-sheet"; back.className = "sheet-back";
    back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="links-h"><h2 id="links-h">My pages</h2><p class="kit-note">Paste the web address of your own profile on each site. They are saved on this device only and shown as quick links on every card.</p>
      ${["linkedin", "handshake", "indeed"].map(k => `<div class="field"><label for="ml-${k}">${NAMES[k]} profile address</label><input type="url" id="ml-${k}" inputmode="url" placeholder="https://" value="${esc(mine[k] || "")}"><small id="mle-${k}" class="links-err"></small></div>`).join("")}
      <div class="sheet-actions"><button type="button" class="btn quiet" id="ml-cancel">Cancel</button><button type="button" class="btn primary" id="ml-save">Save</button></div></div>`;
    document.body.appendChild(back);
    const close = () => { back.remove(); if (opener && opener.isConnected) opener.focus(); }, opener = document.activeElement;
    back.addEventListener("click", ev => { if (ev.target === back) close(); });
    back.addEventListener("keydown", ev => { if (ev.key === "Escape") { ev.stopPropagation(); close(); } });
    document.getElementById("ml-cancel").onclick = close;
    document.getElementById("ml-save").onclick = () => {
      let bad = 0; const next = {};
      ["linkedin", "handshake", "indeed"].forEach(k => { const v = document.getElementById("ml-" + k).value.trim(), err = document.getElementById("mle-" + k); err.textContent = ""; if (!v) return; const g = goodUrl(k, v); if (g) next[k] = g; else { bad++; err.textContent = "Use a full https:// address on " + DOM[k]; } });
      if (bad) return; mine = next; save(); close(); app.toast("Saved. Your pages now show on each card."); app.refresh();
    };
    document.getElementById("ml-linkedin").focus();
  }
  app.links = { empLinks, open: openSheet, mine: () => Object.assign({}, mine) };
});
