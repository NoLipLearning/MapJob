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
