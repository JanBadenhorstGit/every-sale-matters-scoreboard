"""Plain-text highlights for a manager email, built from v2/data/sales.json and collections.json.
Usage: python v2/digest.py [sales.json] [collections.json]  -> prints subject line then body."""
import json, os, sys, datetime, collections, urllib.request

# South African public holidays (no bank processing): treated like weekends
SA_HOLIDAYS = {'2026-11-04', '2026-12-16', '2026-12-25', '2026-12-26', '2027-01-01', '2027-03-22', '2027-03-26', '2027-03-29', '2027-04-27', '2027-05-01', '2027-06-16', '2027-08-09', '2027-09-24', '2027-12-16', '2027-12-25', '2027-12-27'}

def load(path_or_url):
    if path_or_url.startswith('http'):
        return json.load(urllib.request.urlopen(path_or_url + ('&' if '?' in path_or_url else '?') + 'v=' + str(int(datetime.datetime.now().timestamp()))))
    return json.load(open(path_or_url))

def main(sales, coll, leads=None):
    S, C = load(sales), load(coll)
    try:
        LD = load(leads) if leads else None
    except Exception:
        LD = None
    age = (datetime.date.today() - datetime.date.fromisoformat(S['latest_day'])).days
    if age > 4:
        sys.exit(f"STALE: sales data ends {S['latest_day']} ({age} days ago, generated {S['generated_at']}); do not send the highlights")
    month = S['month']; days = {k: v for k, v in S['days'].items() if k.startswith(month)}
    latest = S['latest_day']; today = days.get(latest, {})
    people = {p['key']: p for p in S['roster']}
    col = {k: (people.get(k) or {}).get('college', '?') for d in days.values() for k in d}
    def tot(recs, f): return sum(r[f] for r in recs)
    m_recs = [r for d in days.values() for r in d.values()]
    t_recs = list(today.values())
    m_reg, m_do, m_paid_n, m_paid = tot(m_recs, 'reg'), tot(m_recs, 'do'), tot(m_recs, 'paid_n'), tot(m_recs, 'paid_amt') + tot(m_recs, 'once_due')
    t_reg, t_do = tot(t_recs, 'reg'), tot(t_recs, 'do')
    recorded = len(days)
    aug_per_day = sum(p.get('aug_per_day') or 0 for p in S['roster'])
    pace = 100 * (m_reg / recorded) / aug_per_day if recorded and aug_per_day else None
    by_col_t = collections.Counter(); by_col_m = collections.Counter()
    for k, r in today.items(): by_col_t[col[k]] += r['reg']
    for d in days.values():
        for k, r in d.items(): by_col_m[col[k]] += r['reg']
    # people
    top_t = sorted(today.items(), key=lambda kv: -kv[1]['reg'])[:5]
    m_by_p = collections.Counter(); m_do_p = collections.Counter()
    for d in days.values():
        for k, r in d.items(): m_by_p[k] += r['reg']; m_do_p[k] += r['do']
    active = [k for k, n in m_by_p.items() if n >= 10]
    zero_today = sorted(k for k in active if today.get(k, {}).get('reg', 0) == 0)
    low_do = sorted(((k, 100 * m_do_p[k] / m_by_p[k]) for k in active if m_by_p[k] >= 20), key=lambda x: x[1])[:3]
    # collections
    cyc = C['cancellations']; cur = sorted(cyc.keys())[-1] if isinstance(cyc, dict) else None
    rows = cyc[cur]['rows'] if cur else []
    st = collections.Counter((r.get('status') or 'unprocessed') for r in rows)
    saved = st.get('Saved', 0); canc = st.get('Cancel', 0)
    unproc = sum(1 for r in rows if not r.get('status')); logged_today = sum(1 for r in rows if r.get('logged') == latest)
    cat = collections.Counter(r.get('category') or 'not captured' for r in rows).most_common(3)
    gm = sorted(C['goals'])[-1]; g = C['goals'][gm]
    # Collections run on a cycle from the 8th to the 7th; a day's receipts are complete only the next day.
    sast_today = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=2)).date()
    cycle = sast_today.replace(day=1) if sast_today.day >= 8 else (sast_today.replace(day=1) - datetime.timedelta(days=1)).replace(day=1)
    cycle_key = cycle.strftime('%Y-%m'); nxt = (cycle.replace(day=28) + datetime.timedelta(days=5)).replace(day=1)
    cycle_label = f"8 {cycle.strftime('%b')} - 7 {nxt.strftime('%b')}"
    def day_date(mk, dom):
        y, m = int(mk[:4]), int(mk[5:]); d0 = datetime.date(y, m, 1)
        if dom < 8: d0 = (d0.replace(day=28) + datetime.timedelta(days=5)).replace(day=1)
        try: return d0.replace(day=dom)
        except ValueError: return None
    # goal tab 'actual' = bank collections since the 8th; extend from the bank tabs where the tab stops; never count today
    gm_next = (datetime.date(int(gm[:4]), int(gm[5:]), 28) + datetime.timedelta(days=5)).strftime('%Y-%m')
    cum = 0.0; last = None; note = ''
    for r in g:
        dd = day_date(gm, r['dom'])
        if dd is None or dd >= sast_today: 
            if dd is not None and dd >= sast_today: break
            continue
        if r.get('actual_cum') is not None: cum = r['actual_cum']; last = (r['dom'], cum, r['goal_cum'], False); continue
        bank = C['bank'].get(gm if r['dom'] >= 8 else gm_next, {})
        day = [x for rows in bank.values() for x in rows if x['dom'] == r['dom']]
        if not day: break
        cum += sum(x.get('collections') or 0 for x in day); last = (r['dom'], cum, r['goal_cum'], True)
    # latest complete day (yesterday or earlier) vs its day goal, and today's goal
    bank_days = sorted({(mk, x['dom']) for mk, b in C['bank'].items() for rows in b.values() for x in rows if datetime.date(int(mk[:4]), int(mk[5:]), min(x['dom'], 28)) is not None})
    def bd_date(mk, dom):
        try: return datetime.date(int(mk[:4]), int(mk[5:]), dom)
        except ValueError: return None
    complete = sorted(d for d in (bd_date(mk, dom) for mk, dom in bank_days) if d and d < sast_today and d.weekday() < 5 and d.isoformat() not in SA_HOLIDAYS)
    last_day = complete[-1] if complete else None
    def coll_on(d): return sum((x.get('collections') or 0) for rows in C['bank'].get(d.strftime('%Y-%m'), {}).values() for x in rows if x['dom'] == d.day)
    goal_row = lambda d: next((r for r in g if r['dom'] == d.day and day_date(gm, r['dom']) == d), None)
    last_day_goal = goal_row(last_day) if last_day else None; today_goal = goal_row(sast_today)
    gl = datetime.date(int(gm[:4]), int(gm[5:]), 1).strftime('%b')
    name = lambda k: people.get(k, {}).get('name', k)
    dl = datetime.date.fromisoformat(latest).strftime('%a %-d %b')
    # ---- attention (same rules as the board, abridged) ----
    alerts = []
    if S.get('config_stale'): alerts.append(f"RED  Registration data stops at {dl}: this month's sheets are not connected yet")
    if pace is not None and pace < 80: alerts.append(f"{'RED ' if pace < 70 else 'AMBER'} Team at {pace:.0f}% of August pace")
    if m_reg and 100 * m_do / m_reg < 85: alerts.append(f"AMBER Debit-order rate {100*m_do/m_reg:.0f}% this month")
    if unproc > 20: alerts.append(f"RED  {unproc} cancellation requests logged but not yet worked")
    ref = datetime.date.fromisoformat(latest)
    open_rows = [r for r in rows if (r.get('status') or '').lower() not in ('saved', 'cancel')]
    old_open = sum(1 for r in open_rows if r.get('logged') and (ref - datetime.date.fromisoformat(r['logged'])).days > 14)
    if old_open: alerts.append(f"AMBER {old_open} open cancellation requests older than 14 days")
    prev_key = sorted(cyc)[-2] if len(cyc) > 1 else None
    if prev_key:
        pr = cyc[prev_key]['rows']; ps = sum(1 for r in pr if r.get('status') == 'Saved'); pc = sum(1 for r in pr if r.get('status') == 'Cancel')
        if ps + pc and saved + canc and 100 * saved / (saved + canc) < 100 * ps / (ps + pc) - 5:
            alerts.append(f"RED  Save rate {100*saved/(saved+canc):.0f}% vs {100*ps/(ps+pc):.0f}% last cycle")
    if last and last[2] and last[1] < 0.9 * last[2] and not last[3]: alerts.append(f"AMBER Cash behind goal: R{last[1]/1e6:.2f}m vs R{last[2]/1e6:.2f}m planned")
    for f in ((LD or {}).get('sources', {}).get('flags', [])):
        alerts.append(f"AMBER Placement leak: {f['college'].split()[0]} {f['path'].split('/')[-1]} · {f['third_party_leads']:,} third-party leads, {f['third_party_registered']} registered")
    bank_latest = sorted(C['bank'])[-1]
    if bank_latest < cycle_key: alerts.append(f"AMBER Collections Daily Goal sheet has no bank tabs for the cycle {cycle_label} yet")
    if gm < cycle_key: alerts.append(f"AMBER No goal tab yet for the cycle {cycle_label}")
    # reconcile goal-tab cumulative actual with the bank tabs over the same days
    sheet_rows = [r for r in g if r.get('actual_cum') is not None and not r.get('derived')]
    if sheet_rows:
        lr = sheet_rows[-1]; up_to = day_date(gm, lr['dom'])
        if up_to:
            bank_sum = 0.0; filled = set()
            for mk, lo, hi in ((gm, 8, 31), (gm_next, 1, 7)):
                for rows in C['bank'].get(mk, {}).values():
                    for x in rows:
                        dd = day_date(gm, x['dom']) if lo <= x['dom'] <= hi else None
                        if dd and dd <= up_to and x.get('collections') is not None: bank_sum += x['collections']; filled.add(dd)
            missing = []; dd = day_date(gm, 8)
            while dd and dd <= up_to:
                if dd.weekday() < 5 and dd.isoformat() not in SA_HOLIDAYS and dd not in filled: missing.append(dd.strftime('%a %-d %b'))
                dd += datetime.timedelta(days=1)
            diff = lr['actual_cum'] - bank_sum
            if abs(diff) > max(10000, 0.02 * lr['actual_cum']):
                alerts.append(f"AMBER Goal tab shows R{lr['actual_cum']/1e3:.0f}k banked to {up_to.strftime('%-d %b')} but the bank tabs add up to R{bank_sum/1e3:.0f}k" + (f"; no bank rows for {', '.join(missing[:4])}" + (f" +{len(missing)-4}" if len(missing) > 4 else '') if missing else ''))
    for t in (C.get('sources', {}).get('bank', {}).get('copied_tabs') or []):
        alerts.append(f"RED  {t['college']} bank tab for {datetime.date(int(t['month'][:4]), int(t['month'][5:]), 1).strftime('%B')} repeats the {datetime.date(int(t['same_as'][:4]), int(t['same_as'][5:]), 1).strftime('%B')} figures (copied template?); ignored")
    unrostered = [name(k) for k in m_by_p if people.get(k, {}).get('unrostered') and m_by_p[k] > 0]
    if unrostered: alerts.append(f"AMBER {len(unrostered)} registrars selling but not on the comparison-sheet roster: {', '.join(sorted(unrostered))}")
    # ---- today's three: actions ranked by estimated cash impact (students × avg instalment × 12 months) ----
    H = 12
    inst_sum = collections.Counter(); inst_n = collections.Counter()
    for d in days.values():
        for k, r in d.items(): inst_sum[k] += r.get('inst_sum') or 0; inst_n[k] += r.get('inst_n') or 0
    team_avg = (sum(inst_sum.values()) / sum(inst_n.values())) if sum(inst_n.values()) else 600
    avg_p = lambda k: (inst_sum[k] / inst_n[k]) if inst_n[k] else team_avg
    acts = []
    team_do = 100 * m_do / m_reg if m_reg else None
    for k in active:
        per_day = m_by_p[k] / recorded if recorded else 0
        if per_day >= 2 and today.get(k, {}).get('reg', 0) == 0:
            acts.append((per_day * avg_p(k) * H, f"Call {name(k)}: no sale {dl}, usually {per_day:.1f}/day"))
        do_rate = 100 * m_do_p[k] / m_by_p[k]
        if m_by_p[k] >= 15 and team_do is not None and do_rate < team_do - 15:
            gap = round((team_do - do_rate) / 100 * m_by_p[k])
            acts.append((gap * avg_p(k) * H * 0.5, f"Coach {name(k)} on debit orders: {do_rate:.0f}% vs team {team_do:.0f}% ({gap} sales without a mandate)"))
    save_rate = (saved / (saved + canc)) if (saved + canc) else 0.15
    if unproc:
        oldest = max([(ref - datetime.date.fromisoformat(r['logged'])).days for r in rows if not r.get('status') and r.get('logged')] or [0])
        acts.append((unproc * team_avg * H * save_rate, f"Assign the {unproc} unworked cancellation requests (oldest {oldest} days)"))
    if old_open: acts.append((old_open * team_avg * H * save_rate, f"Close the {old_open} open cancellation request{'s' if old_open != 1 else ''} older than 14 days"))
    by_agent = collections.defaultdict(lambda: [0, 0, 0])
    for r in rows:
        if r.get('agent'):
            a = by_agent[r['agent']]; a[2] += 1
            if r.get('status') == 'Saved': a[0] += 1
            elif r.get('status') == 'Cancel': a[1] += 1
    for ag, (sv, cn, n) in by_agent.items():
        if sv + cn >= 15 and (saved + canc) and sv / (sv + cn) < save_rate - 0.05:
            acts.append(((save_rate - sv / (sv + cn)) * n * team_avg * H, f"Coach {ag}: save rate {100*sv/(sv+cn):.0f}% vs team {100*save_rate:.0f}% on {n} cases"))
    acts.sort(key=lambda x: -x[0])
    L = []
    L.append(f"Casus Radar · highlights to {dl}")
    L.append('')
    L.append("TODAY'S THREE (ranked by estimated cash impact)")
    for imp, txt in acts[:3]: L.append(f"- {txt} · ≈ R{imp/1e3:.0f}k")
    if not acts: L.append('- Nothing stands out today')
    L.append('')
    L.append('ATTENTION' if alerts else 'ATTENTION: nothing flagged')
    for a in alerts[:8]: L.append('- ' + a)
    L.append('')
    L.append('SALES')
    L.append(f"- {dl}: {t_reg} registrations ({t_do} with debit orders)" + (' · ' + ', '.join(f"{c} {n}" for c, n in by_col_t.most_common()) if by_col_t else ''))
    L.append(f"- Month to date: {m_reg:,} registrations in {recorded} days" + (f" · {pace:.0f}% of August pace" if pace else '') + f" · D/O rate {100*m_do/m_reg:.0f}% · upfront cash R{m_paid:,.0f} on {m_paid_n} sales")
    L.append('- By college this month: ' + ', '.join(f"{c} {n:,}" for c, n in by_col_m.most_common()))
    L.append('- Top today: ' + ', '.join(f"{name(k)} {r['reg']}" for k, r in top_t))
    if zero_today: L.append(f"- Active registrars with no sale {dl}: " + ', '.join(name(k) for k in zero_today))
    if low_do: L.append('- Lowest debit-order rate this month: ' + ', '.join(f"{name(k)} {p:.0f}%" for k, p in low_do))
    cm = (S.get('course_months') or {}).get(month) or {}
    if cm:
        dep = collections.Counter(); val = collections.Counter()
        for v in cm.values(): dep[v['dept']] += v['n']; val[v['dept']] += v['inst_sum']
        L.append('- By course type: ' + ', '.join(f"{d} {n:,} (R{val[d]/1e6:.2f}m/month signed)" for d, n in dep.most_common()))
    L.append('')
    L.append('COLLECTIONS')
    if last_day: L.append(f"- {last_day.strftime('%a %-d %b')} (latest complete day): R{coll_on(last_day)/1e3:,.0f}k banked" + (f" vs R{last_day_goal['goal_day']/1e3:,.0f}k day goal" if last_day_goal and last_day_goal.get('goal_day') else " · no day goal"))
    if today_goal and today_goal.get('goal_day') is not None: L.append(f"- Today's goal ({sast_today.strftime('%a %-d %b')}): R{today_goal['goal_day']/1e3:,.0f}k · R{today_goal['goal_cum']/1e6:.2f}m planned by tonight")
    if last: L.append(f"- Cycle cash vs goal ({cycle_label}): R{last[1]/1e6:.2f}m banked to {last[0]} {gl if last[0] >= 8 else nxt.strftime('%b')} vs R{last[2]/1e6:.2f}m planned" + (" (goal tab not filled past " + str([r['dom'] for r in g if r.get('actual_cum') is not None and not r.get('derived')][-1]) + f" {gl}; rest from bank tabs)" if last[3] else ''))
    if cur: L.append(f"- Cancellation requests this cycle: {len(rows)} · {saved} saved, {canc} cancelled · save rate {100*saved/max(1,saved+canc):.0f}% · {unproc} logged but not yet worked · {logged_today} logged {dl}")
    if cat: L.append('- Main reasons: ' + ', '.join(f"{c} {n}" for c, n in cat))
    L.append('')
    if LD and LD.get('monthly', {}).get(month):
        L.append('LEADS')
        tot = collections.Counter(); chs = []
        for col, cc in LD['monthly'][month].items():
            for ch, v in cc.items():
                for k in ('leads', 'allocated', 'registered', 'do'): tot[k] += v[k]
                if v['leads'] >= 100: chs.append((f"{col.split()[0]} {ch}", v['leads'], 100 * v['registered'] / v['leads']))
        sp = LD.get('speed', {}).get('by_college', {})
        n_all = sum(v['n'] for v in sp.values()); w24 = sum((v.get('within_24h_pct') or 0) * v['n'] for v in sp.values()) / n_all if n_all else None
        L.append(f"- Leads created this month: {tot['leads']:,} · {100*tot['allocated']/max(1,tot['leads']):.0f}% allocated · {tot['registered']:,} registered ({100*tot['registered']/max(1,tot['leads']):.1f}%)")
        if w24 is not None: L.append(f"- Allocated to a registrar within 24 h: {w24:.0f}% (median " + ', '.join(f"{c.split()[0]} {v['median_min']/60:.0f} h" for c, v in sp.items() if v.get('median_min')) + ')')
        chs.sort(key=lambda x: -x[2])
        if chs: L.append('- Best converting channels: ' + ', '.join(f"{n} {p:.1f}%" for n, l, p in chs[:3]) + ' · weakest: ' + ', '.join(f"{n} {p:.1f}%" for n, l, p in chs[-2:]))
        for f in LD.get('sources', {}).get('flags', []):
            L.append(f"- PLACEMENT LEAK {f['college'].split()[0]} {f['path'].split('/')[-1]}: {f['third_party_leads']:,} leads via third-party sites, {f['third_party_registered']} registered ({f['third_party_conv']}% vs {f['rest_conv']}% for the page's other traffic). Add placement exclusions in Google Ads.")
        RE = (LD.get('demand') or {}).get('reentries', {}); DDm = (LD.get('demand') or {}).get('daily', {})
        for day in sorted(RE)[-3:]:
            for col, n in RE[day].items():
                tot = (DDm.get(day, {}).get(col) or {}).get('enquiries', 0)
                if tot >= 50 and n / tot > 0.1:
                    L.append(f"- DUPLICATE ROWS {col.split()[0]} GF list: {n:,} of {tot:,} entries on {datetime.date.fromisoformat(day).strftime('%a %-d %b')} were the same contact entering again within an hour. Each writes another row on the sales sheet; check the GF-list automation waits against the 10-minute backup retag.")
        DM = (LD.get('demand') or {}).get('monthly', {}).get(month)
        if DM:
            e = n = r = 0; per_col = []
            for col, cc in DM.items():
                ce = sum(v['enquiries'] for v in cc.values()); cr = sum(v['repeat'] for v in cc.values())
                e += ce; r += cr; n += sum(v['new'] for v in cc.values()); per_col.append((col.split()[0], ce, cr))
            ds = (LD['demand'].get('sales') or {})
            L.append(f"- True demand this month: {e:,} enquiries = {n:,} new contacts + {r:,} repeat enquiries ({100*r/max(1,e):.0f}% repeats) · " + ', '.join(f"{c} {ce:,} ({100*cr/max(1,ce):.0f}% repeat)" for c, ce, cr in sorted(per_col, key=lambda x: -x[1])))
            if ds.get('total'): L.append(f"- Sales in the last {LD['window']['days']} days from people who enquired again: {ds['from_repeat_enquirers']:,} of {ds['total']:,} ({ds['pct']}%)")
        try:
            AD = load(os.path.join(os.path.dirname(str(leads)), 'ads.json')).get('monthly', {}).get(month, {}) if leads else {}
        except Exception:  # noqa: BLE001
            AD = {}
        if AD:
            bits = []
            for col, chs in (LD.get('monthly', {}).get(month) or {}).items():
                for ch, v in chs.items():
                    a_ = (AD.get(col) or {}).get(ch)
                    if a_ and a_.get('cost') and v.get('registered'):
                        bits.append((col.split()[0] + ' ' + ch, a_['cost'] / v['registered'], a_['cost']))
            if bits: L.append('- Ad spend per registration this month: ' + ' · '.join(f"{n} R{c:,.0f} (spend R{t/1000:,.0f}k)" for n, c, t in sorted(bits, key=lambda x: -x[1])))
        try:  # v2.10: spend and volume signals (mirrors marketingSignals in app.js)
            ADS = load(os.path.join(os.path.dirname(str(leads)), 'ads.json')) if leads else {}
            L.extend(spend_signals(ADS, LD))
        except Exception:  # noqa: BLE001
            pass
        try:
            PAY = load(os.path.join(os.path.dirname(str(leads)), 'payments.json')) if leads else {}
        except Exception:  # noqa: BLE001
            PAY = {}
        if PAY.get('months'):
            to = PAY.get('report_registered_to', '')
            import datetime as _dt
            try: cutoff = (_dt.date.fromisoformat(to) - _dt.timedelta(days=66)).strftime('%Y-%m')
            except Exception: cutoff = to[:7]  # noqa: BLE001
            closed = [m for m in sorted(PAY['months']) if (PAY['months'][m].get('_all') or {}).get('sold', 0) >= 50 and m <= cutoff]
            if closed:
                m0 = closed[-1]; a0 = PAY['months'][m0]['_all']
                L.append(f"- What sold actually pays (FileMaker to {to}): {m0} sales {a0['sold']:,}, paid anything {a0['paid_pct']:.0f}%, never paid {a0['pending']:,}, cash R{a0['paid_amt']/1000:,.0f}k")
        age = LD.get('lead_age_at_sale', {}).get(month, {}); at = sum(age.values())
        if at: L.append(f"- Sales from leads older than 30 days: {100*(age.get('31–90 days',0)+age.get('over 90 days',0))/at:.0f}% · no CRM enquiry found: {100*age.get('no lead found',0)/at:.0f}%")
        L.append('')
    L.append('Full board: https://janbadenhorstgit.github.io/every-sale-matters-scoreboard/v2/')
    return L[0], '\n'.join(L[2:])

