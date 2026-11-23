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
            d = _get_json("https://data.usajobs.gov/api/search?" + urllib.parse.urlencode({"Keyword": ref["control"]}),
                          {"Host": "data.usajobs.gov", "User-Agent": email, "Authorization-Key": key})
            items = [x for x in (d.get("SearchResult") or {}).get("SearchResultItems") or [] if str(x.get("MatchedObjectId")) == ref["control"]]
            if not items: return None  # never use another announcement's text
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
YRS = re.compile(r"(\d{1,2})\s*(?:\+|(?:-|–|to)\s*\d{1,2})?\s*(?:or more |plus )?years?(?:'|’)?\s+(?:of\s+)?(?:\w+\s+){0,3}?(?:experience|exp\b)", re.I)
NO_EXP = re.compile(r"\bno (?:prior |previous )?(?:work )?experience (?:is )?(?:required|necessary|needed)\b|\b0 years\b", re.I)
SOFT = re.compile(r"\b(?:preferred|a plus|is a plus|desired|desirable|nice to have|ideally|bonus)\b", re.I)
HISTORY = re.compile(r"\b(?:over|more than|nearly|almost|up to)\s+$", re.I)  # "With over 25 years of experience serving..." (the company)
SPEC_FIELD = re.compile(r"\b(?:nursing|engineering|computer science|accounting|chemistry|physics|biology|pharmacy|architecture|mathematics)\b", re.I)
DEG = [("doctorate", re.compile(r"\bph\.?\s?d\b|\bdoctorate\b|\bdoctoral degree\b|\bjuris doctor\b|\bj\.d\.(?=[\s,;)]|$)", re.I)),
       ("master", re.compile(r"\bmaster(?:'|’)s\b|\bmasters degree\b|\bmaster of (?:arts|science|public|business)\b|\bm\.?b\.?a\b|\bm\.p\.p\b", re.I)),
       ("bachelor", re.compile(r"\bbachelor'?s?\b|\bundergraduate degree\b|\bfour-year degree\b|\b4-year degree\b|\bcollege degree\b", re.I))]
NO_DEG = re.compile(r"\bno (?:college )?degree (?:is )?required\b|\bhigh school diploma or (?:equivalent|ged)\b", re.I)
REQ = re.compile(r"\b(?:required|requires?|must|minimum|at least|need|qualif)", re.I)
ACTIVE = re.compile(r"\b(?:active|current)\s+(?:\w+\s+){0,3}?(?:clearance|ts/sci|top secret|secret)\b|\bclearance required (?:at|prior to|before) (?:start|hire)\b|\bmust (?:currently )?(?:hold|possess|have) an? (?:active |current )?(?:ts/sci|top secret|secret)", re.I)
OBTAIN = re.compile(r"\b(?:or (?:the )?(?:ability|able) to obtain|or be eligible|or eligib|ability to obtain|able to obtain)\b", re.I)
CLEAR_WORD = re.compile(r"\b(?:clearance|ts/sci|top secret|secret)\b", re.I)
LIC_WORD = re.compile(r"\b(?:license|licence|licensure|licensed|certified public accountant|cpa|bar admission|admitted to (?:the|a) bar|registered nurse)\b", re.I)
DATE_TXT = re.compile(r"\b(?:closing date|close date|deadline(?: to apply)?|apply by|applications? (?:are |is )?(?:due|accepted through|accepted until)|applications? (?:will )?close(?:s)?(?: on)?|due by|no later than|open (?:through|until))\s*:?\s*(?:on\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})", re.I)
DATE_NUM = re.compile(r"\b(?:closing date|close date|deadline|apply by|due by|no later than|open (?:through|until))\s*:?\s*(?:on\s+)?(\d{1,2})/(\d{1,2})/(\d{4})\b", re.I)


