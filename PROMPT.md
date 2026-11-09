# Paste this into Claude Code (run `claude` inside this folder)

You are continuing a project: a 3D hiring map for a recent political-science grad job hunting in the DC area, with **no security clearance** and an entry-level focus. Read `README.md` and `CLAUDE.md` first, then do the following.

## What exists
- `reston-hiring-map.html` is a single-page three.js (r128 via jsdelivr) app. It shows 3D office buildings from Warrenton to Capitol Hill, 95 researched employers ranked by a tunable match score, and a "Biggest offices" ranking by estimated floor area.
- The source is `src/template4.html` (it contains a `__DATA__` placeholder). `src/build4.py` injects `src/prep4.json` into it and writes the final HTML. Building tiles are in `tiles/*.json` and are fetched lazily, so the page must be served over HTTP (`python3 -m http.server 8765`), not opened as a file.
- Employer research lives in `src/employers.json` (fields: id, name, type, addr, lat, lon, url, roles, progs, cl, s=[role_fit, clearance_access, entry_access], why, src, notes). The briefs and raw research are in `research/`.
- Match score = weighted average of role fit, no-clearance access, entry access and commute; defaults 35/30/20/15, stored in localStorage.

## Tasks, in order
1. **Make it easy to move around the map.** The template already has a hold-to-move d-pad, rotate/tilt/zoom buttons, a Move/Turn drag toggle, place jump buttons, a compass, a help panel, and a Prev/Next stepper in the card. Test every control in a real browser (Playwright with the SwiftShader flags `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`). Verify: arrow/WASD keys, Q/E rotate, R/F tilt, +/- zoom, N north-up, T 2D/3D, H home, `[` `]` step through the list, `/` focuses search, Enter flies to the top result, mouse drag, right-drag rotate, wheel zoom at cursor, double-click zoom, and touch on a 400px-wide viewport. Fix anything that fails. Known suspect: a mouse drag that starts under the open details card does nothing; consider letting the card shrink by default.
2. **Fill the data gaps.** Fetch the missing Rosslyn-Ballston buildings (`tiles/arlington.json` is an older raw cache of 8,934 Arlington buildings that is NOT registered as a tile; check whether it covers Rosslyn-Ballston, and if not, fetch fresh data) from OpenStreetMap via an Overpass mirror (overpass-api.de may be blocked; try maps.mail.ru and others, split large queries) and add extra DC/Arlington streets. Register any new tile in the `tiles` list inside `src/prep4.json` (id, name, file, cx, cz, rad) and keep the same tile JSON format as `tiles/dc.json`.
3. **Set the default home** once I give you an address (geocode it with Nominatim, 1 request per second, and bake it in as the default while keeping the "Set my home" button).
4. **Re-verify research.** Re-check careers links (curl) and flag weak records: IDB, Cato, RNC, New America, and the Microsoft/NVR/Oracle addresses. Don't invent data; mark anything unverified.
5. Rebuild with `python3 src/build4.py`, test again, and summarize what changed and what you could not verify.

## Next: brainstorm with me (after the tasks above)
I want to brainstorm and ideate on how to make this concept even better, more detailed, more tailored to me, and more adaptable (easy to reshape for other people, cities or goals). Don't start building yet. Do this instead:
1. Ask me up to 5 short questions about my goals, constraints and what I'd actually use day to day.
2. Then propose 8 to 12 concrete ideas, grouped under: **Tailoring** (more of my own background, interests and preferences in the ranking), **Detail** (richer employer cards, real open postings, salary, application deadlines, networking contacts), **Adaptability** (settings and data files so anyone can swap in their own home, field, clearance status and weights, and so other metro areas can be added), and **Workflow** (application tracker, status per employer, reminders, export).
3. For each idea give a one-line payoff, rough effort (small, medium, large), and what data or research it needs. Say which ones you'd do first and why.
4. Wait for me to pick, then build the chosen ones.

## Rules
- Plain language. State what you checked and what you did not.
- Never fabricate job postings, addresses or links.
- Ask before anything that sends email or posts anything outward-facing.
- Keep the page self-contained: no external fonts, images or scripts beyond three.js and OrbitControls from jsdelivr.
