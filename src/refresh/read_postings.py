"""Read every posting (spec docs/superpowers/specs/2026-11-22-read-postings-apply-list-design.md).
Fetch full posting text (USAJOBS / Greenhouse / Lever over HTTP; Indeed text given by the Claude session), cache it,
extract facts that the text states, label each job likely / stretch / long shot, and write reads.json = [{id, patch}].
Never invents: a fact the text does not state stays null. Never patches status or firstSeen.
USAJOBS needs USAJOBS_KEY and USAJOBS_EMAIL in the environment (never stored)."""
import hashlib, json, os, re, urllib.error, urllib.parse, urllib.request
from datetime import date, datetime

from normalize import classify_clearance
from feeds import to_text

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "posting_cache")
UA = "mapjob-read/1.0"


# ---------- fetching ----------

def _get_json(url, headers=None):
    req = urllib.request.Request(url, headers=dict({"User-Agent": UA, "Accept": "application/json"}, **(headers or {})))
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def source_ref(job):
    """Where the full posting lives, from the ids the pipeline already stores."""
    jid, src, board = job.get("id") or "", job.get("source") or "", job.get("board") or ""
    if jid.startswith("usajobs-"): return {"kind": "usajobs", "control": jid[len("usajobs-"):]}
    if jid.startswith("greenhouse-") and board.startswith("greenhouse:"):
        return {"kind": "greenhouse", "token": board.split(":", 1)[1], "job": jid[len("greenhouse-"):]}
    if jid.startswith("lever-") and board.startswith("lever:"):
        return {"kind": "lever", "company": board.split(":", 1)[1], "job": jid[len("lever-"):]}
    if src == "indeed" or jid.startswith("indeed-"): return {"kind": "indeed"}
    return {"kind": "other"}


def _day(v):
    return v[:10] if isinstance(v, str) and re.match(r"\d{4}-\d\d-\d\d", v) else None


def _join(*parts):
    out = []
    for p in parts:
        if isinstance(p, list): out.extend(to_text(x) for x in p if x)
        elif p: out.append(to_text(p))
    return "\n".join(x.strip() for x in out if x and x.strip())


def fetch_text(ref, key, email):
    """{'text', 'applyUrl', 'deadline'} from the source, or None on any failure (the caller keeps the job as title-only)."""
    try:
        k = ref.get("kind")
        if k == "usajobs":
            if not key or not email: return None
            d = _get_json("https://data.usajobs.gov/api/search?" + urllib.parse.urlencode({"ControlNumber": ref["control"]}),
                          {"Host": "data.usajobs.gov", "User-Agent": email, "Authorization-Key": key})
            items = (d.get("SearchResult") or {}).get("SearchResultItems") or []
            if not items: return None
            m = items[0]["MatchedObjectDescriptor"]; det = (m.get("UserArea") or {}).get("Details") or {}
            text = _join(det.get("JobSummary"), det.get("MajorDuties"), m.get("QualificationSummary"), det.get("Requirements"),
                         det.get("Education"), "Security clearance: " + det["SecurityClearance"] if det.get("SecurityClearance") else None, det.get("HowToApply"))
            apply = (m.get("ApplyURI") or [None])[0] or m.get("PositionURI")
            return {"text": text, "applyUrl": apply, "deadline": _day(m.get("ApplicationCloseDate"))}
        if k == "greenhouse":
            d = _get_json("https://boards-api.greenhouse.io/v1/boards/%s/jobs/%s?content=true" % (ref["token"], ref["job"]))
            return {"text": to_text(d.get("content")), "applyUrl": d.get("absolute_url"), "deadline": None}
        if k == "lever":
            d = _get_json("https://api.lever.co/v0/postings/%s/%s" % (ref["company"], ref["job"]))
            lists = [(x.get("text") or "") + "\n" + to_text(x.get("content") or "") for x in d.get("lists") or []]
            return {"text": _join(d.get("descriptionPlain"), lists, d.get("additionalPlain")), "applyUrl": d.get("applyUrl") or d.get("hostedUrl"), "deadline": None}
    except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError):
        return None
    return None


# ---------- cache ----------

def cache_path(job_id):
    return os.path.join(CACHE, re.sub(r"[^A-Za-z0-9_.-]", "_", job_id) + ".txt")


def cache_put(job_id, text):
    os.makedirs(CACHE, exist_ok=True)
    with open(cache_path(job_id), "w") as f: f.write(text)
    return hashlib.sha1(text.encode()).hexdigest()


