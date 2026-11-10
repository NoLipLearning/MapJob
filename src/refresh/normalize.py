"""Pure helpers for the map's job refresh (spec 4.3 step 5, 4.5). No network, no I/O except reading keywords.json.
Run tests:  cd src/refresh && python3 -m unittest -v"""
import hashlib, json, math, os, re
from datetime import date, timedelta
from urllib.parse import urlsplit

KW = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "keywords.json")))
SUFFIX = {"inc", "llc", "corp", "corporation", "co", "ltd", "incorporated", "lp", "llp", "pllc"}


def _has(text, phrase):
    """Whole-phrase match on word boundaries (so 'lead' does not match 'leadership')."""
    return re.search(r"(?<![a-z0-9])" + re.escape(phrase) + r"(?![a-z0-9])", text) is not None


def _any(text, phrases):
    return any(_has(text, p) for p in phrases)


ID_PARAMS = ("jk", "vjk", "currentjobid", "gh_jid", "jobid", "job_id", "postingid", "reqid", "req", "id")


def _url_key(url):
    p = urlsplit(url.strip())
    host = p.netloc.lower()
    host = host[4:] if host.startswith("www.") else host
    q = dict(kv.split("=", 1) if "=" in kv else (kv, "") for kv in p.query.split("&") if kv)
    keep = sorted((k.lower(), v) for k, v in q.items() if k.lower() in ID_PARAMS and v)
    return (host + p.path.rstrip("/") + ("?" + "&".join(k + "=" + v for k, v in keep) if keep else "")).encode()


def job_id(source, raw):
    url = (raw.get("url") or "").strip()
    if source == "indeed" and raw.get("job_id"):
        return "indeed-" + str(raw["job_id"])
    if source == "usajobs" and raw.get("control"):
        return "usajobs-" + str(raw["control"])
    # the same posting gets the same id whichever way it was found (alert email, API, careers page)
    host = urlsplit(url).netloc.lower()
    if host.endswith("linkedin.com"):
        m = re.search(r"/jobs/view/(?:(\d+)|[^/?#]*-(\d{6,}))(?=[/?#]|$)", url)
        if m: return "linkedin-" + (m.group(1) or m.group(2))
        m = re.search(r"[?&]currentJobId=(\d+)", url)
        if m: return "linkedin-" + m.group(1)
    if host.endswith("joinhandshake.com"):
        m = re.search(r"/(?:jobs|postings)/(\d+)", url)
        if m: return "handshake-" + m.group(1)
    if host.endswith("indeed.com"):
        m = re.search(r"[?&]v?jk=([0-9a-f]+)", url)
        if m: return "indeed-" + m.group(1)
    if not url:  # no link: identify by who, what and where so different jobs never share an id
        key = "|".join([norm_name(raw.get("employer")), (raw.get("title") or "").lower().strip(), (raw.get("location") or "").lower().strip()])
        return "web-" + hashlib.sha1(("nolink|" + key).encode()).hexdigest()[:12]
    return "web-" + hashlib.sha1(_url_key(url)).hexdigest()[:12]


