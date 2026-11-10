# Project notes for Claude Code
- App: `reston-hiring-map.html` (built, gitignored) from `src/shell.html` + `src/parts/*.css|*.js` (joined in filename order) + `src/prep4.json` + `src/routes.json`. Rebuild: `python3 src/build4.py` (writes the HTML in the project root).
- Parts talk to the core only through `app` (see the "Part API" block at the top of `src/parts/00-core.js`). Each feature is one part: 10 filters, 20 routes, 30 tracker, 40 reminders/Today, 50 apply helper, 60 job-site links, 70 openings, 72 suggested employers.
- Serve with `python3 -m http.server 8765` from the project root (tiles load from `tiles/`). Tests: `node tests/<name>.js` (default URL :8765; they stub the blocked three.js CDN from `tests/vendor`). Refresh unit tests: `cd src/refresh && python3 -m unittest`.
- Published (private) at https://claude.ai/artifact/H5oMnB3g2z77WQWKBESDyU with capabilities db, user, downloads. Republish the same file path to keep the URL.
- "Refresh my map" = follow `docs/REFRESH.md`. Never scrape LinkedIn or Handshake; never disguise requests to get past a block.
- Data scripts (run from `src/`, in order): `add_rosslyn.py`, `add_employers.py`, `routes.py`. `prep4.py` needs raw OSM files that are not included.
- Projection: equirectangular, origin LAT0=38.955, LON0=-77.355 (x east, z south, meters). three.js r128 + OrbitControls.
- Match score = weighted mean of (role_fit-1)/4, (clearance_access-1)/4, (entry_access-1)/4 and commute score, weights 35/30/20/15.
