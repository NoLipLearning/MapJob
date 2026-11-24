# More employers and jobs across NoVA: design

Date: 2026-11-24. Status: draft for Eric's approval.

## Intent (Eric's words)

"I just want all the jobs in every building in NoVA."
"I just want more jobs or locations websites with even just their career page linked."

So the map grows from 133 hand-picked employers to every sizeable employer in Northern Virginia that a public record can place. Each one is pinned at its building and has a link to its real careers page. On top of that, more actual openings come in through one broad job feed.

This serves the earlier goal of applying to as many jobs as fast as possible. A careers link on the map is one tap from that employer's openings.

## Goals

1. **Directory, phase A:** 300–600 NoVA employers, chosen by hand from public lists. Each has a verified careers-page link and an address placed on the map.
2. **Directory, phase B:** every federal contractor registered in SAM.gov with a physical address in NoVA, likely thousands.
   - These link to the company website.
   - Contractors within 1 mile of Eric's routes (`src/routes_corridor.json`) also get a careers page found by search, capped per run.
3. **More openings:** CareerOneStop's job search (U.S. Department of Labor, fed by the National Labor Exchange) runs as a new refresh source for NoVA towns, and its jobs land in the `jobs` collection like the other sources.
4. **Easy to use:** directory pins are clustered on the map, and every entry is one tap from its careers page.

## Non-goals

- Fit ratings, roles or "why" text for directory entries. Those stay for the 133 researched employers only.
- Reading every directory employer's openings. That happens only where a feed exists (Greenhouse, Lever, Workday, CareerOneStop).
- Tenant lists for buildings, and hiring signals from contract awards (discussed with Eric, not chosen).

## Anti-goals

- **Guessed links.** A careers link is stored only when a search result or the employer's own site shows it. Otherwise the entry links to the homepage, labelled "Website", or has no link.
- **Invented addresses.** Every position comes from a record (list page, SAM.gov, geocoder) and carries its source.
- **Clutter that hides the 133 researched employers or the jobs.**
- **LinkedIn or Handshake fetching, or disguised requests** (standing rule). A blocked site is skipped and reported.

## Constraints

- **Existing structure:**
  - single page from `src/build4.py`, with employers in `src/prep4.json` `emps`;
  - geocoding through Nominatim (allowed host, 1 request per second, cached in `src/geocache.json`);
  - jobs in the artifact database `jobs`, refresh per `docs/REFRESH.md`;
  - data scripts run in the order listed in `CLAUDE.md`.
- **Page size:** under 12 MB (today 3.4 MB). Directory records are small (id, name, type, address, lat/lon, link, source). If phase B pushes the page past the budget, its records move to a runtime file under `tiles/`, like the route tiles.
- **Network:**
  - SAM.gov (`api.sam.gov`) needs a free API key that Eric registers for, and a host approval.
  - CareerOneStop needs a free key from Eric, and a host approval.
  - Keys are passed at run time and never committed, as with the USAJOBS key.
- **Usage:**
  - Phase A careers links come from web searches by Haiku agents, about one search per employer.
  - Phase B searches are capped at 150 per run, corridor companies first.

## Approaches considered

- **A. Hand-built lists with careers pages found by search.** Chosen, first.
- **B. SAM.gov contractor registry.** Chosen, second, for breadth.
- **C. OpenStreetMap office listings.** Rejected: Overpass is unreachable from these sessions, and Nominatim's policy forbids bulk downloads.
- Building-first tenant discovery and contract-award signals. Discussed; Eric chose "more jobs or locations with their careers page" instead.

## What gets built

### 1. Directory data: `src/directory.json`, plus a script `src/add_directory.py`

One record per employer location:

```
{id, name, kind, addr, lat, lon, gc, link, linkType: "careers"|"website",
 src: [urls], via: "list"|"sam", checked: "YYYY-MM-DD", empId?}
```

- `empId` is set when the location matches one of the 133 researched employers (same organisation, within 150 m). That employer's pin is kept, and no duplicate pin is drawn.
- `kind` uses the existing employer `type` values where they fit (federal, state-local, contractor, think-tank, ngo-advocacy, education-health, corporate, international, media).

