"""Helpers for the NoVA employer directory (src/directory.json). Spec: docs/superpowers/specs/2026-11-24-more-employers-careers-links-design.md
Record: {id, name, kind, addr, lat, lon, gc, link, linkType, src, via, checked, empId?}. Only gc == "addr" (house-number match) records are placed."""
import hashlib, math, re

SUFFIX = re.compile(r"\b(inc|llc|l l c|corp|corporation|co|company|ltd|lp|llp|pllc|incorporated)\b")
KINDS = {"federal", "state-local", "contractor", "think-tank", "ngo-advocacy", "education-health", "corporate",
         "international", "media", "consulting", "legislative", "polling-research", "party-campaign"}

def norm_name(s):
    """Lower case; drop parenthesised office notes, punctuation, company suffixes and a leading 'the'."""
    s = re.sub(r"\([^)]*\)", " ", (s or "").lower())
    s = re.sub(r"[^a-z0-9 ]+", " ", s.replace("&", " and "))
    s = SUFFIX.sub(" ", s)
    s = re.sub(r"^\s*the\b", " ", s)
    return " ".join(s.split())

def make_id(name, addr):
    slug = "-".join(norm_name(name).split())[:48] or "employer"
    return slug + "-" + hashlib.sha1((addr or "").strip().lower().encode()).hexdigest()[:6]

def clean_link(url):
    u = (url or "").strip()
    return u if re.match(r"^https?://[^\s/]+\.[^\s/]+", u, re.I) else None

def meters(a, b, c, d):
    r = math.radians; dl, dn = r(c - a), r(d - b)
    h = math.sin(dl / 2) ** 2 + math.cos(r(a)) * math.cos(r(c)) * math.sin(dn / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))

def match_emp(rec, emps, m=150):
    """id of a researched employer with the same normalised name within m metres, else None."""
    n = norm_name(rec.get("name"))
    if not n or rec.get("lat") is None: return None
    for e in emps:
        if e.get("lat") is not None and norm_name(e.get("name")) == n and meters(rec["lat"], rec["lon"], e["lat"], e["lon"]) <= m:
            return e["id"]
    return None

def validate(recs):
    errs, seen = [], set()
    for r in recs:
        i = r.get("id")
        if not i or i in seen: errs.append(f"{i}: missing or duplicate id")
        seen.add(i)
        if not r.get("name"): errs.append(f"{i}: no name")
        if not r.get("src"): errs.append(f"{i}: no src")
        if r.get("gc") != "addr" or r.get("lat") is None or r.get("lon") is None: errs.append(f"{i}: not placed at a house number")
        if r.get("link") is not None and clean_link(r["link"]) != r["link"]: errs.append(f"{i}: bad link")
        if r.get("link") and r.get("linkType") not in ("careers", "website"): errs.append(f"{i}: bad linkType")
        if r.get("kind") not in KINDS: errs.append(f"{i}: bad kind {r.get('kind')}")
        if r.get("via") not in ("list", "sam"): errs.append(f"{i}: bad via")
    return errs
