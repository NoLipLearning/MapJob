# Reston Hiring Map v3: real openings, more employers, faster applying, daily plan

Date: 2026-11-10. Status: design approved by Eric in chat; this spec awaits his review.

## 1. Why

The map shows 98 researched employers with scores, routes, a tracker, reminders, an apply helper and job-site search links. Eric says his hunt is stuck in four places at once:

1. **Finding real openings.** The map shows employers, not jobs. He still digs through LinkedIn, Indeed and Handshake by hand.
2. **Not enough employers.** Ordinary offices near home and along his routes are missing (he named a Social Security building).
3. **Applying takes too long.** Tailoring a resume and cover letter per job is slow, so he puts it off.
4. **Staying on track.** He loses track of what to do each day.

Success means Eric opens the map daily, sees real jobs he qualifies for placed on the map, applies to one in minutes, and knows when he is done for the day.

## 2. Decisions already made (do not reopen)

- **Refresh is on demand.** Eric tells Claude "refresh my map" whenever he wants. Nothing runs on a schedule.
- **Sources:** Indeed (through Eric's Indeed connector), USAJOBS, the careers pages of employers already on the map, and web search for others. **LinkedIn and Handshake are never scraped or logged into.** They arrive through a "Save a job" box in the page, where Eric pastes a link or posting text.
- **No AI call is needed for the page to work.** The page reads jobs from its cloud database. Claude only writes to that database during a refresh.
- **Keep usage low.** A refresh must be bounded (see 4.3).
- **Honesty rules carry over** from `BUILD-PLAN.md` section 0: nothing invented, unverified data labelled, calm ADHD/OCD-friendly UI, real buttons, 44px touch targets, no red, no growing counters.

## 3. What gets built: four pieces, in this order

Each piece is usable by itself and feeds the next.

| # | Piece | New part files | Depends on |
|---|---|---|---|
| 1 | Openings | `src/parts/70-jobs.js`, `.css`; `docs/REFRESH.md`; `src/refresh/*.py` | existing core, filters |
| 2 | Suggested employers | `src/parts/72-suggest.js`, `.css` | piece 1 |
| 3 | Faster applying | edits to `50-apply.js`; `src/parts/74-resume.js`, `.css` | piece 1, tracker |
| 4 | Daily plan | edits to `40-reminders.js` | pieces 1 and 3 |

## 4. Piece 1: Openings

### 4.1 Data: the `jobs` collection

Stored in the artifact's `db` capability as shared collection `jobs`, one document per job. The artifact is private to Eric, so shared rows are visible only to him. If the artifact is ever shared with anyone, this collection must first move to `data/users/<id>/jobs/mine` (same pattern as the tracker); the refresh runbook checks sharing before writing.

```json
{
  "id": "indeed-<job_id> | usajobs-<control number> | saved-<uuid> | web-<sha1 of url, 12 chars>",
  "title": "Program Analyst",
  "employer": "Loudoun County Government",
  "empId": "loudoun-county-government or null",
  "loc": { "text": "Leesburg, VA", "lat": 39.11, "lon": -77.56, "exact": false },
  "url": "https://...",
  "source": "indeed | usajobs | careers | web | saved-linkedin | saved-handshake | saved-other",
  "posted": "YYYY-MM-DD or null",
  "pay": "text as posted, or null",
  "jobType": "fulltime | parttime | internship | contract | temporary | null",
  "clearance": "none | sponsor | required | unknown",
  "entry": "yes | maybe | no | unknown",
  "fit": 0,
  "fitWhy": ["3 short reasons, each quoting the posting or the profile"],
  "summary": "one or two plain sentences",
  "status": "new | saved | dismissed | applied",
  "firstSeen": "YYYY-MM-DD", "lastSeen": "YYYY-MM-DD",
  "verified": true
}
```

Rules:

- `id` is stable, so re-running a refresh updates a job instead of duplicating it.
- `status` belongs to Eric. A refresh never changes `status`, and never rewrites a job he dismissed.
- `clearance` and `entry` come only from the posting text. If the text does not say, the value is `unknown`. The page shows `unknown` as "not stated".
- `fit` is 0-100 and is computed by the documented formula in 4.4, never by impression.
- A job not seen for 30 days gets removed by the next refresh unless its status is `saved` or `applied`.
- A meta document `meta/refresh` holds `{ lastRun, counts: {new, updated, removed}, sourcesTried: [...], sourcesFailed: [...] }`.

### 4.2 Page: `70-jobs.js`

- **Storage layer** `app.jobs`: reads `jobs` with `onSnapshot` when `claude.use("db")` resolves; otherwise reads localStorage key `reston-map-jobs` and shows "Openings sync only on the published page". Exposes `all()`, `byEmp(empId)`, `get(id)`, `setStatus(id, status)`, `save(rawJob)`, `lastRefresh()`, and emits `jobs-changed`.
- **Openings tab** (`app.addTab`, label "Openings"): sorted by `fit`, then newest. Each row: title, employer, place, drive minutes (from `app.routes` when the employer is on the map, otherwise straight-line estimate labelled "est."), a fit number, and plain tags ("No clearance", "Entry level", "Clearance not stated"). Row actions, three at most: **Open**, **Save**, **Not for me**. A dismissed job disappears with a 10-second undo.
- **"New since last time"**: jobs whose `firstSeen` is later than the last time Eric opened the tab get a "New" tag. The tag clears when he leaves the tab. No counter badge on the tab itself beyond the plain count the other tabs already show.
- **On the map:** an employer pin with at least one non-dismissed job gets a small glyph through `app.hooks.marker` composition (the tracker already uses that hook, so this piece changes the hook into a list of contributors in core, keeping the tracker's dot and adding a second position). Jobs with no `empId` but real coordinates show as small square pins on the Openings tab only.
- **Employer card:** a "Open jobs here" section (`app.hooks.card`, slot `main`) listing up to 3 jobs, with "Show all N".
- **Filter:** a "Has openings" toggle added to the filter bar through a new `app.filters.addToggle({id, label, test})` API (small core-side addition in `10-filters.js`).
- **Save a job box:** a button "Save a job" in the Openings tab opens a sheet: link (required), pasted posting text (optional), source picker (LinkedIn, Handshake, Other). It writes a `saved-<uuid>` document with `status: "saved"`, `verified: false`, `fit: null`. The next refresh fills in the rest from the pasted text. Links are validated as `https:` and rendered with `rel="noopener noreferrer"`.
- **Empty state:** "No openings loaded yet. Ask Claude to 'refresh my map', or save a job you found." plus the date of the last refresh.

### 4.3 Refresh: `docs/REFRESH.md` plus helper scripts

`docs/REFRESH.md` is a runbook a Claude session follows when Eric says "refresh my map". It is written so Sonnet can run it. It has a hard budget and a fixed order:

1. **Read state.** `ArtifactData list` on `jobs` and `meta`; read the profile document (piece 3). Confirm the artifact is still private.
2. **Indeed.** Run a fixed query matrix through `mcp__Indeed__search_jobs` (country `US`): locations `Reston, VA`, `Herndon, VA`, `Tysons, VA`, `Arlington, VA`, `Washington, DC`, `Leesburg, VA`, `Manassas, VA`; searches drawn from the profile's `target_roles_implied` (at most 4) plus `entry level policy analyst` and `program assistant`. Cap: 28 searches per refresh. Fetch details with `get_job_details` only for jobs that pass a title screen, at most 25 per refresh.
3. **USAJOBS and careers pages.** Use web search limited to `usajobs.gov` and to the `url` hosts of employers on the map, at most 15 searches. Record only what a result page actually states.
4. **Saved jobs.** For each `saved-*` document with `fit: null`, parse the pasted text. If no text was pasted, leave the fields `unknown` and say so in the summary. Never fetch LinkedIn or Handshake pages.
5. **Normalize** with `src/refresh/normalize.py` (pure functions, unit tested): build ids, parse dates, classify `clearance` and `entry` from keyword lists kept in `src/refresh/keywords.json`, match `empId` (4.5), geocode unknown places with Nominatim at 1 request per second using `src/geocache.json`.
6. **Score** with `src/refresh/score.py` (4.4).
7. **Write** with `ArtifactData batch`: upsert new and changed jobs, preserving `status`; remove expired ones; write `meta/refresh`.
8. **Report** to Eric in under 12 lines: how many new, the top 5 by fit with links, which sources failed, and anything unverified.

If a source is blocked or errors, the refresh continues and reports it. It never retries by disguising the request.

### 4.4 Fit score (deterministic)

`fit = round(100 * (0.35*role + 0.25*entry + 0.20*clearance + 0.20*commute))`

- `role` (0-1): share of the profile's `keywords_for_job_matching` and `target_roles_implied` found in the title (weight 2) and description (weight 1), capped at 1.
- `entry`: yes 1, maybe 0.6, unknown 0.4, no 0.
- `clearance`: none 1, sponsor 0.7, unknown 0.5, required 0. Eric can take sponsor jobs but prefers to avoid them, which is why sponsor is not 1.
- `commute`: the same bands the map uses (15/25/35/45/60 minutes), from `routes.json` when `empId` is set, otherwise straight-line miles times 2.4.

`fitWhy` lists the top three contributing facts in plain words.

### 4.5 Matching a job to an employer on the map

In order: exact normalized-name match; alias match from a new `aliases` list on employer records (for example "SSA" for Social Security Administration); then coordinates within 150 m of an employer plus a shared significant word in the name. Anything else gets `empId: null` and feeds piece 2. Normalization lowercases and strips punctuation, legal suffixes (Inc, LLC, Corp) and "The".

## 5. Piece 2: Suggested employers

- `72-suggest.js` groups jobs with `empId: null` by normalized employer name and place. A group needs a real geocoded location to qualify.
- A "Suggested employers" block sits at the bottom of the Openings tab: name, place, number of openings, drive estimate. Actions: **Add to my map**, **Ignore**.
- **Add** writes a document to collection `myEmployers` (`{id, name, addr, lat, lon, type: "corporate", source: "suggested", addedAt}`; the type is a placeholder Eric can change, since the app has no "unknown" type label). The page merges `myEmployers` into the employer list at load, so the employer appears immediately with a pin, an estimated commute and a match score that uses neutral ratings (3, and clearance taken from its jobs) marked "estimated".
- **Ignore** writes to `ignoredEmployers` so it never returns.
- The next refresh promotes `myEmployers` rows into the built data (`src/add_employers.py` pattern: geocode check, `routes.py` for real routes) and tells Eric to republish. Until then routes are estimates and labelled so.

## 6. Piece 3: Faster applying

- **Resume once** (`74-resume.js`): the "My profile" panel gains "Load from Indeed", which is done by the refresh session calling `mcp__Indeed__get_resume` and writing the structured profile to the profile document (same shape as `docs/resume-extraction-prompt.md` produces). Pasting the JSON by hand stays as the fallback. The page shows when the profile was last updated and what fields are missing.
- **Apply from a job:** "Open" on a job shows its detail with one primary button, **Start applying**. It creates the tracker record (`role` = job title, `postingUrl`, `postingText` = summary plus description when available, `jobId`) and opens the existing apply helper already filled in. "Mark as applied" also sets the job's `status` to `applied`.
- **Answer bank:** a small list in the profile panel for answers he retypes on every form (work authorization, availability date, salary expectation, references). Each has a Copy button. Stored with the profile.

## 7. Piece 4: Daily plan

The Today panel (already limited to 3 items with Done, Snooze, Open) changes its source list to, in order:

1. Follow-ups that are due (existing behaviour).
2. One application in progress (status `applying`), if any: "Finish applying to X".
3. The best new job with `fit >= 60` he has not acted on: "Look at: Title at Employer".

Still never more than 3, earliest due first within group 1. "All caught up for today" appears when the list is empty. A settings switch "Suggest a new job each day" (default on) controls item 3.

## 8. Core changes (small, done first)

- `app.hooks.marker` becomes a list; `badge()` draws up to two status dots (top-right for tracker, top-left for jobs).
- `app.filters.addToggle()` in `10-filters.js`.
- `app.employers.add(list)` in core so `myEmployers` can be merged after load, recomputing ranks and markers.

## 9. Error handling

- `db` unavailable: every new part falls back to localStorage and says so in one line. Nothing throws.
- A job with a bad or missing URL is not rendered as a link.
- All text from postings is escaped with `app.esc`. Posting text is never inserted as HTML.
- A refresh that fails midway leaves existing jobs untouched, because writes happen in one batch at the end.

## 10. Testing

- `tests/jobs.js`, `tests/suggest.js`, `tests/applyflow.js`, `tests/today.js` (Playwright, same CDN stub, default URL `:8765`), each with a fake `claude.use` db seeded with sample jobs, covering: render, sort, statuses with undo, Save-a-job validation, filter toggle, map glyph, add and ignore suggested employer, start-applying flow into the tracker, Today ordering and the cap of 3, and fallbacks with no db.
- `src/refresh/test_normalize.py` and `test_score.py` (plain `python3 -m unittest`): id stability, date parsing, clearance and entry classification from sample posting text, employer matching, the fit formula.
- All existing suites keep passing.
- One real end-to-end refresh run by a person-directed Claude session after publishing, reported honestly. This is the only way to verify the Indeed connector, `ArtifactData` writes and live sync.

## 11. Out of scope

Scheduled or automatic refreshes; logging into or scraping LinkedIn or Handshake; auto-submitting applications; AI calls from inside the page; sharing the map with other people; near-home building detail (still unconfirmed by Eric).

## 12. Model assignment for the build

- **Opus:** `src/refresh/normalize.py`, `score.py`, employer matching, `docs/REFRESH.md`, and the three core changes in section 8. These are where a subtle mistake corrupts data or breaks other parts.
- **Sonnet:** the page parts (70, 72, 74), the apply and Today edits, and Playwright tests.
- **Haiku:** unit-test cases from the spec's tables, and running suites.
