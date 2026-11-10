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


def _url_key(url):
    p = urlsplit(url.strip())
    return (p.netloc.lower() + p.path.rstrip("/")).encode()


def job_id(source, raw):
    url = raw.get("url") or ""
    if source == "indeed" and raw.get("job_id"):
        return "indeed-" + str(raw["job_id"])
    if source == "usajobs" and raw.get("control"):
        return "usajobs-" + str(raw["control"])
    if source == "linkedin":
        m = re.search(r"/jobs/view/(\d+)", url)
        if m: return "linkedin-" + m.group(1)
    if source == "handshake":
        m = re.search(r"/(?:jobs|postings)/(\d+)", url)
        if m: return "handshake-" + m.group(1)
    return "web-" + hashlib.sha1(_url_key(url)).hexdigest()[:12]


def norm_name(name):
    s = (name or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    words = s.split()
    if words and words[0] == "the": words = words[1:]
    while words and words[-1] in SUFFIX: words = words[:-1]
    return " ".join(words)


def classify_clearance(text):
    t = (text or "").lower()
    c = KW["clearance"]
    if _any(t, c["required"]): return "required"
    if _any(t, c["sponsor"]): return "sponsor"
    if _any(t, c["none"]): return "none"
    return "unknown"


def classify_entry(title, text):
    ti, tx, e = (title or "").lower(), (text or "").lower(), KW["entry"]
    if _any(ti, e["no_title"]) or _any(tx, e["no_text"]): return "no"
    if _any(ti, e["yes_title"]) or _any(tx, e["yes_text"]): return "yes"
    if _any(tx, e["maybe_text"]): return "maybe"
    return "unknown"


def _meters(a_lat, a_lon, b_lat, b_lon):
    kx = 111320 * math.cos(math.radians((a_lat + b_lat) / 2))
    return math.hypot((a_lon - b_lon) * kx, (a_lat - b_lat) * 110574)


def match_employer(job, employers):
    """spec 4.5: exact normalized name, then alias, then within 150 m plus a shared word of 4+ letters."""
    jn = norm_name(job.get("employer"))
    loc = job.get("loc") or {}
    has_ll = isinstance(loc.get("lat"), (int, float)) and isinstance(loc.get("lon"), (int, float))
    if jn:
        exact = [e for e in employers if norm_name(e.get("name")) == jn]
        alias = [e for e in employers if jn in {norm_name(a) for a in e.get("aliases", [])}]
        for cands in (exact, alias):
            if cands:
                if len(cands) > 1 and has_ll:
                    cands = sorted(cands, key=lambda e: _meters(loc["lat"], loc["lon"], e["lat"], e["lon"]))
                return cands[0]["id"]
    if has_ll and jn:
        jw = {w for w in jn.split() if len(w) >= 4}
        for e in employers:
            if _meters(loc["lat"], loc["lon"], e["lat"], e["lon"]) <= 150 and jw & {w for w in norm_name(e.get("name")).split() if len(w) >= 4}:
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
