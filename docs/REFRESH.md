# Refresh my map: runbook

Follow this when Eric says "refresh my map" (or similar). It fills the map's **Openings** tab. It writes only to the artifact's database; it never republishes the page unless step 9 applies.

- Artifact: `https://claude.ai/artifact/H5oMnB3g2z77WQWKBESDyU`
- Project: `/home/user/reston-hiring-map/reston-hiring-map` (GitHub `NoLipLearning/MapJob`). If the folder is missing, clone the repo there.
- Work files go in the session scratchpad, written below as `$S`.

## Hard rules

- Never fetch linkedin.com or joinhandshake.com pages, and never log into them. LinkedIn and Handshake jobs come only from Eric's own alert emails (step 3) and from jobs he saves in the page.
- Never change a User-Agent or otherwise disguise a request to get past a block. If a source refuses, skip it and report it.
- Never invent a job, a field, a clearance requirement or an experience level. If the source does not say, leave it out; the pipeline marks it `unknown`.
- Never change a job's `status`. `build_jobs.py` enforces this; do not edit its output by hand.
- Budget per refresh: at most 28 Indeed searches, 25 Indeed detail calls, 15 web searches, 40 Gmail threads read.

## Steps

### 1. Read state

1. `Artifact read` on the URL. Check the header says Eric is the owner and that the page is not shared with anyone else. **If it is shared, stop and ask Eric** before writing jobs to a collection other people can read.
2. `ArtifactData list` collection `jobs`, **following every page until there is no next page**, and save all documents to `$S/existing.json` as one JSON list. Write down the total. `build_jobs.py` prints how many it read; if the numbers differ, stop. A missing file stops the build on purpose. Note the `lastRun` date from `ArtifactData get` `meta/refresh` (absent on the first run).
3. `ArtifactData list` collection `myEmployers` and save to `$S/my.json` (a list; empty if none).
4. Profile: the page keeps it privately at collection `data/users/<Eric's user id>/profile/mine`, document `main`. Try `ArtifactData get` on it; its `json` field holds the profile as a JSON string. If it cannot be read, ask Eric once: "Paste your profile JSON, or say 'use Indeed' to load it from your Indeed resume." Only call `mcp__Indeed__get_resume` if he says so. Save the parts the score uses to `$S/profile.json`: `{"keywords_for_job_matching": [...], "target_roles_implied": [...]}`. Do not save the profile anywhere in the repo.

Collect every job found in steps 2 to 5 into one list `$S/raw.json`. Each item: `{source, title, employer, location, url, posted, pay, jobType, desc}` plus `job_id` (Indeed), `control` (USAJOBS) or `id` (saved jobs). Put only what the source states.

### 2. Indeed

Goal: entry-level jobs Eric can get hired into, in any field (not only his degree), paying $50k+ or not stated. Call `mcp__Indeed__search_jobs` with `country_code: "US"`, `job_type: "fulltime"`. Searches (at most 28): `entry level` and `recent graduate` in Reston, Herndon, Tysons, Arlington, Fairfax, McLean, Washington DC; plus `entry level analyst`, `management trainee`, `associate entry level`, `program assistant`, `policy associate`, `government affairs associate` in Washington DC; plus `<employer> entry level` for up to 6 top-ranked employers on the map.

Use the search results directly (title, company, location, posted date, compensation, link); call `get_job_details` (at most 25) only for the top-scoring jobs, to read clearance and experience requirements. Drop, before building: senior/supervisory/principal/mid-level/GS-12+ titles, titles that say a clearance is required, specialist-credential roles (police, nurse, engineer, scientist, technician), student-only roles, and postings dated before this year. `source: "indeed"`. Indeed short links (`to.indeed.com`) change every search; the pipeline ids them by employer + title + place, so repeats merge.

### 3. Gmail job alerts (LinkedIn, Handshake, Indeed)

Search with `mcp__Gmail__search_threads`:

```
{from:jobalerts-noreply@linkedin.com from:jobs-noreply@linkedin.com from:handshake@g.joinhandshake.com from:donotreply@match.indeed.com} after:<lastRun as YYYY/MM/DD, or 14 days ago on the first run>
```

Read up to 40 threads with `mcp__Gmail__get_thread`. Skip mail that is not a job (news, connection requests, "salary insights", promotions, "want to keep receiving" notices). From each alert, take every job it lists: title, company, location, and the job link exactly as written. Use the text the email shows about that job as `desc` (a sentence or two is fine). `source`: `linkedin` for LinkedIn senders, `handshake` for Handshake, `indeed` for Indeed (use `web` if no Indeed job id is visible in the link). Do not open the links.

