# Read every posting + fast apply list: design

Date: 2026-11-22. Status: draft for Eric's approval.

## Intent (Eric's words)

"When I open the map I'm trying to apply for as many jobs as I can as quickly as possible, where you've ideally read the job posting and I can easily find it."

"I just want a list of all openings even if they don't fit well for me. Don't worry about making a tailored resume for each one."

So the map's job is to be a fast apply list. Every opening has already been read by Claude, the key facts are visible at a glance, and applying takes one tap.

## Goals

1. **Every opening is read, where the source allows it.** Each job carries a short summary taken from the full posting, not its title. "Unread" jobs are labelled as unread, with the reason.
2. **All openings stay listed.** Poor fits are labelled ("Long shot"), never hidden or deleted by the read step.
3. **Applying is fast.**
   - One tap opens the real apply page.
   - When Eric comes back to the map, one tap marks the job applied. The tracker records it, and he lands on the next job.
4. **Easy to find.**
   - The list is sorted so the jobs he can most likely get come first.
   - Each row shows what the job is, its requirements, its deadline and how to apply, without opening anything.

## Non-goals

- Tailored resumes or cover letters (Eric declined).
- Applying on Eric's behalf, or filling in forms.
- New job sources. This round reads the jobs we already collect.

## Anti-goals (a failure even if it "works")

- **Invented requirements.** If the posting doesn't say it, the field stays empty or "not stated". It is never guessed.
- **Hiding jobs Eric could apply to.**
- **Extra steps between "I want this job" and the apply page.**
- **Fetching or logging into LinkedIn or Handshake**, or disguising requests (standing rule).

## Constraints

- **Page structure:** the existing single page and parts (`src/parts/70-jobs.js` owns Openings), with jobs in the artifact database collection `jobs`. The refresh pipeline is in `src/refresh/` and the runbook is `docs/REFRESH.md`. Don't change job `status` semantics.
- **Volume:** about 360 jobs today. Roughly 190 are USAJOBS, 40 Greenhouse/Lever, 125 Indeed, and a few web or saved ones.
- **Usage cost:**
  - USAJOBS and Greenhouse/Lever full text comes free through their APIs, read by a script.
  - Indeed full text needs one `get_job_details` tool call per job, and only a Claude session can make that call. Cap it at 40 per refresh, highest-fit first; the rest stay "title only" until a later refresh.
  - LinkedIn, Handshake and `web` jobs use the alert-email text or pasted text, if there is any.

## Approaches considered

- **A. Read every posting + apply queue/list.** Chosen. Eric asked for it as one list of all openings, not a one-at-a-time queue, and not filtered.
- B. A, plus a tailored resume per job. Rejected by Eric.
- C. Summaries only, no apply flow. Rejected by Eric: it doesn't make applying faster.

## What gets built

### 1. The read step (data)

A new script, `src/refresh/read_postings.py`. For each job in the database without a `read` field, or whose `read.at` is older than its `lastSeen` posting change, it gets the full text:

- **USAJOBS:** the Search API, by announcement or control number. Use `UserArea.Details`: `MajorDuties`, `Requirements`, `Education`, `SecurityClearance`, `ApplyOnlineUrl` and the close date. Key via the `USAJOBS_KEY` and `USAJOBS_EMAIL` env vars, never committed.
- **Greenhouse:** `boards-api.greenhouse.io/v1/boards/<token>/jobs/<id>?content=true`.
- **Lever:** `api.lever.co/v0/postings/<company>/<id>`.
- **Indeed:** read inside the Claude session with `mcp__Indeed__get_job_details`, in batches (top 40 by fit). The text is saved to the same cache format.
- **Others:** existing `desc` or pasted text only.

Raw text is cached under `src/refresh/posting_cache/`, which is gitignored. Nothing is committed.

**Extraction**, deterministic where reliable:
- years of experience required (the minimum stated);
- degree level required;
- clearance (the existing `classify_clearance` on the full text);
- deadline;
- how to apply (`usajobs` / `employer site` / `indeed`);
- apply URL;
- pay, if newly found.

**Plain-words fields** are written in batches by a Haiku agent from the cached text:
- `what`: up to 160 characters on what you'd actually do;
- `musts`: up to 3 must-have qualifications, quoted or near-quoted from the posting.

The agent is told to leave a field null rather than infer it.

Each job gets a `read` object:
`{at, from: "posting"|"alert"|"title", what, musts[], years, degree, clearance, deadline, howApply, applyUrl}`

and a `canGet` label (`likely` / `stretch` / `long shot`) with a one-line reason, computed from:
- years needed versus Eric being a recent grad;
- clearance required versus none held;
- degree required versus his bachelor's.

Where a field is unknown, the label leans on what is known and says which fields were unknown.

Database writes: `update` with `if_version` only. `status` and `firstSeen` are never touched (same rule as `apply_batch.py`).

### 2. The list (Openings tab)

