"""Plan the db writes for a refresh (spec 4.1 rules). Pure: no I/O.
New jobs -> `set` (full document). Jobs already in the db -> `update` patches that never include `status` or `firstSeen`,
so a status Eric changes while a refresh runs is never overwritten."""
from datetime import date

KEEP = ("status", "firstSeen")
EMPTY = (None, "", [], "unknown")


def _days(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def _fold(dst, src, skip=()):
    """Copy src into dst: a known value always wins; an empty or 'unknown' one only fills a key dst does not have yet."""
    for k, v in src.items():
        if k in skip: continue
        if v not in EMPTY or k not in dst: dst[k] = v
    return dst


def plan_writes(existing, incoming, today, authoritative=None):
    """authoritative: set of boards ("greenhouse:<token>", "lever:<company>") fetched successfully this run. An existing job whose `board`
    is in it but that is absent from incoming is deleted now, unless its status is saved, applied or dismissed."""
    authoritative = set(authoritative or ())
    ex = {j["id"]: j for j in existing}
    merged = {}
    for j in incoming:  # merge duplicates inside one refresh
        _fold(merged.setdefault(j["id"], {}), j)
    new, update, counts = [], [], {"new": 0, "updated": 0, "removed": 0}
    for jid, j in merged.items():
        old = ex.get(jid)
        if old and old.get("status") == "dismissed":
            continue  # Eric dismissed it: never rewrite
        if old:
            patch = {k: v for k, v in j.items() if k not in KEEP and k != "id" and v not in EMPTY and old.get(k) != v}
            patch["lastSeen"] = today
            update.append({"id": jid, "patch": patch}); counts["updated"] += 1
        else:
            rec = dict(j); rec["status"] = "new"; rec["firstSeen"] = rec["lastSeen"] = today
            for k in ("clearance", "entry"): rec.setdefault(k, "unknown")
            new.append(rec); counts["new"] += 1
    delete = [jid for jid, j in ex.items()
              if jid not in merged and j.get("status") not in ("saved", "applied", "dismissed")
              and ((j.get("board") in authoritative) or (j.get("lastSeen") and _days(j["lastSeen"], today) > 30))]
    counts["removed"] = len(delete)
    return {"set": new, "update": update, "delete": delete, "counts": counts}
