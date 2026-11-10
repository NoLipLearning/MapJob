"""USAJOBS Search API -> raw items for build_jobs.py (source "usajobs").
Usage (from src/refresh): USAJOBS_KEY=... USAJOBS_EMAIL=... python3 usajobs.py --out $S/usajobs.json
Entry-level / policy roles (GS-5 to GS-9, open to the public) within 30 miles of Reston. The API requires the key in Authorization-Key and your
email as the User-Agent; both come from the environment. Missing either -> prints "skipped: no USAJOBS key" and exits 0."""
import argparse, json, math, os, sys, time, urllib.parse, urllib.request

HOME = (38.93472, -77.32540)
KEYWORDS = ["policy analyst", "program analyst", "program assistant", "management analyst", "public affairs", "foreign affairs", "legislative", "research assistant"]


def miles(a, b):
    r = math.pi / 180; dl, dn = (b[0] - a[0]) * r, (b[1] - a[1]) * r
    h = math.sin(dl / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin(dn / 2) ** 2
    return 2 * 3958.8 * math.asin(math.sqrt(h))


def day(v):
    return v[:10] if isinstance(v, str) and len(v) >= 10 and v[4] == "-" else None


def to_item(d):
    """Map one MatchedObjectDescriptor (+ its MatchedObjectId) to a raw item; None if it has no usable location within 30 miles."""
    locs = [l for l in d.get("PositionLocation") or [] if isinstance(l.get("Latitude"), (int, float)) and isinstance(l.get("Longitude"), (int, float))]
    near = sorted(((miles(HOME, (l["Latitude"], l["Longitude"])), l) for l in locs), key=lambda x: x[0])
    if not near or near[0][0] > 30: return None
    l = near[0][1]
    det = ((d.get("UserArea") or {}).get("Details") or {})
    desc = " ".join(x for x in (det.get("JobSummary"), d.get("QualificationSummary")) if x)
    rem = (d.get("PositionRemuneration") or [{}])[0]
    pay = None
    if rem.get("MinimumRange"):
        pay = "$%s-$%s %s" % (rem["MinimumRange"], rem.get("MaximumRange"), (rem.get("Description") or "").lower())
    return {"source": "usajobs", "control": str(d.get("_id") or d.get("PositionID")), "url": d.get("PositionURI") or "", "title": d.get("PositionTitle") or "",
            "employer": d.get("OrganizationName") or d.get("DepartmentName") or "", "location": l.get("LocationName") or "", "lat": l["Latitude"], "lon": l["Longitude"],
            "desc": desc, "posted": day(d.get("PublicationStartDate")), "deadline": day(d.get("ApplicationCloseDate")), "pay": pay,
            "jobType": ((d.get("PositionSchedule") or [{}])[0]).get("Name")}


def search(key, email, keyword, page=1):
    q = urllib.parse.urlencode({"Keyword": keyword, "LocationName": "Reston, Virginia", "Radius": 30, "PayGradeLow": 5, "PayGradeHigh": 9,
                                "WhoMayApply": "public", "ResultsPerPage": 100, "Page": page})
    req = urllib.request.Request("https://data.usajobs.gov/api/search?" + q, headers={"Host": "data.usajobs.gov", "User-Agent": email, "Authorization-Key": key})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["SearchResult"]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); o = ap.parse_args()
    key, email = os.environ.get("USAJOBS_KEY", "").strip(), os.environ.get("USAJOBS_EMAIL", "").strip()
    if not key or not email:
        print("skipped: no USAJOBS key"); return
    items, seen = [], set()
    for kw in KEYWORDS:
        try:
            res = search(key, email, kw)
        except Exception as ex:
            print("USAJOBS search %r failed: %s" % (kw, str(ex)[:80])); continue
        for it in res.get("SearchResultItems") or []:
            d = dict(it["MatchedObjectDescriptor"], _id=it.get("MatchedObjectId"))
            x = to_item(d)
            if x and x["control"] not in seen: seen.add(x["control"]); items.append(x)
        time.sleep(1)
    json.dump(items, open(o.out, "w"), indent=1)
    print("usajobs: %d jobs within 30 miles -> %s" % (len(items), o.out))


if __name__ == "__main__":
    main()
