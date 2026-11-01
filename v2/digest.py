"""Plain-text highlights for a manager email, built from v2/data/sales.json and collections.json.
Usage: python v2/digest.py [sales.json] [collections.json]  -> prints subject line then body."""
import json, sys, datetime, collections, urllib.request

def load(path_or_url):
    if path_or_url.startswith('http'):
        return json.load(urllib.request.urlopen(path_or_url + ('&' if '?' in path_or_url else '?') + 'v=' + str(int(datetime.datetime.now().timestamp()))))
    return json.load(open(path_or_url))

def main(sales, coll):
    S, C = load(sales), load(coll)
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
    m_reg, m_do, m_paid_n, m_paid = tot(m_recs, 'reg'), tot(m_recs, 'do'), tot(m_recs, 'paid_n'), tot(m_recs, 'paid_amt')
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
    bank_latest = sorted(C['bank'])[-1]
    if bank_latest < month: alerts.append(f"AMBER Collections Daily Goal sheet has no tabs for {datetime.date(int(month[:4]), int(month[5:]), 1).strftime('%B')} yet")
    unrostered = [name(k) for k in m_by_p if people.get(k, {}).get('unrostered') and m_by_p[k] > 0]
    if unrostered: alerts.append(f"AMBER {len(unrostered)} registrars selling but not on the comparison-sheet roster: {', '.join(sorted(unrostered))}")
    L = []
    L.append(f"Every Sale Matters · highlights to {dl}")
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
    L.append('Full board: https://janbadenhorstgit.github.io/every-sale-matters-scoreboard/v2/')
    return L[0], '\n'.join(L[2:])

if __name__ == '__main__':
    a = sys.argv[1:] or ['v2/data/sales.json', 'v2/data/collections.json']
    subj, body = main(*a); print(subj); print(); print(body)
