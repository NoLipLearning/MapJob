# NoVA Employer Directory + More Openings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin every sizeable NoVA employer at its building with a verified careers link, starting with the hand-built list (phase A), then SAM.gov contractors (phase B). Add CareerOneStop as a job source.

**Architecture:**
- Employer locations live in a new `src/directory.json`.
- `src/add_directory.py` builds it from candidate files, using the Nominatim geocoder with its cache.
- `build4.py` puts it in `D.dir`.
- A new part, `src/parts/82-directory.js`, draws the pins through `app.pinProviders` and adds an "All NoVA" list tab through `app.addTab`, the same way `80-offices.js` does.
- Phase B and CareerOneStop are fetch adapters with fixture-based unit tests.

**Tech Stack:** Python 3 stdlib scripts and `unittest`; vanilla JS parts; Playwright tests (`node tests/<name>.js`, server on :8765).

**Spec:** `docs/superpowers/specs/2026-11-24-more-employers-careers-links-design.md`

## Global Constraints

- **Links and sources:**
  - A careers link is stored only when a search result or the employer's own site shows it. Otherwise `linkType: "website"` with the homepage, or no link.
  - Every record carries `src` (URLs) and `checked` (YYYY-MM-DD).
- **Placement:**
  - Placed only when the geocode matches the house number (`gc: "addr"`); other results go to the not-placed list.
  - Phase B is capped at 1,500 new geocodes per run.
- **Pins:**
  - Directory entries are not part of the match score, the employer filters or the tracker.
  - The 133 researched employers are never clustered with directory pins and are drawn above them.
  - A directory entry with `empId` draws no pin.
- **Name matching:** exact normalised names only (lower case, punctuation removed, Inc / LLC / Corp / Co / Ltd / leading "The" stripped). No fuzzy matching.
- **Keys:** the SAM.gov and CareerOneStop keys come from environment variables (`SAM_API_KEY`, `COS_TOKEN`, `COS_USERID`) and are never committed.
- **Network:** never LinkedIn or Handshake; never disguise requests; a blocked host is skipped and reported.
- **Size:** page under 12 MB. If `directory.json` would push it over, phase B records move to `tiles/dir-sam.json`, loaded at runtime.
- **Publishing:** every `tiles/*.json` file goes in the Artifact `files` map.

## Review Focus

