"""Plain-text highlights for a manager email, built from v2/data/sales.json and collections.json.
Usage: python v2/digest.py [sales.json] [collections.json]  -> prints subject line then body."""
import json, os, sys, datetime, collections, urllib.request

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
    # goal tab 'actual' = bank collections since the 8th; extend from the bank tabs where the tab stops
    bank = C['bank'].get(gm, {}); cum = 0.0; last = None; note = ''
    import calendar; dim = calendar.monthrange(int(gm[:4]), int(gm[5:]))[1]
    for r in g:
        if r.get('actual_cum') is not None: cum = r['actual_cum']; last = (r['dom'], cum, r['goal_cum'], False); continue
        if r['dom'] < 8 or r['dom'] > dim: continue
        day = [x for rows in bank.values() for x in rows if x['dom'] == r['dom']]
        if not day: break
        cum += sum(x.get('collections') or 0 for x in day); last = (r['dom'], cum, r['goal_cum'], True)
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
    old_open = sum(1 for r in open_rows if (ref - datetime.date.fromisoformat(r['logged'])).days > 14)
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
    if bank_latest < month: alerts.append(f"AMBER Collections Daily Goal sheet has no tabs for {datetime.date(int(month[:4]), int(month[5:]), 1).strftime('%B')} yet")
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
        oldest = max((ref - datetime.date.fromisoformat(r['logged'])).days for r in rows if not r.get('status'))
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
    if last: L.append(f"- Cash vs goal (cycle from 8 {gl}): R{last[1]/1e6:.2f}m banked by {last[0]} {gl} vs R{last[2]/1e6:.2f}m planned" + (" (goal tab not filled past " + str([r['dom'] for r in g if r.get('actual_cum') is not None and not r.get('derived')][-1]) + f" {gl}; rest from bank tabs)" if last[3] else ''))
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

if __name__ == '__main__':
    a = sys.argv[1:] or ['v2/data/sales.json', 'v2/data/collections.json', 'v2/data/leads.json']
    subj, body = main(*a); print(subj); print(); print(body)
