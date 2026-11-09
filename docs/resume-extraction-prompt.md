# Prompt to paste into Claude chat (attach your resume, cover letter, and writing sample)

I've attached my resume, a cover letter, and a writing sample. Read all three and pull out a structured profile I can paste into a job-application helper. Use only what's in the files. If something is missing or unclear, write `UNKNOWN`. Don't guess, and don't polish or invent anything.

Return exactly one fenced ```json block with this shape, and nothing else:

```json
{
  "name": "",
  "location": "",
  "contact": { "email": "", "phone": "", "linkedin": "", "portfolio": "" },
  "education": [
    { "school": "", "degree": "", "major": "", "minor": "", "grad_year": "", "gpa": "", "honors": [] }
  ],
  "experience": [
    {
      "title": "", "org": "", "location": "",
      "start": "YYYY-MM", "end": "YYYY-MM or present",
      "type": "internship | full-time | part-time | volunteer | research",
      "bullets": [], "tools_used": []
    }
  ],
  "skills": {
    "technical": [], "software": [], "languages": [], "methods": [], "soft": []
  },
  "certifications": [],
  "clearance": { "status": "none | eligible | held", "level": "", "notes": "" },
  "work_authorization": "",
  "writing_sample": {
    "title": "", "format": "", "topic": "", "length_pages": "",
    "one_sentence_summary": "", "skills_it_demonstrates": []
  },
  "cover_letter_themes": [],
  "target_roles_implied": [],
  "keywords_for_job_matching": [],
  "synopsis_60_words": "",
  "synopsis_150_words": "",
  "gaps_or_questions": []
}
```

Rules:
- Dates: use YYYY-MM. If you only find a year, use YYYY.
- `keywords_for_job_matching`: 15–30 terms a recruiter or job board would search for, taken from my actual experience.
- `target_roles_implied`: job titles my background fits, based on what the documents show.
- Write `synopsis_60_words` and `synopsis_150_words` in first person, plain language, with no buzzwords.
- `gaps_or_questions`: list anything the helper will need that isn't in the files, such as missing dates, an unclear clearance status, or skills that are mentioned but never shown.