def spend_signals(ADS, LD):
    """Week-on-week Google Ads spend, zero-spend days and unusual enquiry days, with the spend-moved test."""
    import datetime as _dt
    out = []
    daily = (ADS or {}).get('daily') or {}
    if not daily: return out
    gen = (ADS.get('generated_at') or '')[:10]
    try: as_of = _dt.date.fromisoformat(gen) - _dt.timedelta(days=1)
    except Exception: return out  # noqa: BLE001
    def cost(col, d): return (((daily.get(col) or {}).get(d.isoformat()) or {}).get('PPC') or {}).get('cost') or 0
    def span(col, a, b): return sum(cost(col, a + _dt.timedelta(days=i)) for i in range((b - a).days + 1))
    for col in daily:
        cur = span(col, as_of - _dt.timedelta(days=6), as_of); prev = span(col, as_of - _dt.timedelta(days=13), as_of - _dt.timedelta(days=7))
        if prev > 1000 and abs(cur - prev) / prev > 0.25:
            out.append(f"- MARKETING {col.split()[0]} Google Ads spend {'up' if cur > prev else 'down'} {abs(cur - prev) / prev * 100:.0f}% week on week (R{cur/1000:,.0f}k vs R{prev/1000:,.0f}k, 7 days to {as_of.strftime('%-d %b')})")
        for i in (2, 1, 0):
            d = as_of - _dt.timedelta(days=i); mean = sum(cost(col, d - _dt.timedelta(days=k)) for k in (7, 14, 21, 28)) / 4
            if mean > 500 and cost(col, d) < 0.05 * mean:
                out.append(f"- MARKETING {col.split()[0]}: no Google Ads spend on {d.strftime('%a %-d %b')} (normally R{mean/1000:,.1f}k that weekday). Check account status and billing.")
    dd = ((LD or {}).get('demand') or {}).get('daily') or {}
    to = ((LD or {}).get('window') or {}).get('to')
    days = sorted(k for k in dd if not to or k <= to)[-3:]
    for k in days:
        d = _dt.date.fromisoformat(k)
        for col, v in dd[k].items():
            hist = [dd[(d - _dt.timedelta(days=7 * j)).isoformat()][col]['enquiries'] for j in (1, 2, 3, 4) if (d - _dt.timedelta(days=7 * j)).isoformat() in dd and col in dd[(d - _dt.timedelta(days=7 * j)).isoformat()]]
            if len(hist) < 3: continue
            mean = sum(hist) / len(hist)
            if mean < 30: continue
            ratio = v['enquiries'] / mean
            if ratio < 0.6 or ratio > 1.6:
                sp = cost(col, d); sph = sum(cost(col, d - _dt.timedelta(days=7 * j)) for j in (1, 2, 3, 4)) / 4
                sr = sp / sph if sph else None
                if d > as_of: cause = 'spend not yet reported for this day'
                elif sr is None: cause = 'no Google Ads spend on this weekday either way'
                elif (ratio < 1 and sr < 0.75) or (ratio > 1 and sr > 1.4): cause = 'spend moved with it: marketing'
                else: cause = 'spend did not move: check routing and forms'
                out.append(f"- MARKETING {col.split()[0]}: {v['enquiries']:,} enquiries on {d.strftime('%a %-d %b')} vs {mean:,.0f} normal for that weekday ({(ratio-1)*100:+.0f}%); {cause}")
    return out

if __name__ == '__main__':
    a = sys.argv[1:] or ['v2/data/sales.json', 'v2/data/collections.json', 'v2/data/leads.json']
    subj, body = main(*a); print(subj); print(); print(body)
