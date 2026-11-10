import unittest
from score import score, commute_score, estimate_minutes

P = {"keywords_for_job_matching": ["policy", "research", "legislative", "writing"], "target_roles_implied": ["program analyst"]}


class T(unittest.TestCase):
    def test_perfect(self):
        j = {"title": "Program Analyst, Policy Research", "summary": "legislative writing research policy", "entry": "yes", "clearance": "none"}
        self.assertEqual(score(j, P, 10)[0], 100)

    def test_unknowns(self):
        j = {"title": "Clerk", "summary": "", "entry": "unknown", "clearance": "unknown"}
        self.assertEqual(score(j, P, 10)[0], round(100 * (0 + .25 * .4 + .20 * .5 + .20 * 1)))  # 40

    def test_required_clearance_and_far(self):
        j = {"title": "Program Analyst", "summary": "", "entry": "no", "clearance": "required"}
        self.assertEqual(score(j, P, 70)[0], round(100 * .35 * min(1, 2 / 5)))  # 14

    def test_sponsor_is_below_none(self):
        base = {"title": "Program Analyst", "summary": "", "entry": "yes"}
        self.assertLess(score(dict(base, clearance="sponsor"), P, 20)[0], score(dict(base, clearance="none"), P, 20)[0])

    def test_why_has_three_plain_reasons(self):
        why = score({"title": "Program Analyst", "summary": "policy", "entry": "yes", "clearance": "sponsor"}, P, 20)[1]
        self.assertEqual(len(why), 3)
        self.assertTrue(all(isinstance(w, str) and len(w) < 90 for w in why))

    def test_whole_words_only(self):
        # 'policy' must not match 'policyholder'
        self.assertEqual(score({"title": "Policyholder Services Rep", "summary": "", "entry": "unknown", "clearance": "unknown"}, P, None)[0],
                         score({"title": "Services Rep", "summary": "", "entry": "unknown", "clearance": "unknown"}, P, None)[0])

    def test_bands(self):
        self.assertEqual([commute_score(m) for m in (15, 16, 25, 35, 45, 60, 61)], [1, .8, .8, .6, .4, .2, 0])
        self.assertAlmostEqual(estimate_minutes(10), 24)

    def test_no_profile_does_not_crash(self):
        f, why = score({"title": "Analyst", "summary": "", "entry": "yes", "clearance": "none"}, {}, 20)
        self.assertTrue(0 <= f <= 100); self.assertEqual(len(why), 3)


if __name__ == "__main__":
    unittest.main()
