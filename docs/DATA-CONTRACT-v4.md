# v4 data contract (buildings + more jobs + filters). Both v4 agents code to this; change it only by asking the lead.

## Office buildings: `src/offices.json` -> page `app.D.offices`
A JSON list, at most 4000 entries, built by `src/offices.py` (data agent). Each entry:
```json
{ "id": "gsa-VA1234ZZ | osm-way-123456", "name": "Building or main tenant name", "kind": "federal | government | office | nonprofit | company",
  "tenants": ["Social Security Administration", "..."], "addr": "street, city, ST zip or ''", "lat": 38.94, "lon": -77.31,
  "source": "gsa-iolp | osm", "sourceUrl": "https://... or ''", "empIds": ["existing employer ids in or within 100 m of this building"], "checked": "YYYY-MM-DD" }
```
Only places within 30 miles (straight line) of home 38.93472, -77.32540. No invented tenants: `tenants` holds only names the source states.

## Jobs (additions to spec 4.1)
- `deadline`: "YYYY-MM-DD" or null. Set only when the source states a closing date.
- `officeId`: id from offices.json when the job's location is within 100 m of that building, else null.
- `checked`: "YYYY-MM-DD" when the posting was last confirmed live (= lastSeen for feed sources).
- New sources: `greenhouse`, `lever` (employer feeds), `usajobs` (API). Feed sources are authoritative: a job from a board that was fetched successfully this run but is no longer on that board is deleted unless its status is saved, applied or dismissed.

## Page APIs the UI agent may rely on
- `app.D.offices` (list above), `app.jobs` (existing), `app.filters` (existing, extended by the UI agent).
