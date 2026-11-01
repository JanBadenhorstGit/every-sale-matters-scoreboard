# Sales scoreboard — every sale matters

A public, self-updating sales scoreboard for the team.

- `index.html` — the scoreboard page (person picker, Today/Yesterday/Week/Month, league, colleges, weekly incentives).
- `scoreboard.json` — the latest computed numbers (regenerated hourly during work hours).
- `scoreboard_pipeline.py` — reads the team's public Google Sheets and applies the comparison-report counting rules. It picks the current month's Registration and incentive sheets from `MONTH_SHEETS` automatically (South Africa time); **before the 1st of each month, add the new month's two sheet IDs to `MONTH_SHEETS` and share both sheets as "anyone with the link: viewer"**. If the current month is missing, the run uses the latest month available and prints a WARNING, and `scoreboard.json` carries `config_stale: true`.
- `.github/workflows/refresh.yml` — hourly refresh in the cloud (Mon–Fri, South African work hours).

## Counting rules

A row counts as one registration when it names the salesperson (registrar) **and**
a student name or CRM ID, unless its status is "Cancelled". "Confirmed" and
"Docs Received" both count.

- August pace = person's August total ÷ 20 recorded days × recorded days in the selected period.
- Personal best = best single day since August.
- Weekly incentives come from the team's incentive sheet: qualifying debit orders
  (25 → R400, 30 → R550, …, 100 → R2000; only the highest reached level pays) plus
  cash incentives per bracket (700–2499 → R50, 2500–4999 → R100, 5000–9999 → R200,
  10000–19999 → R300, 20000–29999 → R500, 30000–39999 → R700, 40000+ → R1000).

No student names, contact details or CRM IDs appear anywhere in this repository or on the page.

## Version 2 (`v2/`)

A role-based page for Leadership, Sales Manager, Sales Agent, Collections Manager
and Collections Agent, served from the same repository at `/v2/`.

- `v2/index.html`, `v2/app.js`, `v2/style.css` — the page. The view and person are kept in the URL
  (`#role=sales-agent&who=kenneth`) so each registrar can bookmark their own page.
- `v2/pipeline_sales.py` — runs the v1 pipeline, then records per-day, per-registrar sale detail
  (debit-order mandate, upfront cash, monthly instalment band, first-payment lead time, digital vs
  pick-up) into `v2/data/sales.json`. Earlier months are kept in that file, so a month survives
  even when its sheet is no longer shared. Registrars who sell but are not on the comparison-sheet
  roster are included with the college of the sheet section they appear in.
- `v2/pipeline_collections.py` — reads two **internal** sheets (Collections Daily Goal, 2026
  Cancellation Track Sheet) with the `gws` CLI and writes de-identified aggregates to
  `v2/data/collections.json`. Those sheets hold student details and must stay private, so this
  script is run from a trusted machine or scheduled task, not from the public GitHub Action.
  No student names, numbers or phone numbers are written.
- The Action refreshes `scoreboard.json` and `v2/data/sales.json` every 30 minutes in work hours (08:00–18:30 SAST, Mon–Fri).

### v2.1 additions (1 Nov 2026)

- **Attention card and email section**: automatic flags for data gaps, pace, debit-order rate, unworked or
  ageing cancellation requests, save-rate drops, cash forecast below goal, course types with high cancellation
  rates, registrars missing from the roster.
- **Course economics**: sales, D/O rate, average instalment, monthly value signed and upfront cash per course
  family; cancellation requests per 100 sales per course type (Matric, Provider, QCTO, ICB, Nated).
- **Registrar quality score** (0–100): D/O rate 35%, first payment within 7 days 25%, paid upfront 10%,
  cancellation index 30%. Shown in the league and on each agent page.
- **Cash forecast**: cycle total projected from the average cumulative shape of completed cycles in the bank tabs.
- **Exceptions queue**: open cancellation requests, oldest first, with age, agent, attempts and gaps.
- **Month by month** history table; **personal page links** and **incentive CSV export** for managers.
- `v2/discover_sheets.py` finds each month's Registration and incentive sheets by name in Drive, shares them
  viewer-by-link and writes `month_sheets.json`, which `scoreboard_pipeline.py` merges into `MONTH_SHEETS`.
  It runs in the private weekday-morning task together with the collections refresh.

### v2.2 additions (1 Nov 2026)

- **North star** on Leadership: paying students added this month (debit orders signed − cancelled this cycle) with its drivers.
- **Today's three** (Leadership, Sales Manager, Collections Manager, and the top of each email): actions ranked by
  estimated cash impact (students × average instalment × 12 months, discounted as shown).
