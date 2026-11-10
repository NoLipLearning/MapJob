# Reston Hiring Map

3D map of office buildings from Warrenton to Capitol Hill with 95 researched employers, ranked by a match score you can tune.

## Run it
```
cd reston-hiring-map
python3 -m http.server 8765
# open http://localhost:8765/reston-hiring-map.html
```
(Opening the file directly will not load the 3D building tiles.)

## Continue in Claude Code
```
cd reston-hiring-map
claude
```
Then paste the contents of `PROMPT.md`.

## Rebuild after editing
```
cd src && python3 build4.py && mv reston-hiring-map.html ..
```

## Caveats
Ratings are judgments from public postings as of November 2026. Building heights are estimated when untagged. Rosslyn-Ballston buildings are not loaded yet.

## Refresh openings
Tell Claude "refresh my map". It follows `docs/REFRESH.md`: searches Indeed, reads your LinkedIn/Handshake/Indeed job-alert emails, checks USAJOBS and employers' careers pages, scores each job against your profile, and writes them to the map's Openings tab. Jobs you save, dismiss or apply to keep that status.
