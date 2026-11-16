"""One-step refresh pipeline (spec 4.3 steps 5-7): raw jobs -> normalized, matched, scored -> planned db writes.
Usage (from src/refresh):
  python3 build_jobs.py --raw RAW.json --existing EXISTING.json --profile PROFILE.json --out WRITES.json \
         [--today YYYY-MM-DD] [--extra-employers MY.json] [--tried indeed,gmail] [--failed usajobs] [--geocode]
RAW.json: list of {source, title, employer, location, url, posted, pay, jobType, desc, job_id|control|id, lat?, lon?}
source: indeed | usajobs | careers | web | linkedin | handshake (from Gmail alerts) | greenhouse | lever | saved-linkedin | saved-handshake | saved-other
Feed items (feeds.py, usajobs.py) also carry job_id|control, deadline (YYYY-MM-DD) and board ("greenhouse:<token>" / "lever:<company>").
--authoritative FILE: JSON list of boards fetched OK this run (feeds.py writes it); their vanished jobs are deleted (apply_batch.plan_writes)."""
import argparse, json, math, os, re, time, urllib.parse, urllib.request
from datetime import date
from normalize import job_id, classify_clearance, classify_entry, match_employer, parse_posted, _meters
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


FEED_SOURCES = ("greenhouse", "lever", "usajobs")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def office_for(lat, lon, offices, emp_id=None, max_m=100):
    """Nearest office within max_m of (lat, lon), else None. When emp_id is given, an office listing that employer wins a tie-break."""
    best = None
    for o in offices or []:
        d = _meters(lat, lon, o["lat"], o["lon"])
        if d <= max_m:
            key = (0 if emp_id and emp_id in o.get("empIds", []) else 1, d)
            if best is None or key < best[0]: best = (key, o["id"])
    return best[1] if best else None


def build(raw, existing, profile, employers, routes, home, today, geocode=None, offices=None, authoritative=None):
    by_id = {e["id"]: e for e in employers}
    known = {j["id"] for j in existing}
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
        trusted = loc["exact"]  # a real point, or (below) the employer's own building; a geocoded city centre is not
        if not isinstance(loc["lat"], (int, float)):
            e = by_id.get(job["empId"])
            if e: loc.update(lat=e["lat"], lon=e["lon"], exact=False); trusted = True
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
        dl = (r.get("deadline") or "").strip() if isinstance(r.get("deadline"), str) else ""
        job["deadline"] = dl if DATE_RE.match(dl) else None
        job["officeId"] = office_for(loc["lat"], loc["lon"], offices, job["empId"]) if trusted and isinstance(loc["lat"], (int, float)) else None
        job["checked"] = today.isoformat() if src in FEED_SOURCES else None
        if r.get("board"): job["board"] = r["board"]
        if not desc and (jid in known or title == "Saved job"):
            # nothing new to read: leave what the db already knows (plan_writes skips empty values)
            job.update(clearance=None, entry=None, summary=None)
            job["fit"], job["fitWhy"] = None, []
        else:
            job["fit"], job["fitWhy"] = score(dict(job, desc=desc), profile, mins)
        jobs.append(job)
    plan = plan_writes(existing, jobs, today.isoformat(), authoritative)
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
    a.add_argument("--geocode", action="store_true"); a.add_argument("--authoritative"); a.add_argument("--offices")
    o = a.parse_args()
    load = lambda p, d: json.load(open(p)) if p and os.path.exists(p) else d

    def must_list(p, what):
        # a missing or unreadable file must stop the refresh: treating it as empty would reset every job's status
        if not os.path.exists(p): raise SystemExit("Stopped: %s file not found: %s" % (what, p))
        try: v = json.load(open(p))
        except Exception as e: raise SystemExit("Stopped: %s file is not valid JSON (%s)" % (what, e))
        if not isinstance(v, list): raise SystemExit("Stopped: %s file must be a JSON list" % what)
        return v
    raw, existing = must_list(o.raw, "raw jobs"), must_list(o.existing, "existing jobs")
    D = json.load(open(os.path.join(SRC, "prep4.json"))); routes = load(os.path.join(SRC, "routes.json"), {})
    emps = D["emps"] + load(o.extra_employers, [])
    h = (routes.get("meta") or {}).get("home") or {}
    home = (h["lat"], h["lon"]) if "lat" in h else None
    today = date.fromisoformat(o.today) if o.today else date.today()
    offices = load(o.offices or os.path.join(SRC, "offices.json"), [])
    auth = set(load(o.authoritative, []))
    plan = build(raw, existing, load(o.profile, {}), emps, routes, home, today, make_geocoder() if o.geocode else None, offices, auth)
    print("existing jobs read: %d (must equal the number of documents listed in step 1)" % len(existing))
    plan["meta"] = {"lastRun": today.isoformat(), "counts": plan["counts"], "sourcesTried": [s for s in o.tried.split(",") if s], "sourcesFailed": [s for s in o.failed.split(",") if s]}
    json.dump(plan, open(o.out, "w"), indent=1)
    print("new %(new)d  updated %(updated)d  removed %(removed)d" % plan["counts"])
    for t in plan["top"]: print("  %3s  %s at %s  [%s]" % (t["fit"], t["title"], t["employer"], t["clearance"]))


if __name__ == "__main__":
    main()
