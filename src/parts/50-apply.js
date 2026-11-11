// 50-apply: owned by Agent A (apply helper). See BUILD-PLAN.md section 2.4.
// "My profile" panel + per-employer "Apply helper" sheet. No AI calls: it only builds text for Eric to copy into Claude chat.
// Profile storage: localStorage `reston-map-profile`, mirrored to the private cloud doc data/users/<id>/profile/mine/main when db+user resolve.
PARTS.push(function (app) {
  const esc = app.esc, KEY = "reston-map-profile";
  const PROMPT_SRC = "__APPLY_PROMPT__"; // replaced at build time with src/apply_prompt.md
  const DEFAULT_PROMPT = "You are helping me apply for a job. Use only the profile, employer details and posting below.\n\nGive me: 1. A tailored cover letter in my voice (under 350 words). 2. Three resume bullets from my existing experience, reworded for this posting. 3. Which writing sample to send, and why. 4. Three questions to ask in an interview.\n\nDo not invent experience, skills, credentials, dates or numbers. If the posting wants something my profile lacks, say so plainly.";
  const instructions = () => (PROMPT_SRC && PROMPT_SRC.indexOf("__APPLY_" + "PROMPT__") < 0 ? PROMPT_SRC : DEFAULT_PROMPT).trim();
  const CL = { none: "No clearance needed for entry roles", some: "Some entry roles need a clearance", most: "Most entry roles need a clearance" };
  const MATS = [["resume", "Resume"], ["coverLetter", "Cover letter"], ["writingSample", "Writing sample"], ["references", "References"], ["transcript", "Transcript"]];
  const emp = id => app.findEmployer(id);
  const todayISO = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const nowISO = () => new Date().toISOString();
  const blank = v => v == null || (typeof v === "string" && (!v.trim() || /^unknown$/i.test(v.trim()))) || (Array.isArray(v) && !v.filter(x => !blank(x)).length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).some(k => !blank(v[k])));

  // ---------- profile: parse + validate ----------
  function parseProfile(text) {
    let t = String(text || "").trim();
    if (!t) return { error: "Paste your profile first. It is the block Claude gave you, starting with { and ending with }." };
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) t = fence[1].trim();
    else { const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a > 0 && b > a) t = t.slice(a, b + 1); }
    let j; try { j = JSON.parse(t); } catch (e) { return { error: "That does not read as a profile yet. Copy the whole block Claude gave you, from the first { to the last }, and paste it again." }; }
    if (!j || typeof j !== "object" || Array.isArray(j)) return { error: "A profile should be one block that starts with { and ends with }." };
    if (blank(j.name) && blank(j.education) && blank(j.experience)) return { error: "This has no name, education or experience in it, so it does not look like a profile. Check that you pasted the right block." };
    return { profile: j };
  }
  const FIELDS = [["name", "your name"], ["education", "education"], ["experience", "experience"], ["skills", "skills"], ["writing_sample", "a writing sample"], ["synopsis_60_words", "a short summary of you"]];
  const missing = p => FIELDS.filter(f => blank(p[f[0]])).map(f => f[1]);
  const skillList = p => { const s = p.skills; if (Array.isArray(s)) return s.slice(); if (!s || typeof s !== "object") return []; return [].concat(s.technical || [], s.software || [], s.methods || []).filter(x => !blank(x)); };

  // ---------- profile: storage ----------
  let local = null, cloudRef = null;
  const lsGet = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } };
  const lsSet = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* blocked: stays in memory */ } };
  (function () { const s = lsGet(); if (s && s.profile && typeof s.profile === "object") local = s; })();
  const profile = () => local ? local.profile : null;
  function saveProfile(p) {
    local = { v: 1, updatedAt: nowISO(), profile: p }; lsSet(local);
    if (cloudRef) cloudRef.set({ json: JSON.stringify(p), updatedAt: local.updatedAt }).catch(() => { });
    app.emit("profile-changed", { has: !!p });
  }
  function clearProfile() {
    local = null; try { localStorage.removeItem(KEY); } catch (e) { }
    if (cloudRef) cloudRef.delete().catch(() => { });
    app.emit("profile-changed", { has: false });
  }
  (async function cloudInit() {
    if (typeof claude === "undefined" || !claude || typeof claude.use !== "function") return;
    try {
      const run = (async () => {
        const db = await claude.use("db"), user = await claude.use("user"); if (!db || !user) return;
        const uid = await user.id(); if (!uid) return;
        const ref = db.collection("data/users/" + uid + "/profile/mine").doc("main"), snap = await ref.get(), d = snap && snap.exists ? snap.data() : null;
        cloudRef = ref;
        if (d && d.json && (!local || (d.updatedAt || "") > (local.updatedAt || ""))) {
          local = { v: 1, updatedAt: d.updatedAt || nowISO(), profile: JSON.parse(d.json) }; lsSet(local); app.emit("profile-changed", { has: true });
        } else if (local) await ref.set({ json: JSON.stringify(local.profile), updatedAt: local.updatedAt });
      })();
      await Promise.race([run, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000))]);
    } catch (e) { /* stay on this device */ }
  })();

  // ---------- sheet plumbing ----------
  let sheetEl = null, sheetFrom = null, onClose = null;
  function closeSheet(silent) {
    if (!sheetEl) return; sheetEl.remove(); sheetEl = null; const cb = onClose; onClose = null;
    if (cb && !silent) { cb(); return; }
    if (sheetFrom && document.contains(sheetFrom)) sheetFrom.focus(); sheetFrom = null;
  }
  function openSheet(inner, id, back) {
    const from = sheetEl ? sheetFrom : document.activeElement; closeSheet(true); sheetFrom = from; onClose = back || null;
    const wrap = document.createElement("div"); wrap.className = "sheet-back";
    wrap.innerHTML = `<div class="sheet apl-sheet" role="dialog" aria-modal="true" aria-labelledby="${id}-h">${inner}</div>`;
    document.body.appendChild(wrap); sheetEl = wrap;
    wrap.addEventListener("mousedown", ev => { if (ev.target === wrap) closeSheet(); });
    wrap.addEventListener("keydown", ev => {
      if (ev.key === "Escape") { ev.stopPropagation(); closeSheet(); return; }
      if (ev.key !== "Tab") return;
      const f = Array.from(wrap.querySelectorAll("button,input,select,textarea,summary")).filter(n => !n.disabled && n.offsetParent !== null); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); } else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });
    return wrap;
  }
  document.addEventListener("keydown", ev => { if (sheetEl && ev.key === "Escape") { ev.stopImmediatePropagation(); closeSheet(); } }, true);

  // ---------- My profile sheet ----------
  function openProfile(back) {
    const p = profile(), gaps = p && Array.isArray(p.gaps_or_questions) ? p.gaps_or_questions.filter(g => !blank(g)).map(String) : [], miss = p ? missing(p) : [];
    let h;
    if (!p) {
      h = `<h2 id="apl-p-h">My profile</h2>
        <p class="kit-note" style="margin-top:0">Paste the profile Claude made from your resume (see docs/resume-extraction-prompt.md). It stays on your device${cloudRef ? " and in your account" : ""}.</p>
        <label class="field"><span>Profile (JSON)</span><textarea id="apl-json" spellcheck="false" placeholder='{ "name": "...", ... }'></textarea></label>
        <p class="kit-note apl-err" id="apl-err" role="alert" hidden></p>
        <div class="sheet-actions"><button type="button" class="btn" id="apl-close">Close</button><button type="button" class="btn primary" id="apl-save">Save profile</button></div>`;
    } else {
      h = `<h2 id="apl-p-h">My profile</h2>
        <p class="kit-note" style="margin-top:0" id="apl-pstat">${miss.length ? "Saved. A few things are still empty." : "Saved. Nothing important is missing."}${local && local.updatedAt ? " Last updated " + esc(String(local.updatedAt).slice(0, 10)) + "." : ""}</p>
        ${miss.length ? `<div class="kit-sec"><h3>Still empty</h3><div class="chips">${miss.map(m => `<span class="tag">${esc(m)}</span>`).join("")}</div></div>` : ""}
        ${gaps.length ? `<details class="apl-gaps"><summary>Questions Claude had about your files (${gaps.length})</summary><ul>${gaps.map(g => `<li>${esc(g)}</li>`).join("")}</ul></details>` : ""}
        <div class="kit-sec"><h3>Small edits</h3>
          <label class="field"><span>Name</span><input type="text" id="apl-name" value="${esc(p.name && !blank(p.name) ? p.name : "")}" autocomplete="off"></label>
          <label class="field"><span>Short summary of you</span><textarea id="apl-syn">${esc(blank(p.synopsis_60_words) ? "" : p.synopsis_60_words)}</textarea></label>
          <label class="field"><span>Skills</span><input type="text" id="apl-skills" value="${esc(skillList(p).join(", "))}" autocomplete="off"><small>Separate with commas.</small></label></div>
        <details class="apl-replace"><summary>Paste a different profile</summary>
          <label class="field"><span>Profile (JSON)</span><textarea id="apl-json" spellcheck="false"></textarea></label>
          <button type="button" class="btn" id="apl-use">Use this profile</button></details>
        <p class="kit-note apl-err" id="apl-err" role="alert" hidden></p>
        <div class="sheet-actions"><button type="button" class="btn quiet" id="apl-clear" style="margin-right:auto">Remove profile</button><button type="button" class="btn" id="apl-close">Close</button><button type="button" class="btn primary" id="apl-save">Save changes</button></div>`;
    }
    const w = openSheet(h, "apl-p", back), $ = id => w.querySelector("#" + id);
    const err = m => { const n = $("apl-err"); n.hidden = !m; n.textContent = m || ""; };
    $("apl-close").onclick = () => closeSheet();
    const take = () => { const r = parseProfile($("apl-json").value); if (r.error) { err(r.error); $("apl-json").focus(); return false; } saveProfile(r.profile); app.toast("Profile saved."); return true; };
    if (!p) $("apl-save").onclick = () => { if (take()) openProfile(back); };
    else {
      $("apl-use").onclick = () => { if (take()) openProfile(back); };
      $("apl-clear").onclick = () => { const prev = local; clearProfile(); closeSheet(); app.toast("Profile removed.", { undo: () => { if (prev) saveProfile(prev.profile); } }); };
      $("apl-save").onclick = () => {
        const q = JSON.parse(JSON.stringify(p)), nm = $("apl-name").value.trim(), sy = $("apl-syn").value.trim(), sk = $("apl-skills").value.trim();
        q.name = nm; q.synopsis_60_words = sy;
        if (sk !== skillList(p).join(", ")) {
          const list = sk.split(",").map(s => s.trim()).filter(Boolean);
          if (Array.isArray(p.skills)) q.skills = list; else q.skills = Object.assign({}, p.skills || {}, { technical: list, software: [], methods: [] });
        }
        saveProfile(q); app.toast("Profile saved."); closeSheet();
      };
    }
    ($("apl-json") && !p ? $("apl-json") : $("apl-close")).focus();
  }

  // ---------- prompt assembly ----------
  function buildPrompt(e, r) {
    const p = profile(), L = [];
    L.push(instructions(), "", "=== MY PROFILE (JSON) ===", p ? JSON.stringify(p, null, 2) : "(I have not added my profile yet. Ask me for my background before you write anything.)", "");
    L.push("=== EMPLOYER ===", "Name: " + e.name, "Type: " + (e.type || "n/a"), "Why it fits me: " + (e.why || "n/a"));
    L.push("Entry roles they post: " + (e.roles && e.roles.length ? e.roles.join("; ") : "n/a"));
    L.push("Programs: " + (e.progs && e.progs.length ? e.progs.map(x => x.name).join("; ") : "n/a"));
    L.push("Clearance: " + (CL[e.cl] || "n/a"));
    L.push("Role I am applying for: " + (r.role || "n/a"));
    if (r.postingUrl) L.push("Posting link: " + r.postingUrl);
    L.push("", "=== JOB POSTING ===", r.postingText && r.postingText.trim() ? r.postingText.trim() : "(I have not pasted the posting text yet. Ask me to paste it, then continue.)");
    return L.join("\n");
  }
  async function copyText(text, w) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* blocked: fall through */ }
    let box = w.querySelector("#apl-fallback");
    if (!box) { box = document.createElement("label"); box.className = "field"; box.innerHTML = `<span>Your browser blocked copying. The text is selected below. Press Ctrl+C (Cmd+C on a Mac).</span><textarea id="apl-fallback" readonly></textarea>`; w.querySelector(".apl-copyzone").appendChild(box); box = box.querySelector("textarea"); }
    box.value = text; box.focus(); box.select(); try { return document.execCommand("copy"); } catch (e) { return false; }
  }

  // ---------- Apply helper sheet ----------
  const activeRecs = id => app.tracker.byEmp(id).filter(r => r.status !== "closed");
  function openStart(empId) {
    const e = emp(empId); if (!e) return;
    const w = openSheet(`<h2 id="apl-s-h">Start applying</h2><p class="kit-note" style="margin-top:0">${esc(e.name)}</p>
      <label class="field"><span>Role (required)</span><input type="text" id="apl-role" autocomplete="off" placeholder="Research Assistant, Foreign Policy"></label>
      <p class="kit-note apl-err" id="apl-err" role="alert" hidden></p>
      <div class="sheet-actions"><button type="button" class="btn" id="apl-close">Close</button><button type="button" class="btn primary" id="apl-go">Start</button></div>`, "apl-s");
    const $ = id => w.querySelector("#" + id);
    $("apl-close").onclick = () => closeSheet();
    const go = () => {
      let role = $("apl-role").value.trim();
      if (!role) role = "Any entry-level role";
      const r = app.tracker.upsert({ empId, role, status: "applying" }); openHelper(empId, r.appId);
    };
    $("apl-go").onclick = go;
    $("apl-role").addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); go(); } });
    $("apl-role").focus();
  }
  function openHelper(empId, appId) {
    const e = emp(empId); if (!e) return;
    const recs = activeRecs(empId); if (!recs.length) return openStart(empId);
    const r = app.tracker.get(appId) || recs[0]; appId = r.appId;
    const w = openSheet(`<h2 id="apl-h-h">Apply helper</h2><p class="kit-note" style="margin-top:0">${esc(e.name)}</p>
      ${recs.length > 1 ? `<label class="field"><span>Which role?</span><select id="apl-which">${recs.map(x => `<option value="${esc(x.appId)}" ${x.appId === appId ? "selected" : ""}>${esc(x.role || "Untitled role")}</option>`).join("")}</select></label>` : `<p class="apl-role"><b>${esc(r.role || "Untitled role")}</b></p>`}
      <p class="apl-ready" id="apl-ready" role="status"></p>
      <div class="kit-sec"><h3>Materials</h3><div class="apl-mats">${MATS.map(m => `<label class="apl-mat"><input type="checkbox" data-mat="${m[0]}" ${r.materials[m[0]] ? "checked" : ""}> <span>${m[1]}</span></label>`).join("")}</div></div>
      <div class="kit-sec"><h3>Posting</h3><label class="field" style="margin-top:0"><span>Paste the job posting text</span><textarea id="apl-post" placeholder="Paste the posting here">${esc(r.postingText)}</textarea></label></div>
      <div class="kit-sec"><h3>Profile</h3><div class="btn-row"><span class="apl-pline" id="apl-pline"></span><button type="button" class="btn quiet sm" id="apl-prof"></button></div></div>
      <div class="apl-copyzone"></div>
      <div class="sheet-actions"><button type="button" class="btn quiet" id="apl-close" style="margin-right:auto">Close</button><button type="button" class="btn" id="apl-applied"></button><button type="button" class="btn primary" id="apl-copy">Copy prompt for Claude</button></div>`, "apl-h");
    const $ = id => w.querySelector("#" + id);
    const cur = () => app.tracker.get(appId) || r;
    function status() {
      const p = profile(), rec = cur(), todo = [];
      if (!p) todo.push("add your profile"); if (!rec.postingText.trim()) todo.push("paste the posting");
      const ok = !todo.length; $("apl-ready").textContent = ok ? "Everything's ready. Copy the prompt, then apply." : "Next: " + todo.join(", then ") + ".";
      $("apl-ready").classList.toggle("ok", ok);
      $("apl-pline").textContent = p ? (blank(p.name) ? "Profile added" : "Profile: " + p.name) : "No profile yet";
      $("apl-prof").textContent = p ? "Edit" : "Add profile";
      const ap = $("apl-applied"); ap.disabled = rec.status === "applied" || rec.status === "interviewing" || rec.status === "offer";
      ap.textContent = rec.dates.applied && ap.disabled ? "Applied " + rec.dates.applied : "Mark as applied";
    }
    status();
    const saveText = () => { const v = $("apl-post").value; if (v !== cur().postingText) { app.tracker.update(appId, { postingText: v }); } status(); };
    $("apl-post").addEventListener("change", saveText); $("apl-post").addEventListener("blur", saveText);
    w.querySelectorAll("[data-mat]").forEach(c => c.onchange = () => {
      const k = c.dataset.mat, rec = cur(); app.tracker.update(appId, { materials: { [k]: k === "resume" ? (c.checked ? (rec.materials.resume || "ready") : "") : c.checked } });
    });
    const which = $("apl-which"); if (which) which.onchange = () => openHelper(empId, which.value);
    $("apl-close").onclick = () => closeSheet();
    $("apl-prof").onclick = () => { saveText(); openProfile(() => openHelper(empId, appId)); };
    $("apl-copy").onclick = async () => {
      saveText(); const text = buildPrompt(e, cur());
      if (await copyText(text, w)) app.toast("Copied ✓"); else app.toast("Select the text below and copy it.");
    };
    $("apl-applied").onclick = () => {
      saveText(); const prev = cur(); app.tracker.update(appId, { status: "applied", dates: { applied: todayISO() } });
      closeSheet(); app.toast("Marked Applied for " + e.name + ".", { undo: () => app.tracker.update(appId, { status: prev.status, dates: { applied: prev.dates.applied } }) });
    };
    $("apl-copy").focus();
  }

  // ---------- card section ----------
  app.hooks.card.push(e => {
    const tracked = activeRecs(e.id).length > 0;
    return {
      slot: "bottom",
      html: `<section class="kit-sec apl-sec" aria-label="Apply helper"><h3><span>Apply helper</span></h3>
        <div class="btn-row"><button type="button" class="btn" id="apl-open">${tracked ? "Apply helper" : "Start applying"}</button><button type="button" class="btn quiet sm" id="apl-myprof">My profile</button></div>
        <p class="kit-note">${tracked ? "Keep your materials in one place and build a prompt to paste into Claude." : "Pick a role and get your materials together."}</p></section>`,
      bind(card) {
        const o = card.querySelector("#apl-open"), pr = card.querySelector("#apl-myprof");
        if (o) o.onclick = () => { const rs = activeRecs(e.id); if (rs.length) openHelper(e.id, rs[0].appId); else openStart(e.id); };
        if (pr) pr.onclick = () => openProfile();
      }
    };
  });

  // ---------- profile button near the sync note (My applications tab) ----------
  function addProfileButton() {
    const list = document.getElementById("list"); if (!list || app.tab !== "apps") return;
    const intro = list.querySelector(".intro"); if (!intro || list.querySelector("#apl-tabprof")) return;
    const b = document.createElement("button"); b.type = "button"; b.id = "apl-tabprof"; b.className = "btn quiet sm"; b.textContent = profile() ? "My profile" : "Add my profile";
    b.onclick = () => openProfile(); intro.insertAdjacentElement("afterend", b);
  }
  app.on("refreshed", addProfileButton); app.on("profile-changed", addProfileButton);
  // start applying straight from an opening (spec 6): one tracker record per job, then the helper opens filled in
  function startFromJob(jobId) {
    const j = app.jobs && app.jobs.get(jobId); if (!j) return null;
    const empId = j.empId || "job:" + jobId;
    let r = app.tracker.all().find(x => x.jobId === jobId);
    if (!r) r = app.tracker.upsert({ empId, role: j.title, postingUrl: j.url || "", postingText: j.pasted || j.summary || "", jobId, status: "applying" });
    openHelper(empId, r.appId); return r.appId;
  }
  app.apply = { open: openHelper, startFromJob };
  app.profile = { get: () => profile() ? JSON.parse(JSON.stringify(profile())) : null, open: () => openProfile(), parse: parseProfile, buildPrompt };
});
