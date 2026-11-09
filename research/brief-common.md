# Shared instructions for employer research (read fully)

## Who this is for
A recent college grad job-hunting in the DC metro area:
- B.S. Political Science, minor in Civic Leadership, James Madison University, May 2026 (GPA 3.3).
- Targets: political analyst, policy analyst/research, international affairs, legislative/government service, intelligence-style analysis.
- HARD CONSTRAINT: only pursuing jobs that do NOT require a security clearance (public trust / basic background check is OK).
- Lives in Reston, VA (Silver Line Metro). Hometown is Warrenton, VA (Fauquier County). Commutes anywhere from Warrenton to downtown DC are possible.
- Work history: hospitality/customer service, retail; won 1st place in a university international-relations simulation.

## Your job
For each employer assigned to you, research it on the web (official site first, then reputable sources) and produce one JSON record. Use WebSearch/WebFetch. Never invent facts, URLs, addresses or role titles. If you cannot confirm something, leave it empty or say "unconfirmed" in notes rather than guessing.

## Record schema (one object per employer)
{
  "id": "kebab-case-unique",
  "name": "Employer name",
  "org_type": one of "federal" | "legislative" | "state-local" | "think-tank" | "ngo-advocacy" | "international" | "media" | "polling-research" | "consulting" | "contractor" | "corporate" | "party-campaign" | "education-health",
  "address": "Street, City, ST ZIP of the office in the DC/NoVA area where an entry hire would work (from the official site, contact page, or a reputable listing)",
  "address_source": "URL where you found the address",
  "careers_url": "official careers/jobs page URL (employer's own domain or its official ATS, or USAJOBS for federal agencies)",
  "entry_roles": ["2-4 real entry-level role titles this employer posts or has posted that fit a poli-sci BA"],
  "programs": [{"name": "internship/fellowship/entry program name", "url": "official URL"}],   // [] if none found
  "clearance": "none" | "some" | "most",   // for the entry roles listed: none = no clearance (public trust OK); some = mixed; most = nearly all require Secret or higher
  "scores": {
    "role_fit": 1-5,        // 5 = core work is political/policy/international/legislative analysis matching a poli-sci BA; 3 = adjacent (communications, research operations, program coordination, government affairs support); 1 = unrelated
    "clearance_access": 1-5, // 5 = entry roles typically need no clearance; 3 = about half; 1 = nearly all need Secret+
    "entry_access": 1-5      // 5 = formal entry programs or frequent BA-level postings (research assistant, staff assistant, analyst I, program associate); 3 = occasional; 1 = mostly experienced or advanced-degree hires
  },
  "why": "One plain sentence on why this is or isn't a fit for this grad.",
  "sources": ["URLs you actually opened that support the roles, programs and clearance judgment (at least 1, ideally 2)"],
  "notes": "Anything uncertain, e.g. 'office relocating in 2027', 'careers page blocked automated fetch'"
}

## Rules
- Score honestly. A defense contractor whose analyst roles need a clearance must get a low clearance_access even if role_fit is high.
- Federal agencies: careers_url may be the agency careers page or a USAJOBS search URL for that agency. Note that most federal jobs require a background check; only call it "most" clearance if Secret+ is typical for entry roles.
- Check that each careers_url actually loads (WebFetch). If it is blocked or 403, keep it only if it is clearly the official URL and say so in notes.
- Prefer the employer's office in the DC metro/NoVA (or Warrenton/Fauquier for local ones).
- Write the JSON array to the output path given in your brief (valid JSON, UTF-8, no comments, no trailing commas). Validate with: python3 -c "import json;print(len(json.load(open('PATH'))))"
