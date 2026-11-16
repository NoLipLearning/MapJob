"""Employer job feeds: Greenhouse and Lever boards -> raw items for build_jobs.py.
Usage (from src/refresh): python3 feeds.py --out $S/feeds.json [--boards-out $S/boards_ok.json] [--cache DIR] [--no-network]
Boards come from (a) employer url/src/progs links in src/prep4.json (boards.greenhouse.io/<token>, job-boards.greenhouse.io/<token>,
jobs.lever.co/<company>) and (b) boards.json (a list of {"kind","token","employer","empId"} you maintain; confirmed by fetching).
--out gets the raw items; --boards-out gets the boards fetched OK (pass it to build_jobs.py --authoritative).
Only jobs in the DC/MD/VA metro or remote-US are kept."""
import argparse, html, json, os, re, sys, time, urllib.error, urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__)); SRC = os.path.dirname(HERE)
UA = "mapjob-feeds/1.0"
GH_RE = re.compile(r"(?:boards|job-boards)\.greenhouse\.io/(?:embed/job_board\?for=)?([A-Za-z0-9_-]+)")
LV_RE = re.compile(r"jobs\.lever\.co/([A-Za-z0-9_-]+)")

METRO = re.compile(r"\b(washington|d\.?c\.?|district of columbia|virginia|maryland|arlington|alexandria|reston|herndon|mclean|tysons|fairfax|falls church|"
                   r"bethesda|rockville|silver spring|college park|greenbelt|hyattsville|leesburg|ashburn|sterling|manassas|chantilly|dulles|gaithersburg|"
                   r"landover|lanham|baltimore|annapolis|woodbridge|lorton|centreville|oakton|"
                   r"dmv|national capital|ballston|rosslyn|crystal city|pentagon city)\b|,\s*(va|md|dc)\b|\b(va|md)\s*$|^(va|md|dc)\b", re.I)
REMOTE = re.compile(r"\bremote\b|\banywhere\b|\bnationwide\b", re.I)
FOREIGN = re.compile(r"\b(uk|united kingdom|london|canada|toronto|vancouver|india|bangalore|europe|emea|apac|latam|germany|berlin|france|paris|ireland|dublin|"
                     r"middle east|gulf|asia|africa|australia|sydney|singapore|japan|tokyo|brazil|mexico|israel|netherlands|spain|poland|philippines|china|nigeria|kenya)\b", re.I)


def in_scope(loc):
    """DC/MD/VA metro, or remote in the US (a remote role that names a foreign place does not count)."""
    loc = loc or ""
    if METRO.search(loc) and not FOREIGN.search(loc): return True
    return bool(REMOTE.search(loc)) and not FOREIGN.search(loc)


def to_text(markup):
    t = html.unescape(markup or "")
    t = re.sub(r"(?i)<\s*(br|/p|/li|/h\d|/div)\s*/?>", "\n", t)
    t = re.sub(r"(?i)<li[^>]*>", "- ", t)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    t = re.sub(r"[ \t\xa0]+", " ", t)
    return re.sub(r"\s*\n\s*", "\n", t).strip()


def discover(employers):
    found = {}
    for e in employers:
        links = [e.get("url") or ""]
        s = e.get("src") or []; links += s if isinstance(s, list) else [s]
        links += [p.get("url") or "" for p in e.get("progs") or [] if isinstance(p, dict)]
        for u in links:
            for rx, kind in ((GH_RE, "greenhouse"), (LV_RE, "lever")):
                m = rx.search(u)
                if m: found.setdefault((kind, m.group(1)), {"kind": kind, "token": m.group(1), "employer": e["name"], "empId": e["id"], "found": "prep4:" + e["id"]})
    return found


