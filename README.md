# Casus Radar — every sale matters

A public, self-updating sales and collections scoreboard for the team.

**Since 2 Nov 2026 the root page (`index.html`) opens the role-based board in `v2/` (Casus Radar).**
The original one-page scoreboard lives on at `classic/` until 16 Nov 2026 and is then retired.
Planned address: `radar.casus.co.za` (CNAME to `janbadenhorstgit.github.io`, DNS managed by Jephta).

- `classic/index.html` — the original scoreboard page (person picker, Today/Yesterday/Week/Month, league, colleges, weekly incentives).
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
  pick-up) into `v2/data/sales.json`. A "1st Payment" above R3,000 (ICB and Nated full fees, some
  Matric deposits) is a once-off, not a monthly instalment: it is valued at the amount paid, shown
  under upfront cash (`once_n`, `once_amt`, and `once_due` for the part not yet in the Paid column),
  and left out of the instalment average, so 12-month valuations no longer multiply a full fee by 12. Earlier months are kept in that file, so a month survives
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

### v2.6 — ad spend in the channel funnel (`v2/data/ads.json`)

`v2/data/ads.json` holds monthly ad spend per college and channel: `PPC` from the Google Ads API
(campaign report segmented by date; Skills 8596839047, Matric 4364796192, Bellview 6903639633) and
`Facebook` from the Meta Marketing API (account-level amount spent; Skills from the
"Skills_Academy_Backup" account, Bellview 562792675051629; the Matric College account is not yet
readable through the API). The Marketing view's "Funnel by college and channel" table adds Ad spend,
cost per enquiry, cost per registration (red when above the 12-month value of a registration on that
channel, amber above half of it) and value ÷ spend; "Today's three" raises a marketing action when a
channel's spend exceeds the value it bought. The file is refreshed by a trusted task, not by the
public GitHub Action. When the current month has fewer than 5 registrations on every channel the
table shows the last full month.

GCLID check (2 Nov 2026): the CRM has no GCLID field. The "Source Page" field keeps the landing-page
path with its query string, which includes a full `gclid` for roughly one in ten recent values and
only on the newer landing pages, so an offline-conversion feed to Google Ads is not viable until every
form stores the gclid (hidden field) on submission.

### v2.7 — what sold actually pays (`v2/data/payments.json`)

`v2/pipeline_payments.py` joins every sale in the registration sheets (since August 2026) to the
weekly FileMaker report "All registrations 2024 to date" by CRM number, taking the FileMaker row whose
registration date is nearest the sale day (98–99% of sales are found). It writes only aggregates to
`v2/data/payments.json`: per sales month, per registrar, per course family, per department and per
sales week — sold, matched, paid anything, cash received, never paid (status Pending), cancelled,
fully paid. The FileMaker export itself holds personal data and is never committed. A sale "has paid"
when FileMaker shows any learner payment for that registration; payments are cumulative to the report
date, so the newest month is not comparable with older ones. The paid-anything share flattens about six
weeks after the sale, so the registrar and course tables judge only months whose end is at least five
weeks before the report date.

Leadership, Sales Manager and Collections Manager show "What sold actually pays" (per month), the
weekly cohort curve, "Registrars · whose sales pay" (paid share vs the team on the same months, and
how many sales short of the team rate) and "Courses · which sales pay". "Today's three" raises a
leadership action when a registrar with 40+ matched sales pays 12 points or more below the team rate.

First reading (report to 31 Oct 2026): of August sales, 44% have paid anything and 1,603 of 3,165
never paid; registrars range from 24% to 80% on the same month's sales.

### v2.8 — paid landing pages: what a registration costs (`ads.json → pages`)

Google Ads spend per landing page (ad-level final URLs for Search and Demand Gen; campaign spend for
Performance Max) for 17 Sep – 31 Oct 2026, joined to CRM enquiries carrying that page as Source Page and
to the registration sheets. Per page: spend, leads, registrations, rand per registration (red at twice the
college median, "none" when no registration), share of enquirers answering "I have no funds", share
answering "Still at High School", and the conversion of enquirers who do have funds. Shown on the
Marketing view. Snapshot; refreshed together with ads.json. Bellview's course pages (OHS, Business)
cannot be judged yet: most Bellview PPC enquiries carry no Source Page.

### v2.9 — collections run on a cycle, and a day is complete only the next day

- Collections are judged on the cycle **8th to 7th** (named after the month it starts in), never on the calendar
  month: cycle totals, "no tab yet" flags, chart titles and the digest all use the cycle. There is no "November
  collections goal" while the 8 Oct – 7 Nov cycle is running.
- A day's bank receipts are only complete the next day. Today's figures are shown as partial and excluded from
  cumulative actuals, forecasts and day comparisons. The Collections Manager view opens with **latest complete
  banking day vs its day goal** (weekends skipped) and **today's day goal** from the goal tab.
- `pipeline_collections.py` accepts both tab-name orders ("Matric Bank October", "Skills Academy October Bank",
  including the "Bellivew" spelling). A bank tab whose figures equal the previous month's is a copied template:
  it is dropped and flagged in Attention and the digest (`sources.bank.copied_tabs`).
