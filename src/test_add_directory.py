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

if __name__ == "__main__": unittest.main()