**Phase A sources** (scouts collect the names and addresses; agents find the careers links):
- the Fairfax, Loudoun, Prince William and Arlington county major-employer lists;
- federal agency offices in NoVA: `src/offices.json` (GSA), plus the agency HQs;
- associations headquartered in NoVA (like the NRA);
- think tanks and advocacy groups;
- embassies and international organisations in Arlington and Alexandria;
- hospitals, universities and community colleges;
- the town and city governments;
- the large contractors' named NoVA offices.

**Phase B:**
- The SAM.gov Entity API, filtered to active registrations whose physical address is in the NoVA counties and cities.
- Geocoded with Nominatim, using the cache. An address that doesn't geocode is kept off the map and counted in the report.

### 2. Map and list

- Directory pins are a separate, lighter pin style.
- They are clustered with the existing cluster code (`tests/cluster.js`), and there is an on/off toggle. **Its default is on.**
- Tapping a directory pin shows the name, address, and a **Careers ↗** (or **Website ↗**) button. If the employer has openings on the map, the jobs count shows as well, using the existing `app.jobs.byEmp`.
- The Employers panel gets a searchable "All NoVA employers" list: name, town, link. It is sorted by drive distance from home.

```
[Careers ↗] Booz Allen Hamilton · McLean · 14 min
[Website ↗] Acme Federal Solutions LLC · Chantilly · 18 min
```

### 3. More openings: CareerOneStop source

- A new adapter in `src/refresh/`, following the existing USAJOBS feed adapter.
- Searches a list of NoVA towns with a radius, returns title, employer, location, date and URL, and dedupes against existing jobs.
- Jobs whose employer matches a directory entry get that entry's `empId` or directory id.
- Read step: CareerOneStop gives a short description only. Jobs are marked `read.from = "alert"` when there is text, and "title" otherwise.

### 4. Refresh and report

- `docs/REFRESH.md` gets a directory step: re-check links on 50 entries per run, oldest `checked` first, and mark dead links.
- The report adds "directory: N employers, N with careers links, N website only, N not placed".

## Left to the builder

- Exact list pages and the SAM.gov query fields.
- Batch sizes for the agents.
- Pin colour, taken from the existing kit.
- Where the toggle sits.
- Whether phase B records live in `prep4.json` or a `tiles/` runtime file (decide by size).
- Test structure, following `tests/*.js` and the refresh unit tests.

## Done means

- **Phase A:**
  - at least 300 directory entries placed;
  - at least 90% of them with a careers link;
  - a reviewer spot-checks 20 random links, and each opens that employer's careers or jobs page.
- **Phase B:**
  - SAM.gov NoVA entities loaded;
  - the count placed and the count not placed are reported;
  - the corridor companies (up to 150) have careers links from search.
- **CareerOneStop:** it runs in a refresh, and the new jobs count is reported.
- All suites pass, the page is under 12 MB, and it is republished with all tiles.

## Decisions from the builder check (Claude's calls; Eric can override)

1. **Placement quality.**
   - An entry counts as placed only when the geocoder matches its house number (`gc: "addr"`).
   - Street-level or ZIP-level results count as "not placed" and are listed in the report, not drawn.
   - Phase B geocoding is capped at 1,500 new lookups per run (about 25 minutes at 1 per second) and continues on later runs from the cache.
   - The 150 m match to the 133 researched employers uses placed entries only.
2. **Separate layer.** Directory entries are not part of the match score, the fit ranking, the employer filters or the tracker; they have their own pins and list. "Drive minutes" is the map's existing straight-line estimate (miles x 2.4).
3. **The 133 stay visible.** They are never clustered with directory pins and are drawn above them.
4. **The 90% target.** Website-only entries count toward the 300. Scouts collect about 400 candidates so that at least 300 are placed and at least 90% of those have a careers link. Nothing is dropped to hit the number.
5. **Order.** Phase A is built and published first, without waiting for the SAM.gov or CareerOneStop keys. Phase B and CareerOneStop start once Eric has the keys and has approved the two hosts.
6. **Matching jobs to employers.**
   - Exact match on normalised names only: lower case, punctuation removed, and Inc, LLC, Corp, Co., Ltd and "The" stripped.
   - There is no fuzzy or subsidiary matching. Unmatched jobs simply have no employer pin.
7. **Phase B includes every active NoVA registration**, small firms included, because Eric asked for every employer. Most small firms will be Website-only.
