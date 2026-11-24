import json, os, tempfile, unittest
import add_directory as A

GEO = {"1 Main St, Reston, VA 20190": {"lat": 38.95, "lon": -77.35, "hn": "1"},
       "2 Side St, Reston, VA 20190": {"lat": 38.951, "lon": -77.351, "hn": None},
       "1600 Leidos Way, Reston, VA 20190": {"lat": 38.95, "lon": -77.35, "hn": "1600"}}
geo = lambda addr: GEO.get(addr)
CANDS = [dict(name="Acme Co", kind="corporate", addr="1 Main St, Reston, VA 20190", link="https://acme.com/careers", linkType="careers", src=["https://acme.com"]),
         dict(name="Street Only", kind="corporate", addr="2 Side St, Reston, VA 20190", link=None, linkType=None, src=["https://x.org"]),
         dict(name="No Addr", kind="corporate", addr=None, link="https://n.com", linkType="website", src=["https://n.com"]),
         dict(name="Leidos Inc", kind="contractor", addr="1600 Leidos Way, Reston, VA 20190", link="javascript:bad", linkType="careers", src=["https://leidos.com"])]
EMPS = [dict(id="leidos", name="Leidos (HQ)", lat=38.95, lon=-77.35)]

class T(unittest.TestCase):
    def run_build(self, prev=None):
        recs, unplaced, stats = A.build(CANDS, EMPS, geo, today="2026-11-24", prev=prev or [])
        return recs, unplaced, stats
    def test_unplaced_listed(self):
        recs, unplaced, stats = self.run_build()
        names = [r["name"] for r in recs]
        self.assertNotIn("Street Only", names); self.assertNotIn("No Addr", names)
        self.assertEqual(sorted(u["name"] for u in unplaced), ["No Addr", "Street Only"])
        self.assertEqual(stats["not placed"], 2)
    def test_idempotent(self):
        a, _, _ = self.run_build(); b, _, _ = A.build(CANDS, EMPS, geo, today="2026-12-01", prev=a)
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))
    def test_empid_set(self):
        recs, _, _ = self.run_build()
        le = [r for r in recs if r["name"] == "Leidos Inc"][0]
        self.assertEqual(le["empId"], "leidos"); self.assertIsNone(le["link"]); self.assertIsNone(le["linkType"])
    def test_records_valid(self):
        from directory import validate
        recs, _, stats = self.run_build()
        self.assertEqual(validate(recs), []); self.assertEqual(stats["careers"], 1)

class Keep(unittest.TestCase):
    def test_not_geocoded_keeps_previous_record(self):
        first, _, _ = A.build(CANDS, EMPS, geo, today="2026-11-24", prev=[])
        again, unplaced, _ = A.build(CANDS, EMPS, lambda a: None, today="2026-12-01", prev=first)
        self.assertEqual([r["id"] for r in again], [r["id"] for r in first])
        self.assertEqual(sorted(u["name"] for u in unplaced), ["No Addr", "Street Only"])

class Clean(unittest.TestCase):
    def test_geo_query_drops_suite(self):
        self.assertEqual(A.geo_query("12000 Government Center Parkway, Suite 270, Fairfax, VA 22035"), "12000 Government Center Parkway, Fairfax, VA 22035")
        self.assertEqual(A.geo_query("1 Main St Ste 5, Reston, VA 20190"), "1 Main St, Reston, VA 20190")
        self.assertEqual(A.geo_query("1 Main St, 3rd Floor, Reston, VA"), "1 Main St, Reston, VA")
    def test_rate_limit_stops_run(self):
        calls = []
        def boom(q):
            calls.append(q); import urllib.error; raise urllib.error.HTTPError(q, 629, "x", {}, None)
        g = A.cached_geocoder({}, 10, False, fetch=boom, pause=0)
        self.assertIsNone(g("1 A St, Reston, VA")); self.assertIsNone(g("2 B St, Reston, VA")); self.assertEqual(len(calls), 1)

if __name__ == "__main__": unittest.main()
