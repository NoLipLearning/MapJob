# Read Every Posting + Fast Apply List: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every opening on Eric's map carries facts read from its real posting, a Likely, Stretch or Long shot label, and a one-tap Apply, then "Applied?" loop. All openings stay listed.

**Architecture:**
- An offline Python step, `src/refresh/read_postings.py`, fetches full posting text (USAJOBS, Greenhouse and Lever over HTTP; Indeed text supplied by the Claude session) into a cache. It extracts the deterministic fields, merges in the plain-words fields written by a Haiku batch, computes `canGet`, and emits `reads.json` (`[{id, patch}]`). The session writes that file to the artifact database.
- The page part `src/parts/70-jobs.js` renders the new fields, sorts and filters by them, and runs the Apply, then "Applied?" loop.

**Tech Stack:** Python 3 standard library (`urllib`, `json`, `re`, `hashlib`, `unittest`). Vanilla JS page parts. Node + Playwright browser tests with the existing `tests/fake-claude.js` database.

**Spec:** `docs/superpowers/specs/2026-11-22-read-postings-apply-list-design.md` (approved 2026-11-22). Read it first, especially "Decisions from the builder check".

## Global Constraints

- **Never invent facts.** If the source doesn't say it, the field is `null`. `musts` entries must be phrases found in the cached text (case- and whitespace-insensitive). Every fact in `what` must appear in the text.
- **Never touch `status` or `firstSeen`** in database patches.
- **No secrets in the repo.** USAJOBS key and email come from the `USAJOBS_KEY` and `USAJOBS_EMAIL` environment variables only. `src/refresh/posting_cache/` is gitignored.
- **Never fetch linkedin.com or joinhandshake.com.** Never change a User-Agent to get past a block.
- **Indeed:** at most 40 `get_job_details` calls per refresh. An Indeed job with `read.from == "posting"` is never re-read.
- **`read` object shape:**
  `{at, from: "posting"|"alert"|"title", what, musts, years, degree, clearance, deadline, howApply, applyUrl, hash}`
  - `howApply` is one of `"usajobs"`, `"employer site"`, `"indeed"`, `null`.
  - `degree` is one of `"none"`, `"bachelor"`, `"master"`, `"doctorate"`, `"specialist"`, `null`.
- **`canGet` shape:** `{label: "likely"|"stretch"|"long shot", why: str}`.
- **`canGet` rules (spec decision 4), applied in order:**
  - **long shot** if `years >= 3`, or clearance must be active at hire, or `degree` in (`master`, `doctorate`), or a licence is required;
  - **stretch** if `years == 2`, or `degree == "specialist"`, or the text says "preferred" for an item in `musts`;
  - **likely** otherwise.
  - Unknown fields are never a barrier. `why` lists them ("experience not stated").
- **Sort order:** not applied first; then likely, stretch, long shot; then soonest open deadline (no deadline after dated ones); then fit. Closed jobs (deadline before today) go last, tagged "Closed".
- **Pending-apply storage:** localStorage key `reston-map-apply-pending` holds a JSON array of job ids.
- **Publishing:** republish with every `tiles/*.json` in the `files` map (see `CLAUDE.md`).

## Review Focus

1. **A posting fetch fails** (404, timeout, removed job). The job keeps its old `read`, or becomes `from: "title"`, and nothing crashes. Test owner: Task 1 (`test_fetch_failure_keeps_title_only`).
2. **A deadline that has already passed**, or that parses ambiguously ("Open until filled"). The job is tagged Closed, or the deadline is `null`, never a wrong date. Test owner: Task 1 (`test_deadline_open_until_filled_is_null`) and Task 3 (closed sorts last).
3. **Text that says "Secret clearance preferred" or "ability to obtain".** It must not be labelled long shot. Test owner: Task 2 (`test_ability_to_obtain_is_likely`).
4. **Eric taps Apply on three jobs, then reloads.** All three "Applied?" prompts remain. Test owner: Task 4.
5. **Jobs with no `read` at all** (old documents). The row renders as before, plus an "Unread (title only)" tag, with no JS error. Test owner: Task 3.

---

### Task 1: Fetch and extract (`read_postings.py` core)

**Files:**
- Create: `src/refresh/read_postings.py`
- Create: `src/refresh/test_read_postings.py`
- Create: `src/refresh/fixtures/usajobs_detail.json`
- Create: `src/refresh/fixtures/greenhouse_detail.json`
- Create: `src/refresh/fixtures/lever_detail.json`
  - These are trimmed real responses: fetch one of each once, then keep only the fields used.
- Modify: `.gitignore` (add `src/refresh/posting_cache/`)