def cache_get(job_id):
    p = cache_path(job_id)
    return open(p).read() if os.path.exists(p) else None


# ---------- extraction ----------

MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"], 1)}
YRS = re.compile(r"(?:minimum of |at least |requires? )?(\d{1,2})\s*(?:\+|(?:-|–|to)\s*\d{1,2})?\s*(?:or more |plus )?years?(?:'|’)?\s+(?:of\s+)?(?:\w+\s+){0,3}?(?:experience|exp\b)", re.I)
NO_EXP = re.compile(r"\bno (?:prior |previous )?(?:work )?experience (?:is )?(?:required|necessary|needed)\b|\b0 years\b", re.I)
SPECIALIST = re.compile(r"\b(?:bachelor'?s?|b\.?s\.?|degree)\b[^.]{0,40}\b(?:nursing|engineering|computer science|accounting|chemistry|physics|biology|pharmacy|architecture|mathematics)\b", re.I)
DEG = [("doctorate", re.compile(r"\b(?:ph\.?d|doctorate|doctoral|j\.?d\.?|juris doctor)\b", re.I)),
       ("master", re.compile(r"\bmaster'?s?\b|\bm\.?b\.?a\b|\bm\.?p\.?p\b", re.I)),
       ("bachelor", re.compile(r"\bbachelor'?s?\b|\bb\.?a\.?/b\.?s\b|\bundergraduate degree\b|\bfour-year degree\b|\b4-year degree\b|\bcollege degree\b", re.I))]
NO_DEG = re.compile(r"\bno (?:college )?degree (?:is )?required\b|\bhigh school diploma or (?:equivalent|ged)\b", re.I)
PREF = re.compile(r"\b(?:preferred|a plus|desired|nice to have)\b", re.I)
ACTIVE = re.compile(r"\b(?:active|current)\s+(?:\w+\s+){0,3}?(?:clearance|ts/sci|top secret|secret)\b|\bclearance required (?:at|prior to|before) (?:start|hire)\b|\bmust (?:currently )?(?:hold|possess|have) an? (?:active |current )?(?:ts/sci|top secret|secret)", re.I)
LICENCE = re.compile(r"\b(?:license|licence|licensure|certified public accountant|\bcpa\b|bar admission|admitted to (?:the|a) bar|registered nurse|\brn\b)\b[^.]{0,30}\brequired\b|\bmust (?:hold|have|possess) an? (?:active |valid )?(?:\w+ ){0,2}(?:license|licence)\b", re.I)
DATE_TXT = re.compile(r"\b(?:close[sd]?|closing|deadline|apply by|applications? (?:are )?due|due by|no later than)\b[^.\n]{0,30}?\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})", re.I)
DATE_NUM = re.compile(r"\b(?:close[sd]?|closing|deadline|apply by|due by|no later than)\b[^.\n]{0,30}?\b(\d{1,2})/(\d{1,2})/(\d{4})\b", re.I)


def _sentences_with(rx, text):
    return [s for s in re.split(r"(?<=[.;\n])\s+", text) if rx.search(s)]


def extract(text, today):
    t = text or ""
    yrs = [int(m.group(1)) for m in YRS.finditer(t)]
    years = min(yrs) if yrs else (0 if NO_EXP.search(t) else None)
    degree = None
    if NO_DEG.search(t): degree = "none"
    else:
        req = [(name, rx) for name, rx in DEG]
        hits = []
        for name, rx in req:
            for s in _sentences_with(rx, t):
                hits.append((name, bool(PREF.search(s)) and not re.search(r"\brequired\b", s, re.I)))
        required = [n for n, pref in hits if not pref]
        if required:
            order = ["bachelor", "master", "doctorate"]
            degree = min(required, key=order.index)  # the lowest level the posting requires
        elif hits:
            degree = min((n for n, _ in hits), key=["bachelor", "master", "doctorate"].index)
        if degree == "bachelor" and SPECIALIST.search(t): degree = "specialist"
    cl = classify_clearance(t)
    active = bool(ACTIVE.search(t)) and cl == "required"
    deadline = None
    m = DATE_TXT.search(t)
    if m:
        try: deadline = date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2))).isoformat()
        except ValueError: deadline = None
    else:
        m = DATE_NUM.search(t)
        if m:
            try: deadline = date(int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat()
            except ValueError: deadline = None
    return {"years": years, "degree": degree, "clearance": cl, "active_at_hire": active, "deadline": deadline, "licence": bool(LICENCE.search(t))}
