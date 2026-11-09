# Agent mode resume note: COMPLETE

Goal: extend the Reston Hiring Map toward DC and Warrenton, add researched employers, and rank them with a tunable match score tailored to Eric.

Done:
- Research: 4 Sonnet agents produced /home/claude/research/{gov,policy,contractors,corporate}.json (96 records). verify.py geocoded them and checked links, and merge.py built 95 kept records into employers.json (Richmond dropped).
- Map: tiles for Tysons, Crystal City/Pentagon, downtown DC and Warrenton (cached). Routed highways to Warrenton, Manassas and Leesburg via OSRM. 82 Metro stations via Nominatim.
- UI: template4.html (Top matches with weights, Biggest offices across areas). Built with prep4.py and build4.py.
- Tested: Playwright desktop and phone, no errors and no horizontal scroll. Weight sliders re-rank, and the DC and Warrenton tiles load.
- Published: Version 4, https://claude.ai/artifact/Q7VC8iiFZPtfFDUD5XBgWv

Not done (Overpass servers kept timing out): Rosslyn-Ballston 3D buildings and extra DC/Arlington side streets. Rerun retry2.sh for t_rb1/t_rb2, then prep4.py and build4.py, and republish with tiles/arlington.json.
