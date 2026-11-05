# Lead Dealer

Hands out new GF-list leads to registrars using Johan's current rules. Runs as an Apps Script
inside the private "Lead Dealer – Control" Google Sheet (in Jan's Drive). No lead data is stored here.

- `LeadDealer.gs` – the single file pasted into Extensions > Apps Script (built from the three files below).
- `Engine.gs` – the rules: language and course decide the team (Routes tab); within a team the on-floor
  registrar with the smallest pile (relative to weight, under the daily cap) gets the lead.
- `Dealer.gs` – reads the GF lists every 5 minutes, writes the Log (CRM IDs only), checks the registrar
  pages every 30 minutes and writes the Summary. Modes per college: OFF / SHADOW / LIVE.
  In LIVE it writes the lead into the registrar's day tab and colours the GF row; rows staff have already
  coloured are skipped.
- `Panel.gs`, `panel.html` – Johan's panel, a web app behind the Skills Academy login
  (Casus Radar links to it from the Lead Dealer menu item). Only "Panel editors" can save;
  only "Switch editors" can change a mode. Every change is recorded in the Changes tab.
- `config.json` – the starting Routes and Roster (the live copy is in the Control sheet).
- `run_test.js`, `panel_test.js` with `mock_test.js` – run the script end to end against in-memory sheets:
  `(cat Engine.gs Dealer.gs Panel.gs; echo "var PANEL_HTML='';module.exports={LOG_HEADERS,runDealer,checkPages,getPanelData,savePanel};") > Dealer.gs.js && node run_test.js`
- Back-test (October 2026 hand-outs): 96% of real hand-outs fall within the teams the rules allow.

To rebuild `LeadDealer.gs` after a change, concatenate Engine.gs, Dealer.gs, Panel.gs and
`var PANEL_HTML = String.raw\`<panel.html>\`;`, then paste it into the Apps Script editor and save.