**Interfaces:**
- Produces:
  - `source_ref(job: dict) -> dict | None`
    - returns `{"kind": "usajobs"|"greenhouse"|"lever"|"indeed"|"other", ...ids}`;
    - USAJOBS control number from `id` (`usajobs-<n>`);
    - Greenhouse token from `board` (`greenhouse:<token>`) and job id from `id`;
    - Lever company from `board` and posting id from `id`.
  - `fetch_text(ref: dict, key: str|None, email: str|None) -> dict | None`
    - returns `{"text": str, "applyUrl": str|None, "deadline": "YYYY-MM-DD"|None}`, or `None` on any failure;
    - USAJOBS: `https://data.usajobs.gov/api/search?ControlNumber=<n>`, with the key header and the email as User-Agent;
    - Greenhouse: `https://boards-api.greenhouse.io/v1/boards/<token>/jobs/<id>?content=true`;
    - Lever: `https://api.lever.co/v0/postings/<company>/<id>`.
  - `extract(text: str, today: date) -> dict` returns `years`, `degree`, `clearance`, `deadline`, `licence`.
    - `clearance` reuses `normalize.classify_clearance(text)` and adds an `active_at_hire` boolean.
  - `cache_put(job_id: str, text: str) -> str` writes `posting_cache/<id>.txt` and returns its sha1.
  - `cache_get(job_id) -> str|None`.

- [ ] **Step 1: Write failing tests in `test_read_postings.py`**
  - `test_source_ref_usajobs`: `{"id": "usajobs-839081400", "source": "usajobs"}` gives `{"kind": "usajobs", "control": "839081400"}`.
  - `test_source_ref_greenhouse`: `{"id": "greenhouse-4333797006", "board": "greenhouse:accenturefederalservices"}` gives `{"kind": "greenhouse", "token": "accenturefederalservices", "job": "4333797006"}`.
  - `test_source_ref_indeed`: `{"id": "indeed-0abc", "source": "indeed"}` gives `kind == "indeed"`.
  - `test_extract_years`:
    - "Minimum of 3 years of experience" gives `years == 3`;
    - "1-2 years" gives `years == 1`;
    - "no experience required" gives `years == 0`;
    - text with no mention gives `years is None`.
  - `test_extract_degree`:
    - "Bachelor's degree required" gives `"bachelor"`;
    - "Master's degree required" gives `"master"`;
    - "Bachelor's degree in Nursing" gives `"specialist"`;
    - "Bachelor's preferred, Master's a plus" gives `"bachelor"`;
    - no mention gives `None`.
  - `test_extract_clearance_active`:
    - "Active TS/SCI required" gives `clearance == "required"` and `active_at_hire is True`;
    - "Ability to obtain a Secret clearance" gives `"sponsor"` and `active_at_hire is False`.
  - `test_deadline_open_until_filled_is_null`: "Open until filled" gives `deadline is None`.
  - `test_deadline_parsed`: "Applications close December 3, 2026" gives `"2026-12-03"`.
  - `test_fetch_usajobs_fixture` (monkeypatch the HTTP getter to return the fixture): `text` contains the MajorDuties string from the fixture, and `applyUrl` equals the fixture's `ApplyURI[0]`.
  - `test_fetch_failure_keeps_title_only`: the getter raises `URLError`, so `fetch_text` returns `None`.
- [ ] **Step 2: Run the tests and confirm they fail.**
  Run `cd src/refresh && python3 -m unittest test_read_postings -v`. Expected: FAIL, because the module isn't found.
- [ ] **Step 3: Implement the five functions.**
  - One HTTP helper with a 30 s timeout and the default urllib User-Agent (or the email for USAJOBS).
  - Strip HTML with the existing `feeds.to_text`.
- [ ] **Step 4: Run the tests and confirm they pass**, along with the whole suite: `python3 -m unittest`. Expected: all OK.
- [ ] **Step 5: Live smoke check.**
  Fetch 3 real jobs of each feed kind with `USAJOBS_KEY=... USAJOBS_EMAIL=... python3 -c "import read_postings as r; ..."`. Each should return text over 300 characters. Record the result in the commit message.
- [ ] **Step 6: Commit**: `git commit -m "refresh: fetch and extract full posting text"`

### Task 2: `canGet`, merge and the `reads.json` CLI