def norm_name(name):
    s = (name or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    words = s.split()
    if words and words[0] == "the": words = words[1:]
    while words and words[-1] in SUFFIX: words = words[:-1]
    return " ".join(words)


NEG_CLEAR = re.compile(r"no (?:security |secret )?clearance(?: is)? (?:required|needed)|clearance (?:is )?not (?:required|needed)|does not require (?:a |any )?(?:security )?clearance|no polygraph(?: is)? required")
STRONG = re.compile(r"\bactive (?:secret|top secret|ts|ts/sci|security clearance|clearance)|\bcurrent (?:secret |top secret |security )?clearance|must (?:possess|hold|have) (?:an? )?(?:active )?(?:secret|top secret|ts|security clearance|clearance)|(?:security )?clearance (?:is )?required|required clearance|polygraph (?:is )?required")
LEVEL = re.compile(r"top secret|ts ?/{1,2} ?sci|\bsecret clearance|\bsecurity clearance|\bpolygraph")
SPONSOR = re.compile(r"(?:ability|able|eligible|eligibility) to obtain[^.;]{0,40}(?:clearance|secret|\bts\b|public trust)|will sponsor[^.;]{0,30}clearance|clearance sponsorship|obtain and maintain[^.;]{0,30}(?:clearance|secret|public trust)")


def classify_clearance(text):
    t = (text or "").lower()
    neg = bool(NEG_CLEAR.search(t)); rest = NEG_CLEAR.sub(" ", t)
    if STRONG.search(rest): return "required"
    if SPONSOR.search(rest): return "sponsor"
    if LEVEL.search(rest): return "required"
    if "public trust" in rest: return "sponsor"  # an employer-run investigation: not 'no clearance'
    if neg or _any(rest, KW["clearance"]["none"]): return "none"
    return "unknown"


SENIOR_TITLE = re.compile(r"^(?!senior (?:center|citizen|services|living|care)\b)(?!lead (?:poisoning|abatement|paint)\b)(?:senior|sr\.?|principal|chief|lead)\b|\b(?:senior|sr\.?|principal|lead) (?:analyst|associate|specialist|engineer|consultant|manager|advisor|adviser|officer|researcher|scientist|developer|counsel|fellow|editor|writer|planner|coordinator|accountant|auditor)\b|\b(?:director|manager|vice president|vp|head of)\b")
YEARS = re.compile(r"(?:minimum of |at least )?(\d{1,2})\s*(?:\+|-\s*\d{1,2}|to \d{1,2})?\s*(?:or more )?years?")


def classify_entry(title, text):
    ti, tx, e = (title or "").lower(), (text or "").lower(), KW["entry"]
    if SENIOR_TITLE.search(ti) or re.search(r"not (?:an? )?entry[- ]level", tx): return "no"
    yrs = [int(m.group(1)) for m in YEARS.finditer(tx)]
    if yrs and max(yrs) >= 5: return "no"
    if _any(ti, e["yes_title"]) or _any(tx, e["yes_text"]) or (yrs and max(yrs) <= 1 and "0" in [m.group(1) for m in YEARS.finditer(tx)]): return "yes"
    if yrs: return "maybe"
    return "unknown"


def _meters(a_lat, a_lon, b_lat, b_lon):
    kx = 111320 * math.cos(math.radians((a_lat + b_lat) / 2))
    return math.hypot((a_lon - b_lon) * kx, (a_lat - b_lat) * 110574)


GENERIC = {"solutions", "services", "group", "associates", "consulting", "technologies", "technology", "systems", "international", "partners", "global",
           "management", "center", "centre", "institute", "institution", "company", "national", "american", "research", "policy", "government", "county",
           "office", "foundation", "association", "agency", "department", "federal", "virginia", "washington", "northern", "strategies", "strategic"}


def _ll(o):
    return (o["lat"], o["lon"]) if isinstance(o.get("lat"), (int, float)) and isinstance(o.get("lon"), (int, float)) else None


def match_employer(job, employers):
    """spec 4.5: exact normalized name, then alias, then within 150 m plus a shared distinctive word. Ambiguous -> None."""
    jn = norm_name(job.get("employer"))
    if not jn: return None
    loc = job.get("loc") or {}; jl = _ll(loc)
    place = (loc.get("text") or "").split(",")[0].strip().lower()
    exact = [e for e in employers if norm_name(e.get("name")) == jn]
    alias = [e for e in employers if jn in {norm_name(a) for a in e.get("aliases", [])}]
    for cands in (exact, alias):
        if len(cands) == 1: return cands[0]["id"]
        if len(cands) > 1:
            if jl:
                withll = [e for e in cands if _ll(e)]
                if withll: return min(withll, key=lambda e: _meters(jl[0], jl[1], e["lat"], e["lon"]))["id"]
            if place:
                hit = [e for e in cands if place in (e.get("addr") or "").lower() or place in (e.get("name") or "").lower()]
                if len(hit) == 1: return hit[0]["id"]
            return None  # several offices and nothing says which: do not guess
    if jl:
        jw = {w for w in jn.split() if len(w) >= 4 and w not in GENERIC}
        for e in employers:
            el = _ll(e)
            if el and jw and _meters(jl[0], jl[1], el[0], el[1]) <= 150 and jw & {w for w in norm_name(e.get("name")).split() if len(w) >= 4}:
                return e["id"]
    return None


def parse_posted(text, today):
    t = (text or "").strip().lower()
    if not t: return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", t): return t
    if "30+" in t: return None
    if "just posted" in t or "today" in t or re.search(r"\d+\s*(hour|minute)s?\s+ago", t): return today.isoformat()
    m = re.search(r"(\d+)\s*(day|week)s?\s+ago", t)
    if m:
        n = int(m.group(1)) * (7 if m.group(2) == "week" else 1)
        return (today - timedelta(days=n)).isoformat()
    return None
