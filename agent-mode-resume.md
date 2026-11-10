# Agent-mode checkpoint (Reston Hiring Map v2) - updated 2026-11-09
Goal: build BUILD-PLAN.md (filters, routes, tracker+cloud, reminders, apply helper) AND a much better UI. Eric said "now go".
Team plan: Phase0 me (done) -> Phase1: 3 Sonnet agents in worktrees (F filters, R routes, T tracker) -> merge -> Phase2: 2 Sonnet agents (A apply helper, Rem reminders) -> merge -> Phase3: 1 Sonnet UI-pass agent (layout/mobile/polish, docs/UI-DIRECTION.md) -> me: review, publish artifact, zip.
Done: Phase0 split (src/parts/*, shell.html, build4.py, hooks API in 00-core.js, 05-kit.css, tests/smoke.js passes 10/10, home default set, Rosslyn jump button, card shrunk on desktop, viewport meta).
Pending: Rosslyn tile (src/fetch_osm.py running in bg; overpass flaky; log src/osm_raw/fetch.log). Streets for Arlington. 
Env: added hosts overpass-api.de + router.project-osrm.org to Default env. jsdelivr blocked -> tests stub three.js from tests/vendor.
Waiting on Eric: GitHub repo name; "near-home detail" confirmation; profile JSON from resume prompt. No repo yet => commits are local only; zip to Eric at the end.
Next: spawn Phase1 agents (briefs in this chat), then merge branches, rebuild, run node tests/smoke.js.
Size left: large.

UPDATE: Phase1 agents F, R, T launched (Sonnet, worktrees, background). Merge their branches when they report, then rebuild + node tests/smoke.js + each tests/*.js.
Rosslyn: src/fetch_osm.py bg (bld_00,01,02,10 done; 11 retrying), then run `cd src && python3 add_rosslyn.py` (idempotent, uses prep4.base.json), rebuild, test, commit.
Phase2 (after T merges): Agent A apply helper (BUILD-PLAN 2.4) + Reminders (section 3) in parallel. Phase3: UI pass agent per docs/UI-DIRECTION.md. Then publish artifact (needs capabilities db,user,downloads; files tiles/*.json), zip to Eric.

UPDATE 2: F (filters) and T (tracker) MERGED to master + tests pass (smoke 10, filters, tracker). Built html untracked. R (routes) agent a84e7ca2b7dd7a080 still running. Phase2 agents launched: A apply helper (aee0f2921c7c74496), Reminders (a4d0d8594cbc86169). After all merge: run Rosslyn (add_rosslyn.py after fetch DONE), then Phase3 UI-pass agent per docs/UI-DIRECTION.md, then publish+zip.
Known nits for UI pass: filters 'My status' buckets (star=Interested, applying=Applied, offer=Interviewing); desktop filter bar starts collapsed.

UPDATE 3: ALL Phase1+2 branches MERGED (F,T,R,A,Reminders) + Rosslyn tile+5130 streets. 8 suites pass (smoke10, filters42, tracker48, routes21, apply30, reminders51, rosslyn, integration). 
Next: Phase3 UI-pass agent per docs/UI-DIRECTION.md (launch in worktree), merge, review screenshots myself; then publish artifact (capabilities db,user,downloads; files tiles/*.json) and verify cloud path with ArtifactData; zip to Eric (SendUserFile). Ask Eric: GitHub repo, near-home detail OK?, profile JSON.
UI issues seen: tabs wrap ('Biggest offices'), Today panel pushes list down, phone: map below ~400px controls, card overlaps pad, header tagline tall.

UPDATE 4: GitHub connected: origin = https://github.com/NoLipLearning/MapJob.git, local branch renamed master->main, pushed at c28f6fd. Push again after merging the UI agent (a8ef7649921c867b2). Empty clone at /home/user/mapjob is unused.

UPDATE 5: UI agent merged (fcdda39). Agents' leftover http servers made earlier test passes unreliable; tests now default to :8765; all 9 suites passed on merged build (smoke10 filters45 tracker48 routes21 apply30 reminders51 integration20 layout78). Published artifact https://claude.ai/artifact/H5oMnB3g2z77WQWKBESDyU (v1 = pre-UI build); republish same file path to update. Remaining: republish, verify cloud save once Eric tracks something, near-home detail (unconfirmed), profile JSON from Eric. Server must be restarted after worker restart: python3 -m http.server 8765 from project root.
UPDATE 6: added 3 local/federal employers (SSA Reston, SSA Manassas, VA DVS Ashburn) via src/add_employers.py (run after add_rosslyn.py, then routes.py). Ratings are estimates; ssa.gov blocks automated downloads (do NOT spoof UA). Republished. Open: Eric to say which SSA building he passes; more office types if wanted.
UPDATE 7: added src/parts/60-links.js (Find openings: LinkedIn/Indeed/Handshake/USAJOBS search links on employer cards; Indeed+LinkedIn near-here on building cards; My pages sheet saved in localStorage reston-map-mylinks; core hook app.hooks.rankCard) + tests/links.js.
UPDATE 8: v3 spec + plan written (docs/superpowers/specs/2026-11-10-openings-design.md, docs/superpowers/plans/2026-11-10-openings.md). NOT built. Waiting for Eric to review and pick execution method.

UPDATE 9: v3 BUILT (Tasks 1-9) and pushed; 15 browser suites + 28 unit tests pass. Reviewer agent checking refresh logic. Remaining: fix review findings, republish artifact, first real refresh when Eric asks.
UPDATE 10 (v4): routing removed (pushed). Contract docs/DATA-CONTRACT-v4.md. Next: 2 Sonnet agents in worktrees: DATA (offices.py GSA+OSM, feeds.py Greenhouse/Lever, usajobs.py, authoritative deletes, deadline/officeId, coverage+spotcheck scripts) and UI (facet counts, sorts, Openings facets, pin clustering, office pins + building card, applied-per-week). Then merge, e2e, republish. USAJOBS key not yet requested.
