import unittest
from apply_batch import plan_writes

T = "2026-11-10"


class W(unittest.TestCase):
    def test_keeps_status(self):
        ex = [{"id": "a", "title": "Old", "status": "saved", "firstSeen": "2026-11-01", "lastSeen": "2026-11-01"}]
        out = plan_writes(ex, [{"id": "a", "title": "New title", "status": "new"}], T)
        j = out["set"][0]
        self.assertEqual((j["status"], j["firstSeen"], j["lastSeen"], j["title"]), ("saved", "2026-11-01", T, "New title"))
        self.assertEqual(out["counts"], {"new": 0, "updated": 1, "removed": 0})

    def test_new_gets_dates(self):
        j = plan_writes([], [{"id": "b", "title": "X"}], T)["set"][0]
        self.assertEqual((j["status"], j["firstSeen"], j["lastSeen"]), ("new", T, T))

    def test_expires_after_30_days_unless_saved(self):
        old = {"id": "c", "lastSeen": "2026-10-01", "firstSeen": "2026-10-01"}
        self.assertEqual(plan_writes([dict(old, status="new")], [], T)["delete"], ["c"])
        self.assertEqual(plan_writes([dict(old, status="saved")], [], T)["delete"], [])
        self.assertEqual(plan_writes([dict(old, status="applied")], [], T)["delete"], [])
        # a dismissed job is kept as a marker so it can never come back as "new"
        self.assertEqual(plan_writes([dict(old, status="dismissed")], [], T)["delete"], [])
        self.assertEqual(plan_writes([dict(old, status="new", lastSeen="2026-10-20")], [], T)["delete"], [])

    def test_dismissed_untouched(self):
        ex = [{"id": "d", "status": "dismissed", "lastSeen": "2026-09-01", "firstSeen": "2026-09-01"}]
        out = plan_writes(ex, [{"id": "d", "title": "Still live"}], T)
        self.assertEqual((out["set"], out["delete"]), ([], []))

    def test_duplicate_incoming_merged(self):
        out = plan_writes([], [{"id": "e", "title": "A"}, {"id": "e", "title": "A", "pay": "$20/hr"}], T)
        self.assertEqual(len(out["set"]), 1); self.assertEqual(out["set"][0]["pay"], "$20/hr")
        self.assertEqual(out["counts"]["new"], 1)

    def test_incoming_cannot_set_status(self):
        j = plan_writes([{"id": "f", "status": "applied", "firstSeen": T, "lastSeen": T}], [{"id": "f", "status": "dismissed"}], T)["set"][0]
        self.assertEqual(j["status"], "applied")


if __name__ == "__main__":
    unittest.main()
