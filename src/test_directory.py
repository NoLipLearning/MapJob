import unittest
from directory import norm_name, make_id, clean_link, match_emp, validate

def rec(**k):
    r = dict(id="a", name="A", kind="corporate", addr="1 Main St, Reston, VA 20190", lat=38.95, lon=-77.35, gc="addr",
             link="https://a.com/careers", linkType="careers", src=["https://a.com"], via="list", checked="2026-11-24")
    r.update(k); return r

class T(unittest.TestCase):
    def test_norm_name(self):
        self.assertEqual(norm_name("The Booz Allen Hamilton, Inc."), "booz allen hamilton")
        self.assertEqual(norm_name("Leidos Inc"), norm_name("LEIDOS"))
        self.assertEqual(norm_name("Acme Co., LLC"), "acme")
    def test_ids_unique_per_location(self):
        a = make_id("Booz Allen Hamilton", "8283 Greensboro Dr, McLean, VA")
        b = make_id("Booz Allen Hamilton", "13200 Woodland Park Rd, Herndon, VA")
        self.assertNotEqual(a, b); self.assertTrue(a.startswith("booz-allen-hamilton-"))
        self.assertEqual(a, make_id("Booz Allen Hamilton", "8283 Greensboro Dr, McLean, VA"))
    def test_bad_link_dropped(self):
        self.assertIsNone(clean_link("javascript:x")); self.assertIsNone(clean_link("")); self.assertIsNone(clean_link(None))
        self.assertIsNone(clean_link("/careers"))
        self.assertEqual(clean_link("https://a.com/careers"), "https://a.com/careers")
        self.assertEqual(clean_link(" http://a.com "), "http://a.com")
    def test_match_emp(self):
        emps = [dict(id="leidos", name="Leidos (Reston HQ)", lat=38.95, lon=-77.35)]
        self.assertEqual(match_emp(rec(name="Leidos Inc", lat=38.9509, lon=-77.35), emps), "leidos")  # ~100 m
        self.assertIsNone(match_emp(rec(name="Leidos", lat=38.9518, lon=-77.35), emps))               # ~200 m
        self.assertIsNone(match_emp(rec(name="Leidos Health", lat=38.95, lon=-77.35), emps))
    def test_validate(self):
        self.assertEqual(validate([rec()]), [])
        self.assertTrue(validate([rec(src=[])]))
        self.assertTrue(validate([rec(gc="street")]))
        self.assertTrue(validate([rec(), rec()]))
        self.assertTrue(validate([rec(link="javascript:x")]))

if __name__ == "__main__": unittest.main()
