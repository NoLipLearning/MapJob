# Next-level plan (for an Opus session to execute)

Written 2026-11-16 from what the build sessions showed. Read `CLAUDE.md`, `docs/REFRESH.md` and `docs/DATA-CONTRACT-v4.md` first. Eric's rules still apply: nothing invented, no scraping LinkedIn/Handshake, never disguise requests, keep usage low, calm UI (max 3 actions per row, no red, no growing counters), build only what is listed.

## Where it is weak today (ranked by how much it costs Eric)

1. **Job facts are shallow.** Clearance, experience and degree needs come from titles only, because postings were never opened. 94 openings, most say "Clearance not stated". He can waste applications on jobs he cannot get.
2. **No real profile.** His resume was never loaded, so "fit" uses a generic keyword list. The apply helper is untested with real content. His own `anthropic-skills:job-application-agent` skill exists and is not connected.
3. **Refresh is hand-made.** Each refresh so far was me picking jobs by eye in a session. It is not repeatable, and the Gmail-alert and USAJOBS steps have never run for real.
4. **Two scoring systems disagree.** Openings rank by "chance of getting hired, any field". The Matches tab still ranks employers by the old policy-tailored score (think tanks first).
5. **Businesses near Reston are thin.** OpenStreetMap (Overpass) is refused from this environment, so no named offices or tenants. New employers sit at town-centre pins.
6. **Openings tab lacks basic finding tools.** No search box, no job-type (internship / full-time) or category (sales / analyst / admin / program) filter, no duplicate folding (same job posted in five towns).
7. **Staleness.** Postings close; nothing re-checks them. Some loaded jobs were posted months ago.
8. **Unverified plumbing.** Cloud save has never been confirmed by Eric on two devices. The page is 3.3 MB and opens on the 3D map, although the job list is now the product.

## Phases (do in order; each ends with all tests passing, commit, push, republish)

### Phase 1: Real job facts (biggest win)
- `src/refresh/enrich.py` + runbook step: for the top 40 openings by fit, call `mcp__Indeed__get_job_details` (cap 40 per refresh) and store `desc` (first 1,500 chars), then re-run `classify_clearance`, `classify_entry`, and new `classify_degree(text) -> "none|bachelors|masters|unknown"` and `years_required(text) -> int|None`.
- Score: add a hard gate, not a weight. A job is "Can't apply yet" (hidden by default, own filter chip) when clearance is `required`, degree is `masters`, or years >= 3.
- Flag commission pay: sales title and pay max >= 2x min -> tag "Pay includes commission"; score on the minimum.
- Done means: unit tests for the two new classifiers with 12 real posting snippets; after one real refresh, under 25% of the top 40 show "not stated" for clearance.

### Phase 2: Eric's real profile, and applying in one step
- Load the profile once: `mcp__Indeed__get_resume` (ask Eric first), map to the profile shape, show it to him, write to `data/users/me/profile/mine/main` after he says yes.
- Replace the generic keyword list in the refresh with the stored profile.
- "Start applying" sheet gets one primary button, "Tailor with my application agent": copies a prompt that names the `job-application-agent` skill and includes the posting text and link, so pasting it into Claude runs his skill. Keep the existing copy-prompt as the fallback.
- Done means: `tests/applyflow.js` covers the new button; one real run with Eric produces a tailored resume for a job from the map.

### Phase 3: One repeatable refresh
- Turn `docs/REFRESH.md` into a single entry point: `src/refresh/run.py --raw-dir DIR` that takes the raw tool outputs the session saved (Indeed markdown, Gmail alert text, feeds JSON) and does parse -> screen -> dedupe -> enrich list -> score -> writes file. Add `parse_indeed_markdown()` and `parse_alert_email()` with fixtures taken from real outputs.
- Screening rules move from my judgment into code: drop senior titles, specialist credentials, student-only, postings older than 60 days; fold duplicates by employer + normalized title, keeping the nearest location and listing the others.
- Run the Gmail-alert step and USAJOBS for real (USAJOBS needs Eric's free key and his OK to send his email in the header).
- Done means: a refresh in a fresh session needs no hand-picking; two runs in a row give the same ids; fixtures cover each parser.

### Phase 4: One ranking, jobs first
- Employers rank by hiring signal: best opening fit, number of open entry-level jobs, distance. Keep the researched score as a small tie-breaker and show it as "research rating".
- Make Openings the default tab and the default map layer: job pins sized by fit, clustered. Employers and Buildings become toggles.
- Openings tools: search box, Job type (Full-time, Internship, Part-time), Category (Sales, Analyst, Admin and operations, Program and policy, Other) from title rules in `keywords.json`, and "Within N minutes".
- Done means: `tests/facets.js` extended; `tests/layout.js` still passes at 320-1280 px; first screen on a phone shows jobs within 2 taps.

### Phase 5: Real businesses near Reston
- Overpass is blocked here. Try, in this order, and stop at the first that works: (a) Fairfax and Loudoun county open data on ArcGIS (the same host family as the GSA service that worked) for commercial/office parcels and business names; (b) another Overpass mirror, if Eric approves the host; (c) Nominatim lookups by employer name for the employers already in the jobs data (1 per second, cached).
- Give every employer with openings a real pin; mark town-centre pins as "approximate".
- Done means: at least 300 named non-federal offices within 10 miles of home in `offices.json`, each with a source URL; `check_coverage.py` extended to validate them.

### Phase 6: Keep it true and fast
- Freshness: dim jobs posted over 45 days ago; "Still open?" check on Open for hosts we may request; expire unseen jobs at 30 days (exists).
- Verify with Eric: cloud save on phone + laptop; one status change during a slow sync.
- Speed: load the 3D map and tiles only when the Map view is opened; target first list paint under 1.5 s on a phone.
- Housekeeping: split `70-jobs.js` (storage, facets, rendering); remove the dead `app.routes` fakes from tests; update `CLAUDE.md` part list (60, 70, 72, 80).

## Model and usage
Opus plans each phase and writes the classifiers, screening rules and score gate (Phases 1 and 3). Sonnet builds page work (Phases 2, 4, 6) in worktrees, one agent per phase. Haiku writes parser fixtures and runs suites. One reviewer pass after Phase 3 only (data rules). Stop after each phase and report.

## Needs Eric before starting
1. OK to load his resume from Indeed (Phase 2).
2. A USAJOBS API key, and OK to send his email in that API's required header (Phase 3).
3. OK to allow county open-data hosts (Phase 5).
4. Is he a current student or a graduate? It decides whether internships and "student trainee" roles are shown.