1. **Same employer at several addresses** (for example Booz Allen's McLean and Herndon offices): two records with distinct ids, both pinned. → Task 1 test `test_ids_unique_per_location`.
2. **A link that isn't http(s)** (`javascript:`, empty, relative): it is dropped at build time and the card shows no button. → Task 1 test `test_bad_link_dropped`; Task 3 assertion.
3. **An entry within 150 m of a researched employer with the same normalised name:** it gets `empId` and no second pin. → Task 1 test `test_match_emp`.
4. **`directory.json` missing or empty:** the page loads with no errors, and the tab shows "No employers loaded". → Task 3 assertion.
5. **Geocode miss or street-level result:** the entry is not drawn, it is listed in the report's not-placed count, and the script still completes. → Task 2 test `test_unplaced_listed`.

---

### Task 1: Directory library + build wiring

**Files:**
- Create: `src/directory.py`, `src/test_directory.py`
- Modify: `src/build4.py:12` (also load `directory.json` into `D['dir']`)

**Interfaces:**
- Produces:
  - `norm_name(s: str) -> str`
  - `make_id(name: str, addr: str) -> str` (slug of the name plus a 6-character hash of the address)
  - `clean_link(url: str|None) -> str|None` (http/https only)
  - `match_emp(rec: dict, emps: list[dict], meters=150) -> str|None`
  - `validate(recs: list[dict]) -> list[str]` (an empty list means OK)
- **Record shape:** `{id, name, kind, addr, lat, lon, gc, link, linkType, src, via, checked, empId?}`, where `via` is `"list"` or `"sam"`.

- [ ] **Step 1: Write the failing tests** in `src/test_directory.py`:
  - `test_norm_name`: `norm_name("The Booz Allen Hamilton, Inc.") == "booz allen hamilton"`
  - `test_ids_unique_per_location`: the same name with two addresses gives two different `make_id` values
  - `test_bad_link_dropped`: `clean_link("javascript:x") is None`, `clean_link("") is None`, and `clean_link("https://a.com/careers") == "https://a.com/careers"`
  - `test_match_emp`: a record 100 m from an emp with the same normalised name returns that emp's id; 200 m away returns None; a different name at 10 m returns None
  - `test_validate`: these each produce an error: a missing `src`, `gc != "addr"` with a lat present, and a duplicate id
- [ ] **Step 2: Run the tests and check they fail.** Run: `cd src && python3 -m unittest test_directory -v`. Expected: ImportError.
- [ ] **Step 3: Implement `src/directory.py`** using the haversine formula for distance, and change `build4.py` to: `D['dir'] = json.load(open('directory.json')) if os.path.exists('directory.json') else []`
- [ ] **Step 4: Run the tests and check they pass.** Same command; expected: OK.
- [ ] **Step 5: Commit:** `feat: directory record helpers and build wiring`

### Task 2: Phase A data — candidates, careers links, geocoding

**Files:**
- Create: `src/dir_sources/phaseA-*.json` (candidates, one file per source list), `src/add_directory.py`, `src/test_add_directory.py`
- Output: `src/directory.json`

**Interfaces:**
- Consumes: Task 1 helpers; `src/geocache.json`; Nominatim (allowed host, 1 request per second, the existing cache format from `add_employers.py`).
- **Candidate file rows:** `{name, kind, addr, link, linkType, src: [urls]}`. `link` is null when no careers or homepage link was found.
- Produces: `add_directory.py [--in GLOB] [--cap N] [--offline]`
  - writes `directory.json`, sorted by id;
  - prints `placed N | careers N | website N | no link N | not placed N`;
  - writes `src/dir_unplaced.json`.

- [ ] **Step 1: Write the failing tests** in `src/test_add_directory.py`, with `--offline` and a stub geocoder fixture:
  - `test_unplaced_listed`: a street-level geocode result is not in the output and is in the unplaced list
  - `test_idempotent`: running twice gives identical bytes
  - `test_empid_set`: a candidate matching a researched emp gets `empId`
- [ ] **Step 2: Run the tests and check they fail.** Run: `cd src && python3 -m unittest test_add_directory -v`
- [ ] **Step 3: Implement `add_directory.py`.** The geocoder is injectable for tests; the real one uses Nominatim's structured search, and a result counts as placed only when it has a `house_number`.
- [ ] **Step 4: Run the tests and check they pass.**
- [ ] **Step 5: Collect the candidates (agents).**
  - Haiku scouts produce about 400 candidate rows across these lists:
    - the county major-employer lists (Fairfax, Loudoun, Prince William, Arlington);
    - the agency HQs and the federal offices in `src/offices.json`;
    - associations;
    - think tanks and advocacy groups;
    - embassies and international organisations;
    - hospitals, universities and colleges;
    - the town and city governments;
    - the contractors' NoVA offices.
  - Per row, one WebSearch finds `"<name> careers"`. Keep `linkType: "careers"` only when the result URL is on the employer's domain or its applicant-tracking host (workday, greenhouse, lever, icims, taleo, governmentjobs, usajobs). Otherwise use the homepage.
  - Every row carries the source URL(s) it was found in.
- [ ] **Step 6: Run** `cd src && python3 add_directory.py`. Expected: placed ≥ 300, and careers/placed ≥ 0.9.
- [ ] **Step 7: Spot-check (Sonnet reviewer).** 20 random careers links, each opened through the web-fetch agent or a search result, must show the employer's careers or jobs page. Any fail: fix the row, rerun step 6.
- [ ] **Step 8: Commit:** `data: phase A NoVA employer directory` (`directory.json`, candidate files, unplaced list).

### Task 3: Map pins + "All NoVA" tab

**Files:**
- Create: `src/parts/82-directory.js`, `src/parts/82-directory.css`, `tests/directory.js`, `tests/fixtures/directory.json`

**Interfaces:**
- Consumes:
  - `app.D.dir` (Task 1 shape);
  - `app.pinProviders` and `app.addTab`, used as `80-offices.js` uses them;
  - `app.openCard`;
  - `app.jobs.byEmp(id)` for the openings count;
  - `app.miles` and `app.home` for drive minutes (`miles x 2.4`, rounded).
- Produces:
  - pin kind `"dir"`, clustered separately from the `"emp"` kind and drawn below it (lower `order`);
  - a toggle checkbox `#dir-toggle` (default on, remembered in localStorage `reston-map-dir`);
  - a tab with id `"dir"` and label `All NoVA`;
  - a card button `data-a="dir-open"`, labelled `Careers ↗` or `Website ↗`.

- [ ] **Step 1: Write the failing test** `tests/directory.js`, with the fixture injected the way `tests/rosslyn.js` injects data. It has 4 records: one careers, one website, one with no link, and one with `empId` set to an existing employer. Assertions:
  - pin count of kind `dir` == 3 (the `empId` record draws no pin);
  - the tab "All NoVA" lists 3 rows, sorted by ascending minutes;
  - the careers record card has a button whose text is `Careers ↗` and whose href is the fixture URL;
  - the website record shows `Website ↗`;
  - the no-link record has no `dir-open` button;
  - unticking `#dir-toggle` removes all `dir` pins and leaves the employer pin count unchanged;
  - loading with `D.dir = []` gives no page errors, and the tab shows "No employers loaded".
- [ ] **Step 2: Run it and check it fails.** Run: `python3 src/build4.py && node tests/directory.js`. Expected: FAIL lines.
- [ ] **Step 3: Implement the part.** Links go through the existing `safeUrl` check and open in a new tab with `rel="noopener noreferrer"`.
- [ ] **Step 4: Run** `node tests/directory.js` and then every suite in `tests/`, one at a time. Expected: no FAIL.
- [ ] **Step 5: Commit:** `feat: NoVA employer directory pins and list`
- [ ] **Step 6: Publish** with all tiles (`CLAUDE.md`), and report the phase A counts to Eric.

### Task 4: Phase B — SAM.gov contractors (needs `SAM_API_KEY` and host `api.sam.gov`)

**Files:**
- Create: `src/dir_sam.py`, `src/test_dir_sam.py`, `src/fixtures/sam_entities.json` (hand-built from the documented v4 response shape)

**Interfaces:**
- `fetch_entities(key, counties) -> list[dict]` pages the v4 `entities` endpoint with active registrations, physical state VA, and the NoVA cities and counties (Arlington, Alexandria, Fairfax, Falls Church, Loudoun, Prince William, Manassas, Manassas Park, Fauquier).
- `to_candidates(entities) -> list[candidate rows]` with `via: "sam"`, `link` = the entity URL from SAM as `linkType: "website"`, and `src` = the SAM entity URL.
- Output goes to `src/dir_sources/phaseB-sam.json`, then `add_directory.py --cap 1500`.

- [ ] **Step 1: Write the failing tests:**
  - `test_to_candidates_maps_fields`;
  - `test_inactive_skipped`;
  - `test_no_url_gives_null_link`;
  - `test_key_never_in_output` (no field contains the key).
- [ ] **Step 2: Run them and check they fail.** `cd src && python3 -m unittest test_dir_sam -v`
- [ ] **Step 3: Implement.** The key is passed as the `api_key` query parameter, read from the environment.
- [ ] **Step 4: Run the tests and check they pass.**
- [ ] **Step 5: Live run (after Eric's key and host approval).** Then the corridor search: companies within 1 mile of a `routes_corridor.json` line get one careers search each, capped at 150 per run, nearest first. Rerun `add_directory.py`. If the page goes over 12 MB, move the `via: "sam"` records to `tiles/dir-sam.json`, which `82-directory.js` fetches at runtime, and add a test assertion that it loads.
- [ ] **Step 6: Commit and publish,** and report placed / not placed.

### Task 5: CareerOneStop job source (needs `COS_TOKEN`, `COS_USERID` and host `api.careeronestop.org`)

**Files:**
- Create: `src/refresh/careeronestop.py`, `src/refresh/test_careeronestop.py`, `src/refresh/fixtures/cos_list_jobs.json`
- Modify: `docs/REFRESH.md` (new source step and report line)

**Interfaces:**
- `list_jobs(token, userid, town, radius=10, days=30) -> list[dict]`, using the List Jobs endpoint and `Authorization: Bearer <token>`.
- `to_jobs(rows) -> list[job]` with the same job fields as the existing feed adapter in `src/refresh/`:
  - `source: "careeronestop"`;
  - `read.from: "alert"` when a description is present, else "title";
  - `empId` from `norm_name` matched against the employers and the directory.
- Dedup reuses the refresh's existing job-merge logic. It never changes `status` or `firstSeen`.

- [ ] **Step 1: Write the failing tests:**
  - `test_to_jobs_fields`;
  - `test_dedupe_against_existing`;
  - `test_empid_exact_match_only` ("Leidos Inc" matches "Leidos"; "Leidos Health" does not);
  - `test_status_untouched`.
- [ ] **Step 2: Run them and check they fail.** `cd src/refresh && python3 -m unittest test_careeronestop -v`
- [ ] **Step 3: Implement** against the documented List Jobs response, checking the field names in the API explorer before the live run.
- [ ] **Step 4: Run all refresh unit tests and check they pass.** `cd src/refresh && python3 -m unittest`
- [ ] **Step 5: Live run** in the next refresh (after the key), and report new jobs.
- [ ] **Step 6: Commit.**

### Task 6: Link upkeep + final review

**Files:**
- Modify: `src/add_directory.py` (a `--recheck 50` flag), `docs/REFRESH.md`, `CLAUDE.md` (add `add_directory.py` to the data-script order)

- [ ] **Step 1: Write the failing test** `test_recheck_oldest_first`: with `--recheck 2`, the two oldest `checked` records are re-verified, and a dead link becomes `link: null` with `dead: "YYYY-MM-DD"`.
- [ ] **Step 2: Implement, then run the tests and check they pass.**
- [ ] **Step 3: Whole-branch review** by one Opus reviewer against the spec's "Done means". Fix the findings.
- [ ] **Step 4: Run every suite, check the page size, republish, and commit.**
