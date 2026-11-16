import unittest
from feeds import in_scope, to_text, discover, lever
import feeds
from usajobs import to_item
from spotcheck import api_url, allowed


class F(unittest.TestCase):
    def test_scope(self):
        for loc in ("Reston,Virginia,United States", "Washington, D.C.", "Arlington, VA", "Remote", "Remote (DC Preferred)", "Bethesda, MD"):
            self.assertTrue(in_scope(loc), loc)
        for loc in ("New York, NY", "Columbia, South Carolina", "Remote - UK", "Reporter, Gulf Region - Middle East (Remote)", "London", ""):
            self.assertFalse(in_scope(loc), loc)

    def test_text(self):
        self.assertEqual(to_text("&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;"), "Hello & welcome\n- One")

    def test_discover(self):
        emps = [{"id": "a", "name": "A", "url": "https://job-boards.greenhouse.io/acme/jobs/1", "src": ["https://jobs.lever.co/beta", "https://x.org"]},
                {"id": "b", "name": "B", "url": "https://boards.greenhouse.io/embed/job_board?for=gamma", "progs": [{"url": "https://x.org"}]}]
        self.assertEqual(sorted(discover(emps)), [("greenhouse", "acme"), ("greenhouse", "gamma"), ("lever", "beta")])

    def test_lever_filter(self):
        feeds.get_json = lambda url, tries=3: [{"id": "1", "text": "Analyst", "hostedUrl": "https://jobs.lever.co/x/1", "categories": {"location": "Washington, DC"}, "descriptionPlain": "d", "createdAt": 1762732800000},
                                               {"id": "2", "text": "Other", "hostedUrl": "https://jobs.lever.co/x/2", "categories": {"location": "Austin, TX"}, "descriptionPlain": "d"}]
        total, items = lever({"token": "x", "employer": "X"})
        self.assertEqual((total, [i["job_id"] for i in items], items[0]["posted"], items[0]["board"]), (2, ["1"], "2025-11-10", "lever:x"))

    def test_usajobs_mapping(self):
        d = {"_id": "812345", "PositionTitle": "Program Analyst", "PositionURI": "https://www.usajobs.gov/job/812345", "OrganizationName": "Dept of X",
             "PositionLocation": [{"LocationName": "Reston, Virginia", "Latitude": 38.95, "Longitude": -77.34}, {"LocationName": "Denver", "Latitude": 39.7, "Longitude": -105}],
             "PublicationStartDate": "2026-11-01", "ApplicationCloseDate": "2026-12-01T23:59:59", "QualificationSummary": "q", "UserArea": {"Details": {"JobSummary": "s"}}}
        x = to_item(d)
        self.assertEqual((x["source"], x["control"], x["deadline"], x["posted"], x["location"], x["desc"]), ("usajobs", "812345", "2026-12-01", "2026-11-01", "Reston, Virginia", "s q"))
        self.assertIsNone(to_item(dict(d, PositionLocation=[{"LocationName": "Denver", "Latitude": 39.7, "Longitude": -105}])))

    def test_spotcheck_hosts(self):
        self.assertEqual(api_url("https://job-boards.greenhouse.io/acme/jobs/55"), "https://boards-api.greenhouse.io/v1/boards/acme/jobs/55")
        self.assertEqual(api_url("https://jobs.lever.co/acme/abc"), "https://api.lever.co/v0/postings/acme/abc")
        self.assertFalse(allowed("https://www.linkedin.com/jobs/view/1"))


if __name__ == "__main__":
    unittest.main()
