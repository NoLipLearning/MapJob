# Reston Hiring Map: Build Plan (v2)

Written for a Sonnet-led team of agents. Read `CLAUDE.md`, `README.md` and this file before you change anything. The owner is Eric: a recent political-science grad in Reston, VA, job hunting in the DC area. He drives and takes Metro. He prefers jobs that don't need a security clearance but can accept ones that sponsor it. The app is for his personal use for now.

## 0. Ground rules for every agent

- **Keep data honest.** Don't invent employers, postings, travel times or contacts. Mark unverified data `"verified": false` and show it in the UI as "estimate" or "unverified".
- **No AI calls at runtime.** No feature may depend on an AI call to work. AI is only ever an optional extra (see 6.3).
- **The page must work in two places:**
  1. Served locally: `python3 -m http.server 8765`, then open `/reston-hiring-map.html`.
  2. Published as a claude.ai Artifact with the `db` and `user` capabilities (see section 4).

  When `claude.use("db")` resolves `null` (local serve, or signed out), fall back to `localStorage` and show a small notice: "Saved on this device only".
- **Accessibility is not optional.** Every control gets a real `<button>` or `<input>`, a visible label, keyboard support and a visible focus ring. Touch targets are 44px or larger at 400px width. Don't rely on color alone.
- **ADHD/OCD-friendly UI rules** (these apply to every feature):
  - Show at most 3 actions at once. Collapse the rest behind "Show more".
  - Every task is one concrete verb plus an object ("Email Sarah at Brookings").
  - No red badges, no growing counters, and no "overdue (14)" piles. Overdue items read "Ready when you are", in a calm color.
  - There is always a clear finish state: "All caught up for today ✓".
  - Done means done: a ticked item stays ticked, with a quiet undo for 10 seconds, and never reorders silently.
  - The same action is always in the same place. Use consistent wording and avoid near-synonyms (pick "Applied", never also "Submitted").
- **Test in a real browser.** Use Playwright with the SwiftShader flags: `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. Test at 1280×800 and at 400×800 with touch. Save screenshots to `test-shots/`.

## 1. Phase 0: restore the last session's fixes and split the source (one agent, sequential, blocks everything else)

These fixes were made in an earlier session, but that container was wiped. Redo them:

1. **Rosslyn-Ballston buildings.** `tiles/arlington.json` is an old raw list of 8,934 buildings and isn't registered as a tile. Check whether it covers Rosslyn–Clarendon–Ballston (roughly 38.875–38.900 N, −77.120 to −77.065 W). If it doesn't, fetch fresh data from OSM through an Overpass mirror. overpass-api.de may be blocked, so try maps.mail.ru/osm/tools/overpass or kumi.systems, and split the box into 4 queries. The last run got about 12,174 buildings. Write the result as `tiles/rosslyn.json` in the same format as `tiles/dc.json` (a list of buildings), and register it in `src/prep4.json` → `tiles` (id, name, file, cx, cz, rad).
2. **Arlington streets.** Add them to the road layers in `prep4.json` → `r` (the last run had about 3,687 segments). Match the existing encoding: look at `r.a`/`r.b`/`r.c` and copy the closest class.
3. **Default home.** Set it to Eric's home: lat 38.93472, lon −77.32540. Keep the "Set my home" button working. A saved `reston-map-home` still overrides the default.
4. **Rosslyn jump button.** Add it to `#places`.
5. **Details card.** On desktop (>900px), `cardMin` should default to `true`, with the Expand button visible. On phones it stays as it is today.
6. **Mobile viewport.** Add `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` for local serving. Without it, a phone shows a zoomed-out 980px page.
7. **Split the template so agents can work in parallel without merge fights.** Move the inline JS and CSS out of `src/template4.html` into:
   - `src/parts/00-core.js`: existing map, list and card code, unchanged.
   - `src/parts/10-filters.js`, `20-routes.js`, `30-tracker.js`, `40-reminders.js`, `50-apply.js`: empty stubs, each exporting an `init(app)` hook.
   - `src/parts/*.css`, one per part.

   Update `src/build4.py` to concatenate the parts in filename order, inject `__DATA__`, and write the output. Then add a tiny shared event bus in core (`app.on(evt, fn)`, `app.emit(evt, data)`) with these events: `filters-changed`, `selection-changed`, `tracker-changed`, `home-changed`. Feature parts talk to the core only through `app` and the bus.
