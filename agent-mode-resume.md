# Agent mode resume note (history before 2026-11-21 is in docs/agent-mode-history.md)
Goal: finish docs/AGENT-PROMPT-ROUTE-BUILDINGS.md.
DONE (published v13, commit 6c79365): Fairfax+Loudoun+Microsoft route tiles (55 rb-* tiles), coverage before/after (docs/route-coverage-*.json, no zero miles), 8/10 spot checks, all tiles published via files map.
IN PROGRESS (Sonnet coder):
 1. Employer pads: in src/route_buildings.py, also pull footprints within 400 m of every employer in prep4 emps and every job position in the corridor counties (Fairfax/Loudoun; Microsoft west of Bull Run) so NOVA Manassas + Haymarket spot checks pass.
 2. Building click: clicking a route-tile building shows its county name (src/route_building_names.json) and the employers/jobs whose pin is inside it (or within 60 m).
LEFT: review, tests, commit/push, republish with all tiles in files map (Eric already said to republish when done).
Size left: medium.
