# Scout task: NoVA employers with careers links

You collect real employers in Northern Virginia for a job-search map. Write ONE JSON file (path given below): a list of rows
`{"name", "kind", "addr", "link", "linkType", "src"}`.

- name: the organisation's name as it calls itself, plus the office/campus if it has several in NoVA ("Booz Allen Hamilton (McLean HQ)").
- kind: one of federal, state-local, contractor, think-tank, ngo-advocacy, education-health, corporate, international, media, consulting, legislative.
- addr: full street address WITH house number, city, VA, ZIP, as shown by a source you saw (official site, county list, search result snippet). If you cannot find a street address with a number, put null. NEVER invent or guess an address.
- link: the employer's careers / jobs page URL as shown in a search result or on its own site. Accept only URLs on the employer's own domain or on a hiring-system host (myworkdayjobs.com, workday, greenhouse.io, lever.co, icims.com, taleo.net, governmentjobs.com, usajobs.gov, jobvite.com, smartrecruiters.com, ultipro/ukg, paylocity, adp). If you can't find one, use the homepage and set linkType "website". If you have neither, null.
- linkType: "careers" or "website" (or null when link is null).
- src: list of the URLs where you saw the address and link (at least one).

Rules: use WebSearch (standard mode), about one search per employer, two at most. Don't open LinkedIn, Indeed, Glassdoor or Handshake. Don't list an employer twice for the same address. Only Northern Virginia locations (Arlington, Alexandria, Fairfax County incl. Reston/Herndon/Tysons/McLean/Vienna/Chantilly/Springfield, Falls Church, Loudoun, Prince William, Manassas, Fauquier). Aim for about 80 rows, biggest and most relevant first; a recent political-science graduate is the user, but include every sizeable employer, not only policy ones.

Write the file with the Write tool as valid JSON (a list). Then reply with one line: "<N> rows, <C> careers links, <A> with address".