8. **Version control.** Run `git init`, commit, and push to the GitHub repo Eric names. The container is temporary, so **push after every phase**.

**Done when:** a rebuilt page shows the Rosslyn buildings, opens at Eric's home, the card opens shrunk on desktop, a 400px phone view isn't zoomed out, and every control still works. Re-run the control test from `PROMPT.md` task 1.

## 2. Phase 1: four parallel agents (after Phase 0 is pushed)

Each agent edits only its own part files, plus new data files. Agent R (routes) and the core's commute score meet at one documented interface (2.2).

### 2.1 Agent F: multi-select filters (feature 1)

Replace the single `#area`/`#kind` selects with a filter bar of toggle chips. Inside a group, chips combine with OR. Across groups, they combine with AND.

| Group | Options | Default |
|---|---|---|
| Area | the 6 values in `AREAS` | all on |
| Employer type | the 13 `type` values, with friendly labels | all on |
| Clearance | None needed · Sponsors clearance (`some`) · Mostly cleared (`most`) | None + Some on, Most off. Replaces the `hideclear` checkbox |
| Commute | max drive minutes slider (15–90, step 5) · "Reachable by Metro" toggle · "Toll-free route" toggle | 90 · off · off |
| Entry path | Has an internship or fellowship program (`progs` not empty) · entry_access ≥ 4 | off |
| My status | Not started · Interested · Applied · Interviewing · Closed (from the tracker) | all on |

- Show a live count ("Showing 41 of 95"), plus a single "Reset filters" button.
- Employers that sponsor a clearance (`cl: "some"`) get a small neutral tag: "Sponsors clearance: you'd rather avoid".
- Save filter state in `localStorage` under the key `reston-map-filters`. Emit `filters-changed`. The core list and the map markers both read `app.filters.match(e)`.
- On phones, the filter bar collapses into a "Filters (3 on)" button that opens a sheet.

### 2.2 Agent R: route detail and near-home detail (features 4 and 5)

**Low-cost, precomputed at build time. No live GPS and no runtime API calls.**

**Data pipeline: `src/routes.py` → `src/routes.json`.**

- **Driving.** For each employer, query the public OSRM server (`router.project-osrm.org/route/v1/driving/{home};{emp}?alternatives=3&steps=true&overview=simplified`) at 1 request per second, and cache to `src/routes_cache.json`. For each route alternative, keep:
  - `min`: OSRM duration × rush-hour factor (see calibration below), rounded to 5.
  - `mi`: distance in miles.
  - `via`: the longest-distance named road from the steps, using `ref` (e.g. "VA 7", "US 29") or else the road name.
  - `toll`: true if any step has the toll class, or the geometry runs along the Dulles Toll Road (VA 267), the Dulles Greenway or the I-66/I-495/I-95 Express Lanes. Test this against a hand-drawn buffer of those corridors in `src/toll_corridors.json`.
  - `geom`: polyline simplified to about 50 points.

  If OSRM gives no toll-free alternative for a tolled route, add one by forcing a waypoint on the obvious free road (Rt 7 for Leesburg/Ashburn, US-29 or US-50 for points west and south, or the Fairfax County Pkwy).
- **Calibration.** OSRM has no traffic, so fit one rush-hour factor using Eric's Apple Maps screenshots in `docs/route-screenshots/NOTES.md`:
  - Reston → Leesburg area: 29 min via Rt 7 (no toll); 24 min via the Toll Rd.
  - Reston → Warrenton area: 47 min via Fairfax County Pkwy and US-29.

  Store the factor and these checkpoints in `routes.json.calibration`, and print the error for each one.
- **Metro.** Home → walk or drive to Wiehle-Reston East (precompute the distance from home). Then the Silver Line, timed with a station-to-station minutes table in `src/metro_times.json`, entered by hand from WMATA's published schedule, with the source URL recorded and `verified` set. Then a walk from the nearest station to the employer (straight-line distance × 1.3, at 3 mph). Show this only when the walk at the destination end is ≤ 15 min. Otherwise say "Metro plus a long walk or bus".

**UI.**

