import json, os, unittest, urllib.error
from datetime import date
import read_postings as rp

FX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
TODAY = date(2026, 11, 22)
load = lambda n: json.load(open(os.path.join(FX, n)))


class SourceRef(unittest.TestCase):
    def test_source_ref_usajobs(self):
        self.assertEqual(rp.source_ref({"id": "usajobs-839081400", "source": "usajobs"}), {"kind": "usajobs", "control": "839081400"})

    def test_source_ref_greenhouse(self):
        self.assertEqual(rp.source_ref({"id": "greenhouse-4333797006", "source": "greenhouse", "board": "greenhouse:accenturefederalservices"}),
                         {"kind": "greenhouse", "token": "accenturefederalservices", "job": "4333797006"})

    def test_source_ref_lever(self):
        self.assertEqual(rp.source_ref({"id": "lever-2ed4a12a-3346-4125-ba45-ffd68b3c976a", "source": "lever", "board": "lever:fiscalnote"}),
                         {"kind": "lever", "company": "fiscalnote", "job": "2ed4a12a-3346-4125-ba45-ffd68b3c976a"})

    def test_source_ref_indeed(self):
        self.assertEqual(rp.source_ref({"id": "indeed-0abc", "source": "indeed"})["kind"], "indeed")


class Extract(unittest.TestCase):
    def test_extract_years(self):
        self.assertEqual(rp.extract("Minimum of 3 years of experience", TODAY)["years"], 3)
        self.assertEqual(rp.extract("1-2 years of related experience", TODAY)["years"], 1)
        self.assertEqual(rp.extract("No experience required.", TODAY)["years"], 0)
        self.assertIsNone(rp.extract("Great team, good benefits.", TODAY)["years"])

    def test_extract_degree(self):
        self.assertEqual(rp.extract("Bachelor's degree required", TODAY)["degree"], "bachelor")
        self.assertEqual(rp.extract("Master's degree required", TODAY)["degree"], "master")
        self.assertEqual(rp.extract("Bachelor's degree in Nursing required", TODAY)["degree"], "specialist")
        self.assertIsNone(rp.extract("Bachelor's preferred, Master's a plus", TODAY)["degree"])  # final review: preferred is not required
        self.assertIsNone(rp.extract("Great team.", TODAY)["degree"])

    def test_extract_clearance_active(self):
        a = rp.extract("Active TS/SCI clearance required at start.", TODAY)
        self.assertEqual((a["clearance"], a["active_at_hire"]), ("required", True))
        b = rp.extract("Ability to obtain a Secret clearance.", TODAY)
        self.assertEqual((b["clearance"], b["active_at_hire"]), ("sponsor", False))

    def test_deadline_open_until_filled_is_null(self):
        self.assertIsNone(rp.extract("Open until filled.", TODAY)["deadline"])

    def test_deadline_parsed(self):
        self.assertEqual(rp.extract("Applications close December 3, 2026.", TODAY)["deadline"], "2026-12-03")


class Fetch(unittest.TestCase):
    def setUp(self): self._get = rp._get_json

    def tearDown(self): rp._get_json = self._get

    def test_fetch_usajobs_fixture(self):
        rp._get_json = lambda url, headers=None: load("usajobs_detail.json")
        r = rp.fetch_text({"kind": "usajobs", "control": "851633800"}, "k", "e")
        self.assertIn("Reviews agency programs and prepares written reports", r["text"])
        self.assertEqual(r["applyUrl"], "https://www.usajobs.gov:443/job/851633800/apply")
        self.assertEqual(r["deadline"], "2026-12-03")

    def test_fetch_greenhouse_fixture(self):
        rp._get_json = lambda url, headers=None: load("greenhouse_detail.json")
        r = rp.fetch_text({"kind": "greenhouse", "token": "accenturefederalservices", "job": "4333797006"}, None, None)
        self.assertGreater(len(r["text"]), 300); self.assertNotIn("<", r["text"][:200])
        self.assertTrue(r["applyUrl"].startswith("https://"))

    def test_fetch_lever_fixture(self):
        rp._get_json = lambda url, headers=None: load("lever_detail.json")
        r = rp.fetch_text({"kind": "lever", "company": "fiscalnote", "job": "x"}, None, None)
        self.assertGreater(len(r["text"]), 300); self.assertTrue(r["applyUrl"].endswith("/apply"))

    def test_fetch_failure_keeps_title_only(self):
        def boom(url, headers=None): raise urllib.error.URLError("down")
        rp._get_json = boom
        self.assertIsNone(rp.fetch_text({"kind": "greenhouse", "token": "t", "job": "1"}, None, None))

    def test_usajobs_without_key_is_none(self):
        self.assertIsNone(rp.fetch_text({"kind": "usajobs", "control": "1"}, None, None))

    def test_cache_roundtrip(self):
        h = rp.cache_put("test-job-1", "hello posting")
        self.assertEqual(rp.cache_get("test-job-1"), "hello posting"); self.assertEqual(len(h), 40)
        os.remove(rp.cache_path("test-job-1"))