def load_boards(cfg_path=None):
    emps = json.load(open(os.path.join(SRC, "prep4.json")))["emps"]
    boards = discover(emps)
    p = cfg_path or os.path.join(HERE, "boards.json")
    if os.path.exists(p):
        for b in json.load(open(p)):
            boards.setdefault((b["kind"], b["token"]), dict(b, found="boards.json"))
    print("boards to try: %d (%d discovered in prep4.json employer links, %d total after boards.json)" % (len(boards), len(discover(emps)), len(boards)))
    return list(boards.values())


def get_json(url, tries=3):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"}), timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as ex:
            if ex.code < 500 and ex.code != 429: raise  # 404 etc: the board does not exist, retrying will not help
            last = ex
        except Exception as ex:
            last = ex
        time.sleep(2 * 2 ** i)
    raise last


def iso_date(v):
    if isinstance(v, (int, float)): return datetime.fromtimestamp(v / 1000, timezone.utc).strftime("%Y-%m-%d")
    m = re.match(r"\d{4}-\d{2}-\d{2}", v or "")
    return m.group(0) if m else None


def greenhouse(b):
    d = get_json("https://boards-api.greenhouse.io/v1/boards/%s/jobs?content=true" % b["token"])
    jobs = d.get("jobs") or []
    items = []
    for j in jobs:
        loc = (j.get("location") or {}).get("name") or ""
        if not in_scope(loc): continue
        items.append({"source": "greenhouse", "job_id": j["id"], "url": j.get("absolute_url") or "", "title": j.get("title") or "", "employer": b["employer"],
                      "location": loc, "desc": to_text(j.get("content")), "posted": iso_date(j.get("first_published") or j.get("updated_at")), "board": "greenhouse:" + b["token"]})
    return len(jobs), items


def lever(b):
    jobs = get_json("https://api.lever.co/v0/postings/%s?mode=json" % b["token"])
    if not isinstance(jobs, list): raise ValueError("unexpected Lever response")
    items = []
    for j in jobs:
        c = j.get("categories") or {}
        locs = [c.get("location") or ""] + list(c.get("allLocations") or [])
        loc = next((l for l in locs if l and in_scope(l)), None)
        if loc is None and not (j.get("workplaceType") == "remote" and not any(FOREIGN.search(l) for l in locs if l)): continue
        loc = loc or "Remote"
        extra = " ".join(to_text(x.get("text", "")) + " " + to_text(x.get("content", "")) for x in j.get("lists") or [])
        items.append({"source": "lever", "job_id": j["id"], "url": j.get("hostedUrl") or "", "title": j.get("text") or "", "employer": b["employer"], "location": loc,
                      "desc": (j.get("descriptionPlain") or to_text(j.get("description"))) + ("\n" + extra if extra.strip() else ""), "posted": iso_date(j.get("createdAt")),
                      "board": "lever:" + b["token"]})
    return len(jobs), items


def fetch_all(boards, log=print):
    items, ok = [], []
    for b in boards:
        name = "%s:%s" % (b["kind"], b["token"])
        try:
            total, got = (greenhouse if b["kind"] == "greenhouse" else lever)(b)
        except Exception as ex:
            log("  FAILED  %-40s %s" % (name, str(ex)[:60])); continue
        if total == 0:
            log("  EMPTY   %-40s board returned no jobs; not treated as authoritative" % name); continue
        ok.append(name); items += got
        log("  OK      %-40s %3d jobs on board, %3d in DC/MD/VA/remote-US  (%s)" % (name, total, len(got), b["employer"]))
        time.sleep(0.5)
    return items, ok


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); ap.add_argument("--boards-out"); ap.add_argument("--boards")
    o = ap.parse_args()
    items, ok = fetch_all(load_boards(o.boards))
    json.dump(items, open(o.out, "w"), indent=1)
    json.dump(ok, open(o.boards_out or o.out + ".boards.json", "w"), indent=1)
    print("boards fetched OK: %d -> %s" % (len(ok), ", ".join(ok) or "none"))
    print("jobs emitted: %d -> %s" % (len(items), o.out))


if __name__ == "__main__":
    main()
