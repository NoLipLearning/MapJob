import unittest
from datetime import date
from build_jobs import build

EMPS = [{"id": "ssa-reston-field-office", "name": "Social Security Administration, Reston Field Office", "aliases": ["SSA", "Social Security Administration"], "lat": 38.9441, "lon": -77.3181}]
ROUTES = {"employers": {"ssa-reston-field-office": {"options": [{"min": 5, "toll": False}, {"min": 4, "toll": True}]}}}
P = {"keywords_for_job_matching": ["policy", "claims"], "target_roles_implied": ["claims specialist"]}
HOME = (38.93472, -77.3254); T = date(2026, 11, 10)


class B(unittest.TestCase):
    def test_alert_job_matches_and_scores(self):
        raw = [{"source": "linkedin", "url": "https://www.linkedin.com/comm/jobs/view/111/?trk=x", "title": "Claims Specialist", "employer": "Social Security Administration", "desc": "Entry-level. Public trust background check.", "posted": "Posted 2 days ago"}]
        j = build(raw, [], P, EMPS, ROUTES, HOME, T)["set"][0]
        self.assertEqual((j["id"], j["empId"], j["minutes"], j["entry"], j["clearance"], j["posted"]), ("linkedin-111", "ssa-reston-field-office", 5, "yes", "none", "2026-11-08"))
        self.assertGreaterEqual(j["fit"], 80)

    def test_same_job_from_two_alerts_is_one(self):
        r = {"source": "linkedin", "title": "Analyst", "employer": "Acme"}
        out = build([dict(r, url="https://www.linkedin.com/comm/jobs/view/5/?a=1"), dict(r, url="https://www.linkedin.com/jobs/view/5/")], [], P, EMPS, ROUTES, HOME, T)
        self.assertEqual(len(out["set"]), 1)

    def test_clearance_flagged(self):
        j = build([{"source": "indeed", "job_id": "z", "title": "Intelligence Analyst", "employer": "Booz Allen Hamilton", "desc": "Required clearance: TS/SCI with polygraph."}], [], P, EMPS, ROUTES, HOME, T)["set"][0]
        self.assertEqual(j["clearance"], "required")

    def test_saved_without_text(self):
        j = build([{"source": "saved-handshake", "id": "saved-1", "url": "https://app.joinhandshake.com/jobs/1"}], [{"id": "saved-1", "status": "saved", "firstSeen": "2026-11-09", "lastSeen": "2026-11-09"}], P, EMPS, ROUTES, HOME, T)["set"][0]
        self.assertEqual((j["status"], j["fit"], j["clearance"], j["verified"]), ("saved", None, "unknown", False))

    def test_non_https_url_dropped(self):
        j = build([{"source": "web", "url": "http://x.org/j", "title": "Analyst", "employer": "X"}], [], P, EMPS, ROUTES, HOME, T)["set"][0]
        self.assertIsNone(j["url"])

    def test_top_excludes_unscored(self):
        out = build([{"source": "saved-other", "id": "saved-2", "url": "https://x.org"}, {"source": "indeed", "job_id": "q", "title": "Policy Analyst", "employer": "X"}], [], P, EMPS, ROUTES, HOME, T)
        self.assertEqual([t["title"] for t in out["top"]], ["Policy Analyst"])


if __name__ == "__main__":
    unittest.main()