Every row shows:
- the title (it links to the posting);
- employer · town · drive minutes;
- a **Can-get badge**: Likely / Stretch / Long shot;
- one line of `what`;
- a facts line: `2+ yrs · no clearance · Bachelor's · apply by Dec 3 · via USAJOBS`;
- an "Unread (title only)" tag when `from` is "title".

Buttons:
- **Apply ↗** opens `applyUrl` (falling back to `url`).
- When Eric returns to the tab, that row shows **"Applied?" Yes / Not yet**. Yes sets status `applied`, which flows to the tracker as it does today, and scrolls to the next unapplied row.
- **Not for me** is kept as it is today.

Sort order:
1. not yet applied;
2. then Likely, Stretch, Long shot;
3. then soonest deadline;
4. then fit.

The existing filters stay, plus a **Can get** filter. Its default shows all three.

A counter at the top reads "Applied this week: N · Unread: N", reusing the existing weekly applied count.

```
Openings  ·  Applied this week 4  ·  12 unread
[Likely] Program Analyst — Small Business Administration · DC · 39 min
  Review agency programs and write reports for managers.
  0 yrs · no clearance · Bachelor's · apply by Dec 3 · via USAJOBS
  [Apply ↗]  [Not for me]
```

### 3. Refresh runbook

Add a "read postings" step to `docs/REFRESH.md` after the build step:
1. Run the script for USAJOBS, Greenhouse and Lever.
2. Read Indeed in-session (cap 40).
3. Send a Haiku batch for `what` and `musts`.
4. Write updates.

The report adds "read N, still unread N".

## Left to the builder

- Exact regexes for years, degree and deadline.
- Batch sizes.
- The cache layout.
- How "returning to the tab" is detected (`visibilitychange` or `focus` is fine).
- Badge colours from the existing kit.
- Test structure, following the existing `tests/*.js` and the refresh unit tests.

## Done means

- At least 95% of USAJOBS and Greenhouse/Lever jobs have `read.from = "posting"`.
- Every job has a `canGet` label.
- The 40 top-fit Indeed jobs are read.
- No `read` field contains text that isn't in its source. The reviewer checks 15 random jobs against their cached text.
- Apply flow, end to end in a test: Apply → return → Yes marks the job applied and scrolls to the next row.
- All existing suites and unit tests pass.
- The page is republished with all tiles (`CLAUDE.md`).

## Decisions from the builder check (Claude's calls unless marked)

1. **Database writes.** `read_postings.py` does not touch the database. It reads `existing.json` (the same file the refresh already saves) and writes `reads.json`, a list of `{id, patch}` updates. The session writes those with `ArtifactData batch` using `if_version`, just as it writes `writes.json` today. Unit tests run on files only.
2. **Job ids** are already in each record:
   - USAJOBS: the control number is the end of the id (`usajobs-839081400`) and the URL. The full announcement comes from the Search API with `ControlNumber=<n>`, using the key Eric gave (set in the environment at run time, never saved).
   - Greenhouse: the board token comes from `board` (`greenhouse:<token>`) and the job id from the id.
   - Lever: the company comes from `board` and the posting id from the id.
   - Indeed: only through `get_job_details`, matched by title, employer and place from a fresh `search_jobs`, because Indeed short links change every search. Jobs that can't be matched stay "title only".
3. **When a job is re-read:**
   - A job is read once.
   - USAJOBS, Greenhouse and Lever are re-read only when a hash of their fetched text changes. Fetching costs nothing, so they are re-fetched each refresh.
   - Indeed jobs are never re-read after a successful read, so the 40-call cap is spent only on new jobs.
4. **`canGet` rules**, in order (Eric is a recent grad with a bachelor's in political science, holds no clearance, and is OK with jobs that sponsor one; his earlier answer):
   - **Long shot** if any of these hold: 3+ years required; an active clearance required at hire; a master's or higher required; a professional licence required.
   - **Stretch** if any of these hold: exactly 2 years required; the posting says "preferred" for something he lacks; a specialist degree required (engineering, nursing, CS).
   - **Likely** otherwise, including "ability to obtain a clearance", 0–1 years, "entry level" or "recent graduate".
   - Unknown fields count as no barrier, and the reason line lists them ("experience not stated").
   - Every label carries a one-line reason taken from the fields.
5. **Deadlines.** A job whose deadline has passed drops to the bottom with a "Closed" tag. It isn't deleted, so the refresh's normal expiry still applies. Jobs without a deadline sort after jobs with one, within the same `canGet` group.
6. **"Applied?" prompt.** Every row where Eric tapped Apply but didn't answer keeps its own "Applied? Yes / Not yet" prompt. The prompts are saved in localStorage (`reston-map-apply-pending`), so they survive a reload. On return the list scrolls to the most recent one. "Not yet" clears that one prompt.
7. **Truth standard.**
   - `musts` must be phrases found in the cached text, allowing for case and whitespace.
   - `what` may paraphrase, but every fact in it (duty, place, tool) must appear in the text.
   - The reviewer checks 15 random jobs against this standard. Any fail means the batch is redone with a tighter prompt.