if __name__ == "__main__":
    unittest.main()


class CanGet(unittest.TestCase):
    def test_three_years_is_long_shot(self):
        self.assertEqual(rp.can_get({"years": 3})["label"], "long shot")

    def test_two_years_is_stretch(self):
        self.assertEqual(rp.can_get({"years": 2, "degree": "bachelor", "clearance": "none"})["label"], "stretch")

    def test_ability_to_obtain_is_likely(self):
        self.assertEqual(rp.can_get({"clearance": "sponsor", "activeAtHire": False, "years": 0})["label"], "likely")

    def test_active_clearance_long_shot(self):
        g = rp.can_get({"clearance": "required", "activeAtHire": True, "years": 0})
        self.assertEqual(g["label"], "long shot"); self.assertIn("active clearance", g["why"])

    def test_master_long_shot(self):
        self.assertEqual(rp.can_get({"degree": "master"})["label"], "long shot")

    def test_specialist_stretch(self):
        self.assertEqual(rp.can_get({"degree": "specialist", "years": 0})["label"], "stretch")

    def test_licence_long_shot(self):
        self.assertEqual(rp.can_get({"licence": True})["label"], "long shot")

    def test_unknowns_listed(self):
        g = rp.can_get({})
        self.assertEqual(g["label"], "likely"); self.assertIn("experience not stated", g["why"])

    def test_musts_ok_drops_invented(self):
        self.assertEqual(rp.musts_ok(["Bachelor's degree", "5 years Python"], "Requires a bachelor's  degree."), ["Bachelor's degree"])


def _job(i, **kw):
    d = {"id": i, "title": "Analyst", "employer": "X", "url": "https://example.gov/" + i, "status": "new", "firstSeen": "2026-11-01"}
    d.update(kw); return d


GH_TEXT = "Duties: write reports. Requirements: Bachelor's degree required. 1-2 years of related experience. Applications close December 3, 2026."