These are Eric's own emails, sent to him by those sites. Read only these senders.

### 4. USAJOBS and employers' careers pages

Up to 15 web searches, limited with `allowed_domains` to `usajobs.gov` or to the careers hosts of employers on the map (their `url` in `src/prep4.json`). Prefer employers rated well for Eric (high match, `cl: "none"`). Record only what the result states. `source: "usajobs"` (put the announcement number in `control` when shown) or `"careers"`.

### 4b. Employer feeds, USAJOBS API, offices

```bash
cd /home/user/reston-hiring-map/reston-hiring-map/src/refresh
python3 feeds.py --out $S/feeds.json --boards-out $S/boards_ok.json   # Greenhouse + Lever boards (employer links in prep4.json + boards.json)
USAJOBS_KEY=... USAJOBS_EMAIL=... python3 usajobs.py --out $S/usajobs.json   # prints "skipped: no USAJOBS key" if either is unset
```

Append both outputs to `$S/raw.json`. Boards that failed or came back empty are not in `boards_ok.json`, so they delete nothing. To add a board, confirm `https://boards-api.greenhouse.io/v1/boards/<token>/jobs` or `https://api.lever.co/v0/postings/<company>?mode=json` answers 200, then add `{"kind","token","employer","empId"}` to `src/refresh/boards.json`. Office buildings (`src/offices.json`) change rarely: `python3 src/offices.py` then `python3 src/check_coverage.py` (must print PASS).

### 5. Saved jobs

Every document in `$S/existing.json` whose id starts with `saved-`: add it to `raw.json` as `{source: <its source>, id, url, title, employer, location, desc: <its pasted text, if any>}`. Do not fetch its link.

### 6. Build

```bash
cd /home/user/reston-hiring-map/reston-hiring-map/src/refresh
python3 build_jobs.py --raw $S/raw.json --existing $S/existing.json --profile $S/profile.json \
  --extra-employers $S/my.json --out $S/writes.json --geocode \
  --authoritative $S/boards_ok.json --tried indeed,gmail,usajobs,careers,greenhouse,lever --failed <comma list of sources that errored or were blocked>
```

It prints the counts and the top five. `--geocode` looks up at most 20 new places through Nominatim (1 per second, cached in `src/geocache.json`).

### 7. Write

One `ArtifactData batch` call to the artifact:

- each document in `writes.json` → `set` → `set` in collection `jobs`, document id = its `id` (new jobs only).
- each entry in `writes.json` → `update` → `update` collection `jobs`, document `id`, with its `patch`. Patches never contain `status` or `firstSeen`, so a job Eric dismissed or saved during the refresh keeps his choice. Never turn an update into a `set`.
- each id in `writes.json` → `delete` → `delete`. Feed jobs (Greenhouse, Lever) whose board was fetched OK this run but that are no longer on it are in `delete` right away, unless saved, applied or dismissed; all other jobs expire after 30 days unseen.
- `set` `meta/refresh` = `writes.json` → `meta`.

If the batch fails, nothing was written; report it and stop. Do not retry more than once.

### 7b. Spot check (optional, after writing)

`python3 spotcheck.py $S/existing.json` samples up to 20 jobs and reports live / gone / not checked (only Greenhouse, Lever and USAJOBS hosts are requested; Greenhouse and Lever postings are checked through their APIs). Mention "gone" ones in the report.

### 8. Report to Eric (under 12 lines)

- New, updated and removed counts.
- The top five (from `top`): fit, title, employer, a link, and "needs clearance" where `clearance` is `required`.
- Sources that failed or were skipped, and why.
- Anything unverified (for example, alert emails that show only a title and company).

### 9. Only when `myEmployers` has entries

Employers Eric added from suggestions live only in the database until they are built in. To build them in: add each to `NEW` in `src/add_employers.py` (with their real address), run `python3 add_employers.py`, then `python3 build4.py`, run the test suites, commit, push, and ask Eric before republishing the page.

## Last dry run

2026-11-10, `build_jobs.py` on 4 hand-made sample jobs (no real data, no network):
- two alert copies of one LinkedIn job (with and without tracking parameters) became one document, matched to employer `csis`, fit 78;
- a posting saying "Required Clearance: TS/SCI with polygraph" was classified `required`, fit 20;
- a saved Handshake link with no text kept `status: saved`, `fit: null`, `clearance: unknown`, and its link was not fetched;
- a dismissed job and a 70-day-old `new` job: the dismissed one is kept, the stale one is deleted.