- In the employer card, add a "Getting there" section: 2–3 driving options, each one line, e.g. "**32 min** via VA 7 · no tolls". The toll-free option comes first. A tolled option shows as "(toll)", without guessing a price. Under them goes one Metro line if one applies.
- On the map, selecting an employer draws its default route as a ribbon above the roads. Use the existing `ribbon()` helper and a distinct color with a dashed pattern so it doesn't rely on color alone. A "Show other routes" toggle draws the alternatives fainter.
- Commute score: the core's `commuteScore(e)` currently uses straight-line miles. Change it to use `app.routes.bestMinutes(e)` (the fastest toll-free option) when that's available, with banding 15 / 25 / 35 / 45 / 60 min. Keep the +0.15 Metro bonus. Fall back to miles when there's no route.
- If Eric moves his home, the precomputed routes no longer apply. Show "Routes are from your saved home. Rebuild to refresh", and fall back to miles × factor.

**Near-home detail (feature 5).** These are assumptions; confirm with Eric before building them:

- A "Near home" filter preset for employers ≤ 20 min by car.
- Denser building and street detail for Reston, Herndon and Dulles: register a `tiles/reston.json` tile from OSM, in the same pipeline as Phase 0.
- A list entry for each of the Silver Line stations on Eric's side (Wiehle, Reston Town Center, Herndon, Innovation Center) showing which employers are within a 15-min walk.

### 2.3 Agent T: application tracker with cloud backup (features 9 and 10)

**Storage layer: `src/parts/30-tracker.js` exposes `app.store`.**

- Try `const db = await claude.use("db")` and `const user = await claude.use("user")`. If both resolve, save to `data/users/<await user.id()>/apps/<appId>`. That path is private to Eric, even from other editors. Use `onSnapshot` so phone and laptop stay in sync. Write one document at a time, and only when something changed.
- If `db` is `null`, fall back to `localStorage` under the key `reston-map-tracker`, and show the notice "Saved on this device only. Open the published link to sync".
- Add a 10-second loading timeout. On timeout, show the local copy and retry quietly once.
- **Export/import:** "Download backup" writes JSON and CSV (via the `downloads` capability when published, or a normal `<a download>` locally). "Restore from backup" imports JSON, merging by `appId`; when the same item exists in both, the newer `updatedAt` wins.

**Record schema** (one per application, so one employer can have several):

```json
{
  "appId": "uuid",
  "empId": "brookings",
  "role": "Research Assistant, Foreign Policy",
  "postingUrl": "",
  "status": "interested | applying | applied | interviewing | offer | closed",
  "closedReason": "rejected | withdrew | no-response | accepted | not-a-fit | null",
  "dates": { "interested": "", "applied": "", "lastContact": "", "interview": [] },
  "nextAction": { "text": "Email recruiter to follow up", "due": "YYYY-MM-DD", "doneAt": null },
  "materials": { "resume": "v3", "coverLetter": true, "writingSample": true },
  "contacts": [{ "name": "", "role": "", "how": "email|linkedin|referral", "note": "" }],
  "clearanceSponsor": false,
  "notes": "",
  "createdAt": "", "updatedAt": ""
}
```

Also save a per-employer flag, `data/users/<id>/stars/<empId>` = `{ "starred": true }`, for "Interested" without creating a full application.

**UI.**

- Every employer card gets a status button: "Track this". Pressing it marks Interested and opens a small form. Only the role is required.
- A new third tab, "My applications", shows a simple board grouped by status (a list on phones). Each row shows the employer, the role, the status and the one next action.
- Changing a status is one tap and records the date automatically.
- Each employer's map marker gets a small status ring, plus a shape cue for colorblind use.

### 2.4 Agent A: apply helper (feature 12)

This doesn't depend on AI. It builds a prompt that Eric copies into Claude chat.

- **Profile.** Store it at `data/users/<id>/profile` (or under the `localStorage` key `reston-map-profile`). It's the JSON that `docs/resume-extraction-prompt.md` produces. Add a "My profile" panel with a textarea where Eric pastes that JSON. Validate it, show what's missing (`gaps_or_questions`), and allow small edits.
- **Per application:** an "Apply helper" button opens a panel containing:
  1. A materials checklist (resume, cover letter, writing sample, references, transcript), each one tickable. It writes back to `materials` in the tracker.
  2. A box to paste the posting text, saved in the record as `postingText`.
  3. A "Copy prompt for Claude" button. It assembles the profile JSON, the employer's card fields (name, type, why, roles, progs, cl), the posting text, and a fixed instruction block. The instruction block asks Claude for: a tailored cover letter in Eric's voice, 3 resume bullets reworded for this posting, which writing sample to send and why, and 3 questions to ask in an interview. It forbids inventing experience. The button copies to the clipboard and shows "Copied ✓".
  4. A "Mark as applied" button. It sets the status and date, and auto-creates the first follow-up (see 2.5).