**Files:**
- Modify: `src/refresh/read_postings.py`
- Modify: `src/refresh/test_read_postings.py`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `can_get(read: dict) -> dict` returns `{"label", "why"}`, following the Global Constraints rules.
  - `musts_ok(musts: list[str], text: str) -> list[str]` keeps only items found in the text (case- and whitespace-normalised).
  - `build_reads(existing: list[dict], fetched: dict[id, dict|None], plain: dict[id, {"what", "musts"}], indeed_text: dict[id, str], today: date) -> list[{"id", "patch": {"read", "canGet"}}]`.
    - Skip when the old `read.hash` equals the new hash.
    - Skip an Indeed job whose `read.from == "posting"`.
    - Never include `status` or `firstSeen` in a patch.
  - CLI: `python3 read_postings.py --existing E.json --out reads.json [--plain plain.json] [--indeed indeed.json] [--fetch]`.
    - `--fetch` does the network step and writes the cache.
    - Without `--fetch`, it uses the cache only.
    - It prints `read N (posting) / M (alert) / K (title), skipped S unchanged`.
    - It also writes `needs_plain.json`: a list of `{id, cachePath}` for jobs whose `what` is missing, to hand to the Haiku batch.

- [ ] **Step 1: Write failing tests**
  - `test_three_years_is_long_shot`: `can_get({"years": 3})["label"] == "long shot"`.
  - `test_two_years_is_stretch`.
  - `test_ability_to_obtain_is_likely`: `{"clearance": "sponsor", "active_at_hire": False, "years": 0}` gives `"likely"`.
  - `test_active_clearance_long_shot`.
  - `test_master_long_shot`.
  - `test_specialist_stretch`.
  - `test_unknowns_listed`: `can_get({})` gives `"likely"`, and `why` contains `"experience not stated"`.
  - `test_musts_ok_drops_invented`: `musts_ok(["Bachelor's degree", "5 years Python"], "Requires a bachelor's  degree.") == ["Bachelor's degree"]`.
  - `test_build_reads_never_patches_status`: no patch has the key `status` or `firstSeen`.
  - `test_build_reads_skips_unchanged_hash`.
  - `test_build_reads_skips_read_indeed`.
  - `test_build_reads_title_only_when_fetch_failed`: `patch.read.from == "title"`, and `canGet` is still present.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement `can_get`, `musts_ok`, `build_reads` and the CLI.**
- [ ] **Step 4: Run them and confirm they pass**, along with the full `python3 -m unittest`.
- [ ] **Step 5: Commit**: `git commit -m "refresh: canGet labels and reads.json"`

### Task 3: Openings rows, sort and Can-get filter

**Files:**
- Modify: `src/parts/70-jobs.js`
  - `row(j)`, around line 147;
  - the `SORTS` and `SORT_FN` area, around lines 15–19 and 175;
  - `fdefaults`/facets, around line 17.
- Modify: `src/parts/70-jobs.css` (layout only; reuse kit classes and pills).
- Modify: `tests/fixtures/` (add 4 jobs with `read` and `canGet`: likely, stretch, long shot, closed) and one job without `read`.
- Create: `tests/applylist.js` (structure copied from `tests/jobs.js`; uses `FAKE` from `tests/fake-claude.js`).

**Interfaces:**
- Consumes: the `read` and `canGet` shapes from the Global Constraints.
- Produces:
  - `SORTS` gains `["apply", "Apply order"]` as the **default** sort (`sortBy = "apply"`).
  - A facet key `cg`, with defaults `["likely", "stretch", "long shot", "unread"]` (all on).
  - The row DOM:
    - `.jobrow[data-job]` contains `.jcan` (the badge text "Likely", "Stretch" or "Long shot"), `.jwhat`, `.jfacts`, and `.jtitleonly` when unread;
    - the button `[data-a="apply"]` has the text `Apply ↗`.

