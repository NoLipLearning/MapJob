"""One-step refresh pipeline (spec 4.3 steps 5-7): raw jobs -> normalized, matched, scored -> planned db writes.
Usage (from src/refresh):
  python3 build_jobs.py --raw RAW.json --existing EXISTING.json --profile PROFILE.json --out WRITES.json \
         [--today YYYY-MM-DD] [--extra-employers MY.json] [--tried indeed,gmail] [--failed usajobs] [--geocode]
RAW.json: list of {source, title, employer, location, url, posted, pay, jobType, desc, job_id|control|id, lat?, lon?}
source: indeed | usajobs | careers | web | linkedin | handshake (from Gmail alerts) | saved-linkedin | saved-handshake | saved-other"""
import argparse, json, math, os, re, time, urllib.parse, urllib.request
from datetime import date
from normalize import job_id, classify_clearance, classify_entry, match_employer, parse_posted
from score import score, estimate_minutes
from apply_batch import plan_writes

HERE = os.path.dirname(os.path.abspath(__file__)); SRC = os.path.dirname(HERE)


def _miles(a, b):
    r = math.pi / 180; dl, dn = (b[0] - a[0]) * r, (b[1] - a[1]) * r
    h = math.sin(dl / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin(dn / 2) ** 2
    return 2 * 3958.8 * math.asin(math.sqrt(h))


def best_minutes(routes, emp_id):
    opts = ((routes or {}).get("employers", {}).get(emp_id) or {}).get("options") or []
    free = [o["min"] for o in opts if not o.get("toll")]
    return min(free) if free else None


def build(raw, existing, profile, employers, routes, home, today, geocode=None):
    by_id = {e["id"]: e for e in employers}
    jobs = []
    for r in raw:
        src = r.get("source") or "web"
        jid = r.get("id") if src.startswith("saved-") else job_id(src, r)
        if not jid: continue
        title = (r.get("title") or "").strip() or "Saved job"
        desc = re.sub(r"\s+", " ", r.get("desc") or "").strip()
        text = title + " " + desc
        loc = {"text": r.get("location") or "", "lat": r.get("lat"), "lon": r.get("lon"), "exact": isinstance(r.get("lat"), (int, float))}
        job = {"id": jid, "title": title, "employer": (r.get("employer") or "").strip(), "loc": loc, "source": src}
        job["empId"] = match_employer(job, employers)
        if not isinstance(loc["lat"], (int, float)):
            e = by_id.get(job["empId"])
            if e: loc.update(lat=e["lat"], lon=e["lon"], exact=False)
            elif geocode and loc["text"]:
                ll = geocode(loc["text"])
                if ll: loc.update(lat=ll[0], lon=ll[1], exact=False)
        mins = best_minutes(routes, job["empId"]) if job["empId"] else None
        if mins is None and isinstance(loc["lat"], (int, float)) and home:
            mins = round(estimate_minutes(_miles(home, (loc["lat"], loc["lon"]))))
        url = (r.get("url") or "").strip()
        job.update(
            url=url if url.startswith("https://") else None,
            posted=parse_posted(r.get("posted") or "", today), pay=r.get("pay") or None, jobType=r.get("jobType") or None,
            clearance=classify_clearance(text) if desc or title != "Saved job" else "unknown",
            entry=classify_entry(title, desc) if desc or title != "Saved job" else "unknown",
            summary=desc[:280] or None, verified=not src.startswith("saved-"), minutes=mins)
        if title == "Saved job" and not desc:
            job["fit"], job["fitWhy"] = None, []
        else:
            job["fit"], job["fitWhy"] = score(dict(job, desc=desc), profile, mins)
        jobs.append(job)
    plan = plan_writes(existing, jobs, today.isoformat())
    live = [j for j in plan["set"] if j.get("status") == "new" and j.get("fit") is not None]
    plan["top"] = [{k: j.get(k) for k in ("title", "employer", "fit", "url", "clearance")} for j in sorted(live, key=lambda j: -j["fit"])[:5]]
    return plan


def make_geocoder(max_lookups=20):
    path = os.path.join(SRC, "geocache.json"); cache = json.load(open(path)) if os.path.exists(path) else {}; left = [max_lookups]

    def geo(q):
        q = q.strip()
        if q in cache: return cache[q][:2] if cache[q] else None
        if left[0] <= 0: return None
        left[0] -= 1
        url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "json", "limit": 1, "countrycodes": "us"})
        try:
            res = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "reston-hiring-map/1.0 (personal job-search map)"}), timeout=30))
        except Exception:
            return None
        finally:
            time.sleep(1.1)
        cache[q] = [float(res[0]["lat"]), float(res[0]["lon"])] if res else None
        json.dump(cache, open(path, "w"))
        return cache[q]
    return geo


def main():
    a = argparse.ArgumentParser()
    for k in ("raw", "existing", "profile", "out"): a.add_argument("--" + k, required=True)
    a.add_argument("--today"); a.add_argument("--extra-employers"); a.add_argument("--tried", default=""); a.add_argument("--failed", default="")
    a.add_argument("--geocode", action="store_true")
    o = a.parse_args()
    load = lambda p, d: json.load(open(p)) if p and os.path.exists(p) else d
    D = json.load(open(os.path.join(SRC, "prep4.json"))); routes = load(os.path.join(SRC, "routes.json"), {})
    emps = D["emps"] + load(o.extra_employers, [])
    h = (routes.get("meta") or {}).get("home") or {}
    home = (h["lat"], h["lon"]) if "lat" in h else None
    today = date.fromisoformat(o.today) if o.today else date.today()
    plan = build(load(o.raw, []), load(o.existing, []), load(o.profile, {}), emps, routes, home, today, make_geocoder() if o.geocode else None)
    plan["meta"] = {"lastRun": today.isoformat(), "counts": plan["counts"], "sourcesTried": [s for s in o.tried.split(",") if s], "sourcesFailed": [s for s in o.failed.split(",") if s]}
    json.dump(plan, open(o.out, "w"), indent=1)
    print("new %(new)d  updated %(updated)d  removed %(removed)d" % plan["counts"])
    for t in plan["top"]: print("  %3s  %s at %s  [%s]" % (t["fit"], t["title"], t["employer"], t["clearance"]))


if __name__ == "__main__":
    main()
