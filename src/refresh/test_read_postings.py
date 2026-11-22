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
        self.assertEqual(rp.extract("Bachelor's preferred, Master's a plus", TODAY)["degree"], "bachelor")
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
