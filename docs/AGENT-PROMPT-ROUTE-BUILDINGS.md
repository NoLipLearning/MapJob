# Agent prompt: buildings along Eric's commutes

Paste everything below the line into a new Claude Code session on this repo (NoLipLearning/MapJob). It is written for a boss agent that leads a small team.

---

You are the **boss** of a small agent team. Your job: make Eric's job map show the real office and commercial buildings along **his actual drives to work**, with the employers and jobs already on the map attached to the buildings they sit in. The map has 3D building tiles only for Tysons, Rosslyn, Arlington, Crystal City, DC and Warrenton (`tiles/*.json`). There are none along the roads he drives every day. Close that gap fully, not partly.

## Team and roles

- **Boss (you, Opus):** plan, split the work, dispatch, review every result against the checks below, and merge. Do not write the bulk code yourself. Reject work that misses a check and send it back once with the exact failure.
- **Scouts (Haiku, 1 or 2, in parallel):** find data layers and read their schemas. They return short facts: layer URL, field names, record counts, a sample record. No code.
- **Builders (Sonnet, 1 or 2, in parallel):** write and run the scripts. Each works in its own git worktree, on one county at a time.
- **Reviewer (Sonnet, 1):** runs the checks, takes the screenshots and reports pass or fail with evidence. It never fixes; it only reports.

Keep the cost low. Scouts before builders, one script per county reused for the others, no browsing for what an API returns, and no re-reading of large files. Write a checkpoint to `agent-mode-resume.md` after each phase.

## Eric's routes (from his own Apple Maps screenshots in `docs/route-screenshots/`)

Home: Reston, 38.93472, -77.32540. He prefers toll-free roads.

1. **Leesburg commute (29 min, his route):** Rt 7 (Leesburg Pike) northwest from Reston through Sterling, Ashburn and Lansdowne to work near US-15 in Leesburg. The alternative is the Dulles Toll Rd (267) plus the Dulles Greenway (tolls).
2. **Warrenton commute (47 min, his route):** Fairfax County Pkwy (608) south from Reston past Fair Oaks to US-29 (Lee Hwy) near Union Mill and Centreville, then US-29 west through Gainesville and New Baltimore to work near Warrenton (US-15/29). The alternative, which avoids highways, also uses US-29 and back roads near Buckland.
3. Also include the **I-66 corridor** from Fair Oaks to Rosslyn (Eric asked for it) and the **Dulles Toll Rd / Rt 28** stretch near home.

Define each route as a polyline. Use the roads already stored in `src/prep4.json` (`r`) where they match; otherwise use road centerlines from the county GIS layers below. The **corridor** is everything within 1 mile of a route line.

## Raw data to start from (not OpenStreetMap: its Overpass server is unreachable from these sessions)

- **Fairfax County GIS** on `services1.arcgis.com/ioennV6PpG5Xodq0` (already allowed):
  - `Buildings`, `Buildings2018LiDAR` (footprints and heights);
  - `Tax_Administration_Real_Estate_Commercial_Data` (building names, `IMPRNAME`, joined by `PARID`);
  - a parcel layer that gives each `PARID` a position.
- **Loudoun County GIS** (Rt 7: Sterling, Ashburn, Leesburg) and **Prince William County GIS** (US-29 at Gainesville, Manassas). Fauquier County GIS covers New Baltimore and Warrenton.
  - Scouts find their public ArcGIS REST endpoints.
  - If a host is blocked, propose adding exactly that host with the environment tools. Do not work around blocks.
- **Microsoft US Building Footprints**: a fallback for footprints only, with no names.
- Already in the repo:
  - `src/offices.json` (GSA federal buildings);
  - `src/prep4.json` `emps` (133 employers with positions);
  - the artifact database `jobs` (about 360 openings with positions).

## What to build

1. One script, `src/route_buildings.py`, that, for each county:
   - pages through the footprints inside the corridor bounding box;
   - clips them to the 1-mile corridor;
   - keeps commercial, office, industrial, institutional and government buildings (by use code or the tax join), but **drops houses**;
   - simplifies the outlines the same way `src/add_rosslyn.py` does;
   - writes tiles in the **same format** as `tiles/rosslyn.json`: `[height, flag, x1, y1, ...]`, using the equirectangular projection with origin 38.955, -77.355 (see `CLAUDE.md`);
   - registers the tiles in `prep4.json` the way `add_rosslyn.py` does.
2. **Names:** attach a building name only where a county record states one.
3. **Employers and jobs:** snap each employer and job position to the building outline that contains it (or the nearest within 60 m), and store that building's id. Never move a pin onto a building it isn't in.
4. **Size budget:**
   - Keep the built page under 12 MB.
   - If that's tight, drop small buildings (under about 400 m²) far from any employer first, and say how many you dropped.
5. Rebuild with `python3 src/build4.py`, run every test suite (`node tests/<name>.js`, server on :8765), commit, and push. Ask Eric before republishing the artifact.

## Rules

- Nothing invented: every building, name and height comes from a county or federal record and is labelled with its source.
- Never scrape LinkedIn or Handshake. Never disguise requests.
- Don't add UI that wasn't asked for. The only UI change allowed is making the new tiles load.

## How the boss proves it worked (the reviewer runs these; report the numbers)

1. **Coverage per mile, before and after**, for each route: count the buildings inside the corridor per mile, and list every stretch over 1 mile that has zero buildings. The target is no zero-building stretches through Sterling, Ashburn, Leesburg, Fair Oaks, Centreville, Gainesville or Warrenton town.
2. **Ten spot checks:** each of these must fall inside a tiled building outline:
   - NRA HQ, 11250 Waples Mill Rd;
   - Fair Lakes Center;
   - Inova Fair Oaks Hospital;
   - Reston Town Center;
   - Loudoun County Government Center, Leesburg;
   - One Loudoun or Dulles Town Center;
   - Northern Virginia Community College, Manassas;
   - Haymarket Medical Center;
   - Fauquier County Courthouse, Warrenton;
   - Navy Federal HQ, Vienna.
3. **Screenshots** (Playwright, deviceScaleFactor 2) of the map along Rt 7 at Ashburn, US-29 at Gainesville and I-66 at Fair Oaks, before and after. Send them to Eric.
4. **All test suites pass.** Page size is reported.

Final report to Eric, under 12 lines: buildings added per route, per-mile coverage before and after, spot-check results, page size, anything skipped and why, and the screenshots.