- **80/20 card**: share of sales and of expected cash held by the top 4%, top 20% and bottom 50% of registrars and course families.
- **League ranked by expected 12-month cash** (toggle) alongside the volume ranking.
- **Where the lost cash is** (Collections Manager): cancelled requests valued by course type, by reason and course,
  plus save rate per salvage-offer type (bucketed from the free-text column).
- **Tests register**: a Google Sheet (`ESM Tests register`) read by the private collections refresh; the board shows
  conversion per variant, lift and a 95% two-proportion z-test, declaring a winner only when the test is marked Done.
- **Cancellation sheet parsing is now content-anchored**: the trailing columns drift between tabs (October 2026's
  header row is one column out of step with its data from "Account status" onward; earlier tabs have one more column),
  so Course/College/agent columns are located by content rather than by fixed index. Earlier cycles were mis-read before this.
- Instalment amounts above R20,000 are treated as capture errors (an August row carried a six-figure value).

### v2.3 additions (1 Nov 2026): lead funnel from the CRM

- **`v2/pipeline_leads.py`** (private; runs in the weekday refresh with the ActiveCampaign credential) pulls the contacts
  created in the last 45 days, joins them to the registration sheets by CRM ID (phone as a fallback) and writes
  `v2/data/leads.json` with aggregates only: funnel per college × channel × month, speed to allocation (enquiry created →
  registrar field set), landing pages, registrar lead conversion, unconverted pools, lead age at sale, sale-link quality
  and first-referrer × source attribution. Raw API pages are cached per day under `sheets_private/ac/` (git-ignored).
- **Marketing view**: funnel table, speed to lead by college, lead age at sale, landing pages vs college average,
  re-engagement pools, first touch vs lead source.
- **Leadership**: lead funnel strip under the KPIs; 80/20 card gains a lead-channels block; Today's three ranks slow or
  unallocated leads by estimated cash.
- **Sales Manager**: speed to lead per registrar and allocated leads per sale (dead-lead effort).
- **Digest** gains a LEADS section (`digest.py` accepts `leads.json` as a third argument).
- Caveats: allocation time uses the last change of the registrar field, so bulk re-allocation of old leads inflates it;
  "Old Enquiry" flags are set on nearly every contact and are therefore not used; the Sale Stage field only ever holds
  "Allocated" or "Won". Spend (Google Ads, Meta) is not joined yet, so no channel is red-flagged.

### v2.4 (1 Nov 2026): lead quality by traffic source

- `pipeline_leads.py` groups each lead's CRM First Referrer into none / own / google-app / search / social / third-party
  and writes `leads.json → sources`: conversion per group, third-party referring domains (10+ leads), per-page
  third-party vs rest-of-page conversion, and `flags` for pages with 50+ third-party leads converting at under half the
  page's other traffic (display/PMax placements that generate form fills from job-bait and content-farm sites).
- Marketing view: "Lead quality by traffic source", "Top third-party referring sites" and "Placement leads per landing
  page" cards. Leadership Attention list and the digest ATTENTION/LEADS sections carry a "Placement leak" line while a
  page is flagged. First flag: the Skills Academy PMax page (744 third-party leads, 4 registered, 0.5% vs 1.2%).

### v2.5 (1 Nov 2026): true demand, including repeat enquiries

- Lead counts on the board were new CRM contacts only. A person who enquires again does not create a new contact, so
  repeat enquiries (about a third of all submissions) were invisible. `pipeline_leads.py` now reads the entries into
  each college's GF-list automation (Skills 4, Matric 111, Bellview 7615; one entry per form submission, double-fires
  within 10 minutes collapsed) via `contactAutomations?filters[seriesid]&filters[adddate]`, cached per automation-day
  in `sheets_private/ac/auto/`. A submission is "new" if the contact was created within 6 hours of it, otherwise
  "repeat"; contacts behind repeats are fetched by id and cached per day.
- `leads.json → demand`: daily and monthly enquiries / new / repeat per college and channel, repeat enquirers who
  registered, weekly repeat share (a step marks a routing change), time since the returning person first entered the
  CRM, and the share of the window's sales that came from repeat enquirers. `--no-demand` skips the pull.
- Marketing view: "True demand" table, "Enquiries per day · new vs repeat" chart, an Enquiries column in the channel
  funnel; the Leads KPI is relabelled "New leads". Digest LEADS section gains a "True demand" line.