- Keep the instruction block in `src/apply_prompt.md` so Eric can edit it without touching code.

## 3. Phase 2: reminders (feature 11; one agent, after Agent T merges, because it reads the tracker)

**Follow-up rules** live in `src/parts/40-reminders.js` and can be edited in Settings:

- Applied → "Follow up by email" due 7 business days later.
- No reply 10 business days after that → "Second follow-up, or move on". The action has two buttons: "Sent it" and "Close as no response".
- An interview date is set → "Send thank-you note" due the next business day, then "Check in if no word", due 7 business days after the interview.
- Interested for more than 14 days with no application → "Apply or let it go?" with two buttons: "Start applying" and "Not now". "Not now" hides the item for 30 days.

**Today panel.** A collapsible box at the top of the side panel, open by default when anything is due.

- Shows at most 3 items, earliest due first. Each has three buttons: **Done** · **Snooze** (choose 2 days or 1 week) · **Open**.
- "Done" ticks the item with a 10-second undo, and stamps `lastContact` when the item is a follow-up.
- When nothing is due: "All caught up for today ✓". There is no number anywhere.
- An optional "This week" view lists everything due in the next 7 days, grouped by day.
- **Calendar:** "Add to my calendar" downloads a `.ics` file with the open next actions. Use all-day events, each titled with the action and employer, and include a link to the page. This is optional, and nothing depends on it.
- No browser notifications in v2. Eric can import the `.ics` file if he wants phone alerts.

## 4. Phase 3: publish and sync (one agent, last)

1. Build. Then publish with the Artifact tool:
   - `file_path`: the built `reston-hiring-map.html`.
   - `files`: every `tiles/*.json` at its relative path. Fetches are relative, so they resolve next to the page. The total is about 4–6 MB, within limits.
   - `capabilities`: `{ "db": { "rules": [] }, "user": {}, "downloads": true }`. Tracker data lives under `data/users/<id>/`, which is private by default, so no extra rules are needed.
   - `icon`: `"map"`.
2. three.js loads from `cdn.jsdelivr.net/npm/three@0.128.0`, which is allowed. Keep it pinned.
3. Verify on the published page: create a tracker item, use `ArtifactData list` on Eric's user path to confirm it's stored, open the page on a phone-size viewport, and confirm the item appears there.
4. Pin the artifact only if Eric asks.

## 5. Order and who does what

```
Phase 0 (1 agent) ──push──► Phase 1: F ║ R ║ T ║ A (4 agents in parallel, separate part files)
                                         │
                            integration agent: merge, rebuild, full browser test, push
                                         │
                            Phase 2: reminders (1 agent) ──► Phase 3: publish (1 agent)
```

The integration agent runs a review after each phase (`superpowers:requesting-code-review`), and runs the browser test from §0 before it pushes.

## 6. Open questions for Eric (ask before the related phase starts)

1. **GitHub repo** to push to (Phase 0, step 8). This is needed because the cloud container is wiped between sessions.
2. **Near-home detail (feature 5).** Are the three assumptions in 2.2 what you meant?
3. **Optional extras, off by default:**
   1. An in-page "Draft it for me" button in the apply helper, using the artifact `sample` capability.
   2. Google Calendar sync of reminders, using the `mcp` capability. Your Google Calendar connector is available.

   Both need your consent when first used and are never required.
4. **Profile JSON.** Paste in what Claude chat returns from the resume-extraction prompt. Agent A needs it to test the apply helper.

## 7. Files

- Source: `src/template4.html` (split into `src/parts/` in Phase 0), `src/build4.py`, `src/prep4.json`, `src/employers.json`
- New data: `src/routes.json`, `src/routes_cache.json`, `src/metro_times.json`, `src/toll_corridors.json`, `src/apply_prompt.md`, `tiles/rosslyn.json`, `tiles/reston.json`
- Reference: `docs/route-screenshots/` (Eric's Apple Maps commute checks), `docs/resume-extraction-prompt.md`