- [ ] **Step 1: Write failing tests in `tests/applylist.js`**
  - The default sort is "Apply order", and the first row is the likely job.
  - The closed job is the last row and contains the text `Closed`.
  - The likely row's `.jfacts` text is `0 yrs · no clearance · Bachelor's · apply by Dec 3 · via USAJOBS`, taken from its fixture values.
  - The job without `read` shows `.jtitleonly`, and the page has no console errors.
  - Unticking "Long shot" in the Can-get facet hides exactly one row; the count text updates.
  - The `.jcan` text of the long-shot row equals "Long shot", and its `title` attribute equals `canGet.why`.
- [ ] **Step 2:** Rebuild with `python3 src/build4.py`, serve on :8765, and run `node tests/applylist.js`. Expected: FAIL.
- [ ] **Step 3: Implement the rows, the sort function and the facet.**
  - The facts line omits null parts. Use "no clearance" when `clearance == "none"`, "clearance: ability to obtain" for `sponsor`, and "active clearance" for `required`.
  - Show the deadline as `apply by Mon D`.
- [ ] **Step 4:** Rebuild, then run `applylist.js` plus the existing `jobs.js`, `facets.js`, `smoke.js`, `layout.js` and `integration.js`. Expected: all PASS (update an existing assertion only where it asserted the old default sort, and say so in the commit).
- [ ] **Step 5: Commit**: `git commit -m "openings: posting facts, can-get badge, apply order"`

### Task 4: Apply, then "Applied?" loop

**Files:**
- Modify: `src/parts/70-jobs.js`
- Modify: `tests/applylist.js`

**Interfaces:**
- Consumes: Task 3's row DOM and the existing `setStatus(id, "applied")`. That already flows to the tracker through the `applied` sync at around line 281; keep it.
- Produces:
  - Clicking `[data-a="apply"]` opens `read.applyUrl || url` in a new tab and adds the id to `reston-map-apply-pending`.
  - On `visibilitychange` to visible, or on window `focus`, each pending row shows `.jasked`, which contains a `Yes` button (`[data-a="applied-yes"]`) and a `Not yet` button (`[data-a="applied-no"]`). The list then scrolls to the most recently added one.
  - **Yes** calls `setStatus(id, "applied")`, removes the id from pending, and focuses or scrolls to the next unapplied row.
  - **Not yet** removes the id only.
  - The header shows `Applied this week: N · Unread: M`.

- [ ] **Step 1: Write failing tests**
  - Stub `window.open` and click Apply on rows 1, 2 and 3. Localstorage pending equals the 3 ids, and `window.open` received `read.applyUrl` for row 1.
  - After a reload, firing `visibilitychange`, all 3 rows show `.jasked`.
  - Click Yes on row 1. The fake database got `update` with `{status: "applied"}` for that id, `.jasked` is gone from row 1, the row shows `✓ Applied`, and the tracker has a record with that `jobId` (`app.tracker.all()`).
  - Click Not yet on row 2. It is removed from pending and the status is unchanged.
  - The header text matches `/Applied this week: \d+ · Unread: \d+/`.
- [ ] **Step 2:** Rebuild and run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Rebuild and run `applylist.js`, `jobs.js`, `tracker.js`, `today.js`, `applyflow.js`, `smoke.js` and `integration.js`. Expected: all PASS.
- [ ] **Step 5: Commit**: `git commit -m "openings: apply then applied? loop"`

### Task 5: Real run, runbook, reviewer check, publish

**Files:**
- Modify: `docs/REFRESH.md` (add step "6b. Read postings" between Build and Write)
- Modify: `CLAUDE.md` (one line: `read_postings.py` runs after `build_jobs.py`)

This task is run by the lead session, not a subagent, because it needs ArtifactData and the Indeed tools.

- [ ] **Step 1: List the database and fetch.**
  - `ArtifactData list` the `jobs` collection, following every page, to `$S/existing.json`.
  - Run `USAJOBS_KEY=... USAJOBS_EMAIL=... python3 read_postings.py --existing $S/existing.json --fetch --out $S/reads.json`.
- [ ] **Step 2: Read Indeed in-session.**
  - Pick the top 40 unread Indeed jobs by fit.
  - Run `mcp__Indeed__search_jobs` to get fresh job ids, matched by title, employer and place, then `get_job_details`.
  - Save to `$S/indeed.json` (`{id: text}`).
- [ ] **Step 3: Haiku batches for the plain-words fields.**
  - Split `needs_plain.json` into batches of 40.
  - One Haiku agent per batch, at most 4 in parallel. Each reads the cache files and returns `{id: {what (≤160 chars), musts (≤3 phrases copied from the text)}}`. It must leave a field null rather than infer it.
  - Merge the results into `$S/plain.json`.
- [ ] **Step 4: Rebuild the reads** with `python3 read_postings.py --existing ... --plain $S/plain.json --indeed $S/indeed.json --out $S/reads.json`.
  - Expected: at least 95% of USAJOBS, Greenhouse and Lever jobs are `from: "posting"`, and every job has `canGet`.
- [ ] **Step 5: Reviewer (Sonnet).**
  - Give it 15 random reads and their cache files.
  - It checks the truth standard from Global Constraints and returns PASS/FAIL per job.
  - Any FAIL: redo that batch with the failure quoted in the prompt. At most 2 retries.
- [ ] **Step 6: Write the updates.**
  - `ArtifactData batch` updates, 50 per call, `update` with `if_version` from `existing.json`.
  - Update `meta/refresh` to add `read` counts.
- [ ] **Step 7: Publish.**
  - Rebuild and run all browser suites, plus `python3 -m unittest`.
  - Commit and push.
  - Republish the artifact with every `tiles/*.json` in `files`.
- [ ] **Step 8: Report to Eric:**
  - read and unread counts by source;
  - Likely / Stretch / Long shot counts;
  - the reviewer's result;
  - anything still unread, and why.