WORDNUM = {w: str(i) for i, w in enumerate(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"])}
HEAD_WORD = re.compile(r"\b(?:qualifications?|requirements?|skills|education|experience|responsibilities|duties|benefits|about (?:you|the|us)|what you|who you|you have|you bring|nice to have|bonus|preferred|desired|helpful|pluses)\b", re.I)
SOFT_HEAD = re.compile(r"\b(?:helpful|preferred|nice to have|bonus|desired|desirable|a plus|pluses|ideally)\b", re.I)
YRS_ANY = re.compile(r"(\d{1,2})\s*(?:\+|(?:-|–|to)\s*\d{1,2})?\s*years?\s+(?:of|with|in)\s+(?!age\b|earning|graduat|complet|service|study|studies|college|school|education|employment with|tour)[a-z]", re.I)
YRS_LIST = re.compile(r"(?:^|:)\s*(\d{1,2})\+?\s*years?\s*\(required\)", re.I)  # Indeed: "Coding: 1 year (Required)"


def _normalize(text):
    """Digits for number words, drop "(one)" after a digit, and mark lines under a "helpful/preferred" heading as preferred."""
    t = text or ""
    for _ in range(2):  # twice, so "Zero to two years" becomes "0 to 2 years"
        t = re.sub(r"\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b(?=\s*(?:\+|(?:-|–|to)\s*\d+)?\s*(?:\(\d+\)\s*)?years?\b)", lambda m: WORDNUM[m.group(1).lower()], t, flags=re.I)
    t = re.sub(r"(\d)\s*\((?:zero|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\)", r"\1", t, flags=re.I)
    out, soft = [], False
    for line in t.split("\n"):
        s = line.strip(); head = s.endswith(":") or (0 < len(s) < 60 and not s.endswith(".") and bool(HEAD_WORD.search(s)) and not re.search(r"\d", re.sub(r"^[IVX\d]+\.\s*", "", s)))
        if head and SOFT_HEAD.search(s): soft = True; out.append(line); continue
        if head: soft = False
        out.append("(preferred) " + line if soft and s else line)
    return "\n".join(out)


def _sentences(text):
    raw = [s for s in re.split(r"(?<=[.;!?:\n])\s+|\n+|•", text or "") if s.strip()]
    out, soft = [], 0  # sentences after a "helpful/preferred ...:" heading are preferred until the next heading (at most 6)
    for s in raw:
        st = s.strip()
        if st.endswith(":"):
            soft = 6 if SOFT_HEAD.search(st) else 0; out.append(s); continue
        if soft and not SOFT.search(st): out.append(s + " (preferred)"); soft -= 1; continue
        out.append(s)
    return out


SUBST = re.compile(r"\b(?:may satisfy|in lieu of|substitut\w*|in place of|equivalent combination|may be accepted instead)\b", re.I)
ALT_PATH = re.compile(r"\bbachelor.{0,80}\bor\b.{0,40}\b(?:high school|diploma|ged)\b", re.I)  # "Bachelor's or HS diploma and 4 years": years belong to the no-degree path


def _years(sents):
    found = []
    for s in sents:
        if SOFT.search(s) or SUBST.search(s) or ALT_PATH.search(s): continue
        ms = [m for rx in (YRS, YRS_LIST, YRS_ANY) for m in rx.finditer(s) if not HISTORY.search(s[:m.start()][-25:]) and int(m.group(1)) <= 15]
        ms = sorted({m.start(1): m for m in ms}.values(), key=lambda m: m.start())
        if not ms: continue
        b = re.search(r"\bbachelor", s, re.I)
        if len(ms) > 1 and b:  # "Bachelor's with 2 years, or Master's with 0 years": the bachelor's path is Eric's
            after = [m for m in ms if m.start() > b.start()]
            ms = after[:1] or ms
            found.append(int(ms[0].group(1))); continue
        found.append(min(int(m.group(1)) for m in ms))  # one sentence = one requirement (a range or options): its low end
    return max(found) if found else None  # separate requirements all apply: the largest is the bar


def _degree(sents, text):
    hits = []
    for s in sents:
        for name, rx in DEG:
            if rx.search(s): hits.append((name, s))
    req = [(n, s) for n, s in hits if not SOFT.search(s) or REQ.search(s)]
    if not req: return "none" if NO_DEG.search(text) else None
    order = ["bachelor", "master", "doctorate"]
    name, sent = min(req, key=lambda x: order.index(x[0]))
    if name == "bachelor":
        for n, s in req:
            if n == "bachelor" and SPEC_FIELD.search(s) and not re.search(r"\bor\b|related field|such as|including|,", s, re.I):
                return "specialist"
    return name


def _clearance(sents, text):
    if re.search(r"\bclearance(?: type| level| requirements?)?\s*:\s*(?:none|not required|n/?a)\b", text, re.I): return "none", False
    cl = classify_clearance(text)
    cs = [s for s in sents if CLEAR_WORD.search(s)]
    if cl in ("required", "sponsor") and cs and all(SOFT.search(s) and not REQ.search(s) for s in cs): return "preferred", False
    active = any(ACTIVE.search(s) and not SOFT.search(s) and not OBTAIN.search(s) for s in cs) and cl == "required"
    return cl, active


def _licence(sents):
    for s in sents:
        if LIC_WORD.search(s) and not re.search(r"driver", s, re.I) and not SOFT.search(s) and (REQ.search(s) or re.search(r"\bcpa\b|registered nurse|bar admission|admitted to", s, re.I)):
            return True
    return False


def _deadline(text):
    m = DATE_TXT.search(text or "")
    if m and not re.search(r"extended from\s*$", (text or "")[:m.start(1)][-20:], re.I):
        try: return date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2))).isoformat()
        except ValueError: return None
    m = DATE_NUM.search(text or "")
    if m:
        try: return date(int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat()
        except ValueError: return None
    return None


FED_LADDER = re.compile(r"\bspecialized experience\b|\b(?:GS|GL)-?\s?\d{1,2}\b|\bcombination of (?:education and experience|experience and education)\b|\bmay (?:be )?substitut", re.I)
BG_CHECK = re.compile(r"\b(?:background investigation|background check|suitability (?:determination|investigation)|public trust)\b", re.I)
FED_ALT = re.compile(r"\byears?\b|semester|credit hours|\bdegree\b|\beducation\b|\bgpa\b|\bgrade\b|\bgs-|\bgl-", re.I)


def fed_musts(musts):
    """Federal must-haves: drop items that are one of several alternative ways to qualify (years, credit hours, degrees)."""
    return [m for m in (musts or []) if not FED_ALT.search(m)]


def extract(text, today):
    t = _normalize(text); sents = _sentences(t)
    fed = bool(FED_LADDER.search(t))  # federal qualification ladder: experience OR education, by grade; no single number is honest
    years = None if fed else _years(sents)
    if years is None and not fed and NO_EXP.search(t): years = 0
    cl, active = _clearance(sents, t)
    if cl in ("none", "unknown") and BG_CHECK.search(t): cl = "sponsor"
    return {"years": years, "degree": None if fed else _degree(sents, t), "clearance": cl, "active_at_hire": active, "deadline": _deadline(t), "licence": _licence(sents), "federal": fed}


# ---------- labels ----------

def can_get(read):
    """likely / stretch / long shot for a recent grad with a bachelor's, no clearance, open to sponsored clearance. Unknown = no barrier."""
    r = read or {}
    years, deg, cl = r.get("years"), r.get("degree"), r.get("clearance")
    long_, stretch = [], []
    if isinstance(years, int) and years >= 3: long_.append("%d+ years of experience required" % years)
    if cl == "required" and r.get("activeAtHire"): long_.append("an active clearance is required at hire")
    if deg in ("master", "doctorate"): long_.append("a %s's degree is required" % deg if deg == "master" else "a doctorate is required")
    if r.get("licence"): long_.append("a professional licence is required")
    if years == 2: stretch.append("2 years of experience required")
    if deg == "specialist": stretch.append("a specialist degree is required")
    if r.get("federal") and not long_ and not stretch:
        return {"label": "likely", "why": "Federal posting: qualify with experience or education at the listed grade (check the posting)"}
    unknown = [w for k, w in (("years", "experience not stated"), ("degree", "degree not stated"), ("clearance", "clearance not stated")) if r.get(k) in (None, "unknown")]
    tail = (" (" + ", ".join(unknown) + ")") if unknown else ""
    if long_: return {"label": "long shot", "why": "; ".join(long_).capitalize() + tail}
    if stretch: return {"label": "stretch", "why": "; ".join(stretch).capitalize() + tail}
    return {"label": "likely", "why": ("Nothing in the posting rules you out" if r.get("from") != "title" else "Posting not read yet") + tail}


def _norm(s):
    return re.sub(r"\s+", " ", (s or "").lower().replace("’", "'")).strip()


def musts_ok(musts, text):
    t = _norm(text)
    return [m for m in (musts or []) if m and _norm(m) in t][:3]


HOW = {"usajobs": "usajobs", "greenhouse": "employer site", "lever": "employer site", "indeed": "indeed"}
ALERT_SOURCES = ("linkedin", "handshake", "web", "careers")


def build_reads(existing, fetched, plain, indeed_text, today):
    """[{id, patch: {read, canGet}, version?}] for jobs whose read is new or changed. Never touches status/firstSeen."""
    out = []
    for j in existing:
        jid = j.get("id")
        if not jid: continue
        ref = source_ref(j); kind = ref["kind"]; old = j.get("read") or {}
        text, src_from, fx = None, "title", None
        if kind == "indeed":
            if old.get("from") == "posting": continue
            if indeed_text.get(jid): text, src_from = indeed_text[jid], "posting"
        elif kind in ("usajobs", "greenhouse", "lever"):
            if jid in fetched:
                fx = fetched[jid]
                if fx and fx.get("text"): text, src_from = fx["text"], "posting"
                elif old.get("from") == "posting": continue  # a failed fetch never wipes a good read
            elif old: continue  # not attempted this run: keep what we have
        if text is None and (j.get("pasted") or j.get("summary")) and (str(j.get("source") or "").split("-")[-1] in ALERT_SOURCES or str(j.get("source", "")).startswith("saved")):
            text, src_from = j.get("pasted") or j.get("summary"), "alert"
        h = hashlib.sha1(text.encode()).hexdigest() if text else None
        p = plain.get(jid) or {}
        if old and h and old.get("hash") == h and not p: continue
        if old and not h and old.get("from") == "title" and j.get("canGet"): continue
        ex = extract(text, today) if text else {}
        what = p.get("what") if text else None
        read = {"at": today.isoformat(), "from": src_from,
                "what": (what or old.get("what") if old.get("hash") == h else what) or None,
                "musts": (fed_musts(musts_ok(p.get("musts"), text)) if ex.get("federal") else musts_ok(p.get("musts"), text)) if text else [],
                "years": ex.get("years"), "degree": ex.get("degree"), "clearance": ex.get("clearance"),
                "activeAtHire": bool(ex.get("active_at_hire")), "licence": bool(ex.get("licence")), "federal": bool(ex.get("federal")),
                "deadline": (fx or {}).get("deadline") or ex.get("deadline") or j.get("deadline"),
                "howApply": HOW.get(kind), "applyUrl": (fx or {}).get("applyUrl") or j.get("url"), "hash": h}
        if not read["musts"] and old.get("hash") == h and old.get("musts"): read["musts"] = old["musts"]
        w = {"id": jid, "patch": {"read": read, "canGet": can_get(read)}}
        if "_version" in j: w["version"] = j["_version"]
        out.append(w)
    return out


# ---------- CLI ----------

def main(argv=None):
    import argparse
    a = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    a.add_argument("--existing", required=True); a.add_argument("--out", required=True)
    a.add_argument("--plain"); a.add_argument("--indeed"); a.add_argument("--fetch", action="store_true"); a.add_argument("--today")
    o = a.parse_args(argv)
    today = date.fromisoformat(o.today) if o.today else date.today()
    existing = json.load(open(o.existing))
    plain = json.load(open(o.plain)) if o.plain else {}
    indeed = json.load(open(o.indeed)) if o.indeed else {}
    key, email = os.environ.get("USAJOBS_KEY", "").strip(), os.environ.get("USAJOBS_EMAIL", "").strip()
    fetched, failed = {}, 0
    for j in existing:
        ref = source_ref(j)
        if ref["kind"] not in ("usajobs", "greenhouse", "lever"): continue
        if o.fetch:
            r = fetch_text(ref, key, email)
            if r and r.get("text"): cache_put(j["id"], json.dumps(r))
            else: failed += 1
            fetched[j["id"]] = r
        else:
            c = cache_get(j["id"])
            if c: fetched[j["id"]] = json.loads(c)
    for jid, t in indeed.items(): cache_put(jid, json.dumps({"text": t, "applyUrl": None, "deadline": None}))
    out = build_reads(existing, fetched, plain, indeed, today)
    json.dump(out, open(o.out, "w"), indent=1)
    froms = {}
    for w in out: froms[w["patch"]["read"]["from"]] = froms.get(w["patch"]["read"]["from"], 0) + 1
    labels = {}
    for w in out: labels[w["patch"]["canGet"]["label"]] = labels.get(w["patch"]["canGet"]["label"], 0) + 1
    need = [{"id": w["id"], "cachePath": cache_path(w["id"])} for w in out if w["patch"]["read"]["from"] == "posting" and not w["patch"]["read"]["what"]]
    json.dump(need, open(os.path.join(os.path.dirname(os.path.abspath(o.out)), "needs_plain.json"), "w"), indent=1)
    print("read %d (posting) / %d (alert) / %d (title), skipped %d unchanged, fetch failures %d" % (
        froms.get("posting", 0), froms.get("alert", 0), froms.get("title", 0), len(existing) - len(out), failed))
    print("labels:", labels, "| need plain-words:", len(need))


if __name__ == "__main__":
    main()