class BuildReads(unittest.TestCase):
    def test_build_reads_never_patches_status(self):
        out = rp.build_reads([_job("greenhouse-1", board="greenhouse:t", source="greenhouse")],
                             {"greenhouse-1": {"text": GH_TEXT, "applyUrl": "https://boards.greenhouse.io/t/jobs/1", "deadline": None}}, {}, {}, TODAY)
        self.assertEqual(len(out), 1)
        for w in out: self.assertFalse({"status", "firstSeen"} & set(w["patch"]))
        r = out[0]["patch"]["read"]
        self.assertEqual((r["from"], r["years"], r["degree"], r["deadline"], r["howApply"]), ("posting", 1, "bachelor", "2026-12-03", "employer site"))
        self.assertEqual(out[0]["patch"]["canGet"]["label"], "likely")

    def test_build_reads_skips_unchanged_hash(self):
        h = rp.hashlib.sha1(GH_TEXT.encode()).hexdigest()
        j = _job("greenhouse-1", board="greenhouse:t", source="greenhouse", read={"from": "posting", "hash": h, "what": "x"}, canGet={"label": "likely", "why": ""})
        out = rp.build_reads([j], {"greenhouse-1": {"text": GH_TEXT, "applyUrl": None, "deadline": None}}, {}, {}, TODAY)
        self.assertEqual(out, [])

    def test_build_reads_skips_read_indeed(self):
        j = _job("indeed-1", source="indeed", read={"from": "posting", "hash": "abc", "what": "x"}, canGet={"label": "likely", "why": ""})
        self.assertEqual(rp.build_reads([j], {}, {}, {"indeed-1": "new text " * 50}, TODAY), [])

    def test_build_reads_indeed_text_is_posting(self):
        out = rp.build_reads([_job("indeed-2", source="indeed")], {}, {}, {"indeed-2": "Minimum of 3 years of experience required."}, TODAY)
        self.assertEqual(out[0]["patch"]["read"]["from"], "posting"); self.assertEqual(out[0]["patch"]["read"]["howApply"], "indeed")
        self.assertEqual(out[0]["patch"]["canGet"]["label"], "long shot")

    def test_build_reads_title_only_when_fetch_failed(self):
        out = rp.build_reads([_job("greenhouse-3", board="greenhouse:t", source="greenhouse")], {"greenhouse-3": None}, {}, {}, TODAY)
        p = out[0]["patch"]
        self.assertEqual(p["read"]["from"], "title"); self.assertIn("canGet", p)
        self.assertEqual(p["read"]["applyUrl"], "https://example.gov/greenhouse-3")

    def test_build_reads_alert_text(self):
        out = rp.build_reads([_job("linkedin-1", source="linkedin", summary="Entry level policy assistant role. No experience required.")], {}, {}, {}, TODAY)
        self.assertEqual(out[0]["patch"]["read"]["from"], "alert"); self.assertEqual(out[0]["patch"]["read"]["years"], 0)

    def test_build_reads_plain_fields_checked(self):
        out = rp.build_reads([_job("greenhouse-1", board="greenhouse:t", source="greenhouse")],
                             {"greenhouse-1": {"text": GH_TEXT, "applyUrl": None, "deadline": None}},
                             {"greenhouse-1": {"what": "Write reports for the team.", "musts": ["Bachelor's degree required", "Python expert"]}}, {}, TODAY)
        r = out[0]["patch"]["read"]
        self.assertEqual(r["what"], "Write reports for the team."); self.assertEqual(r["musts"], ["Bachelor's degree required"])

    def test_build_reads_keeps_version(self):
        j = _job("greenhouse-1", board="greenhouse:t", source="greenhouse"); j["_version"] = 4
        out = rp.build_reads([j], {"greenhouse-1": {"text": GH_TEXT, "applyUrl": None, "deadline": None}}, {}, {}, TODAY)
        self.assertEqual(out[0]["version"], 4)


class ReviewFindings(unittest.TestCase):
    """Final review (2026-11-22): each case produced a wrong fact before the fix."""
    def ex(self, t): return rp.extract(t, TODAY)

    def test_jd_edwards_is_not_a_doctorate(self):
        self.assertIsNone(self.ex("Experience with JD Edwards ERP.")["degree"])

    def test_drivers_licence_is_not_professional(self):
        self.assertFalse(self.ex("Valid driver's license required.")["licence"])
        self.assertTrue(self.ex("Active CPA license required.")["licence"])

    def test_company_years_ignored(self):
        self.assertIsNone(self.ex("With over 25 years of experience serving federal clients, we are a leader.")["years"])

    def test_preferred_years_ignored(self):
        self.assertIsNone(self.ex("3+ years of experience preferred.")["years"])
        self.assertEqual(rp.can_get(dict(self.ex("3+ years of experience preferred."), activeAtHire=False))["label"], "likely")

    def test_preferred_only_degree_is_not_required(self):
        self.assertIsNone(self.ex("Master's degree preferred.")["degree"])

    def test_active_clearance_preferred_is_not_long_shot(self):
        for t in ["Active Secret clearance preferred.",
                  "Must obtain and maintain a Secret clearance. Current Secret clearance is a plus.",
                  "Must have an active Secret clearance or the ability to obtain one."]:
            e = self.ex(t)
            self.assertFalse(e["active_at_hire"], t)
            self.assertNotEqual(rp.can_get({"clearance": e["clearance"], "activeAtHire": e["active_at_hire"], "years": 0})["label"], "long shot", t)

    def test_clearance_preferred_stated_as_preferred(self):
        self.assertEqual(self.ex("Secret clearance preferred.")["clearance"], "preferred")

    def test_engineering_in_a_list_is_not_specialist(self):
        self.assertEqual(self.ex("Bachelor's degree in political science, economics, engineering, or a related field.")["degree"], "bachelor")
        self.assertEqual(self.ex("Bachelor's degree in Nursing required.")["degree"], "specialist")

    def test_bachelor_path_years(self):
        self.assertEqual(self.ex("Bachelor's degree with 2 years of experience, or Master's degree with 0 years of experience.")["years"], 2)

    def test_high_school_or_equivalent_does_not_override_bachelor(self):
        self.assertEqual(self.ex("High school diploma or equivalent. Bachelor's degree required.")["degree"], "bachelor")

    def test_extended_from_is_not_a_deadline(self):
        self.assertIsNone(self.ex("The deadline was extended from January 5, 2026 to a later date.")["deadline"])
        self.assertIsNone(self.ex("Our contract closes out in March 3, 2027.")["deadline"])
        self.assertEqual(self.ex("Closing date: December 3, 2026.")["deadline"], "2026-12-03")


