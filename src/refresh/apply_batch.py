"""Plan the db writes for a refresh (spec 4.1 rules). Pure: no I/O."""
from datetime import date

KEEP = ("status", "firstSeen")
EMPTY = (None, "", [])


def _fold(dst, src, skip=()):
    """Copy src into dst: a non-empty value always wins; an empty one only fills a key dst does not have yet."""
    for k, v in src.items():
        if k in skip: continue
        if v not in EMPTY or k not in dst: dst[k] = v
    return dst


def _days(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def plan_writes(existing, incoming, today):
    ex = {j["id"]: j for j in existing}
    merged = {}
    for j in incoming:  # merge duplicates inside one refresh; later non-empty fields win
        _fold(merged.setdefault(j["id"], {}), j)
    out, counts = [], {"new": 0, "updated": 0, "removed": 0}
    for jid, j in merged.items():
        old = ex.get(jid)
        if old and old.get("status") == "dismissed":
            continue  # Eric dismissed it: never rewrite
        if old:
            rec = _fold(dict(old), j, KEEP); rec["lastSeen"] = today
            counts["updated"] += 1
        else:
            rec = dict(j); rec["status"] = "new"; rec["firstSeen"] = rec["lastSeen"] = today
            counts["new"] += 1
        out.append(rec)
    delete = [jid for jid, j in ex.items()
              if jid not in merged and j.get("status") not in ("saved", "applied", "dismissed")
              and j.get("lastSeen") and _days(j["lastSeen"], today) > 30]
    counts["removed"] = len(delete)
    return {"set": out, "delete": delete, "counts": counts}
