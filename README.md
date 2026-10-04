# Sales scoreboard — every sale matters

A public, self-updating sales scoreboard for the team.

- `index.html` — the scoreboard page (person picker, Today/Yesterday/Week/Month, league, colleges, weekly incentives).
- `scoreboard.json` — the latest computed numbers (regenerated hourly during work hours).
- `scoreboard_pipeline.py` — reads the team's four public Google Sheets and applies the comparison-report counting rules.
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
