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
        self.assertEqual((j["id"], j["empId"], j["minutes"], j["entry"], j["clearance"], j["posted"]), ("linkedin-111", "ssa-reston-field-office", 5, "yes", "sponsor", "2026-11-08"))
        self.assertGreaterEqual(j["fit"], 80)

    def test_same_job_from_two_alerts_is_one(self):
        r = {"source": "linkedin", "title": "Analyst", "employer": "Acme"}
        out = build([dict(r, url="https://www.linkedin.com/comm/jobs/view/5/?a=1"), dict(r, url="https://www.linkedin.com/jobs/view/5/")], [], P, EMPS, ROUTES, HOME, T)
        self.assertEqual(len(out["set"]), 1)

    def test_clearance_flagged(self):
        j = build([{"source": "indeed", "job_id": "z", "title": "Intelligence Analyst", "employer": "Booz Allen Hamilton", "desc": "Required clearance: TS/SCI with polygraph."}], [], P, EMPS, ROUTES, HOME, T)["set"][0]
        self.assertEqual(j["clearance"], "required")

    def test_saved_without_text(self):
        out = build([{"source": "saved-handshake", "id": "saved-1", "url": "https://app.joinhandshake.com/jobs/1"}], [{"id": "saved-1", "status": "saved", "fit": None, "clearance": "unknown", "firstSeen": "2026-11-09", "lastSeen": "2026-11-09"}], P, EMPS, ROUTES, HOME, T)
        p = out["update"][0]["patch"]
        self.assertNotIn("status", p); self.assertNotIn("fit", p); self.assertNotIn("clearance", p)

    def test_reseen_without_text_keeps_good_data(self):
        ex = [{"id": "indeed-z", "status": "new", "clearance": "required", "fit": 20, "summary": "Active TS/SCI required", "firstSeen": "2026-11-01", "lastSeen": "2026-11-01"}]
        out = build([{"source": "indeed", "job_id": "z", "title": "Intelligence Analyst", "employer": "X"}], ex, P, EMPS, ROUTES, HOME, T)
        p = out["update"][0]["patch"]
        self.assertNotIn("clearance", p); self.assertNotIn("fit", p); self.assertNotIn("summary", p)

    def test_non_https_url_dropped(self):
        j = build([{"source": "web", "url": "http://x.org/j", "title": "Analyst", "employer": "X"}], [], P, EMPS, ROUTES, HOME, T)["set"][0]
        self.assertIsNone(j["url"])

    def test_top_excludes_unscored(self):
        out = build([{"source": "saved-other", "id": "saved-2", "url": "https://x.org"}, {"source": "indeed", "job_id": "q", "title": "Policy Analyst", "employer": "X"}], [], P, EMPS, ROUTES, HOME, T)
        self.assertEqual([t["title"] for t in out["top"]], ["Policy Analyst"])

    OFFICES = [{"id": "gsa-VA0001", "lat": 38.9441, "lon": -77.3181, "empIds": ["ssa-reston-field-office"]}, {"id": "gsa-VA0002", "lat": 38.9500, "lon": -77.3000, "empIds": []}]

    def test_deadline_passthrough(self):
        raw = {"source": "usajobs", "control": "123", "title": "Program Analyst", "employer": "X", "desc": "d"}
        out = build([dict(raw, deadline="2026-12-01"), dict(raw, control="124", deadline="soon"), dict(raw, control="125")], [], P, EMPS, ROUTES, HOME, T)["set"]
        d = {j["id"]: j["deadline"] for j in out}
        self.assertEqual(d, {"usajobs-123": "2026-12-01", "usajobs-124": None, "usajobs-125": None})
        self.assertEqual(out[0]["checked"], "2026-11-10")  # fetched source

    def test_office_id_match_and_no_match(self):
        near = {"source": "greenhouse", "job_id": "1", "title": "Analyst", "employer": "Nobody", "desc": "d", "lat": 38.94415, "lon": -77.31812}
        far = dict(near, job_id="2", lat=38.9461, lon=-77.3181)  # about 220 m away
        out = {j["id"]: j for j in build([near, far], [], P, EMPS, ROUTES, HOME, T, offices=self.OFFICES)["set"]}
        self.assertEqual(out["greenhouse-1"]["officeId"], "gsa-VA0001")
        self.assertIsNone(out["greenhouse-2"]["officeId"])

    def test_office_id_via_employer_but_not_city_centre(self):
        j = build([{"source": "linkedin", "url": "https://www.linkedin.com/jobs/view/9/", "title": "Claims Specialist", "employer": "Social Security Administration", "desc": "d"}], [], P, EMPS, ROUTES, HOME, T, offices=self.OFFICES)["set"][0]
        self.assertEqual(j["officeId"], "gsa-VA0001"); self.assertIsNone(j["checked"])
        g = lambda q: (38.9500, -77.3000)  # a geocoded place name is a guess, not a building
        k = build([{"source": "web", "url": "https://x.org/a", "title": "Analyst", "employer": "Nobody", "location": "Reston, VA"}], [], P, EMPS, ROUTES, HOME, T, geocode=g, offices=self.OFFICES)["set"][0]
        self.assertIsNone(k["officeId"])

    def test_board_kept_for_authoritative_delete(self):
        ex = [{"id": "greenhouse-9", "status": "new", "board": "greenhouse:acme", "firstSeen": "2026-11-08", "lastSeen": "2026-11-08"}]
        out = build([{"source": "greenhouse", "job_id": "1", "title": "Policy Associate", "employer": "Acme", "desc": "d", "board": "greenhouse:acme"}], ex, P, EMPS, ROUTES, HOME, T, authoritative={"greenhouse:acme"})
        self.assertEqual(out["delete"], ["greenhouse-9"]); self.assertEqual(out["set"][0]["board"], "greenhouse:acme")


class Relevance(unittest.TestCase):
    def test_feed_titles_filtered(self):
        raw = [{"source": "greenhouse", "url": "https://boards.greenhouse.io/x/jobs/1", "title": "SAP ABAP Developer", "employer": "X"},
               {"source": "greenhouse", "url": "https://boards.greenhouse.io/x/jobs/2", "title": "Policy Associate", "employer": "X"},
               {"source": "indeed", "job_id": "k", "title": "SAP ABAP Developer", "employer": "X"},
               {"source": "greenhouse", "url": "https://boards.greenhouse.io/x/jobs/3", "title": "Client Experience Associate", "employer": "X", "pay": "$55,000 a year"}]
        out = build(raw, [], P, EMPS, ROUTES, HOME, T)["set"]
        ids = [j["id"] for j in out]
        self.assertEqual(len(ids), 2); self.assertNotIn("indeed-k", ids)  # specialist roles dropped, any-field entry roles kept
        self.assertEqual([j["payMin"] for j in out if j["title"].startswith("Client")], [55000])


if __name__ == "__main__":
    unittest.main()
