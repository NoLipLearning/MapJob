"""Deterministic "chance you get hired" score (v5, replaces spec 4.4):
fit = round(100 * (0.10*topic + 0.30*entry + 0.20*clearance + 0.20*pay + 0.20*commute))
topic is a small bonus for Eric's interests; the job does not have to match his degree. pay: >= $50k 1, not listed .5, under $50k 0."""
import re

W = {"role": .10, "entry": .30, "clearance": .20, "pay": .20, "commute": .20}
ENTRY = {"yes": 1, "maybe": .6, "unknown": .4, "no": 0}
CLEAR = {"none": 1, "sponsor": .7, "unknown": .5, "required": 0}
ENTRY_WHY = {"yes": "Entry level", "maybe": "Asks for some experience", "unknown": "Experience level not stated", "no": "Asks for more experience"}
CLEAR_WHY = {"none": "No clearance needed", "sponsor": "Clearance can be sponsored", "unknown": "Clearance not stated", "required": "Needs an active clearance"}


def commute_score(minutes):
    for limit, s in ((15, 1), (25, .8), (35, .6), (45, .4), (60, .2)):
        if minutes <= limit: return s
    return 0


def estimate_minutes(miles):
    return miles * 2.4


def _has(text, term):
    return re.search(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])", text) is not None


def score(job, profile, minutes):
    terms = [t.lower().strip() for t in (profile or {}).get("keywords_for_job_matching", []) + (profile or {}).get("target_roles_implied", []) if t and t.strip()]
    title, desc = (job.get("title") or "").lower(), (job.get("desc") or job.get("summary") or "").lower()
    in_title = [t for t in terms if _has(title, t)]
    in_desc = [t for t in terms if _has(desc, t)]
    role = min(1, (2 * len(in_title) + len(in_desc)) / max(4, len(terms))) if terms else 0
    entry = ENTRY.get(job.get("entry"), ENTRY["unknown"])
    clear = CLEAR.get(job.get("clearance"), CLEAR["unknown"])
    commute = commute_score(minutes) if minutes is not None else .5
    pm = job.get("payMin")
    pay = .5 if pm is None else (1 if pm >= 50000 else 0)
    fit = round(100 * (W["role"] * role + W["entry"] * entry + W["clearance"] * clear + W["pay"] * pay + W["commute"] * commute))
    role_why = ("Title matches '" + in_title[0] + "'") if in_title else ("Mentions " + ", ".join(in_desc[:2])) if in_desc else "Few matches with your background"
    reasons = [(W["role"] * role, role_why[:85]),
               (W["entry"] * entry, ENTRY_WHY.get(job.get("entry"), ENTRY_WHY["unknown"])),
               (W["clearance"] * clear, CLEAR_WHY.get(job.get("clearance"), CLEAR_WHY["unknown"])),
               (W["pay"] * pay, "Pays $50k or more" if pay == 1 else "Pay not listed" if pm is None else "Pays under $50k"),
               (W["commute"] * commute, ("About %d min drive" % round(minutes)) if minutes is not None else "Drive time unknown")]
    reasons.sort(key=lambda r: -r[0])
    return fit, [r[1] for r in reasons[:3]]
