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
