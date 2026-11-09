# Project notes for Claude Code
- App: `reston-hiring-map.html` (built) from `src/template4.html` + `src/prep4.json`. build4.py reads and writes in the current directory, so rebuild with `cd src && python3 build4.py && mv reston-hiring-map.html ..`.
- Serve with `python3 -m http.server 8765` from the project root; tiles are fetched relatively from `tiles/`.
- Projection: equirectangular, origin LAT0=38.955, LON0=-77.355 (x east, z south, meters).
- three.js r128 + OrbitControls. Sprites use sizeAttenuation:false; layering uses depthWrite:false and renderOrder.
- Match score = weighted mean of (role_fit-1)/4, (clearance_access-1)/4, (entry_access-1)/4 and commute score, times weights 35/30/20/15.
- localStorage keys: reston-map-weights, reston-map-home, reston-map-hideclear, reston-map-help-seen.
- `src/prep4.py` rebuilds prep4.json but needs large raw OSM files that are not included; prep4.json is prebuilt.
