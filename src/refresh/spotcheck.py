"""Spot-check that jobs are still live. Usage (from src/refresh): python3 spotcheck.py JOBS.json [--n 20] [--seed 1]
JOBS.json: list of jobs with `url` (and optionally `title`). Picks up to n at random, requests each url (HEAD, then GET if HEAD is refused),
and prints live / gone / not checked. Only hosts the refresh already uses are requested; any other host is "not checked".
It never changes a User-Agent to get past a block: a refusal (403/429) is reported as "not checked", not retried."""
import argparse, json, random, urllib.error, urllib.request
from urllib.parse import urlsplit

UA = "mapjob-spotcheck/1.0"
ALLOWED = ("boards-api.greenhouse.io", "api.lever.co", "data.usajobs.gov")  # the hosts this project may request


def api_url(url):
    """Public posting pages are not on the allowed list, so ask the board's own API about that one posting instead."""
    p = urlsplit(url or ""); parts = [x for x in p.path.split("/") if x]
    if p.hostname in ("job-boards.greenhouse.io", "boards.greenhouse.io") and len(parts) >= 3 and parts[1] == "jobs":
        return "https://boards-api.greenhouse.io/v1/boards/%s/jobs/%s" % (parts[0], parts[2])
    if p.hostname == "jobs.lever.co" and len(parts) >= 2:
        return "https://api.lever.co/v0/postings/%s/%s" % (parts[0], parts[1])
    return url


def allowed(url):
    p = urlsplit(url or "")
    return p.scheme == "https" and (p.hostname or "") in ALLOWED


def check(url, opener=urllib.request.urlopen):
    """-> ("live"|"gone"|"not checked", detail)"""
    url = api_url(url)
    if not allowed(url): return "not checked", "host not allowed"
    for method in ("HEAD", "GET"):
        try:
            with opener(urllib.request.Request(url, method=method, headers={"User-Agent": UA}), timeout=30) as r:
                return "live", "%s %s" % (method, r.status)
        except urllib.error.HTTPError as ex:
            if ex.code in (404, 410): return "gone", "%s %s" % (method, ex.code)
            if method == "HEAD" and ex.code in (400, 403, 405, 501): continue  # HEAD refused: try GET once
            return "not checked", "%s %s" % (method, ex.code)
        except Exception as ex:
            return "not checked", repr(ex)[:60]
    return "not checked", "no answer"


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("jobs"); ap.add_argument("--n", type=int, default=20); ap.add_argument("--seed", type=int)
    o = ap.parse_args()
    jobs = [j for j in json.load(open(o.jobs)) if isinstance(j, dict) and j.get("url")]
    pick = random.Random(o.seed).sample(jobs, min(o.n, 20, len(jobs)))
    tally = {"live": 0, "gone": 0, "not checked": 0}
    for j in pick:
        st, why = check(j["url"]); tally[st] += 1
        print("%-11s %-14s %s  %s" % (st, why, (j.get("title") or "")[:40], j["url"]))
    print("checked %d: live %d, gone %d, not checked %d" % (len(pick), tally["live"], tally["gone"], tally["not checked"]))


if __name__ == "__main__":
    main()
