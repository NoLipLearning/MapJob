import unittest
from datetime import date
from normalize import job_id, norm_name, classify_clearance, classify_entry, match_employer, parse_posted


class T(unittest.TestCase):
    def test_id_is_stable(self):
        self.assertEqual(job_id("indeed", {"job_id": "abc123"}), "indeed-abc123")
        self.assertEqual(job_id("usajobs", {"control": "812345600"}), "usajobs-812345600")
        u = {"url": "https://example.org/jobs/1"}
        self.assertEqual(job_id("web", u), job_id("web", dict(u)))
        self.assertRegex(job_id("web", u), r"^web-[0-9a-f]{12}$")

    def test_id_from_alert_links_ignores_tracking(self):
        a = job_id("linkedin", {"url": "https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&refId=1"})
        b = job_id("linkedin", {"url": "https://www.linkedin.com/jobs/view/4012345678/"})
        self.assertEqual(a, "linkedin-4012345678"); self.assertEqual(a, b)
        self.assertEqual(job_id("handshake", {"url": "https://app.joinhandshake.com/jobs/9876543?ref=email"}), "handshake-9876543")
        self.assertEqual(job_id("web", {"url": "https://x.org/a?utm=1"}), job_id("web", {"url": "https://x.org/a?utm=2"}))

    def test_norm_name(self):
        self.assertEqual(norm_name("The Brookings Institution, Inc."), "brookings institution")
        self.assertEqual(norm_name("TAMARACK TECHNOLOGIES INC"), "tamarack technologies")

    def test_clearance(self):
        self.assertEqual(classify_clearance("Must possess an active Secret clearance."), "required")
        self.assertEqual(classify_clearance("Ability to obtain a Secret clearance; active Secret a plus."), "required")
        self.assertEqual(classify_clearance("Must be able to obtain a Public Trust."), "sponsor")
        self.assertEqual(classify_clearance("Background check only."), "none")
        self.assertEqual(classify_clearance("Great team, free coffee."), "unknown")
        self.assertEqual(classify_clearance("Required Clearance: TS/SCI with polygraph"), "required")

    def test_entry(self):
        self.assertEqual(classify_entry("Senior Policy Analyst", "entry level welcome"), "no")
        self.assertEqual(classify_entry("Program Assistant", "Recent graduate, 0-2 years."), "yes")
        self.assertEqual(classify_entry("Analyst", "5+ years required"), "no")
        self.assertEqual(classify_entry("Analyst", "Join us."), "unknown")
        self.assertEqual(classify_entry("Analyst", "2+ years preferred"), "maybe")
        # a senior person mentioned in the text does not make the job senior
        self.assertEqual(classify_entry("Research Assistant", "Support senior fellows. Entry-level role."), "yes")

    def test_match(self):
        emps = [{"id": "ssa-reston-field-office", "name": "Social Security Administration, Reston Field Office", "aliases": ["SSA", "Social Security Administration"], "lat": 38.9441, "lon": -77.3181},
                {"id": "ssa-manassas-field-office", "name": "Social Security Administration, Manassas Field Office", "aliases": ["SSA", "Social Security Administration"], "lat": 38.7521, "lon": -77.4817},
                {"id": "brookings", "name": "Brookings Institution", "lat": 38.909, "lon": -77.04}]
        self.assertEqual(match_employer({"employer": "SSA", "loc": {}}, emps), "ssa-reston-field-office")
        self.assertEqual(match_employer({"employer": "Social Security Administration", "loc": {"lat": 38.75, "lon": -77.48}}, emps), "ssa-manassas-field-office")
        self.assertEqual(match_employer({"employer": "The Brookings Institution", "loc": {}}, emps), "brookings")
        self.assertIsNone(match_employer({"employer": "Acme Widgets", "loc": {"lat": 38.80, "lon": -77.10}}, emps))
        self.assertEqual(match_employer({"employer": "Brookings Inst. (Foreign Policy)", "loc": {"lat": 38.9091, "lon": -77.0401}}, emps), "brookings")
        self.assertIsNone(match_employer({"employer": "Acme Institution", "loc": {"lat": 38.80, "lon": -77.10}}, emps))

    def test_posted(self):
        t = date(2026, 11, 10)
        self.assertEqual(parse_posted("Posted 3 days ago", t), "2026-11-07")
        self.assertEqual(parse_posted("Just posted", t), "2026-11-10")
        self.assertEqual(parse_posted("Posted 2 weeks ago", t), "2026-10-27")
        self.assertEqual(parse_posted("2026-11-01", t), "2026-11-01")
        self.assertIsNone(parse_posted("30+ days ago", t))
        self.assertIsNone(parse_posted("", t))


if __name__ == "__main__":
    unittest.main()