class FailedFetchKeepsRead(unittest.TestCase):
    def test_failed_fetch_keeps_old_posting_read(self):
        old = {"from": "posting", "hash": "h1", "what": "Write reports.", "musts": ["Bachelor's degree"], "deadline": "2026-12-03"}
        j = _job("greenhouse-1", board="greenhouse:t", source="greenhouse", read=old, canGet={"label": "likely", "why": ""})
        self.assertEqual(rp.build_reads([j], {"greenhouse-1": None}, {}, {}, TODAY), [])


class TruthCheckFindings(unittest.TestCase):
    """Truth check of 15 real postings (2026-11-22): each case was a wrong fact before the fix."""
    def ex(self, t): return rp.extract(t, TODAY)

    def test_word_number_years(self):
        self.assertEqual(self.ex("At least one year of related experience.")["years"], 1)

    def test_parenthetical_number_years(self):
        self.assertEqual(self.ex("Must have a minimum of 1 (one) year of experience in sales.")["years"], 1)

    def test_indeed_required_list_years(self):
        self.assertEqual(self.ex("Experience:\nCoding: 1 year (Required)\nPython: 1 year (Required)")["years"], 1)

    def test_largest_of_several_requirements(self):
        t = "Here's What You Need:\n1+ year of experience in IT support\n2 years of Cisco Switching\nBachelor's degree"
        self.assertEqual(self.ex(t)["years"], 2)

    def test_range_still_takes_its_low_end(self):
        self.assertEqual(self.ex("1-3 years of experience required.")["years"], 1)

    def test_helpful_section_is_not_required(self):
        t = "Requirements:\nHigh school diploma or equivalent\nIt would be helpful if you have:\nBachelor's degree\nSales experience"
        self.assertEqual(self.ex(t)["degree"], "none")


class TruthCheckRetry(unittest.TestCase):
    def ex(self, t): return rp.extract(t, TODAY)

    def test_up_to_is_a_ceiling_not_a_requirement(self):
        t = "Candidates with up to 2 years of professional experience are encouraged to apply. Experience: Zero to 2 years of professional experience. Coding: 1 year (Required)"
        self.assertEqual(self.ex(t)["years"], 1)

    def test_helpful_heading_without_newlines(self):
        t = "Requirements: High school diploma or equivalent. It would be helpful if you have: Bachelor's degree. Earn $72,000 each year."
        self.assertEqual(self.ex(t)["degree"], "none")


class WordRange(unittest.TestCase):
    def test_zero_to_two_words(self):
        self.assertEqual(rp.extract("Experience: Zero to two years of professional experience.", TODAY)["years"], 0)


class TruthCheckRetry2(unittest.TestCase):
    def ex(self, t): return rp.extract(t, TODAY)

    def test_clearance_type_none(self):
        self.assertEqual(self.ex("Clearance Type: None. Bachelor's degree required.")["clearance"], "none")

    def test_substitution_years_ignored(self):
        t = "Bachelor's degree required. At least 0-4 years of experience. A minimum of four (4) years of additional relevant experience may satisfy degree requirements."
        self.assertEqual(self.ex(t)["years"], 0)

    def test_degree_or_diploma_plus_years(self):
        t = "Bachelor's Degree or High School Diploma/GED and 4 years of relevant work experience."
        e = self.ex(t)
        self.assertEqual((e["degree"], e["years"]), ("bachelor", None))


class PreferredHeading(unittest.TestCase):
    def test_preferred_heading_line_and_next_heading_resets(self):
        t = ("A. Required Qualifications\n\nBachelor's Degree\n\nB. Preferred Qualifications\n\n"
             "4 years of supervisory experience (in addition to education requirement).\n\nIV. Physical Requirements\n\n2 years of experience driving required.")
        self.assertEqual(rp.extract(t, TODAY)["years"], 2)

    def test_short_item_lines_do_not_end_a_preferred_section(self):
        t = "Preferred Qualifications\nMaster's degree\n3 years of experience\nRequired Qualifications\nBachelor's degree"
        e = rp.extract(t, TODAY)
        self.assertEqual((e["degree"], e["years"]), ("bachelor", None))
