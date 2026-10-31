/* Every Sale Matters v2 — role-based sales & collections scoreboard.
   Reads data/sales.json (public sheets, refreshed by GitHub Actions) and
   data/collections.json (internal sheets, refreshed by a trusted task). */
(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };

  // ---------- formatting ----------
  const nf0 = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const n0 = v => (v === null || v === undefined || Number.isNaN(v)) ? '–' : nf0.format(v);
  const n1 = v => (v === null || v === undefined || Number.isNaN(v)) ? '–' : nf1.format(v);
  const rand = v => (v === null || v === undefined || Number.isNaN(v)) ? '–' : 'R' + nf0.format(Math.round(v));
  const randK = v => (v === null || v === undefined) ? '–' : (Math.abs(v) >= 1e6 ? 'R' + n1(v / 1e6) + 'm' : Math.abs(v) >= 1e4 ? 'R' + n0(v / 1e3) + 'k' : rand(v));
  const pct = (a, b, d = 0) => b ? (100 * a / b).toFixed(d) + '%' : '–';
  const pctN = (a, b) => b ? 100 * a / b : null;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dShort = iso => { const d = new Date(iso + 'T00:00:00'); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const dDow = iso => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(iso + 'T00:00:00').getDay()];
  const monthLabel = ym => `${MONTHS_LONG[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
  const timeAgo = iso => {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} days ago`;
  };
  const collegeClass = c => /skills/i.test(c) ? 'skills' : /bellview/i.test(c) ? 'bellview' : /matric/i.test(c) ? 'matric' : '';
  const collegeColor = c => ({ skills: '#3ddc84', bellview: '#4da3ff', matric: '#ff6b81' })[collegeClass(c)] || '#9aa5b1';
  const firstName = s => (s || '').trim().split(/\s+/)[0].toLowerCase();

  // SA public holidays 2026 (for working-day projections)
  const HOLIDAYS = new Set(['2026-01-01', '2026-03-21', '2026-04-03', '2026-04-06', '2026-04-27', '2026-05-01', '2026-06-16', '2026-08-10', '2026-09-24', '2026-12-16', '2026-12-25', '2026-12-26']);
  const isWorkDay = d => { const dow = d.getDay(); return dow !== 0 && dow !== 6 && !HOLIDAYS.has(d.toISOString().slice(0, 10)); };
  const workDaysInMonth = ym => {
    const [y, m] = ym.split('-').map(Number);
    let n = 0;
    for (let d = new Date(Date.UTC(y, m - 1, 1)); d.getUTCMonth() === m - 1; d.setUTCDate(d.getUTCDate() + 1)) {
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6 && !HOLIDAYS.has(d.toISOString().slice(0, 10))) n++;
    }
    return n;
  };

  // ---------- state ----------
  const S = { role: 'leadership', who: null, sales: null, coll: null, charts: [] };

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get('role')) S.role = p.get('role');
    if (p.get('who')) S.who = p.get('who');
  }
  function writeHash() {
    const p = new URLSearchParams();
    p.set('role', S.role);
    if (S.who && /agent/.test(S.role)) p.set('who', S.who);
    history.replaceState(null, '', '#' + p.toString());
  }

  // ---------- derived sales data ----------
  function buildSales(raw) {
    const days = Object.keys(raw.days).sort();
    const month = raw.month;
    const monthDays = days.filter(d => d.startsWith(month));
    const latest = raw.latest_day;
    const yesterday = monthDays[monthDays.indexOf(latest) - 1] || null;
    const lt = new Date(latest + 'T00:00:00');
    const monday = new Date(lt); monday.setDate(lt.getDate() - ((lt.getDay() + 6) % 7));
    const mondayIso = monday.toISOString().slice(0, 10);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const sundayIso = sunday.toISOString().slice(0, 10);
    const weekDays = days.filter(d => d >= mondayIso && d <= sundayIso);
    const workDays = workDaysInMonth(month);
    const recorded = monthDays.length;
    const remaining = Math.max(0, workDays - recorded);

    const prevMonth = (() => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); })();
    const prevMonthDays = days.filter(d => d.startsWith(prevMonth));

    const zero = () => ({ reg: 0, do: 0, paid_n: 0, paid_amt: 0, digital: 0, pup: 0, inst_sum: 0, inst_n: 0,
      inst: { lt400: 0, b400_699: 0, b700_1499: 0, ge1500: 0, unknown: 0 }, lead: { le7: 0, d8_14: 0, d15_30: 0, gt30: 0, unknown: 0 } });
    const add = (a, r) => {
      if (!r) return a;
      for (const k of ['reg', 'do', 'paid_n', 'paid_amt', 'digital', 'pup', 'inst_sum', 'inst_n']) a[k] += r[k] || 0;
      for (const k in a.inst) a.inst[k] += (r.inst && r.inst[k]) || 0;
      for (const k in a.lead) a.lead[k] += (r.lead && r.lead[k]) || 0;
      return a;
    };
    const sumFor = (key, dayList) => dayList.reduce((a, d) => add(a, raw.days[d][key]), zero());
    const teamFor = dayList => dayList.reduce((a, d) => { for (const k in raw.days[d]) add(a, raw.days[d][k]); return a; }, zero());

    const people = raw.roster.map(p => {
      const m = sumFor(p.key, monthDays);
      const w = sumFor(p.key, weekDays);
      const pm = sumFor(p.key, prevMonthDays);
      const today = (raw.days[latest][p.key] || {}).reg || 0;
      const yday = yesterday ? ((raw.days[yesterday][p.key] || {}).reg || 0) : null;
      let best = 0, bestDate = null, prevBest = 0;
      const series = monthDays.map(d => (raw.days[d][p.key] || {}).reg || 0);
      for (const d of days) {
        const v = (raw.days[d][p.key] || {}).reg || 0;
        if (v > best) { best = v; bestDate = d; }
        if (d < latest && v > prevBest) prevBest = v;
      }
      let streak = 0;
      for (let i = monthDays.length - 1; i >= 0; i--) { if (series[i] > 0) streak++; else break; }
      const perDay = recorded ? m.reg / recorded : 0;
      const expected = p.aug_per_day != null ? p.aug_per_day * recorded : null;
      const lastTwo = monthDays.slice(-2).reduce((a, d) => a + ((raw.days[d][p.key] || {}).reg || 0), 0);
      return {
        ...p, today, yesterday: yday, week: w.reg, month: m.reg, m, w, pm, prevMonth: pm.reg,
        best, bestDate, prevBest, streak, perDay, expected,
        pct: expected ? 100 * m.reg / expected : null,
        projection: m.reg + perDay * remaining,
        doRate: pctN(m.do, m.reg), paidRate: pctN(m.paid_n, m.reg), avgInst: m.inst_n ? m.inst_sum / m.inst_n : null,
        lowBand: pctN(m.inst.lt400 + m.inst.b400_699, m.reg), fastPay: pctN(m.lead.le7, m.reg), digital: pctN(m.digital, m.reg),
        lastTwo, series, active: m.reg > 0 || pm.reg > 0 || w.reg > 0,
      };
    });

    const colleges = {};
    for (const p of people) {
      const c = colleges[p.college] ||= { name: p.college, people: [], m: zero(), w: zero(), pm: zero(), today: 0, expected: 0, augPerDay: 0, series: monthDays.map(() => 0) };
      c.people.push(p); add(c.m, p.m); add(c.w, p.w); add(c.pm, p.pm); c.today += p.today;
      if (p.aug_per_day != null) { c.expected += p.aug_per_day * recorded; c.augPerDay += p.aug_per_day; }
      p.series.forEach((v, i) => c.series[i] += v);
    }
    for (const c of Object.values(colleges)) {
      c.pct = c.expected ? 100 * c.m.reg / c.expected : null;
      c.perDay = recorded ? c.m.reg / recorded : 0;
      c.projection = c.m.reg + c.perDay * remaining;
      c.doRate = pctN(c.m.do, c.m.reg);
    }
    const team = { m: teamFor(monthDays), w: teamFor(weekDays), pm: teamFor(prevMonthDays), today: teamFor([latest]).reg, yesterday: yesterday ? teamFor([yesterday]).reg : null };
    team.expected = Object.values(colleges).reduce((a, c) => a + c.expected, 0);
    team.pct = team.expected ? 100 * team.m.reg / team.expected : null;
    team.perDay = recorded ? team.m.reg / recorded : 0;
    team.projection = team.m.reg + team.perDay * remaining;
    team.doRate = pctN(team.m.do, team.m.reg); team.paidRate = pctN(team.m.paid_n, team.m.reg);
    team.avgInst = team.m.inst_n ? team.m.inst_sum / team.m.inst_n : null;
    team.fastPay = pctN(team.m.lead.le7, team.m.reg);
    team.lowBand = pctN(team.m.inst.lt400 + team.m.inst.b400_699, team.m.reg);
    team.series = monthDays.map(d => teamFor([d]).reg);
    team.augPerDay = Object.values(colleges).reduce((a, c) => a + c.augPerDay, 0);

    // daily team totals for the whole history (for trend charts)
    const history = days.map(d => ({ d, reg: teamFor([d]).reg }));

    return { raw, days, month, monthDays, latest, yesterday, weekDays, mondayIso, workDays, recorded, remaining, prevMonth, prevMonthDays, people, colleges, team, history, zero, add };
  }

  // ---------- derived collections data ----------
  function buildCollections(raw) {
    if (!raw) return null;
    const cycles = Object.keys(raw.cancellations || {}).sort();
    const cur = cycles[cycles.length - 1];
    const prev = cycles[cycles.length - 2];
    const agg = rows => {
      const o = { total: rows.length, saved: 0, cancelled: 0, open: 0, unprocessed: 0, fault: 0, attempts: 0, contacts: 0, offers: 0, sentToColl: 0,
        byCat: {}, byCollege: {}, byAgent: {}, bySales: {}, byDay: {}, byCourse: {} };
      for (const r of rows) {
        const st = (r.status || '').toLowerCase();
        if (st === 'saved') o.saved++; else if (st === 'cancel') o.cancelled++; else if (st) o.open++; else o.unprocessed++;
        if (r.our_fault) o.fault++;
        o.attempts += r.attempts.length;
        o.contacts += r.attempts.filter(a => /success/i.test(a)).length;
        if (r.offer_made) o.offers++;
        if (r.sent_to_collections) o.sentToColl++;
        if (r.category) o.byCat[r.category] = (o.byCat[r.category] || 0) + 1;
        if (r.college) o.byCollege[r.college] = (o.byCollege[r.college] || 0) + 1;
        if (r.course) o.byCourse[r.course] = (o.byCourse[r.course] || 0) + 1;
        o.byDay[r.logged] = (o.byDay[r.logged] || 0) + 1;
        if (r.agent) {
          const a = o.byAgent[r.agent] ||= { name: r.agent, total: 0, saved: 0, cancelled: 0, open: 0, attempts: 0, contacts: 0, offers: 0, cats: {} };
          a.total++; if (st === 'saved') a.saved++; else if (st === 'cancel') a.cancelled++; else a.open++;
          a.attempts += r.attempts.length; a.contacts += r.attempts.filter(x => /success/i.test(x)).length; if (r.offer_made) a.offers++;
          if (r.category) a.cats[r.category] = (a.cats[r.category] || 0) + 1;
        }
        if (r.sales_agent) {
          const k = firstName(r.sales_agent);
          const s = o.bySales[k] ||= { total: 0, saved: 0, cancelled: 0 };
          s.total++; if (st === 'saved') s.saved++; else if (st === 'cancel') s.cancelled++;
        }
      }
      o.decided = o.saved + o.cancelled;
      o.saveRate = pctN(o.saved, o.decided);
      return o;
    };
    const perCycle = {};
    for (const k of cycles) perCycle[k] = { ...raw.cancellations[k], agg: agg(raw.cancellations[k].rows) };

    const bankMonths = Object.keys(raw.bank || {}).sort();
    const goalMonths = Object.keys(raw.goals || {}).sort();
    // The goal sheet's "actual" is cumulative bank collections from the 8th. Where the goal tab stops
    // being filled in but the bank tabs continue, extend the actual line from the bank tabs (marked derived).
    for (const m of goalMonths) {
      const g = raw.goals[m]; const bankM = raw.bank[m];
      const nextM = (() => { const y = +m.slice(0, 4), mo = +m.slice(5, 7); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; })();
      const bankNext = raw.bank[nextM];
      const dayColl = (bank, dom) => bank ? Object.values(bank).reduce((t, rows) => t + rows.filter(r => r.dom === dom).reduce((u, r) => u + (r.collections || 0), 0), 0) : null;
      const hasBankDay = (bank, dom) => !!bank && Object.values(bank).some(rows => rows.some(r => r.dom === dom));
      let cum = 0; let filled = 0; g.sheetTo = null;
      for (const r of g) {
        const inThisMonth = r.dom >= 8; const bank = inThisMonth ? bankM : bankNext;
        if (r.actual_cum != null) { cum = r.actual_cum; g.sheetTo = r.dom; continue; }
        if (inThisMonth && r.dom > new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate()) continue; // e.g. 31 Sep
        if (!hasBankDay(bank, r.dom)) break;
        cum += dayColl(bank, r.dom); r.actual_cum = Math.round(cum * 100) / 100; r.derived = true; filled++;
      }
      g.derivedDays = filled;
    }
    return { raw, cycles, cur, prev, perCycle, bankMonths, goalMonths, agg };
  }

  // ---------- charts ----------
  Chart.defaults.color = '#9aa5b1';
  Chart.defaults.borderColor = '#222a33';
  Chart.defaults.font.family = "'Satoshi', system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight = 10;
  Chart.defaults.animation.duration = 500;
  function chart(canvas, cfg) {
    const c = new Chart(canvas, cfg);
    S.charts.push(c);
    return c;
  }
  function destroyCharts() { for (const c of S.charts) c.destroy(); S.charts = []; }
  const chartCard = (title, sub, cls = '') => {
    const canvas = el('canvas');
    const card = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, title), sub ? el('span', { class: 'xs muted' }, sub) : null), el('div', { class: 'chart ' + cls }, canvas));
    return { card, canvas };
  };

  // ---------- generic widgets ----------
  const kpi = (label, value, sub, cls = '') => el('div', { class: 'card kpi' }, el('div', { class: 'label' }, label), el('div', { class: 'value num ' + cls }, value), sub ? el('div', { class: 'sub' }, sub) : null);
  const pill = (txt, cls = '') => el('span', { class: 'pill ' + cls }, txt);
  const paceClass = p => p == null ? '' : p >= 100 ? 'good' : p >= 80 ? 'warn' : 'bad';
  const progress = (v, max, cls = '') => el('div', { class: 'progress ' + cls }, el('span', { style: `width:${Math.max(0, Math.min(100, max ? 100 * v / max : 0))}%` }));
  const mixBar = (parts, labels, colors) => {
    const total = parts.reduce((a, b) => a + b, 0) || 1;
    const bar = el('div', { class: 'mix' }, parts.map((v, i) => el('span', { style: `width:${100 * v / total}%;background:${colors[i]}`, title: `${labels[i]}: ${v}` })));
    const legend = el('div', { class: 'legend' }, parts.map((v, i) => el('span', {}, el('i', { style: `background:${colors[i]}` }), `${labels[i]} ${pct(v, total)}`)));
    return el('div', {}, bar, legend);
  };
  const INST_LABELS = ['Under R400', 'R400–699', 'R700–1,499', 'R1,500+', 'Not captured'];
  const INST_KEYS = ['lt400', 'b400_699', 'b700_1499', 'ge1500', 'unknown'];
  const INST_COLORS = ['#4fc98a', '#8fd6a8', '#f5b942', '#f06a6a', '#3a4552'];
  const LEAD_LABELS = ['Within 7 days', '8–14 days', '15–30 days', 'Over 30 days', 'No date'];
  const LEAD_KEYS = ['le7', 'd8_14', 'd15_30', 'gt30', 'unknown'];
  const LEAD_COLORS = ['#4fc98a', '#8fd6a8', '#f5b942', '#f06a6a', '#3a4552'];

  function sortableTable(columns, rows, defaultSort, opts = {}) {
    let sortKey = defaultSort, dir = 'desc';
    const table = el('table');
    const thead = el('thead'); const tbody = el('tbody');
    table.append(thead, tbody);
    const render = () => {
      thead.innerHTML = '';
      const tr = el('tr');
      for (const c of columns) {
        const th = el('th', { class: c.num ? 'num' : '', 'data-sorted': c.key === sortKey ? dir : null, onclick: () => { if (sortKey === c.key) dir = dir === 'desc' ? 'asc' : 'desc'; else { sortKey = c.key; dir = c.num ? 'desc' : 'asc'; } render(); } }, c.label);
        tr.append(th);
      }
      thead.append(tr);
      const sorted = [...rows].sort((a, b) => {
        const va = a[sortKey], vb = b[sortKey];
        if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
        return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))) * (dir === 'desc' ? -1 : 1);
      });
      tbody.innerHTML = '';
      sorted.forEach((r, i) => {
        const tr = el('tr', { class: opts.highlight && opts.highlight(r) ? 'me' : '' });
        columns.forEach((c, ci) => {
          const v = r[c.key];
          const td = el('td', { class: c.num ? 'num' : '' });
          if (c.render) td.append(c.render(v, r, i)); else td.textContent = c.num ? (c.fmt || n0)(v) : (v ?? '–');
          if (ci === 0 && opts.rank) td.prepend(el('span', { class: 'rank num' }, i + 1), ' ');
          tr.append(td);
        });
        tbody.append(tr);
      });
    };
    render();
    return el('div', { class: 'table-wrap' }, table);
  }

  const freshnessCard = (D, C) => {
    const rows = [];
    const sales = D.raw;
    rows.push(['Registrations', `${dShort(D.latest)} (${dDow(D.latest)})`, sales.config_stale ? 'bad' : 'good', sales.config_stale ? 'Month sheet not configured' : 'live']);
    rows.push(['Incentive sheet', sales.incentive_week_days.length ? `week of ${dShort(sales.incentive_week_days[0])}` : '–', 'good', 'live']);
    if (C) {
      const b = C.raw.sources.bank; const cz = C.raw.sources.cancellations;
      const bankStale = b && b.latest_month < D.month;
      rows.push(['Banked cash', b && b.latest_month ? monthLabel(b.latest_month) : '–', bankStale ? 'bad' : 'good', bankStale ? 'no tabs for ' + monthLabel(D.month) : 'live']);
      rows.push(['Cancellations', cz && cz.latest_logged ? 'logged to ' + dShort(cz.latest_logged > D.latest ? D.latest : cz.latest_logged) : '–', 'good', 'refreshed ' + timeAgo(C.raw.generated_at)]);
    } else rows.push(['Collections data', 'not available', 'bad', 'collections.json missing']);
    return el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Data freshness'), el('span', { class: 'xs muted' }, 'sales updated ' + timeAgo(sales.generated_at))),
      el('div', { class: 'fresh' }, rows.map(r => el('div', {}, el('span', {}, el('strong', {}, r[0]), ' ', el('span', { class: 'muted' }, r[1])), pill(r[3], r[2])))));
  };

  // ---------- views ----------
  function goalNote(g, goalMonth, D) {
    const mo = MONTHS[+goalMonth.slice(5, 7) - 1];
    const parts = ['collections banked since the 8th'];
    if (g.sheetTo != null && g.derivedDays) parts.push(`goal tab filled to ${g.sheetTo} ${mo}, rest from bank tabs`);
    else if (g.sheetTo != null) parts.push(`goal tab filled to ${g.sheetTo} ${mo}`);
    if (goalMonth < D.month) parts.push(`no ${monthLabel(D.month)} tab yet`);
    return parts.join(' · ');
  }
  function viewLeadership(D, C) {
    const t = D.team; const out = [];
    const cur = C && C.cur ? C.perCycle[C.cur] : null;
    const bankMonth = C && C.bankMonths.length ? C.bankMonths[C.bankMonths.length - 1] : null;
    let bankColl = null, bankSales = null;
    if (bankMonth) { bankColl = 0; bankSales = 0; for (const rows of Object.values(C.raw.bank[bankMonth])) for (const r of rows) { bankColl += r.collections || 0; bankSales += r.sales || 0; } }
    const goalMonth = C && C.goalMonths.length ? C.goalMonths[C.goalMonths.length - 1] : null;
    let goalPct = null, goalActual = null, goalTarget = null;
    if (goalMonth) {
      const g = C.raw.goals[goalMonth];
      const withActual = g.filter(r => r.actual_cum != null);
      const last = withActual[withActual.length - 1];
      goalActual = last ? last.actual_cum : null;
      goalTarget = g[g.length - 1].goal_cum;
      const goalAtDay = last ? g.find(r => r.dom === last.dom).goal_cum : null;
      goalPct = goalAtDay ? 100 * goalActual / goalAtDay : null;
    }

    out.push(el('section', { class: 'grid kpis' },
      kpi(`Registrations · ${MONTHS_LONG[+D.month.slice(5, 7) - 1]}`, n0(t.m.reg), `${t.pct != null ? Math.round(t.pct) + '% of August pace' : 'no baseline'} · ${D.recorded} of ${D.workDays} days`, paceClass(t.pct)),
      kpi('Projected month end', n0(Math.round(t.projection)), `${n1(t.perDay)}/day · August pace ${n0(Math.round(t.augPerDay * D.workDays))}`, t.projection >= t.augPerDay * D.workDays ? 'good' : 'bad'),
      kpi('Debit orders on new sales', pct(t.m.do, t.m.reg), `${n0(t.m.do)} of ${n0(t.m.reg)} this month`),
      kpi('Upfront cash on new sales', randK(t.m.paid_amt), `${rand(t.m.paid_amt)} · ${n0(t.m.paid_n)} sales paid something upfront (${pct(t.m.paid_n, t.m.reg)})`),
      kpi(bankMonth ? `Banked · ${MONTHS[+bankMonth.slice(5, 7) - 1]}` : 'Banked cash', bankColl != null ? randK(bankColl + bankSales) : '–', bankColl != null ? `${randK(bankColl)} collections + ${randK(bankSales)} sales` : 'no bank data', bankMonth && bankMonth < D.month ? 'bad' : ''),
      kpi(cur ? `Cancellations · cycle from ${dShort(cur.start)}` : 'Cancellations', cur ? n0(cur.agg.total) : '–', cur ? `${n0(cur.agg.saved)} saved · ${cur.agg.saveRate != null ? Math.round(cur.agg.saveRate) + '% save rate' : ''} · ${n0(cur.agg.open + cur.agg.unprocessed)} open` : 'no data'),
    ));

    // Charts: daily registrations stacked by college + August pace
    const { card: c1, canvas: cv1 } = chartCard('Daily registrations by college', 'dashed line = August pace');
    const { card: c2, canvas: cv2 } = chartCard(goalMonth ? `Cash goal vs actual · cycle from 8 ${MONTHS[+goalMonth.slice(5, 7) - 1]}` : 'Cash goal vs actual', goalMonth ? goalNote(C.raw.goals[goalMonth], goalMonth, D) : '');
    out.push(el('section', { class: 'grid two' }, c1, c2));

    // College cards
    const colleges = Object.values(D.colleges).filter(c => c.name !== 'Unknown').sort((a, b) => b.m.reg - a.m.reg);
    out.push(el('section', { class: 'grid three' }, colleges.map(c => {
      const cz = cur ? cur.agg.byCollege[c.name] || 0 : null;
      const bankRows = bankMonth && C.raw.bank[bankMonth][c.name];
      const bColl = bankRows ? bankRows.reduce((a, r) => a + (r.collections || 0), 0) : null;
      return el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h2', {}, el('span', { class: 'dot ' + collegeClass(c.name) }), ' ', c.name), pill(c.pct != null ? Math.round(c.pct) + '% of pace' : 'no baseline', paceClass(c.pct))),
        el('div', { class: 'row spread' }, el('div', { class: 'kpi' }, el('div', { class: 'label' }, 'Month'), el('div', { class: 'value num' }, n0(c.m.reg))), el('div', { class: 'kpi' }, el('div', { class: 'label' }, 'Today'), el('div', { class: 'value num' }, n0(c.today))), el('div', { class: 'kpi' }, el('div', { class: 'label' }, 'Projected'), el('div', { class: 'value num' }, n0(Math.round(c.projection))))),
        progress(c.m.reg, c.expected || c.m.reg, paceClass(c.pct)),
        el('ul', { class: 'list', style: 'margin-top:12px' },
          el('li', {}, el('span', { class: 'muted' }, 'Expected at August pace'), el('span', { class: 'num' }, c.expected ? n0(Math.round(c.expected)) : '–')),
          el('li', {}, el('span', { class: 'muted' }, 'Debit-order rate'), el('span', { class: 'num' }, pct(c.m.do, c.m.reg))),
          el('li', {}, el('span', { class: 'muted' }, 'Upfront cash'), el('span', { class: 'num' }, `${rand(c.m.paid_amt)} · ${pct(c.m.paid_n, c.m.reg)}`)),
          el('li', {}, el('span', { class: 'muted' }, 'Under R700/month'), el('span', { class: 'num' }, pct(c.m.inst.lt400 + c.m.inst.b400_699, c.m.reg))),
          el('li', {}, el('span', { class: 'muted' }, bankMonth ? `Collections banked · ${MONTHS[+bankMonth.slice(5, 7) - 1]}` : 'Collections banked'), el('span', { class: 'num' }, bColl != null ? randK(bColl) : '–')),
          el('li', {}, el('span', { class: 'muted' }, 'Cancellation requests this cycle'), el('span', { class: 'num' }, cz != null ? n0(cz) : '–')),
          el('li', {}, el('span', { class: 'muted' }, 'Registrars selling'), el('span', { class: 'num' }, n0(c.people.filter(p => p.m.reg > 0).length))),
        ));
    })));

    // Trend across months + cancellations across cycles + freshness
    const { card: c3, canvas: cv3 } = chartCard('Registrations per working day, by month', 'all months on record');
    const { card: c4, canvas: cv4 } = chartCard('Cancellation requests per cycle', 'saved vs cancelled vs still open');
    out.push(el('section', { class: 'grid three' }, c3, c4, freshnessCard(D, C)));

    requestAnimationFrame(() => {
      chart(cv1, { type: 'bar', data: { labels: D.monthDays.map(dShort), datasets: [
        ...colleges.map(c => ({ label: c.name, data: c.series, backgroundColor: collegeColor(c.name), stack: 's', borderRadius: 2 })),
        { type: 'line', label: 'August pace', data: D.monthDays.map(() => t.augPerDay), borderColor: '#f5b942', borderDash: [6, 4], pointRadius: 0, borderWidth: 2 },
      ] }, options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } }, plugins: { legend: { position: 'bottom' } } } });
      if (goalMonth) {
        const g = C.raw.goals[goalMonth];
        chart(cv2, { type: 'line', data: { labels: g.map(r => r.dom), datasets: [
          { label: 'Goal (cumulative)', data: g.map(r => r.goal_cum), borderColor: '#9aa5b1', borderDash: [6, 4], pointRadius: 0, borderWidth: 2 },
          { label: 'Actual (cumulative)', data: g.map(r => r.actual_cum), borderColor: '#f5b942', backgroundColor: 'rgba(245,185,66,0.15)', fill: true, pointRadius: 0, borderWidth: 2, spanGaps: false, segment: { borderDash: ctx => g[ctx.p1DataIndex] && g[ctx.p1DataIndex].derived ? [3, 3] : undefined } },
        ] }, options: { maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'day of month (cycle starts on the 8th)' }, grid: { display: false } }, y: { ticks: { callback: v => randK(v) } } }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${rand(c.parsed.y)}` } } } } });
      } else cv2.replaceWith(el('div', { class: 'empty' }, 'No cash-goal data'));
      // per-month averages
      const months = [...new Set(D.days.map(d => d.slice(0, 7)))];
      const avg = months.map(m => { const ds = D.days.filter(d => d.startsWith(m)); return ds.reduce((a, d) => a + D.history.find(h => h.d === d).reg, 0) / ds.length; });
      chart(cv3, { type: 'bar', data: { labels: months.map(monthLabel), datasets: [{ label: 'Registrations per recorded day', data: avg, backgroundColor: months.map(m => m === D.month ? '#f5b942' : '#3a4552'), borderRadius: 4 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } } });
      if (C && C.cycles.length) {
        chart(cv4, { type: 'bar', data: { labels: C.cycles.map(k => dShort(k) + ' →'), datasets: [
          { label: 'Saved', data: C.cycles.map(k => C.perCycle[k].agg.saved), backgroundColor: '#4fc98a', stack: 's' },
          { label: 'Cancelled', data: C.cycles.map(k => C.perCycle[k].agg.cancelled), backgroundColor: '#f06a6a', stack: 's' },
          { label: 'Open / unprocessed', data: C.cycles.map(k => C.perCycle[k].agg.open + C.perCycle[k].agg.unprocessed), backgroundColor: '#3a4552', stack: 's' },
        ] }, options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } }, plugins: { legend: { position: 'bottom' } } } });
      } else cv4.replaceWith(el('div', { class: 'empty' }, 'No cancellation data'));
    });
    return out;
  }

  function viewSalesManager(D, C) {
    const t = D.team; const out = [];
    const cur = C && C.cur ? C.perCycle[C.cur] : null;
    const people = D.people.filter(p => p.active);

    out.push(el('section', { class: 'grid kpis' },
      kpi('Today', n0(t.today), `${dDow(D.latest)} ${dShort(D.latest)} · yesterday ${n0(t.yesterday)}`),
      kpi('This week', n0(t.w.reg), `from Mon ${dShort(D.mondayIso)}`),
      kpi('This month', n0(t.m.reg), `${t.pct != null ? Math.round(t.pct) + '% of August pace' : ''} · projected ${n0(Math.round(t.projection))}`, paceClass(t.pct)),
      kpi('Debit-order rate', pct(t.m.do, t.m.reg), 'sales with a D/O mandate'),
      kpi('First payment within 7 days', pct(t.m.lead.le7, t.m.reg), `avg instalment ${rand(t.avgInst)}`),
      kpi('Registrars selling', n0(people.filter(p => p.m.reg > 0).length), `${people.filter(p => p.unrostered && p.m.reg > 0).length} not on roster · ${D.people.filter(p => !p.active).length} inactive`),
    ));

    // Attention list
    const attention = [];
    for (const p of people) {
      if (p.m.reg === 0) { attention.push([p, 'no sales this month' + (p.prevMonth ? ` (${p.prevMonth} last month)` : ''), 'bad']); continue; }
      if (p.aug_per_day != null && p.pct != null && p.pct < 70) attention.push([p, `${Math.round(p.pct)}% of August pace`, 'bad']);
      else if (p.lastTwo === 0 && p.m.reg > 0) attention.push([p, 'no sales in the last two recorded days', 'warn']);
      else if (p.m.reg >= 10 && p.doRate != null && t.doRate != null && p.doRate < t.doRate - 15) attention.push([p, `D/O rate ${Math.round(p.doRate)}% vs team ${Math.round(t.doRate)}%`, 'warn']);
      if (p.unrostered && p.m.reg > 0) attention.push([p, 'selling but not on the comparison-sheet roster (no baseline, no incentive tracking)', 'warn']);
    }
    const attentionCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Needs attention'), el('span', { class: 'xs muted' }, `${attention.length} flags`)),
      attention.length ? el('ul', { class: 'list' }, attention.sort((x, y) => (x[2] === 'bad' ? 0 : 1) - (y[2] === 'bad' ? 0 : 1)).slice(0, 12).map(([p, why, cls]) => el('li', {}, el('span', {}, el('span', { class: 'dot ' + collegeClass(p.college) }), ' ', el('strong', {}, p.name), ' ', el('span', { class: 'muted' }, why)), pill(n0(p.m.reg) + ' mtd', cls)))) : el('div', { class: 'empty' }, 'Nothing flagged'));

    // Mix cards
    const mixCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Monthly instalment mix'), el('span', { class: 'xs muted' }, 'this month, all colleges')),
      mixBar(INST_KEYS.map(k => t.m.inst[k]), INST_LABELS, INST_COLORS),
      el('p', { class: 'note', style: 'margin:12px 0 0' }, 'Lower monthly values have historically paid through better than higher ones.'),
      el('h3', { style: 'margin:16px 0 8px' }, 'First payment due'),
      mixBar(LEAD_KEYS.map(k => t.m.lead[k]), LEAD_LABELS, LEAD_COLORS));
    const { card: trendCard, canvas: trendCv } = chartCard('Team registrations per day', 'this month · dashed = August pace');
    out.push(el('section', { class: 'grid three' }, attentionCard, mixCard, trendCard));

    // League table
    const cols = [
      { key: 'name', label: 'Registrar', render: (v, r) => el('span', {}, el('span', { class: 'dot ' + collegeClass(r.college) }), ' ', v, r.unrostered ? el('span', { class: 'faint xs' }, ' · not on roster') : null) },
      { key: 'today', label: 'Today', num: true },
      { key: 'yesterday', label: 'Yday', num: true },
      { key: 'week', label: 'Week', num: true },
      { key: 'month', label: 'Month', num: true, render: (v, r) => el('span', {}, el('span', { class: 'bar', style: `width:${Math.round(60 * v / Math.max(1, ...people.map(p => p.month)))}px` }), el('span', { class: 'num' }, n0(v))) },
      { key: 'pct', label: 'vs Aug', num: true, render: v => v == null ? el('span', { class: 'faint' }, '–') : el('span', { class: paceClass(v) }, Math.round(v) + '%') },
      { key: 'projection', label: 'Proj.', num: true, fmt: v => n0(Math.round(v)) },
      { key: 'doRate', label: 'D/O', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' },
      { key: 'paidRate', label: 'Upfront', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' },
      { key: 'avgInst', label: 'Avg inst.', num: true, fmt: v => rand(v) },
      { key: 'fastPay', label: '1st pay ≤7d', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' },
      { key: 'cancels', label: 'Cancel req.', num: true, fmt: v => v == null ? '–' : n0(v) },
      { key: 'best', label: 'Best day', num: true },
      { key: 'incDO', label: 'D/O wk', num: true, fmt: v => v == null ? '–' : n0(v) },
      { key: 'incTotal', label: 'Incentive', num: true, fmt: v => v == null ? '–' : rand(v) },
    ];
    const rows = people.map(p => ({ ...p, cancels: cur ? (cur.agg.bySales[firstName(p.name)] || {}).total || 0 : null, incDO: p.incentive ? p.incentive.debit_orders : null, incTotal: p.incentive ? p.incentive.total : null }));
    const filter = el('select', { onchange: e => { const v = e.target.value; tableHost.innerHTML = ''; tableHost.append(sortableTable(cols, v === 'all' ? rows : rows.filter(r => r.college === v), 'month', { rank: true })); } },
      el('option', { value: 'all' }, 'All colleges'), Object.keys(D.colleges).filter(c => c !== 'Unknown').map(c => el('option', { value: c }, c)));
    const tableHost = el('div', {}, sortableTable(cols, rows, 'month', { rank: true }));
    out.push(el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'League table'), el('div', { class: 'row' }, el('span', { class: 'xs muted' }, 'click a column to sort'), filter)), tableHost,
      el('p', { class: 'note', style: 'margin:12px 0 0' }, 'vs Aug = this month against each registrar’s August daily rate × recorded days. Proj. = current daily rate carried to month end. Cancel req. = cancellation requests this cycle on sales attributed to the registrar. D/O wk and Incentive come from the weekly incentive sheet.')));

    requestAnimationFrame(() => {
      chart(trendCv, { type: 'bar', data: { labels: D.monthDays.map(dShort), datasets: [
        { label: 'Registrations', data: t.series, backgroundColor: '#f5b942', borderRadius: 3 },
        { type: 'line', label: 'August pace', data: D.monthDays.map(() => t.augPerDay), borderColor: '#9aa5b1', borderDash: [6, 4], pointRadius: 0, borderWidth: 2 },
      ] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } } });
    });
    return out;
  }

  function viewSalesAgent(D, C) {
    const people = D.people.filter(p => p.active).sort((a, b) => a.name.localeCompare(b.name));
    const p = people.find(x => x.key === S.who) || people.sort((a, b) => b.month - a.month)[0];
    if (!p) return [el('div', { class: 'empty' }, 'No registrars found')];
    S.who = p.key;
    const t = D.team; const out = [];
    const cur = C && C.cur ? C.perCycle[C.cur] : null;
    const college = D.colleges[p.college];
    const rankAll = [...D.people].sort((a, b) => b.month - a.month).findIndex(x => x.key === p.key) + 1;
    const rankCollege = college ? [...college.people].sort((a, b) => b.month - a.month).findIndex(x => x.key === p.key) + 1 : null;
    const inc = p.incentive;
    const needed = inc && inc.next_level_at ? inc.next_level_at : null;
    const ringPct = inc ? (needed ? Math.min(100, 100 * inc.debit_orders / needed) : 100) : 0;
    const r = 62, circ = 2 * Math.PI * r;
    const myCancels = cur ? cur.agg.bySales[firstName(p.name)] : null;

    out.push(el('section', { class: 'card hero agent-hero' },
      el('div', {},
        el('div', { class: 'row' }, el('span', { class: 'dot ' + collegeClass(p.college) }), el('span', { class: 'muted small' }, p.college), rankAll ? pill(`#${rankAll} overall`, rankAll <= 3 ? 'good' : '') : null, rankCollege ? pill(`#${rankCollege} in college`) : null),
        el('h1', { style: 'margin:8px 0' }, p.name),
        el('div', { class: 'row bignums' },
          el('div', {}, el('div', { class: 'xs muted' }, 'TODAY'), el('div', { class: 'big num' }, n0(p.today))),
          el('div', {}, el('div', { class: 'xs muted' }, 'THIS WEEK'), el('div', { class: 'big num' }, n0(p.week))),
          el('div', {}, el('div', { class: 'xs muted' }, 'THIS MONTH'), el('div', { class: 'big num' }, n0(p.month))),
        ),
        el('div', { class: 'row', style: 'margin-top:14px' },
          p.pct != null ? pill(`${Math.round(p.pct)}% of your August pace`, paceClass(p.pct)) : pill('no August baseline yet'),
          pill(`on track for ${n0(Math.round(p.projection))} this month`),
          p.streak >= 2 ? pill(`${p.streak}-day streak`, 'good') : null,
          p.today > 0 && p.today >= p.prevBest && p.prevBest > 0 ? pill('personal best today', 'good') : null,
        )),
      el('div', {}, inc ? el('div', { class: 'ring' },
        el('svg', { viewBox: '0 0 150 150', html: `<circle cx="75" cy="75" r="${r}" fill="none" stroke="#1d242c" stroke-width="12"/><circle cx="75" cy="75" r="${r}" fill="none" stroke="#f5b942" stroke-width="12" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - ringPct / 100)}"/>` }),
        el('div', { class: 'ring-label' }, el('b', { class: 'num' }, n0(inc.debit_orders)), el('span', { class: 'xs muted' }, needed ? `of ${needed} D/Os` : 'D/Os this week'))) : el('div', { class: 'empty' }, 'Not on the incentive sheet'),
        inc ? el('div', { style: 'text-align:center;margin-top:10px' }, el('div', { class: 'small' }, needed ? `${inc.to_next_level} more debit order${inc.to_next_level === 1 ? '' : 's'} this week unlocks ${rand(inc.next_level_amount)}` : 'Top incentive level reached'), el('div', { class: 'xs muted' }, `Earned so far: ${rand(inc.total)} (${rand(inc.enrolment_incentive)} enrolment + ${rand(inc.cash_incentive)} cash)`)) : null)));

    const { card: dayCard, canvas: dayCv } = chartCard('Your sales per day this month', 'dashed = your August pace');
    const qualityCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Sale quality this month'), el('span', { class: 'xs muted' }, 'you vs team')),
      el('ul', { class: 'list' }, [
        ['Debit-order mandate', p.doRate, t.doRate, '%'],
        ['Paid something upfront', p.paidRate, t.paidRate, '%'],
        ['First payment within 7 days', p.fastPay, t.fastPay, '%'],
        ['Under R700 per month', p.lowBand, t.lowBand, '%'],
        ['Average monthly instalment', p.avgInst, t.avgInst, 'R'],
        ['Digital material', p.digital, pctN(t.m.digital, t.m.reg), '%'],
      ].map(([label, mine, team, unit]) => el('li', {}, el('span', { class: 'muted' }, label), el('span', { class: 'num' }, el('strong', {}, mine == null ? '–' : unit === 'R' ? rand(mine) : Math.round(mine) + '%'), el('span', { class: 'faint' }, ` · team ${team == null ? '–' : unit === 'R' ? rand(team) : Math.round(team) + '%'}`))))),
      el('h3', { style: 'margin:16px 0 8px' }, 'Your instalment mix'), mixBar(INST_KEYS.map(k => p.m.inst[k]), INST_LABELS, INST_COLORS));
    const recordsCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Records & follow-through')),
      el('ul', { class: 'list' },
        el('li', {}, el('span', { class: 'muted' }, 'Best single day'), el('span', { class: 'num' }, `${n0(p.best)}${p.bestDate ? ' · ' + dShort(p.bestDate) : ''}`)),
        el('li', {}, el('span', { class: 'muted' }, 'Last month'), el('span', { class: 'num' }, n0(p.prevMonth))),
        el('li', {}, el('span', { class: 'muted' }, 'August daily rate'), el('span', { class: 'num' }, p.aug_per_day != null ? n1(p.aug_per_day) : '–')),
        el('li', {}, el('span', { class: 'muted' }, 'Your daily rate this month'), el('span', { class: 'num' }, n1(p.perDay))),
        el('li', {}, el('span', { class: 'muted' }, 'Upfront cash collected'), el('span', { class: 'num' }, rand(p.m.paid_amt))),
        el('li', {}, el('span', { class: 'muted' }, 'Cancellation requests on your sales (this cycle)'), el('span', { class: 'num ' + (myCancels && myCancels.total ? 'warn' : '') }, myCancels ? `${n0(myCancels.total)} · ${n0(myCancels.saved)} saved` : cur ? '0' : '–')),
      ));
    out.push(el('section', { class: 'grid three' }, dayCard, qualityCard, recordsCard));

    // Team league (compact), highlighting me
    const rows = D.people.filter(x => x.active).map(x => ({ name: x.name, college: x.college, key: x.key, today: x.today, week: x.week, month: x.month, pct: x.pct }));
    out.push(el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Where you stand'), el('span', { class: 'xs muted' }, 'this month')),
      sortableTable([
        { key: 'name', label: 'Registrar', render: (v, r) => el('span', {}, el('span', { class: 'dot ' + collegeClass(r.college) }), ' ', v) },
        { key: 'today', label: 'Today', num: true }, { key: 'week', label: 'Week', num: true }, { key: 'month', label: 'Month', num: true },
        { key: 'pct', label: 'vs Aug', num: true, render: v => v == null ? el('span', { class: 'faint' }, '–') : el('span', { class: paceClass(v) }, Math.round(v) + '%') },
      ], rows, 'month', { rank: true, highlight: r => r.key === p.key })));

    requestAnimationFrame(() => {
      chart(dayCv, { type: 'bar', data: { labels: D.monthDays.map(dShort), datasets: [
        { label: 'Sales', data: p.series, backgroundColor: p.series.map(v => v >= p.best && v > 0 ? '#4fc98a' : '#f5b942'), borderRadius: 3 },
        p.aug_per_day != null ? { type: 'line', label: 'August pace', data: D.monthDays.map(() => p.aug_per_day), borderColor: '#9aa5b1', borderDash: [6, 4], pointRadius: 0, borderWidth: 2 } : null,
      ].filter(Boolean) }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } } });
    });
    return out;
  }

  function viewCollectionsManager(D, C) {
    if (!C || !C.cur) return [el('div', { class: 'empty' }, 'Collections data is not available yet.')];
    const cur = C.perCycle[C.cur], prev = C.prev ? C.perCycle[C.prev] : null;
    const a = cur.agg; const out = [];
    const goalMonth = C.goalMonths[C.goalMonths.length - 1];
    const g = goalMonth ? C.raw.goals[goalMonth] : null;
    const withActual = g ? g.filter(r => r.actual_cum != null) : [];
    const last = withActual[withActual.length - 1];
    const goalAtDay = last ? g.find(r => r.dom === last.dom).goal_cum : null;
    const bankMonth = C.bankMonths[C.bankMonths.length - 1];
    const bank = bankMonth ? C.raw.bank[bankMonth] : null;
    const bankTot = bank ? Object.fromEntries(Object.entries(bank).map(([c, rows]) => [c, rows.reduce((o, r) => ({ sales: o.sales + (r.sales || 0), collections: o.collections + (r.collections || 0), unclaimed: o.unclaimed + (r.unclaimed || 0) }), { sales: 0, collections: 0, unclaimed: 0 })])) : null;
    const bankAll = bankTot ? Object.values(bankTot).reduce((o, r) => ({ sales: o.sales + r.sales, collections: o.collections + r.collections, unclaimed: o.unclaimed + r.unclaimed }), { sales: 0, collections: 0, unclaimed: 0 }) : null;
    const stale = goalMonth && goalMonth < D.month;

    out.push(el('section', { class: 'grid kpis' },
      kpi(goalMonth ? `Cash vs goal · ${MONTHS_LONG[+goalMonth.slice(5, 7) - 1]} cycle` : 'Cash vs goal', last ? pct(last.actual_cum, goalAtDay) : '–', last ? `${randK(last.actual_cum)} banked by day ${last.dom} vs ${randK(goalAtDay)} planned` : 'no data', stale ? 'bad' : last && last.actual_cum >= goalAtDay ? 'good' : 'warn'),
      kpi(bankMonth ? `Collections banked · ${MONTHS[+bankMonth.slice(5, 7) - 1]}` : 'Collections banked', bankAll ? randK(bankAll.collections) : '–', bankAll ? `+ ${randK(bankAll.sales)} sales cash · ${randK(bankAll.unclaimed)} unclaimed` : '', stale ? 'bad' : ''),
      kpi(`Cancellation requests · from ${dShort(cur.start)}`, n0(a.total), prev ? `${n0(prev.agg.total)} in the previous cycle` : ''),
      kpi('Save rate', a.saveRate != null ? Math.round(a.saveRate) + '%' : '–', `${n0(a.saved)} saved of ${n0(a.decided)} decided${prev && prev.agg.saveRate != null ? ' · prev ' + Math.round(prev.agg.saveRate) + '%' : ''}`, a.saveRate != null && prev && prev.agg.saveRate != null ? (a.saveRate >= prev.agg.saveRate ? 'good' : 'bad') : ''),
      kpi('Open cases', n0(a.open + a.unprocessed), `${n0(a.open)} not finalised · ${n0(a.unprocessed)} logged, not yet worked`, a.unprocessed > 20 ? 'warn' : ''),
      kpi('Reached on first call', pct(cur.rows.filter(r => r.attempts[0] && /success/i.test(r.attempts[0])).length, cur.rows.filter(r => r.attempts.length).length), `${n0(a.contacts)} successful of ${n0(a.attempts)} attempts · ${n0(a.offers)} offers made`),
    ));

    const { card: c1, canvas: cv1 } = chartCard(goalMonth ? `Cash goal vs actual · cycle from 8 ${MONTHS[+goalMonth.slice(5, 7) - 1]}` : 'Cash goal vs actual', goalMonth ? goalNote(g, goalMonth, D) : '');
    const { card: c2, canvas: cv2 } = chartCard(bankMonth ? `Daily collections banked by college · ${monthLabel(bankMonth)}` : 'Daily collections banked', 'from the bank tabs');
    out.push(el('section', { class: 'grid two' }, c1, c2));

    // Category / college / trend
    const catCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Why students ask to cancel'), el('span', { class: 'xs muted' }, 'this cycle')),
      el('ul', { class: 'list' }, Object.entries(a.byCat).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => el('li', {}, el('span', {}, k), el('span', { class: 'num' }, `${n0(v)} · ${pct(v, a.total - a.unprocessed)}`)))),
      el('p', { class: 'note', style: 'margin:10px 0 0' }, `${n0(a.fault)} marked as avoidable by us. ${n0(a.unprocessed)} requests have no category yet.`));
    const colCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'By college'), el('span', { class: 'xs muted' }, 'requests · save rate')),
      el('ul', { class: 'list' }, Object.entries(a.byCollege).sort((x, y) => y[1] - x[1]).map(([c, v]) => {
        const rows = cur.rows.filter(r => r.college === c); const sv = rows.filter(r => (r.status || '').toLowerCase() === 'saved').length; const dc = rows.filter(r => /^(saved|cancel)$/i.test(r.status || '')).length;
        return el('li', {}, el('span', {}, el('span', { class: 'dot ' + collegeClass(c) }), ' ', c), el('span', { class: 'num' }, `${n0(v)} · ${dc ? Math.round(100 * sv / dc) + '% saved' : '–'}`));
      })),
      el('h3', { style: 'margin:16px 0 8px' }, 'By course type'),
      el('ul', { class: 'list' }, Object.entries(a.byCourse).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => el('li', {}, el('span', {}, k), el('span', { class: 'num' }, n0(v))))));
    const { card: c3, canvas: cv3 } = chartCard('Requests logged per day', 'this cycle');
    out.push(el('section', { class: 'grid three' }, catCard, colCard, c3));

    // Agent table
    const agents = Object.values(a.byAgent).map(x => ({ ...x, decided: x.saved + x.cancelled, saveRate: pctN(x.saved, x.saved + x.cancelled), perCase: x.total ? x.attempts / x.total : 0, contactRate: pctN(x.contacts, x.attempts), offerRate: pctN(x.offers, x.total) }));
    out.push(el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Collections agents · this cycle'), el('span', { class: 'xs muted' }, 'click a column to sort')),
      sortableTable([
        { key: 'name', label: 'Agent' },
        { key: 'total', label: 'Cases', num: true },
        { key: 'saved', label: 'Saved', num: true },
        { key: 'cancelled', label: 'Cancelled', num: true },
        { key: 'open', label: 'Open', num: true },
        { key: 'saveRate', label: 'Save rate', num: true, render: v => v == null ? el('span', { class: 'faint' }, '–') : el('span', { class: v >= 20 ? 'good' : v >= 10 ? 'warn' : 'bad' }, Math.round(v) + '%') },
        { key: 'attempts', label: 'Attempts', num: true },
        { key: 'perCase', label: 'Per case', num: true, fmt: n1 },
        { key: 'contactRate', label: 'Reached', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' },
        { key: 'offerRate', label: 'Offer made', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' },
      ], agents, 'total', { rank: true }),
      el('p', { class: 'note', style: 'margin:12px 0 0' }, 'Save rate = saved ÷ (saved + cancelled). Reached = "Call Successful" attempts ÷ all attempts. Offer made = cases where a salvage offer other than "no offer made" was recorded.')));

    // Previous cycles comparison
    out.push(el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Cycle on cycle')),
      sortableTable([
        { key: 'label', label: 'Cycle' }, { key: 'total', label: 'Requests', num: true }, { key: 'saved', label: 'Saved', num: true }, { key: 'cancelled', label: 'Cancelled', num: true }, { key: 'open', label: 'Open', num: true },
        { key: 'saveRate', label: 'Save rate', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' }, { key: 'fault', label: 'Our fault', num: true }, { key: 'perCase', label: 'Attempts per case', num: true, fmt: n1 },
      ], C.cycles.map(k => { const x = C.perCycle[k].agg; return { label: C.perCycle[k].label, total: x.total, saved: x.saved, cancelled: x.cancelled, open: x.open + x.unprocessed, saveRate: x.saveRate, fault: x.fault, perCase: x.total ? x.attempts / x.total : 0, start: k }; }), 'start')));

    requestAnimationFrame(() => {
      if (g) chart(cv1, { type: 'line', data: { labels: g.map(r => r.dom), datasets: [
        { label: 'Goal', data: g.map(r => r.goal_cum), borderColor: '#9aa5b1', borderDash: [6, 4], pointRadius: 0, borderWidth: 2 },
        { label: 'Actual', data: g.map(r => r.actual_cum), borderColor: '#f5b942', backgroundColor: 'rgba(245,185,66,0.15)', fill: true, pointRadius: 0, borderWidth: 2, segment: { borderDash: ctx => g[ctx.p1DataIndex] && g[ctx.p1DataIndex].derived ? [3, 3] : undefined } },
      ] }, options: { maintainAspectRatio: false, scales: { x: { grid: { display: false }, title: { display: true, text: 'day of month' } }, y: { ticks: { callback: v => randK(v) } } }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${rand(c.parsed.y)}` } } } } });
      else cv1.replaceWith(el('div', { class: 'empty' }, 'No goal data'));
      if (bank) {
        const doms = [...new Set(Object.values(bank).flat().map(r => r.dom))].sort((x, y) => x - y);
        chart(cv2, { type: 'bar', data: { labels: doms.map(d => `${d} ${MONTHS[+bankMonth.slice(5, 7) - 1]}`), datasets: Object.entries(bank).map(([c, rows]) => ({ label: c, data: doms.map(d => { const r = rows.find(x => x.dom === d); return r ? r.collections || 0 : 0; }), backgroundColor: collegeColor(c), stack: 's' })) },
          options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: v => randK(v) } } }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${rand(c.parsed.y)}` } } } } });
      } else cv2.replaceWith(el('div', { class: 'empty' }, 'No bank data'));
      const dayKeys = Object.keys(a.byDay).filter(d => d >= cur.start && d <= cur.end).sort();
      chart(cv3, { type: 'bar', data: { labels: dayKeys.map(dShort), datasets: [{ label: 'Requests', data: dayKeys.map(d => a.byDay[d]), backgroundColor: '#f06a6a', borderRadius: 3 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } } });
    });
    return out;
  }

  function viewCollectionsAgent(D, C) {
    if (!C || !C.cur) return [el('div', { class: 'empty' }, 'Collections data is not available yet.')];
    const cur = C.perCycle[C.cur], prev = C.prev ? C.perCycle[C.prev] : null;
    const agents = Object.values(cur.agg.byAgent).sort((a, b) => b.total - a.total);
    const me = agents.find(x => x.name.toLowerCase() === (S.who || '').toLowerCase()) || agents[0];
    if (!me) return [el('div', { class: 'empty' }, 'No agents in this cycle')];
    S.who = me.name;
    const team = cur.agg;
    const myRows = cur.rows.filter(r => r.agent === me.name);
    const decided = me.saved + me.cancelled;
    const saveRate = pctN(me.saved, decided);
    const prevMe = prev ? prev.agg.byAgent[me.name] : null;
    const contactRate = pctN(me.contacts, me.attempts);
    const firstReach = pctN(myRows.filter(r => r.attempts[0] && /success/i.test(r.attempts[0])).length, myRows.filter(r => r.attempts.length).length);
    const rank = agents.map(x => ({ n: x.name, sr: pctN(x.saved, x.saved + x.cancelled) || 0 })).sort((a, b) => b.sr - a.sr).findIndex(x => x.n === me.name) + 1;
    const out = [];

    out.push(el('section', { class: 'card hero agent-hero' },
      el('div', {},
        el('div', { class: 'row' }, el('span', { class: 'muted small' }, `Cycle from ${dShort(cur.start)} to ${dShort(cur.end)}`), rank ? pill(`#${rank} save rate`, rank <= 3 ? 'good' : '') : null),
        el('h1', { style: 'margin:8px 0' }, me.name),
        el('div', { class: 'row bignums' },
          el('div', {}, el('div', { class: 'xs muted' }, 'CASES'), el('div', { class: 'big num' }, n0(me.total))),
          el('div', {}, el('div', { class: 'xs muted' }, 'SAVED'), el('div', { class: 'big num good' }, n0(me.saved))),
          el('div', {}, el('div', { class: 'xs muted' }, 'OPEN'), el('div', { class: 'big num' }, n0(me.open))),
        ),
        el('div', { class: 'row', style: 'margin-top:14px' },
          pill(saveRate != null ? `${Math.round(saveRate)}% save rate · team ${team.saveRate != null ? Math.round(team.saveRate) : '–'}%` : 'no decided cases yet', saveRate != null && team.saveRate != null ? (saveRate >= team.saveRate ? 'good' : 'warn') : ''),
          prevMe ? pill(`last cycle: ${n0(prevMe.saved)} saved of ${n0(prevMe.saved + prevMe.cancelled)}`) : null,
        )),
      el('div', { class: 'stack' },
        el('ul', { class: 'list' },
          el('li', {}, el('span', { class: 'muted' }, 'Attempts per case'), el('span', { class: 'num' }, `${n1(me.total ? me.attempts / me.total : 0)} · team ${n1(team.total ? team.attempts / team.total : 0)}`)),
          el('li', {}, el('span', { class: 'muted' }, 'Reached on first attempt'), el('span', { class: 'num' }, firstReach == null ? '–' : Math.round(firstReach) + '%')),
          el('li', {}, el('span', { class: 'muted' }, 'Attempts that reached the student'), el('span', { class: 'num' }, `${contactRate == null ? '–' : Math.round(contactRate) + '%'} · team ${pctN(team.contacts, team.attempts) == null ? '–' : Math.round(pctN(team.contacts, team.attempts)) + '%'}`)),
          el('li', {}, el('span', { class: 'muted' }, 'Salvage offer made'), el('span', { class: 'num' }, `${pct(me.offers, me.total)} · team ${pct(team.offers, team.total)}`)),
          el('li', {}, el('span', { class: 'muted' }, 'Cases with no attempt logged'), el('span', { class: 'num ' + (myRows.filter(r => !r.attempts.length).length ? 'warn' : '') }, n0(myRows.filter(r => !r.attempts.length).length))),
        ))));

    const catCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Your cases by reason')),
      el('ul', { class: 'list' }, Object.entries(me.cats).sort((x, y) => y[1] - x[1]).map(([k, v]) => { const sv = myRows.filter(r => r.category === k && /saved/i.test(r.status || '')).length; return el('li', {}, el('span', {}, k), el('span', { class: 'num' }, `${n0(v)} · ${n0(sv)} saved`)); })));
    const openCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Open cases'), el('span', { class: 'xs muted' }, 'oldest first')),
      myRows.filter(r => !/^(saved|cancel)$/i.test(r.status || '')).length ? el('ul', { class: 'list' }, myRows.filter(r => !/^(saved|cancel)$/i.test(r.status || '')).sort((x, y) => x.logged.localeCompare(y.logged)).slice(0, 12).map(r => el('li', {}, el('span', {}, el('span', { class: 'dot ' + collegeClass(r.college || '') }), ` logged ${dShort(r.logged)} · ${r.category || 'no category'}`), pill(r.attempts.length ? `${r.attempts.length} attempt${r.attempts.length === 1 ? '' : 's'}` : 'no attempt yet', r.attempts.length ? '' : 'warn')))) : el('div', { class: 'empty' }, 'No open cases'));
    const { card: c1, canvas: cv1 } = chartCard('Saved vs cancelled by agent', 'this cycle');
    out.push(el('section', { class: 'grid three' }, catCard, openCard, c1));

    const rows = agents.map(x => ({ name: x.name, total: x.total, saved: x.saved, cancelled: x.cancelled, open: x.open, saveRate: pctN(x.saved, x.saved + x.cancelled), attempts: x.attempts }));
    out.push(el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Where you stand'), el('span', { class: 'xs muted' }, 'this cycle')),
      sortableTable([{ key: 'name', label: 'Agent' }, { key: 'total', label: 'Cases', num: true }, { key: 'saved', label: 'Saved', num: true }, { key: 'cancelled', label: 'Cancelled', num: true }, { key: 'open', label: 'Open', num: true }, { key: 'saveRate', label: 'Save rate', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' }, { key: 'attempts', label: 'Attempts', num: true }], rows, 'saved', { rank: true, highlight: r => r.name === me.name })));

    requestAnimationFrame(() => {
      chart(cv1, { type: 'bar', data: { labels: agents.map(x => x.name), datasets: [
        { label: 'Saved', data: agents.map(x => x.saved), backgroundColor: agents.map(x => x.name === me.name ? '#4fc98a' : 'rgba(79,201,138,0.45)'), stack: 's' },
        { label: 'Cancelled', data: agents.map(x => x.cancelled), backgroundColor: agents.map(x => x.name === me.name ? '#f06a6a' : 'rgba(240,106,106,0.45)'), stack: 's' },
        { label: 'Open', data: agents.map(x => x.open), backgroundColor: '#3a4552', stack: 's' },
      ] }, options: { indexAxis: 'y', maintainAspectRatio: false, scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true, grid: { display: false } } }, plugins: { legend: { position: 'bottom' } } } });
    });
    return out;
  }

  // ---------- shell ----------
  const VIEWS = { leadership: viewLeadership, 'sales-manager': viewSalesManager, 'sales-agent': viewSalesAgent, 'collections-manager': viewCollectionsManager, 'collections-agent': viewCollectionsAgent };

  function render() {
    const D = S.sales, C = S.coll;
    destroyCharts();
    const app = $('#app');
    app.innerHTML = '';
    for (const b of document.querySelectorAll('#roles button')) b.setAttribute('aria-pressed', String(b.dataset.role === S.role));
    const picker = $('#picker'); const sel = $('#person');
    if (S.role === 'sales-agent') {
      const people = D.people.filter(p => p.active).sort((a, b) => a.name.localeCompare(b.name));
      if (!people.find(p => p.key === S.who)) S.who = [...people].sort((a, b) => b.month - a.month)[0]?.key;
      sel.innerHTML = ''; people.forEach(p => sel.append(el('option', { value: p.key, selected: p.key === S.who }, `${p.name} · ${p.college}`)));
      picker.hidden = false;
    } else if (S.role === 'collections-agent' && C && C.cur) {
      const agents = Object.values(C.perCycle[C.cur].agg.byAgent).sort((a, b) => a.name.localeCompare(b.name));
      if (!agents.find(a => a.name.toLowerCase() === (S.who || '').toLowerCase())) S.who = agents[0]?.name;
      sel.innerHTML = ''; agents.forEach(a => sel.append(el('option', { value: a.name, selected: a.name === S.who }, a.name)));
      picker.hidden = false;
    } else picker.hidden = true;
    const view = VIEWS[S.role] || viewLeadership;
    for (const node of view(D, C)) app.append(node);
    writeHash();
  }

  async function load() {
    const bust = `?v=${Math.floor(Date.now() / 60000)}`;
    const [salesRes, collRes] = await Promise.all([fetch('data/sales.json' + bust), fetch('data/collections.json' + bust).catch(() => null)]);
    if (!salesRes.ok) throw new Error('sales.json ' + salesRes.status);
    const sales = await salesRes.json();
    const coll = collRes && collRes.ok ? await collRes.json() : null;
    S.sales = buildSales(sales);
    S.coll = buildCollections(coll);
    $('#asof').textContent = `Data to ${dDow(S.sales.latest)} ${dShort(S.sales.latest)} · refreshed ${timeAgo(sales.generated_at)}`;
    $('#foot-fresh').textContent = `Sales data ${new Date(sales.generated_at).toLocaleString('en-ZA')}${coll ? ' · collections data ' + new Date(coll.generated_at).toLocaleString('en-ZA') : ''}`;
    render();
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('#roles button');
    if (!b) return;
    S.role = b.dataset.role; S.who = null; render();
  });
  $('#person').addEventListener('change', e => { S.who = e.target.value; render(); });
  window.addEventListener('hashchange', () => { readHash(); if (S.sales) render(); });

  readHash();
  load().catch(err => { $('#app').innerHTML = ''; $('#app').append(el('div', { class: 'empty' }, 'Could not load scoreboard data: ' + err.message)); });
  // auto-refresh every 15 minutes (data changes every 30)
  setInterval(() => load().catch(() => {}), 15 * 60 * 1000);
})();
