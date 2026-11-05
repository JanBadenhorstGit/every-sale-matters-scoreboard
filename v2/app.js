/* Casus Radar (Every Sale Matters v2) — role-based sales & collections scoreboard.
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
  // Collections run on a cycle from the 8th to the 7th, named after the month it starts in. A day's bank
  // receipts are only complete the next day, so "latest complete day" is the last banked day before today.
  const sastToday = () => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Johannesburg' })); d.setHours(0, 0, 0, 0); return d; };
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const cycleMonthOf = d => { const s = d.getDate() >= 8 ? new Date(d.getFullYear(), d.getMonth(), 1) : new Date(d.getFullYear(), d.getMonth() - 1, 1); return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}`; };
  const nextMonthKey = m => { const y = +m.slice(0, 4), mo = +m.slice(5, 7); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
  const cycleLabel = m => `8 ${MONTHS[+m.slice(5, 7) - 1]} – 7 ${MONTHS[+nextMonthKey(m).slice(5, 7) - 1]}`;
  // South African public holidays (no debit-order or EFT processing): treated like weekends.
  const SA_HOLIDAYS = new Set(['2026-11-04', '2026-12-16', '2026-12-25', '2026-12-26', '2027-01-01', '2027-03-22', '2027-03-26', '2027-03-29', '2027-04-27', '2027-05-01', '2027-06-16', '2027-08-09', '2027-09-24', '2027-12-16', '2027-12-25', '2027-12-27']);
  const cycleDayDate = (m, dom) => { const mm = dom >= 8 ? m : nextMonthKey(m); return `${mm}-${String(dom).padStart(2, '0')}`; };
  const CYCLE = cycleMonthOf(sastToday());
  const TODAY = ymd(sastToday());
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
  const S = { role: 'leadership', who: null, sales: null, coll: null, leads: null, charts: [] };

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
    const latest = raw.latest_day;
    const days = Object.keys(raw.days).filter(d => d <= latest).sort();  // future (empty) tabs are not days
    const month = raw.month;
    const monthDays = days.filter(d => d.startsWith(month));
    const yesterday = days[days.indexOf(latest) - 1] || null;  // on the 1st working day this is last month's last day
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

    const zero = () => ({ reg: 0, do: 0, paid_n: 0, paid_amt: 0, digital: 0, pup: 0, inst_sum: 0, inst_n: 0, once_n: 0, once_amt: 0, once_due: 0,
      inst: { lt400: 0, b400_699: 0, b700_1499: 0, ge1500: 0, unknown: 0 }, lead: { le7: 0, d8_14: 0, d15_30: 0, gt30: 0, unknown: 0 } });
    const add = (a, r) => {
      if (!r) return a;
      for (const k of ['reg', 'do', 'paid_n', 'paid_amt', 'digital', 'pup', 'inst_sum', 'inst_n', 'once_n', 'once_amt', 'once_due']) a[k] += r[k] || 0;
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
      const base = p.status !== 'inactive' && p.baseline_per_day != null ? p.baseline_per_day : null;
      const expected = base != null ? base * recorded : null;
      const lastTwo = monthDays.slice(-2).reduce((a, d) => a + ((raw.days[d][p.key] || {}).reg || 0), 0);
      return {
        ...p, today, yesterday: yday, week: w.reg, month: m.reg, m, w, pm, prevMonth: pm.reg,
        best, bestDate, prevBest, streak, perDay, expected,
        pct: expected ? 100 * m.reg / expected : null,
        projection: m.reg + perDay * remaining,
        doRate: pctN(m.do, m.reg), paidRate: pctN(m.paid_n, m.reg), avgInst: m.inst_n ? m.inst_sum / m.inst_n : null,
        lowBand: pctN(m.inst.lt400 + m.inst.b400_699, m.reg), fastPay: pctN(m.lead.le7, m.reg), digital: pctN(m.digital, m.reg),
        base, lastTwo, series, active: p.status ? p.status !== 'inactive' || m.reg > 0 : (m.reg > 0 || pm.reg > 0 || w.reg > 0),
        firstMonth: p.status !== 'inactive' && base == null,
      };
    });

    const colleges = {};
    for (const p of people) {
      const c = colleges[p.college] ||= { name: p.college, people: [], m: zero(), w: zero(), pm: zero(), today: 0, expected: 0, augPerDay: 0, baseReg: 0, firstMonthReg: 0, series: monthDays.map(() => 0) };
      c.people.push(p); add(c.m, p.m); add(c.w, p.w); add(c.pm, p.pm); c.today += p.today;
      // pace is like-for-like: sales of people with a baseline against their expected; first-month starters are shown beside it
      if (p.base != null) { c.expected += p.base * recorded; c.augPerDay += p.base; c.baseReg += p.m.reg; } else c.firstMonthReg += p.m.reg;
      p.series.forEach((v, i) => c.series[i] += v);
    }
    for (const c of Object.values(colleges)) {
      c.pct = c.expected ? 100 * c.baseReg / c.expected : null;
      c.perDay = recorded ? c.m.reg / recorded : 0;
      c.projection = c.m.reg + c.perDay * remaining;
      c.doRate = pctN(c.m.do, c.m.reg);
    }
    const team = { m: teamFor(monthDays), w: teamFor(weekDays), pm: teamFor(prevMonthDays), today: teamFor([latest]).reg, yesterday: yesterday ? teamFor([yesterday]).reg : null };
    team.expected = Object.values(colleges).reduce((a, c) => a + c.expected, 0);
    team.baseReg = Object.values(colleges).reduce((a, c) => a + c.baseReg, 0);
    team.firstMonthReg = Object.values(colleges).reduce((a, c) => a + c.firstMonthReg, 0);
    team.pct = team.expected ? 100 * team.baseReg / team.expected : null;
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
        r.date = cycleDayDate(m, r.dom); r.partial = r.date >= TODAY; // today's receipts are incomplete until tomorrow
        if (r.actual_cum != null) { cum = r.actual_cum; g.sheetTo = r.dom; continue; }
        if (r.partial) break;
        if (inThisMonth && r.dom > new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate()) continue; // e.g. 31 Sep
        if (!hasBankDay(bank, r.dom)) break;
        cum += dayColl(bank, r.dom); r.actual_cum = Math.round(cum * 100) / 100; r.derived = true; filled++;
      }
      g.derivedDays = filled;
    }
    // Cycle totals from the bank tabs: 8th of the cycle month to the 7th of the next, per college.
    const cycleBank = m => { const out = {}; for (const [mm, lo, hi] of [[m, 8, 31], [nextMonthKey(m), 1, 7]]) for (const [c, rows] of Object.entries(raw.bank[mm] || {})) { const o = out[c] ||= { sales: 0, collections: 0, unclaimed: 0, days: [] }; for (const r of rows) if (r.dom >= lo && r.dom <= hi) { o.sales += r.sales || 0; o.collections += r.collections || 0; o.unclaimed += r.unclaimed || 0; o.days.push({ ...r, date: `${mm}-${String(r.dom).padStart(2, '0')}` }); } } return out; };
    return { raw, cycles, cur, prev, perCycle, bankMonths, goalMonths, agg, cycleBank };
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
      const bankStale = b && b.latest_month < CYCLE;
      rows.push(['Banked cash', b && b.latest_month ? monthLabel(b.latest_month) : '–', bankStale ? 'bad' : 'good', bankStale ? `no tabs for the cycle ${cycleLabel(CYCLE)}` : 'live · a day is complete the next day']);
      rows.push(['Cancellations', cz && cz.latest_logged ? 'logged to ' + dShort(cz.latest_logged > D.latest ? D.latest : cz.latest_logged) : '–', 'good', 'refreshed ' + timeAgo(C.raw.generated_at)]);
    } else rows.push(['Collections data', 'not available', 'bad', 'collections.json missing']);
    return el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Data freshness'), el('span', { class: 'xs muted' }, 'sales updated ' + timeAgo(sales.generated_at))),
      el('div', { class: 'fresh' }, rows.map(r => el('div', {}, el('span', {}, el('strong', {}, r[0]), ' ', el('span', { class: 'muted' }, r[1])), pill(r[3], r[2])))));
  };


  // ---------- analysis helpers (alerts, quality score, forecast, queue, course economics) ----------
  const DEPT_ORDER = ['Matric', 'Provider', 'QCTO', 'ICB', 'Nated'];
  const dataDate = C => { const g = C && C.raw.generated_at ? new Date(C.raw.generated_at) : new Date(); g.setHours(0, 0, 0, 0); return g; };
  const ageDays = (iso, ref) => Math.max(0, Math.round((ref - new Date(iso + 'T00:00:00')) / 86400000));

  // Registrar quality score 0–100: debit-order rate 35%, first payment within 7 days 25%, upfront payment 10%,
  // cancellation index 30% (100 minus 10 points per cancellation request per 100 sales over this + last month).
  function qualityFor(p, cancels) {
    if (!p.m || p.m.reg < 10) return null;
    const base = (p.m.reg || 0) + (p.pm ? p.pm.reg : 0);
    const per100 = base ? 100 * (cancels || 0) / base : 0;
    const cIdx = Math.max(0, 100 - 10 * per100);
    const q = 0.35 * (p.doRate || 0) + 0.25 * (p.fastPay || 0) + 0.10 * (p.paidRate || 0) + 0.30 * cIdx;
    return { score: Math.round(q), per100, cIdx };
  }
  const qualityClass = q => q == null ? '' : q >= 75 ? 'good' : q >= 60 ? 'warn' : 'bad';

  // Cash forecast for the latest goal cycle, using the average cumulative shape of completed cycles in the bank tabs.
  function cashForecast(C) {
    if (!C || !C.goalMonths.length) return null;
    const gm = C.goalMonths[C.goalMonths.length - 1]; const g = C.raw.goals[gm];
    const withActual = g.filter(r => r.actual_cum != null && !r.partial); const last = withActual[withActual.length - 1];
    if (!last) return null;
    const nextOf = m => { const y = +m.slice(0, 4), mo = +m.slice(5, 7); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
    const dayColl = (bank, dom) => Object.values(bank).reduce((t, rows) => t + rows.filter(r => r.dom === dom).reduce((u, r) => u + (r.collections || 0), 0), 0);
    const shapes = [];
    for (const m of C.bankMonths) {
      const nm = nextOf(m); if (!C.raw.bank[nm] || m === gm) continue;
      const dim = new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
      const cum = []; let c = 0;
      for (let d = 8; d <= dim; d++) { c += dayColl(C.raw.bank[m], d); cum.push({ dom: d, c }); }
      for (let d = 1; d <= 7; d++) { c += dayColl(C.raw.bank[nm], d); cum.push({ dom: d, c }); }
      if (c > 0) shapes.push({ m, total: c, cum });
    }
    if (shapes.length < 2) return null;
    const idx = g.findIndex(r => r.dom === last.dom);
    const shareAt = i => shapes.reduce((a, s) => a + (s.cum[Math.min(i, s.cum.length - 1)].c / s.total), 0) / shapes.length;
    const share = shareAt(idx);
    if (!share) return null;
    const total = last.actual_cum / share;
    const line = g.map((r, i) => i < idx ? null : Math.round(total * shareAt(i)));
    return { month: gm, total, line, cycles: shapes.length, share, lastDom: last.dom, goalTotal: g[g.length - 1].goal_cum, actual: last.actual_cum };
  }

  // Open cancellation requests, oldest first, with age and gaps (no agent, no attempt, no category).
  function queueFor(C, cycle, agent) {
    const ref = dataDate(C);
    return cycle.rows.filter(r => !/^(saved|cancel)$/i.test(r.status || '') && (!agent || r.agent === agent))
      .map(r => ({ ...r, age: ageDays(r.logged, ref), dept: r.course || '–', worked: !!r.status, noAgent: !!r.status && !r.agent, noAttempt: !!r.status && !!r.agent && !r.attempts.length, noCat: !r.category }))
      .sort((x, y) => y.age - x.age);
  }

  function alertsFor(D, C) {
    const A = []; const t = D.team;
    const add = (area, sev, text, role) => A.push({ area, sev, text, role });
    // Data
    if (D.raw.config_stale) add('Data', 'bad', `Registration data stops at ${dShort(D.latest)}: this month's sheets are not connected yet`, 'leadership');
    if (C) {
      const genAge = Math.round((Date.now() - new Date(C.raw.generated_at)) / 86400000);
      if (genAge > 3) add('Data', 'warn', `Collections data last refreshed ${genAge} days ago`, 'leadership');
      const bankLatest = C.bankMonths[C.bankMonths.length - 1];
      if (bankLatest && bankLatest < CYCLE) add('Data', 'bad', `Collections Daily Goal sheet has no bank tabs for the cycle ${cycleLabel(CYCLE)} (latest ${monthLabel(bankLatest)})`, 'collections');
      // A bank tab whose figures equal the previous month's is a copied template, not data.
      for (const t of ((C.raw.sources.bank || {}).copied_tabs || [])) add('Data', 'bad', `${t.college} bank tab for ${monthLabel(t.month)} repeats the ${monthLabel(t.same_as)} figures (copied template?); ignored`, 'collections');
      const gm = C.goalMonths[C.goalMonths.length - 1];
      // Reconcile: the goal tab's cumulative actual must equal the bank tabs' collections over the same days.
      if (gm) {
        const sheetRows = C.raw.goals[gm].filter(r => r.actual_cum != null && !r.derived && !r.partial); const lastRow = sheetRows[sheetRows.length - 1];
        if (lastRow) {
          const upTo = cycleDayDate(gm, lastRow.dom); const bank = C.cycleBank(gm);
          const bankDays = Object.values(bank).flatMap(o => o.days).filter(d => d.date <= upTo);
          const bankSum = bankDays.reduce((s, d) => s + (d.collections || 0), 0);
          const filled = new Set(bankDays.filter(d => d.collections != null).map(d => d.date));
          const want = []; for (let d = new Date(cycleDayDate(gm, 8) + 'T00:00:00'); ymd(d) <= upTo; d.setDate(d.getDate() + 1)) if (![0, 6].includes(d.getDay()) && !SA_HOLIDAYS.has(ymd(d)) && !filled.has(ymd(d))) want.push(ymd(d));
          const diff = lastRow.actual_cum - bankSum;
          if (Math.abs(diff) > Math.max(10000, 0.02 * lastRow.actual_cum)) add('Data', 'warn', `Goal tab shows ${randK(lastRow.actual_cum)} banked to ${dShort(upTo)} but the bank tabs add up to ${randK(bankSum)}` + (want.length ? `; no bank rows for ${want.slice(0, 4).map(dShort).join(', ')}${want.length > 4 ? ` +${want.length - 4}` : ''}` : ''), 'collections');
        }
      }
      if (gm && gm < CYCLE) add('Data', 'bad', `No goal tab yet for the cycle ${cycleLabel(CYCLE)} (latest ${cycleLabel(gm)})`, 'collections');
      if (gm) { const g = C.raw.goals[gm]; if (g.derivedDays > 1) add('Data', 'warn', `Goal tab for ${cycleLabel(gm)} not filled past day ${g.sheetTo}; actuals derived from bank tabs`, 'collections'); }
    } else add('Data', 'bad', 'Collections data not available', 'leadership');
    // Sales
    if (t.pct != null && t.pct < 80) add('Sales', t.pct < 70 ? 'bad' : 'warn', `Team at ${Math.round(t.pct)}% of baseline pace (${n0(t.baseReg)} vs ${n0(Math.round(t.expected))} expected${t.firstMonthReg ? `; plus ${n0(t.firstMonthReg)} from first-month starters` : ''})`, 'sales');
    for (const c of Object.values(D.colleges)) if (c.pct != null && c.pct < 75 && c.name !== 'Unknown') add('Sales', 'warn', `${c.name} at ${Math.round(c.pct)}% of baseline pace`, 'sales');
    if (t.doRate != null && t.doRate < 85) add('Sales', 'warn', `Debit-order rate ${Math.round(t.doRate)}% on this month's sales`, 'sales');
    const topZero = D.people.filter(p => p.active && p.prevMonth >= 40 && p.today === 0 && p.m.reg > 0).map(p => p.name);
    if (topZero.length) add('Sales', 'warn', `No sale on ${dShort(D.latest)} from ${topZero.slice(0, 5).join(', ')}${topZero.length > 5 ? ` +${topZero.length - 5}` : ''} (each sold 40+ last month)`, 'sales');
    // one-off roster notices: shown on the day they are issued only (the full list stays in the Roster changes card)
    for (const n of (D.raw.roster_notices || []).filter(n => n.issued === ymd(new Date()))) add('Sales', 'info', n.type === 'new_starter' ? `New starter: ${n.name} (${n.college}), first sale ${dShort(n.date)}` : `No sales for 30 days: ${n.name} (${n.college}), last sale ${dShort(n.date)}; left out of expected`, 'sales');
    const cm = (D.raw.course_months || {})[D.month] || {};
    for (const [fam, v] of Object.entries(cm)) if (v.n >= 10 && v.do / v.n < 0.7) add('Sales', 'warn', `${fam}: only ${pct(v.do, v.n)} of ${v.n} sales have a debit order`, 'sales');
    // Leads: the same contact re-entering a college's GF-list automation within an hour writes a duplicate sales-sheet row (seen 2 Nov 2026: Matric wait cut to 5 min, 10-min backup retag re-fired)
    { const dm = (S.leads || {}).demand || {}; const re = dm.reentries || {}; const dd = dm.daily || {};
      for (const day of Object.keys(re).sort().slice(-3)) for (const [col, n] of Object.entries(re[day])) { const tot = ((dd[day] || {})[col] || {}).enquiries || 0; if (tot >= 50 && n / tot > 0.1) add('Leads', 'bad', `${col} GF list: ${n0(n)} of ${n0(tot)} entries on ${dDow(day)} ${dShort(day)} were the same contact entering again within an hour — duplicate rows on the sales sheet; check the GF-list automation waits against the backup retag`, 'leadership'); } }
    for (const f of (((S.leads || {}).sources || {}).flags || [])) add('Marketing', 'warn', `${f.college.split(' ')[0]} ${f.path.split('/').pop()}: ${n0(f.third_party_leads)} leads from third-party placements, ${f.third_party_registered} registered (${n1(f.third_party_conv)}% vs ${n1(f.rest_conv)}% for the page's other traffic)`, 'leadership');
    // Collections
    if (C && C.cur) {
      const cur = C.perCycle[C.cur], a = cur.agg; const prev = C.prev ? C.perCycle[C.prev].agg : null;
      const q = queueFor(C, cur);
      const old = q.filter(r => r.age > 14).length; const noAgent = q.filter(r => r.noAgent).length; const noAtt = q.filter(r => r.noAttempt).length;
      if (a.unprocessed > 20) add('Collections', 'bad', `${n0(a.unprocessed)} cancellation requests logged but not yet worked (no status)`, 'collections');
      if (old) add('Collections', 'warn', `${n0(old)} open ${old === 1 ? 'request' : 'requests'} older than 14 days`, 'collections');
      if (noAgent) add('Collections', 'warn', `${n0(noAgent)} worked ${noAgent === 1 ? 'request has' : 'requests have'} no collections agent recorded`, 'collections');
      if (noAtt) add('Collections', 'warn', `${n0(noAtt)} assigned ${noAtt === 1 ? 'request has' : 'requests have'} no contact attempt logged`, 'collections');
      if (prev && a.saveRate != null && prev.saveRate != null && a.saveRate < prev.saveRate - 5) add('Collections', 'bad', `Save rate ${Math.round(a.saveRate)}% vs ${Math.round(prev.saveRate)}% last cycle`, 'collections');
      const f = cashForecast(C);
      if (f && f.goalTotal && f.total < 0.9 * f.goalTotal) add('Collections', 'warn', `Cycle cash forecast ${randK(f.total)} vs goal ${randK(f.goalTotal)}`, 'collections');
      const byDept = {}; for (const r of cur.rows) if (r.course) byDept[r.course] = (byDept[r.course] || 0) + 1;
      const sold = {}; for (const m of [D.prevMonth, D.month]) for (const v of Object.values((D.raw.course_months || {})[m] || {})) sold[v.dept] = (sold[v.dept] || 0) + v.n;
      for (const [d, n] of Object.entries(byDept)) if (sold[d] && n >= 5 && 100 * n / sold[d] > 8) add('Collections', 'warn', `${d}: ${n} cancellation requests this cycle = ${n1(100 * n / sold[d])} per 100 sales of the last two months`, 'collections');
    }
    if (S.ads && S.leads) {
      const sg = marketingSignals(D, S.leads, S.ads);
      for (const s of sg.spend) { if (s.zeroDay) add('Marketing', 'bad', `${s.college}: no Google Ads spend on ${dDow(s.zeroDay)} ${dShort(s.zeroDay)} (normally ${randK(s.mean)} a day)`, 'marketing'); else if (s.flag) add('Marketing', Math.abs(s.chg) > 50 ? 'bad' : 'warn', `${s.college} Google Ads spend ${s.chg > 0 ? 'up' : 'down'} ${Math.round(Math.abs(s.chg))}% week on week (${randK(s.cur)} vs ${randK(s.prev)})`, 'marketing'); }
      for (const f of sg.facebook) if (f.flag) add('Marketing', Math.abs(f.chg) > 50 ? 'bad' : 'warn', `${f.college} Facebook spend pace ${f.chg > 0 ? 'up' : 'down'} ${Math.round(Math.abs(f.chg))}% on last month (${randK(f.pace)} vs ${randK(f.ppace)} a day)`, 'marketing');
      for (const x of sg.anomalies) add('Marketing', x.ratio < 0.6 ? 'bad' : 'warn', `${x.college}: ${n0(x.n)} enquiries on ${dDow(x.date)} ${dShort(x.date)} vs ${n0(Math.round(x.mean))} normal; ${x.cause}`, 'marketing');
    }
    return A.sort((x, y) => (x.sev === 'bad' ? 0 : 1) - (y.sev === 'bad' ? 0 : 1));
  }
  function alertsCard(D, C, scope) {
    const all = alertsFor(D, C);
    const list = all.filter(a => scope === 'leadership' || a.role === scope || a.role === 'leadership');
    return el('div', { class: 'card alerts' }, el('div', { class: 'card-head' }, el('h2', {}, 'Attention'), el('span', { class: 'xs muted' }, `${list.filter(a => a.sev === 'bad').length} red · ${list.filter(a => a.sev === 'warn').length} amber` + (list.some(a => a.sev === 'info') ? ` · ${list.filter(a => a.sev === 'info').length} notice${list.filter(a => a.sev === 'info').length === 1 ? '' : 's'}` : ''))),
      list.length ? el('ul', { class: 'list' }, list.map(a => el('li', {}, el('span', {}, pill(a.area, a.sev), ' ', a.text)))) : el('div', { class: 'empty' }, 'Nothing needs attention'));
  }

  function courseEconomics(D, C) {
    const cm = (D.raw.course_months || {})[D.month] || {};
    const pm = (D.raw.course_months || {})[D.prevMonth] || {};
    const cur = C && C.cur ? C.perCycle[C.cur] : null;
    const cancelsByDept = {}; if (cur) for (const r of cur.rows) if (r.course) cancelsByDept[r.course] = (cancelsByDept[r.course] || 0) + 1;
    const depts = {};
    for (const [src, w] of [[cm, 'm'], [pm, 'p']]) for (const v of Object.values(src)) { const d = depts[v.dept] ||= { dept: v.dept, m: 0, p: 0, do: 0, inst: 0, paid: 0 }; d[w] += v.n; if (w === 'm') { d.do += v.do; d.inst += v.inst_sum; d.paid += v.paid_amt; } }
    const deptRows = DEPT_ORDER.filter(d => depts[d]).map(d => { const x = depts[d]; const cz = cancelsByDept[d] || 0; return { ...x, cancels: cur ? cz : null, per100: cur && (x.m + x.p) ? 100 * cz / (x.m + x.p) : null, doRate: pctN(x.do, x.m) }; });
    const total = Object.values(cm).reduce((a, v) => a + v.n, 0);
    const famRows = Object.entries(cm).map(([fam, v]) => ({ fam, dept: v.dept, n: v.n, share: 100 * v.n / total, doRate: pctN(v.do, v.n), avgInst: v.inst_n ? v.inst_sum / v.inst_n : null, monthly: v.inst_sum, upfront: upfrontCash(v), onceN: v.once_n || 0, paidRate: pctN(v.paid_n, v.n), college: Object.entries(v.colleges || {}).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || '', variants: v.variants || {} })).filter(r => r.n >= 5);
    const strip = el('div', { class: 'grid five', style: 'margin-bottom:12px' }, deptRows.map(d => el('div', { class: 'kpi mini' }, el('div', { class: 'label' }, d.dept), el('div', { class: 'value num' }, n0(d.m)), el('div', { class: 'sub' }, `D/O ${d.doRate == null ? '–' : Math.round(d.doRate) + '%'} · ${randK(d.inst)}/month signed`, d.cancels != null ? el('span', { class: d.per100 > 8 ? ' bad' : '' }, ` · ${n0(d.cancels)} cancel req. (${d.per100 == null ? '–' : n1(d.per100)}/100)`) : null))));
    const table = sortableTable([
      { key: 'fam', label: 'Course family', render: (v, r) => el('span', {}, v, ' ', el('span', { class: 'faint xs' }, r.dept)) },
      { key: 'n', label: 'Sales', num: true },
      { key: 'share', label: 'Share', num: true, fmt: v => Math.round(v) + '%' },
      { key: 'doRate', label: 'D/O', num: true, render: v => v == null ? '–' : el('span', { class: v < 70 ? 'bad' : v < 85 ? 'warn' : '' }, Math.round(v) + '%') },
      { key: 'avgInst', label: 'Avg inst.', num: true, fmt: rand },
      { key: 'monthly', label: 'Monthly value signed', num: true, fmt: randK },
      { key: 'upfront', label: 'Upfront cash', num: true, fmt: randK },
      { key: 'onceN', label: 'Once-off', num: true, fmt: n0 },
      { key: 'paidRate', label: 'Paid upfront', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' },
    ], famRows, 'n');
    return el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, `Course economics · ${MONTHS_LONG[+D.month.slice(5, 7) - 1]}`), el('span', { class: 'xs muted' }, 'cancellation requests this cycle per 100 sales of this + last month')), strip, table,
      el('p', { class: 'note', style: 'margin:12px 0 0' }, 'Monthly value signed = sum of first-instalment amounts captured on this month\u2019s sales (recurring value at risk if students lapse). A first payment above R3,000 is treated as a once-off (full fee or large deposit): it is counted under Upfront cash and Once-off, not in the instalment average. The cancellation sheet records course type only (Matric, Provider, QCTO, ICB, Nated), so cancellations are matched at that level. Families with fewer than 5 sales are hidden.'));
  }

  function trendCard(D, C) {
    const months = [...new Set(D.days.map(d => d.slice(0, 7)))].sort();
    const rows = months.map(m => {
      const ds = D.days.filter(d => d.startsWith(m)); const agg = D.zero(); for (const d of ds) for (const k in D.raw.days[d]) D.add(agg, D.raw.days[d][k]);
      const bank = C && C.raw.bank[m] ? Object.values(C.raw.bank[m]).flat().reduce((a, r) => a + (r.collections || 0), 0) : null;
      const cyc = C ? C.cycles.find(k => k.startsWith(m)) : null; const cz = cyc ? C.perCycle[cyc].agg : null;
      return { m, label: monthLabel(m), reg: agg.reg, perDay: agg.reg / ds.length, doRate: pctN(agg.do, agg.reg), upfront: upfrontCash(agg), avgInst: agg.inst_n ? agg.inst_sum / agg.inst_n : null, bank, cancels: cz ? cz.total : null, saveRate: cz ? cz.saveRate : null, days: ds.length };
    });
    return el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Month by month'), el('span', { class: 'xs muted' }, 'cancel req. = requests in the cycle starting on the 8th of that month · history is kept after sheets are archived')),
      sortableTable([
        { key: 'label', label: 'Month' }, { key: 'days', label: 'Days recorded', num: true }, { key: 'reg', label: 'Registrations', num: true }, { key: 'perDay', label: 'Per day', num: true, fmt: n1 },
        { key: 'doRate', label: 'D/O', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' }, { key: 'avgInst', label: 'Avg inst.', num: true, fmt: rand }, { key: 'upfront', label: 'Upfront cash', num: true, fmt: randK },
        { key: 'bank', label: 'Collections banked', num: true, fmt: v => v == null ? '–' : randK(v) }, { key: 'cancels', label: 'Cancel req.', num: true, fmt: v => v == null ? '–' : n0(v) }, { key: 'saveRate', label: 'Save rate', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' },
      ], rows, 'm'));
  }

  const agentLink = key => `${location.origin}${location.pathname}#role=sales-agent&who=${encodeURIComponent(key)}`;
  function copyButton(text, label = 'Copy link') {
    const b = el('button', { class: 'btn', type: 'button' }, label);
    b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; setTimeout(() => b.textContent = label, 1500); } catch { prompt('Copy this link', text); } });
    return b;
  }
  function downloadCsv(name, header, rows) {
    const esc = v => v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
    const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: name }); document.body.append(a); a.click(); a.remove();
  }
  function incentiveExportCard(D) {
    const wk = D.raw.incentive_week_days || [];
    const rows = D.people.filter(p => p.incentive).map(p => [p.name, p.college, p.incentive.debit_orders, p.incentive.enrolment_incentive, p.incentive.cash_collected, p.incentive.cash_incentive, p.incentive.total, p.m.reg, p.m.do, Math.round(upfrontCash(p.m))]);
    const header = ['Registrar', 'College', 'Debit orders (week)', 'Enrolment incentive', 'Cash collected (week)', 'Cash incentive', 'Incentive total (week)', `Registrations ${D.month}`, `Debit orders ${D.month}`, `Upfront cash ${D.month}`];
    const total = rows.reduce((a, r) => a + (r[6] || 0), 0);
    return el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Incentive export'), el('span', { class: 'xs muted' }, wk.length ? `week of ${dShort(wk[0])}` : '')),
      el('ul', { class: 'list' }, el('li', {}, el('span', { class: 'muted' }, 'Registrars on the incentive sheet'), el('span', { class: 'num' }, n0(rows.length))), el('li', {}, el('span', { class: 'muted' }, 'Incentive earned this week'), el('span', { class: 'num' }, rand(total))), el('li', {}, el('span', { class: 'muted' }, 'Already paid (per sheet)'), el('span', { class: 'num' }, n0(D.people.filter(p => p.incentive && p.incentive.paid).length)))),
      el('div', { class: 'row', style: 'margin-top:12px' }, el('button', { class: 'btn', type: 'button', onclick: () => downloadCsv(`incentive_${wk[0] || D.month}.csv`, header, rows) }, 'Download CSV'), el('span', { class: 'xs muted' }, 'weekly figures from the incentive sheet + month-to-date sales')));
  }
  function teamLinksCard(D) {
    const people = D.people.filter(p => p.active).sort((a, b) => a.name.localeCompare(b.name));
    const all = people.map(p => `${p.name}\t${agentLink(p.key)}`).join('\n');
    return el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Personal pages'), copyButton(all, 'Copy all links')),
      el('p', { class: 'note' }, 'Each registrar has a bookmarkable page. Send the link once; it stays current.'),
      el('div', { class: 'links' }, people.map(p => el('a', { href: agentLink(p.key), target: '_blank', rel: 'noopener' }, el('span', { class: 'dot ' + collegeClass(p.college) }), ' ', p.name))));
  }
  function queueCard(C, cur, title, agent) {
    const q = queueFor(C, cur, agent);
    const cols = [
      { key: 'age', label: 'Age (days)', num: true, render: v => el('span', { class: v > 14 ? 'bad' : v > 7 ? 'warn' : '' }, n0(v)) },
      { key: 'logged', label: 'Logged', render: v => dShort(v) },
      { key: 'college', label: 'College', render: v => el('span', {}, el('span', { class: 'dot ' + collegeClass(v || '') }), ' ', v || '–') },
      { key: 'dept', label: 'Course type' },
      { key: 'category', label: 'Reason', render: v => v || el('span', { class: 'warn' }, 'not captured') },
      { key: 'status', label: 'Status', render: v => v || el('span', { class: 'bad' }, 'not worked') },
      { key: 'agent', label: 'Agent', render: v => v || el('span', { class: 'bad' }, 'unassigned') },
      { key: 'attempts', label: 'Attempts', num: true, render: v => v.length ? n0(v.length) : el('span', { class: 'warn' }, '0') },
      { key: 'logger', label: 'Logged by' },
    ];
    return el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, title), el('span', { class: 'xs muted' }, `${n0(q.length)} open · ${n0(q.filter(r => r.age > 14).length)} older than 14 days · ${n0(q.filter(r => r.noAgent).length)} unassigned · ${n0(q.filter(r => r.noAttempt).length)} no attempt`)),
      q.length ? sortableTable(cols, q.slice(0, 60), 'age') : el('div', { class: 'empty' }, 'No open requests'),
      q.length > 60 ? el('p', { class: 'note', style: 'margin:8px 0 0' }, `Showing the 60 oldest of ${q.length}.`) : null);
  }
  // ---------- v2.2 analysis: north star, 80/20, expected cash, top actions, cancellation 80/20 ----------
  // Cancellation requests per registrar first name over this cycle and the previous one.
  function cancelsByRegistrar(C) {
    const out = {};
    if (!C) return out;
    for (const k of [C.prev, C.cur]) if (k) for (const [n, s] of Object.entries(C.perCycle[k].agg.bySales)) out[n] = (out[n] || 0) + s.total;
    return out;
  }
  // Average monthly instalment per course type over this and last month (used to value cancellations).
  function avgInstByDept(D) {
    const acc = {};
    for (const m of [D.prevMonth, D.month]) for (const v of Object.values((D.raw.course_months || {})[m] || {})) { const a = acc[v.dept] ||= { s: 0, n: 0 }; a.s += v.inst_sum || 0; a.n += v.inst_n || 0; }
    const out = {}; for (const [d, a] of Object.entries(acc)) out[d] = a.n ? a.s / a.n : null;
    out._team = D.team.avgInst;
    return out;
  }
  // Upfront cash = amounts in the Paid column + once-off first payments (> R3,000) whose payment date is still ahead.
  function upfrontCash(m) { return (m.paid_amt || 0) + (m.once_due || 0); }
  // Expected 12-month cash from this month's sales: monthly value signed × 12 × (1 − cancellation rate) + upfront cash.
  // Cancellation rate = requests per 100 sales over this + last cycle, capped at 50%. An estimate, not a forecast of what will bank.
  function expectedCash(p, cancels) {
    const base = (p.m.reg || 0) + (p.pm ? p.pm.reg : 0);
    const rate = base ? Math.min(0.5, (cancels || 0) / base) : 0;
    return (p.m.inst_sum || 0) * 12 * (1 - rate) + upfrontCash(p.m);
  }
  const HORIZON = 12; // months of instalments used to value a student

  function northStarCard(D, C) {
    const t = D.team; const cur = C && C.cur ? C.perCycle[C.cur] : null;
    const payingReady = t.m.do; // students who signed with a debit order this month
    const cancelled = cur ? cur.agg.cancelled : null;
    const net = cancelled != null ? payingReady - cancelled : null;
    const drivers = [
      ['Registrations', n0(t.m.reg), `${D.recorded} of ${D.workDays} days`],
      ['× Debit-order rate', pct(t.m.do, t.m.reg), `${n0(t.m.reg - t.m.do)} sales without a D/O`],
      ['− Cancelled this cycle', cancelled != null ? n0(cancelled) : '–', cur ? `${n0(cur.agg.saved)} saved · ${n0(cur.agg.open + cur.agg.unprocessed)} still open` : 'no data'],
      ['Upfront cash', randK(upfrontCash(t.m)), `${n0(t.m.paid_n)} sales paid something upfront${t.m.once_n ? ` · ${n0(t.m.once_n)} once-off (${randK(t.m.once_amt)})` : ''}`],
    ];
    return el('section', { class: 'card north' },
      el('div', { class: 'north-main' },
        el('div', { class: 'label' }, `Paying students added · ${MONTHS_LONG[+D.month.slice(5, 7) - 1]}`),
        el('div', { class: 'value num ' + (t.pct != null ? paceClass(t.pct) : '') }, net != null ? n0(net) : n0(payingReady)),
        el('div', { class: 'sub' }, `${n0(payingReady)} signed with a debit order${cancelled != null ? ` − ${n0(cancelled)} cancelled this cycle` : ''} · everything below is a driver of this number`)),
      el('div', { class: 'north-drivers' }, drivers.map(d => el('div', {}, el('span', { class: 'xs muted' }, d[0]), el('b', { class: 'num' }, d[1]), el('span', { class: 'xs faint' }, d[2])))),
      el('p', { class: 'note' }, `Proxy: a debit order in place is the best signal of a paying student until first-debit-order outcomes are connected. Cancellations are this cycle's, not only this month's sales.`));
  }

  // 80/20: share of count and of cash held by the top 4%, top 20% and bottom 50% of a ranked list.
  function pareto(items, countKey, cashKey) {
    const sorted = [...items].filter(x => x[countKey] > 0).sort((a, b) => b[cashKey] - a[cashKey]);
    const n = sorted.length; const tc = sorted.reduce((a, x) => a + x[countKey], 0); const tv = sorted.reduce((a, x) => a + x[cashKey], 0);
    const seg = (from, to) => { const s = sorted.slice(from, to); return { n: s.length, names: s.map(x => x.name), count: pctN(s.reduce((a, x) => a + x[countKey], 0), tc), cash: pctN(s.reduce((a, x) => a + x[cashKey], 0), tv) }; };
    if (n < 5) return null;
    const top4 = Math.max(1, Math.round(n * 0.04)); const top20 = Math.max(1, Math.round(n * 0.2)); const half = Math.floor(n / 2);
    return { n, top4: seg(0, top4), top20: seg(0, top20), bottom50: seg(n - half, n), sorted, tc, tv };
  }
  function paretoCard(D, C) {
    const cz = cancelsByRegistrar(C);
    const regs = D.people.filter(p => p.m.reg > 0).map(p => ({ name: p.name, count: p.m.reg, cash: expectedCash(p, cz[firstName(p.name)]) }));
    const cm = (D.raw.course_months || {})[D.month] || {};
    const courses = Object.entries(cm).map(([fam, v]) => ({ name: fam, count: v.n, cash: v.inst_sum * HORIZON + upfrontCash(v) }));
    const pr = pareto(regs, 'count', 'cash'); const pc = pareto(courses, 'count', 'cash');
    const block = (title, p, unit) => !p ? el('div', { class: 'empty' }, 'not enough data') : el('div', { class: 'pareto' },
      el('h3', {}, title, ' ', el('span', { class: 'xs muted' }, `${p.n} ${unit}`)),
      [['Top 4%', p.top4], ['Top 20%', p.top20], ['Bottom 50%', p.bottom50]].map(([lab, s]) => el('div', { class: 'pareto-row' },
        el('span', {}, el('b', {}, lab), el('br'), el('span', { class: 'xs muted' }, `${s.n} ${unit === 'registrars' ? (s.n === 1 ? 'registrar' : 'registrars') : (s.n === 1 ? 'family' : 'families')}`)),
        el('span', { class: 'num' }, `${Math.round(s.count)}% of sales`),
        el('span', { class: 'num ' + (s.cash >= 50 ? 'good' : s.cash < 15 ? 'bad' : '') }, `${Math.round(s.cash)}% of cash`),
        el('span', { class: 'xs faint names' }, lab === 'Bottom 50%' ? '' : s.names.slice(0, 4).join(', ') + (s.names.length > 4 ? ` +${s.names.length - 4}` : '')))));
    return el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, '80/20'), el('span', { class: 'xs muted' }, 'this month · cash = expected 12-month value')),
      block('Registrars', pr, 'registrars'), block('Course families', pc, 'families'), S.leads ? block('Lead channels', pareto(channelRows(S.leads, D.month), 'count', 'cash'), 'channels') : null,
      el('p', { class: 'note' }, 'Cash = monthly instalments signed × 12 × (1 − cancellation rate) + upfront (incl. once-off fees above R3,000). Lead channels = college × source from the CRM; details on the Marketing view.'));
  }

  // Today's three: alerts and gaps ranked by estimated cash impact (12 months of instalments per student).
  function actionsFor(D, C) {
    const A = []; const t = D.team; const inst = avgInstByDept(D); const avg = inst._team || 600;
    const add = (role, impact, text, why) => A.push({ role, impact, text, why });
    // Sales: registrars who usually sell but were at zero on the latest day
    for (const p of D.people) if (p.active && p.today === 0 && p.perDay >= 2 && p.m.reg > 0) add('sales', p.perDay * (p.avgInst || avg) * HORIZON, `Call ${p.name}: no sale ${dShort(D.latest)}, usually ${n1(p.perDay)}/day`, 'a lost day at their rate');
    // Sales: D/O gap vs team
    for (const p of D.people) if (p.m.reg >= 15 && p.doRate != null && t.doRate != null && p.doRate < t.doRate - 15) { const gap = Math.round((t.doRate - p.doRate) / 100 * p.m.reg); add('sales', gap * (p.avgInst || avg) * HORIZON * 0.5, `Coach ${p.name} on debit orders: ${Math.round(p.doRate)}% vs team ${Math.round(t.doRate)}% (${gap} sales without a mandate)`, 'half the value of the missing mandates'); }
    // Leadership: registrars whose closed-month sales pay far below the team rate
    if (S.pay && S.pay.months) {
      const judge = payJudgeMonths(S.pay);
      for (const r of payRegistrarRows(S.pay, judge)) if (r.matched >= 40 && r.gap != null && r.gap < -12) {
        const p = D.people.find(x => x.key === r.key); const nm = p ? p.name : r.key;
        add('leadership', r.missing * (p && p.avgInst ? p.avgInst : avg) * HORIZON * 0.5, `${nm}: only ${Math.round(r.paidPct)}% of ${judge.map(monthLabel).join(' and ')} sales have paid anything vs ${Math.round(r.teamPct)}% team (${n0(r.missing)} sales short); review how the sale is closed`, 'half the value of the sales that never paid');
      }
    }
    // Sales: course families with low D/O
    const cm = (D.raw.course_months || {})[D.month] || {};
    for (const [fam, v] of Object.entries(cm)) if (v.n >= 10 && v.do / v.n < 0.7 && (v.inst_n ? v.inst_sum / v.inst_n : 0) < 20000) add('sales', (v.n - v.do) * (v.inst_n ? v.inst_sum / v.inst_n : avg) * HORIZON * 0.5, `${fam}: ${v.n - v.do} of ${v.n} sales have no debit order`, 'half the value of the missing mandates');
    if (S.leads) {
      const L = S.leads; const mm = L.monthly[D.month] || {};
      for (const [col, chs] of Object.entries(mm)) {
        const tot = Object.values(chs).reduce((o, v) => ({ leads: o.leads + v.leads, reg: o.reg + v.registered, inst: o.inst + v.inst_sum, n: o.n + v.inst_n }), { leads: 0, reg: 0, inst: 0, n: 0 });
        const sp = (L.speed.by_college || {})[col]; if (!sp || !tot.leads) continue;
        const conv = tot.reg / tot.leads; const val = (tot.n ? tot.inst / tot.n : avg) * HORIZON;
        if (sp.within_24h_pct != null && sp.within_24h_pct < 60) add('sales', (1 - sp.within_24h_pct / 100) * tot.leads * conv * val * 0.2, `${col}: only ${sp.within_24h_pct}% of leads reach a registrar within 24 h (median ${hrs(sp.median_min)})`, 'a fifth of the value of slow leads');
        if (sp.never_allocated_pct != null && sp.never_allocated_pct >= 10) add('sales', (sp.never_allocated_pct / 100) * tot.leads * conv * val * 0.5, `${col}: ${sp.never_allocated_pct}% of leads older than 3 days have no registrar`, 'half the value at the college conversion rate');
      }
      const AM = S.ads && S.ads.monthly ? S.ads.monthly[D.month] : null;
      if (AM) for (const [col, chs] of Object.entries(mm)) for (const [ch, v] of Object.entries(chs)) {
        const a = (AM[col] || {})[ch]; if (!a || a.cost < 5000 || !v.registered) continue;
        const perReg = v.inst_sum * HORIZON / v.registered, cpr = a.cost / v.registered;
        if (cpr > perReg) add('marketing', a.cost - v.registered * perReg, `${col.split(' ')[0]} ${ch}: ${rand(cpr)} of ad spend per registration vs ${rand(perReg)} 12-month value; cut or re-target`, 'spend above the 12-month value of the registrations it bought');
      }
      for (const f of ((L.sources || {}).flags || [])) {
        add('marketing', f.third_party_leads * ((f.rest_conv || 0) - (f.third_party_conv || 0)) / 100 * avg * HORIZON, `${f.college.split(' ')[0]} ${f.path.split('/').pop()}: ${n0(f.third_party_leads)} leads via third-party sites converted at ${n1(f.third_party_conv)}% vs ${n1(f.rest_conv)}% for the rest; exclude those placements`, 'leads bought from display placements that never register still cost ad spend and registrar calls');
      }
    }
    if (C && C.cur) {
      const cur = C.perCycle[C.cur]; const a = cur.agg; const q = queueFor(C, cur);
      const saveRate = (a.saveRate != null ? a.saveRate : 15) / 100;
      const rowVal = r => (inst[r.course] || avg) * HORIZON;
      const unw = q.filter(r => !r.worked); if (unw.length) add('collections', unw.reduce((s, r) => s + rowVal(r), 0) * saveRate, `Assign the ${unw.length} unworked cancellation requests (oldest ${Math.max(...unw.map(r => r.age))} days)`, `value × ${Math.round(saveRate * 100)}% save rate`);
      const old = q.filter(r => r.worked && r.age > 14); if (old.length) add('collections', old.reduce((s, r) => s + rowVal(r), 0) * saveRate, `Close the ${old.length} open ${old.length === 1 ? 'request' : 'requests'} older than 14 days`, `value × ${Math.round(saveRate * 100)}% save rate`);
      const noAtt = q.filter(r => r.noAttempt); if (noAtt.length) add('collections', noAtt.reduce((s, r) => s + rowVal(r), 0) * saveRate, `${noAtt.length} assigned requests have no contact attempt yet`, `value × ${Math.round(saveRate * 100)}% save rate`);
      // courses leaking cancellations
      const byDept = {}; for (const r of cur.rows) if (r.course) byDept[r.course] = (byDept[r.course] || 0) + 1;
      const sold = {}; for (const m of [D.prevMonth, D.month]) for (const v of Object.values((D.raw.course_months || {})[m] || {})) sold[v.dept] = (sold[v.dept] || 0) + v.n;
      for (const [d, n] of Object.entries(byDept)) if (sold[d] >= 30 && n >= 5 && 100 * n / sold[d] > 8) add('leadership', n * (inst[d] || avg) * HORIZON, `${d}: ${n} cancellation requests = ${n1(100 * n / sold[d])} per 100 sales; find the cause (course, script or registrar)`, 'value of the requests');
      // agents with low save rate and many cases
      for (const ag of Object.values(a.byAgent)) if (ag.saved + ag.cancelled >= 15 && a.saveRate != null && 100 * ag.saved / (ag.saved + ag.cancelled) < a.saveRate - 5) add('collections', (a.saveRate / 100 - ag.saved / (ag.saved + ag.cancelled)) * ag.total * avg * HORIZON, `Coach ${ag.name}: save rate ${Math.round(100 * ag.saved / (ag.saved + ag.cancelled))}% vs team ${Math.round(a.saveRate)}% on ${ag.total} cases`, 'gap to team save rate');
    }
    if (D.raw.config_stale) {
      // working days since the last recorded day, excluding today (data for today is never complete)
      let missed = 0; const today = new Date(); today.setHours(0, 0, 0, 0);
      for (let d = new Date(D.latest + 'T00:00:00'); ; ) { d.setDate(d.getDate() + 1); if (d >= today) break; const dow = d.getDay(); if (dow !== 0 && dow !== 6 && !HOLIDAYS.has(d.toISOString().slice(0, 10))) missed++; }
      if (missed) add('leadership', missed * t.perDay * avg * HORIZON, `Connect this month's registration sheets: ${missed} working day${missed === 1 ? '' : 's'} of sales invisible since ${dShort(D.latest)}`, `${missed} day${missed === 1 ? '' : 's'} at the team rate`);
    }
    return A.sort((x, y) => y.impact - x.impact);
  }
  function actionsCard(D, C, scope) {
    const all = actionsFor(D, C).filter(a => scope === 'leadership' || a.role === scope || a.role === 'leadership').slice(0, 3);
    return el('div', { class: 'card actions' }, el('div', { class: 'card-head' }, el('h2', {}, 'Today’s three'), el('span', { class: 'xs muted' }, 'ranked by cash impact')),
      all.length ? el('ol', { class: 'actions-list' }, all.map(a => el('li', {}, el('span', {}, a.text), el('span', { class: 'impact num' }, '≈ ' + randK(a.impact), el('span', { class: 'xs faint' }, ' · ' + a.why))))) : el('div', { class: 'empty' }, 'Nothing stands out today'),
      el('p', { class: 'note' }, `Impact = students × average monthly instalment × ${HORIZON} months, discounted as noted. A ranking aid, not a forecast.`));
  }

  // Which 20% of cancellations hold most of the lost cash, and which salvage offers actually recover it.
  function cancelParetoCard(D, C) {
    if (!C || !C.cur) return null;
    const cur = C.perCycle[C.cur]; const inst = avgInstByDept(D); const avg = inst._team || 600;
    const val = r => (inst[r.course] || avg) * HORIZON;
    const lost = cur.rows.filter(r => (r.status || '').toLowerCase() === 'cancel');
    const totalLost = lost.reduce((s, r) => s + val(r), 0);
    const group = key => { const g = {}; for (const r of lost) { const k = r[key] || 'not captured'; const o = g[k] ||= { name: k, n: 0, cash: 0 }; o.n++; o.cash += val(r); } return Object.values(g).sort((a, b) => b.cash - a.cash); };
    const cats = group('category'); const courses = group('course');
    let cum = 0; const catRows = cats.map(c => { cum += c.cash; return { ...c, share: pctN(c.cash, totalLost), cum: pctN(cum, totalLost) }; });
    const offers = {}; for (const r of cur.rows) { const st = (r.status || '').toLowerCase(); if (st !== 'saved' && st !== 'cancel') continue; const k = r.offer || 'No offer made'; const o = offers[k] ||= { name: k, n: 0, saved: 0 }; o.n++; if (st === 'saved') o.saved++; }
    const offerRows = Object.values(offers).map(o => ({ ...o, rate: pctN(o.saved, o.n) })).sort((a, b) => b.rate - a.rate);
    const list = (rows, fmt) => el('div', { class: 'list tight' }, rows.map(r => el('div', { class: 'li' }, el('span', {}, r.name), el('span', { class: 'num muted' }, fmt(r)))));
    return el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Where the lost cash is'), el('span', { class: 'xs muted' }, `${n0(lost.length)} cancelled · ≈ ${randK(totalLost)} over ${HORIZON} months`)),
      el('h3', {}, 'By reason'), list(catRows.slice(0, 6), r => `${n0(r.n)} · ${Math.round(r.share)}% of cash · cum ${Math.round(r.cum)}%`),
      el('h3', { style: 'margin-top:12px' }, 'By course type'), list(courses.slice(0, 5), r => `${n0(r.n)} · ${randK(r.cash)}`),
      el('h3', { style: 'margin-top:12px' }, 'Salvage offers that work'), list(offerRows.filter(o => o.n >= 3), r => `${Math.round(r.rate)}% saved of ${n0(r.n)}`),
      el('p', { class: 'note' }, 'Cash uses the average instalment of the course type sold this and last month. Offer types are read from the free-text “Salvage Offer Made” column.'));
  }

  // Tests register: conversion per variant, lift and a two-proportion z-test (95%). Winner only when Done and reliable.
  function testStats(t) {
    const pa = t.a.n ? t.a.conv / t.a.n : null, pb = t.b.n ? t.b.conv / t.b.n : null;
    if (pa == null || pb == null) return { pa, pb, z: null, reliable: false, lift: null };
    const p = (t.a.conv + t.b.conv) / (t.a.n + t.b.n); const se = Math.sqrt(p * (1 - p) * (1 / t.a.n + 1 / t.b.n));
    const z = se ? (pb - pa) / se : 0;
    return { pa, pb, z, reliable: Math.abs(z) >= 1.96 && t.a.n >= 30 && t.b.n >= 30, lift: pa ? 100 * (pb - pa) / pa : null };
  }
  function testsCard(C, filterTypes) {
    const wrap = (...kids) => el("section", { class: "card" }, ...kids);
    const all = (C && C.raw.tests) || [];
    const tests = filterTypes ? all.filter(t => filterTypes.test(t.type || '')) : all;
    const url = C && C.raw.sources && C.raw.sources.tests ? `https://docs.google.com/spreadsheets/d/${C.raw.sources.tests.sheet}/edit` : null;
    const head = el('div', { class: 'card-head' }, el('h2', {}, 'Tests'), el('span', { class: 'xs muted' }, url ? el('a', { href: url, target: '_blank', rel: 'noopener' }, 'open the register') : 'register not connected'));
    if (!tests.length) return wrap(head, el('div', { class: 'empty' }, 'No tests logged yet. Add a row to the Tests register (mailer, SMS or call script, offer, price, deposit, debit date) with how many saw each variant and how many converted; the readout appears here the next morning.'));
    const rows = tests.map(t => { const s = testStats(t); const done = /done|stopped/i.test(t.status || '');
      const verdict = s.z == null ? 'no data yet' : done && s.reliable ? `${s.pb > s.pa ? t.b.name : t.a.name} wins` : s.reliable ? 'leading, not closed' : 'no reliable difference yet';
      return { ...t, ...s, verdict, cls: s.z == null ? '' : done && s.reliable ? 'good' : s.reliable ? 'warn' : '' }; });
    return wrap(head,
      el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ['Test', 'Metric', 'A', 'B', 'Lift', 'Verdict', 'Status'].map((h, i) => el('th', { class: i >= 2 && i <= 4 ? 'num' : '' }, h)))),
        el('tbody', {}, rows.map(r => el('tr', {}, el('td', {}, el('strong', {}, r.test), r.type ? el('span', { class: 'xs muted' }, ' · ' + r.type) : null), el('td', {}, r.metric || '–'),
          el('td', { class: 'num' }, r.pa == null ? '–' : `${Math.round(100 * r.pa)}% (${n0(r.a.conv)}/${n0(r.a.n)})`), el('td', { class: 'num' }, r.pb == null ? '–' : `${Math.round(100 * r.pb)}% (${n0(r.b.conv)}/${n0(r.b.n)})`),
          el('td', { class: 'num ' + (r.lift == null ? '' : r.lift > 0 ? 'good' : 'bad') }, r.lift == null ? '–' : `${r.lift > 0 ? '+' : ''}${Math.round(r.lift)}%`), el('td', {}, el('span', { class: r.cls }, r.verdict)), el('td', {}, r.status || '–')))))),
      el('p', { class: 'note' }, 'B is compared with A. Reliable = two-proportion z-test at 95% with at least 30 in each variant. A winner is declared only once the test is marked Done.'));
  }

  // ---------- views ----------
  function goalNote(g, goalMonth, D) {
    const mo = MONTHS[+goalMonth.slice(5, 7) - 1];
    const parts = ['collections banked since the 8th'];
    if (g.sheetTo != null && g.derivedDays) parts.push(`goal tab filled to ${g.sheetTo} ${mo}, rest from bank tabs`);
    else if (g.sheetTo != null) parts.push(`goal tab filled to ${g.sheetTo} ${mo}`);
    if (goalMonth < CYCLE) parts.push(`no tab yet for the cycle ${cycleLabel(CYCLE)}`);
    parts.push('today excluded: a day is complete the next day');
    return parts.join(' · ');
  }
  // ---------- v2.7: what sold actually pays (FileMaker payment totals joined to each sale) ----------
  // Months old enough to judge: the paid-anything curve flattens about 6 weeks after the sale.
  // Closed months whose end is at least 5 weeks before the FileMaker report date (the curve has flattened by then).
  function payJudgeMonths(P) {
    const to = P.report_registered_to ? new Date(P.report_registered_to) : new Date();
    return Object.keys(P.months || {}).sort().filter(m => (P.months[m]._all || {}).sold >= 50 && (to - new Date(m + '-01T00:00:00')) / 864e5 >= 31 + 35).slice(-2);
  }
  function payRegistrarRows(P, months) {
    // Per registrar: sold and paid across the chosen months, compared with the team rate of the same months (same age).
    const acc = {};
    for (const m of months) {
      const team = (P.months[m] || {})._all; if (!team || !team.matched) continue;
      for (const [k, v] of Object.entries(P.registrars[m] || {})) {
        const a = acc[k] ||= { key: k, sold: 0, matched: 0, paid: 0, cash: 0, pending: 0, cancelled: 0, expected: 0 };
        a.sold += v.sold; a.matched += v.matched; a.paid += v.paid_any; a.cash += v.paid_amt; a.pending += v.pending; a.cancelled += v.cancelled;
        a.expected += v.matched * team.paid_any / team.matched;
      }
    }
    return Object.values(acc).map(a => ({ ...a, paidPct: pctN(a.paid, a.matched), teamPct: pctN(a.expected, a.matched), gap: a.matched ? 100 * (a.paid - a.expected) / a.matched : null, missing: Math.round(a.expected - a.paid) }));
  }
  function paymentsCard(D, scope) {
    const P = S.pay; if (!P || !P.months) return null;
    const months = Object.keys(P.months).sort().filter(m => (P.months[m]._all || {}).sold >= 50);
    const judge = payJudgeMonths(P);
    const nameOf = k => (D.people.find(p => p.key === k) || {}).name || k.replace(/\b\w/g, c => c.toUpperCase());
    const collegeOf = k => (D.people.find(p => p.key === k) || {}).college || '';
    const monthRows = months.map(m => { const a = P.months[m]._all; return { m, label: monthLabel(m), sold: a.sold, matched: a.match_pct, paid: a.paid_pct, pending: a.pending, cancelled: a.cancelled, cash: a.paid_amt, perSale: a.sold ? a.paid_amt / a.sold : null }; });
    const mcols = [{ key: 'label', label: 'Sales month' }, { key: 'sold', label: 'Sold', num: true }, { key: 'paid', label: 'Paid any', num: true, render: v => v == null ? '–' : el('span', { class: v < 35 ? 'bad' : v < 45 ? 'warn' : 'good' }, Math.round(v) + '%') },
      { key: 'pending', label: 'Never paid', num: true }, { key: 'cancelled', label: 'Cancelled', num: true }, { key: 'cash', label: 'Cash', num: true, fmt: randK }];
    const wk = Object.entries(P.weeks || {}).filter(([k, v]) => v.sold >= 100).sort();
    const { card: wcard, canvas: wcv } = chartCard('Share of each week’s sales that has paid anything', `cumulative to ${P.report_registered_to ? dShort(P.report_registered_to) : 'report date'} · flattens about 6 weeks after the sale`);
    queueMicrotask(() => chart(wcv, { type: 'bar', data: { labels: wk.map(([k]) => dShort(k)), datasets: [{ label: 'Paid any', data: wk.map(([, v]) => v.paid_pct), backgroundColor: wk.map(([k]) => k >= (judge[judge.length - 1] || '') + '-99' ? 'rgba(99,142,255,.45)' : 'rgba(79,201,138,.8)') }] }, options: { maintainAspectRatio: false, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { beginAtZero: true, max: 60, ticks: { callback: v => v + '%' } } }, plugins: { legend: { display: false } } } }));
    const parts = [el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'What sold actually pays'), el('span', { class: 'xs muted' }, `FileMaker payment totals to ${P.report_registered_to ? dShort(P.report_registered_to) : '–'} joined to each sale by CRM number`)),
      el('div', { class: 'table-wrap dense' }, sortableTable(mcols, monthRows, 'm')),
      el('p', { class: 'note' }, 'A sale counts as paid when FileMaker shows any learner payment for that registration. Pending = no payment has ever been received. 98–99% of sales are found in FileMaker. Payments are cumulative to the report date, so the newest month is not yet comparable; judge registrars and courses on the closed months. The weekly FileMaker report arrives on Mondays; this card refreshes then.'))];
    if (scope !== 'collections') parts.push(wcard);
    if (judge.length) {
      const mas = {}; // money at sale per registrar over the judged months, from the sales sheets
      for (const [d, regs] of Object.entries(D.raw.days || {})) if (judge.includes(d.slice(0, 7))) for (const [k, v] of Object.entries(regs)) { const m = mas[k] ||= { reg: 0, paid: 0 }; m.reg += v.reg || 0; m.paid += v.paid_n || 0; }
      const rows = payRegistrarRows(P, judge).filter(r => r.matched >= 30).map(r => ({ ...r, name: nameOf(r.key), college: collegeOf(r.key), masPct: mas[r.key] ? pctN(mas[r.key].paid, mas[r.key].reg) : null }));
      const teamMas = Object.values(mas).reduce((s, m) => ({ reg: s.reg + m.reg, paid: s.paid + m.paid }), { reg: 0, paid: 0 }); const teamMasPct = pctN(teamMas.paid, teamMas.reg);
      const rcols = [{ key: 'name', label: 'Registrar', render: (v, r) => el('span', {}, el('span', { class: 'dot ' + collegeClass(r.college) }), ' ', v) }, { key: 'sold', label: 'Sold', num: true },
        { key: 'paidPct', label: 'Paid any', num: true, render: (v, r) => v == null ? '–' : el('span', { class: r.gap != null && r.gap < -12 ? 'bad' : r.gap < -5 ? 'warn' : r.gap > 10 ? 'good' : '' }, Math.round(v) + '%') },
        { key: 'teamPct', label: 'Team', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' },
        { key: 'missing', label: 'Short', num: true, render: v => v == null ? '–' : el('span', { class: v > 15 ? 'bad' : '' }, v > 0 ? n0(v) : '–') },
        { key: 'masPct', label: 'Money at sale', num: true, render: v => v == null ? '–' : el('span', { class: teamMasPct != null && v < teamMasPct - 10 ? 'bad' : teamMasPct != null && v > teamMasPct + 10 ? 'good' : '' }, Math.round(v) + '%') },
        { key: 'cash', label: 'Cash', num: true, fmt: randK }];
      parts.push(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Registrars · whose sales pay'), el('span', { class: 'xs muted' }, judge.map(monthLabel).join(' + ') + ' sales · registrars with 30+ matched sales')),
        el('div', { class: 'table-wrap dense' }, sortableTable(rcols, rows, 'missing')),
        el('p', { class: 'note' }, 'Team rate is computed on the same months, so age does not favour anyone. "Sales short of team rate" = how many more of this registrar’s sales would have paid at the team rate; a high number with a low paid share points to how the sale is closed (deposit promised, debit-order date, course fit), not to collections. Money at sale = share of the registrar’s sales in the same months where any payment was taken on the day of the sale (team ' + (teamMasPct == null ? '–' : Math.round(teamMasPct) + '%') + '); sales with money at sale pay on at roughly three times the rate of debit-order-only sales.')));
    }
    if (judge.length && (scope === 'collections' || scope === 'leadership')) {
      const fam = {};
      for (const m of judge) for (const [f, v] of Object.entries(P.families[m] || {})) { const a = fam[f] ||= { fam: f, dept: v.dept, sold: 0, matched: 0, paid: 0, cash: 0, pending: 0 }; a.sold += v.sold; a.matched += v.matched; a.paid += v.paid_any; a.cash += v.paid_amt; a.pending += v.pending; }
      const frows = Object.values(fam).filter(a => a.matched >= 20).map(a => ({ ...a, paidPct: pctN(a.paid, a.matched), perSale: a.sold ? a.cash / a.sold : null }));
      const fcols = [{ key: 'fam', label: 'Course family' }, { key: 'dept', label: 'Dept' }, { key: 'sold', label: 'Sold', num: true }, { key: 'paidPct', label: 'Paid any', num: true, render: v => v == null ? '–' : el('span', { class: v < 30 ? 'bad' : v < 40 ? 'warn' : 'good' }, Math.round(v) + '%') }, { key: 'pending', label: 'Never paid', num: true }, { key: 'cash', label: 'Cash', num: true, fmt: randK }];
      parts.push(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Courses · which sales pay'), el('span', { class: 'xs muted' }, judge.map(monthLabel).join(' + ') + ' sales · families with 20+ matched sales')), el('div', { class: 'table-wrap dense' }, sortableTable(fcols, frows, 'sold'))));
    }
    const frag = document.createDocumentFragment();
    frag.appendChild(el('section', { class: 'grid two' }, parts[0], parts[1] || null));
    if (parts.length > 2) frag.appendChild(el('section', { class: 'grid two' }, parts[2], parts[3] || null));
    return frag;
  }

  function viewLeadership(D, C) {
    const t = D.team; const out = [];
    const cur = C && C.cur ? C.perCycle[C.cur] : null;
    const bankMonth = C && C.bankMonths.length ? C.bankMonths[C.bankMonths.length - 1] : null;
    const cycBank = C && bankMonth ? C.cycleBank(CYCLE) : null;
    let bankColl = null, bankSales = null;
    if (cycBank) { bankColl = 0; bankSales = 0; for (const o of Object.values(cycBank)) { bankColl += o.collections; bankSales += o.sales; } }
    const goalMonth = C && C.goalMonths.length ? C.goalMonths[C.goalMonths.length - 1] : null;
    let goalPct = null, goalActual = null, goalTarget = null;
    if (goalMonth) {
      const g = C.raw.goals[goalMonth];
      const withActual = g.filter(r => r.actual_cum != null && !r.partial);
      const last = withActual[withActual.length - 1];
      goalActual = last ? last.actual_cum : null;
      goalTarget = g[g.length - 1].goal_cum;
      const goalAtDay = last ? g.find(r => r.dom === last.dom).goal_cum : null;
      goalPct = goalAtDay ? 100 * goalActual / goalAtDay : null;
    }

    out.push(northStarCard(D, C));
    out.push(el('section', { class: 'grid two' }, actionsCard(D, C, 'leadership'), alertsCard(D, C, 'leadership')));
    out.push(el('section', { class: 'grid kpis' },
      kpi(`Registrations · ${MONTHS_LONG[+D.month.slice(5, 7) - 1]}`, n0(t.m.reg), `${t.pct != null ? Math.round(t.pct) + '% of baseline pace' : 'no baseline'} · ${D.recorded} of ${D.workDays} days`, paceClass(t.pct)),
      kpi('Projected month end', n0(Math.round(t.projection)), `${n1(t.perDay)}/day · baseline pace ${n0(Math.round(t.augPerDay * D.workDays))}`, t.projection >= t.augPerDay * D.workDays ? 'good' : 'bad'),
      kpi('Debit orders on new sales', pct(t.m.do, t.m.reg), `${n0(t.m.do)} of ${n0(t.m.reg)} this month`),
      kpi('Upfront cash on new sales', randK(t.m.paid_amt), `${rand(t.m.paid_amt)} · ${n0(t.m.paid_n)} sales paid something upfront (${pct(t.m.paid_n, t.m.reg)})`),
      kpi(`Banked · cycle ${cycleLabel(CYCLE)}`, bankColl != null ? randK(bankColl + bankSales) : '–', bankColl != null ? `${randK(bankColl)} collections + ${randK(bankSales)} sales · to yesterday` : 'no bank data', bankMonth && bankMonth < CYCLE ? 'bad' : ''),
      kpi(cur ? `Cancellations · cycle from ${dShort(cur.start)}` : 'Cancellations', cur ? n0(cur.agg.total) : '–', cur ? `${n0(cur.agg.saved)} saved · ${cur.agg.saveRate != null ? Math.round(cur.agg.saveRate) + '% save rate' : ''} · ${n0(cur.agg.open + cur.agg.unprocessed)} open` : 'no data'),
    ));

    if (S.leads) out.push(funnelStripCard(D, S.leads));
    const payL = paymentsCard(D, 'leadership'); if (payL) out.push(payL);
    // Charts: daily registrations stacked by college + August pace
    const { card: c1, canvas: cv1 } = chartCard('Daily registrations by college', 'dashed line = baseline pace (active registrars)');
    const { card: c2, canvas: cv2 } = chartCard(goalMonth ? `Cash goal vs actual · cycle ${cycleLabel(goalMonth)}` : 'Cash goal vs actual', goalMonth ? goalNote(C.raw.goals[goalMonth], goalMonth, D) : '');
    out.push(el('section', { class: 'grid two' }, c1, c2));

    // College cards
    const colleges = Object.values(D.colleges).filter(c => c.name !== 'Unknown').sort((a, b) => b.m.reg - a.m.reg);
    out.push(el('section', { class: 'grid three' }, colleges.map(c => {
      const cz = cur ? cur.agg.byCollege[c.name] || 0 : null;
      const bColl = cycBank && cycBank[c.name] ? cycBank[c.name].collections : null;
      return el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h2', {}, el('span', { class: 'dot ' + collegeClass(c.name) }), ' ', c.name), pill(c.pct != null ? Math.round(c.pct) + '% of pace' : 'no baseline', paceClass(c.pct))),
        el('div', { class: 'row spread' }, el('div', { class: 'kpi' }, el('div', { class: 'label' }, 'Month'), el('div', { class: 'value num' }, n0(c.m.reg))), el('div', { class: 'kpi' }, el('div', { class: 'label' }, 'Today'), el('div', { class: 'value num' }, n0(c.today))), el('div', { class: 'kpi' }, el('div', { class: 'label' }, 'Projected'), el('div', { class: 'value num' }, n0(Math.round(c.projection))))),
        progress(c.baseReg, c.expected || c.m.reg, paceClass(c.pct)),
        el('ul', { class: 'list', style: 'margin-top:12px' },
          el('li', {}, el('span', { class: 'muted' }, 'Expected at baseline pace'), el('span', { class: 'num' }, c.expected ? n0(Math.round(c.expected)) : '–')),
          el('li', {}, el('span', { class: 'muted' }, 'Sold by registrars with a baseline'), el('span', { class: 'num' }, n0(c.baseReg) + (c.firstMonthReg ? ` · +${n0(c.firstMonthReg)} first month` : ''))),
          el('li', {}, el('span', { class: 'muted' }, 'Debit-order rate'), el('span', { class: 'num' }, pct(c.m.do, c.m.reg))),
          el('li', {}, el('span', { class: 'muted' }, 'Upfront cash'), el('span', { class: 'num' }, `${rand(c.m.paid_amt)} · ${pct(c.m.paid_n, c.m.reg)}`)),
          el('li', {}, el('span', { class: 'muted' }, 'Under R700/month'), el('span', { class: 'num' }, pct(c.m.inst.lt400 + c.m.inst.b400_699, c.m.reg))),
          el('li', {}, el('span', { class: 'muted' }, `Collections banked · cycle from 8 ${MONTHS[+CYCLE.slice(5, 7) - 1]}`), el('span', { class: 'num' }, bColl != null ? randK(bColl) : '–')),
          el('li', {}, el('span', { class: 'muted' }, 'Cancellation requests this cycle'), el('span', { class: 'num' }, cz != null ? n0(cz) : '–')),
          el('li', {}, el('span', { class: 'muted' }, 'Registrars selling'), el('span', { class: 'num' }, n0(c.people.filter(p => p.m.reg > 0).length))),
        ));
    })));

    // Trend across months + cancellations across cycles + freshness
    const { card: c3, canvas: cv3 } = chartCard('Registrations per working day, by month', 'all months on record');
    const { card: c4, canvas: cv4 } = chartCard('Cancellation requests per cycle', 'saved vs cancelled vs still open');
    out.push(el('section', { class: 'grid three' }, c3, c4, freshnessCard(D, C)));
    out.push(courseEconomics(D, C));
    out.push(trendCard(D, C));
    out.push(testsCard(C));

    requestAnimationFrame(() => {
      chart(cv1, { type: 'bar', data: { labels: D.monthDays.map(dShort), datasets: [
        ...colleges.map(c => ({ label: c.name, data: c.series, backgroundColor: collegeColor(c.name), stack: 's', borderRadius: 2 })),
        { type: 'line', label: 'Baseline pace', data: D.monthDays.map(() => t.augPerDay), borderColor: '#f5b942', borderDash: [6, 4], pointRadius: 0, borderWidth: 2 },
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

  // Roster changes: new starters and registrars with no sale for 30 days, each listed once with the day it was noticed.
  function rosterChangesCard(D) {
    const since = new Date(); since.setDate(since.getDate() - 30); const cut = ymd(since);
    const ns = (D.raw.roster_notices || []).filter(n => n.issued >= cut).sort((a, b) => b.issued.localeCompare(a.issued) || a.type.localeCompare(b.type));
    if (!ns.length) return null;
    const rules = D.raw.roster_rules || {};
    return el('section', {}, el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Roster changes'), el('span', { class: 'xs muted' }, 'from the sales sheets · last 30 days')),
      el('ul', { class: 'list' }, ns.map(n => el('li', {}, el('span', {}, el('span', { class: 'dot ' + collegeClass(n.college) }), ' ', el('strong', {}, n.name), ' ',
        el('span', { class: 'muted' }, n.type === 'new_starter' ? `new starter, first sale ${dShort(n.date)}: shows “first month” until a full month is on record` : `no sales for 30 days, last sale ${dShort(n.date)}: left out of expected`)),
        pill(n.type === 'new_starter' ? 'new' : 'inactive', n.type === 'new_starter' ? 'good' : 'warn')))),
      el('p', { class: 'note', style: 'margin:12px 0 0' }, `Roster = everyone who sold on the sales sheets. Active = a sale in the last ${rules.active_days || 30} days. Baseline = the August rate from the comparison sheet where it exists, otherwise the person's own last full month (${rules.previous_full_month ? monthLabel(rules.previous_full_month) : 'last month'}). Each change is listed once, on the day it is noticed.`)));
  }

  function viewSalesManager(D, C) {
    const t = D.team; const out = [];
    const cur = C && C.cur ? C.perCycle[C.cur] : null;
    const people = D.people.filter(p => p.active);

    out.push(el('section', { class: 'grid kpis' },
      kpi('Today', n0(t.today), `${dDow(D.latest)} ${dShort(D.latest)} · yesterday ${n0(t.yesterday)}`),
      kpi('This week', n0(t.w.reg), `from Mon ${dShort(D.mondayIso)}`),
      kpi('This month', n0(t.m.reg), `${t.pct != null ? Math.round(t.pct) + '% of baseline pace' : ''} · projected ${n0(Math.round(t.projection))}`, paceClass(t.pct)),
      kpi('Debit-order rate', pct(t.m.do, t.m.reg), 'sales with a D/O mandate'),
      kpi('First payment within 7 days', pct(t.m.lead.le7, t.m.reg), `avg instalment ${rand(t.avgInst)}`),
      kpi('Registrars selling', n0(people.filter(p => p.m.reg > 0).length), `${people.filter(p => p.firstMonth && p.m.reg > 0).length} in first month · ${D.people.filter(p => !p.active).length} inactive (30 days)`),
    ));

    // Attention list
    const attention = [];
    for (const p of people) {
      if (p.m.reg === 0) { attention.push([p, 'no sales this month' + (p.prevMonth ? ` (${p.prevMonth} last month)` : ''), 'bad']); continue; }
      if (p.base != null && p.pct != null && p.pct < 70) attention.push([p, `${Math.round(p.pct)}% of baseline pace (${p.baseline_source === 'August' ? 'August' : 'own ' + monthLabel(p.baseline_source)})`, 'bad']);
      else if (p.lastTwo === 0 && p.m.reg > 0) attention.push([p, 'no sales in the last two recorded days', 'warn']);
      else if (p.m.reg >= 10 && p.doRate != null && t.doRate != null && p.doRate < t.doRate - 15) attention.push([p, `D/O rate ${Math.round(p.doRate)}% vs team ${Math.round(t.doRate)}%`, 'warn']);
    }
    const attentionCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Needs attention'), el('span', { class: 'xs muted' }, `${attention.length} flags`)),
      attention.length ? el('ul', { class: 'list' }, attention.sort((x, y) => (x[2] === 'bad' ? 0 : 1) - (y[2] === 'bad' ? 0 : 1)).slice(0, 12).map(([p, why, cls]) => el('li', {}, el('span', {}, el('span', { class: 'dot ' + collegeClass(p.college) }), ' ', el('strong', {}, p.name), ' ', el('span', { class: 'muted' }, why)), pill(n0(p.m.reg) + ' mtd', cls)))) : el('div', { class: 'empty' }, 'Nothing flagged'));

    // Mix cards
    const mixCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Monthly instalment mix'), el('span', { class: 'xs muted' }, 'this month, all colleges')),
      mixBar(INST_KEYS.map(k => t.m.inst[k]), INST_LABELS, INST_COLORS),
      el('p', { class: 'note', style: 'margin:12px 0 0' }, 'Lower monthly values have historically paid through better than higher ones.'),
      el('h3', { style: 'margin:16px 0 8px' }, 'First payment due'),
      mixBar(LEAD_KEYS.map(k => t.m.lead[k]), LEAD_LABELS, LEAD_COLORS));
    const { card: trendCard, canvas: trendCv } = chartCard('Team registrations per day', 'this month · dashed = baseline pace');
    out.push(el('section', { class: 'grid three' }, actionsCard(D, C, 'sales'), alertsCard(D, C, 'sales'), attentionCard));
    const rc = rosterChangesCard(D); if (rc) out.push(rc);
    out.push(el('section', { class: 'grid two' }, paretoCard(D, C), mixCard));
    out.push(testsCard(C, /mailer|sms|call|script|offer|price|deposit|landing|other|^$/i));
    out.push(el('section', { class: 'grid three' }, trendCard, incentiveExportCard(D), teamLinksCard(D)));
    const payS = paymentsCard(D, 'sales'); if (payS) out.push(payS);

    // League table
    const cols = [
      { key: 'name', label: 'Registrar', render: (v, r) => el('span', {}, el('span', { class: 'dot ' + collegeClass(r.college) }), ' ', v, r.firstMonth ? el('span', { class: 'faint xs' }, ' · first month') : null) },
      { key: 'today', label: 'Today', num: true },
      { key: 'yesterday', label: 'Yday', num: true },
      { key: 'week', label: 'Week', num: true },
      { key: 'month', label: 'Month', num: true, render: (v, r) => el('span', {}, el('span', { class: 'bar', style: `width:${Math.round(60 * v / Math.max(1, ...people.map(p => p.month)))}px` }), el('span', { class: 'num' }, n0(v))) },
      { key: 'pct', label: 'vs base', num: true, render: v => v == null ? el('span', { class: 'faint' }, '–') : el('span', { class: paceClass(v) }, Math.round(v) + '%') },
      { key: 'projection', label: 'Proj.', num: true, fmt: v => n0(Math.round(v)) },
      { key: 'quality', label: 'Quality', num: true, render: v => v == null ? el('span', { class: 'faint' }, '–') : el('span', { class: qualityClass(v) }, n0(v)) },
      { key: 'expCash', label: '12-mo cash', num: true, fmt: v => randK(v) },
      { key: 'doRate', label: 'D/O', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' },
      { key: 'paidRate', label: 'Upfront', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' },
      { key: 'avgInst', label: 'Avg inst.', num: true, fmt: v => rand(v) },
      { key: 'fastPay', label: '1st pay ≤7d', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' },
      { key: 'cancels', label: 'Cancel req.', num: true, fmt: v => v == null ? '–' : n0(v) },
      { key: 'best', label: 'Best day', num: true },
      { key: 'incDO', label: 'D/O wk', num: true, fmt: v => v == null ? '–' : n0(v) },
      { key: 'incTotal', label: 'Incentive', num: true, fmt: v => v == null ? '–' : rand(v) },
    ];
    const czAll = cancelsByRegistrar(C);
    const rows = people.map(p => { const cz = cur ? (cur.agg.bySales[firstName(p.name)] || {}).total || 0 : null; const q = qualityFor(p, czAll[firstName(p.name)] || 0); return { ...p, cancels: cz, quality: q ? q.score : null, expCash: expectedCash(p, czAll[firstName(p.name)]), incDO: p.incentive ? p.incentive.debit_orders : null, incTotal: p.incentive ? p.incentive.total : null }; });
    let leagueCollege = 'all';
    const redraw = () => { tableHost.innerHTML = ''; tableHost.append(sortableTable(cols, leagueCollege === 'all' ? rows : rows.filter(r => r.college === leagueCollege), S.leagueSort || 'month', { rank: true })); };
    const filter = el('select', { onchange: e => { leagueCollege = e.target.value; redraw(); } },
      el('option', { value: 'all' }, 'All colleges'), Object.keys(D.colleges).filter(c => c !== 'Unknown').map(c => el('option', { value: c }, c)));
    const rankBy = el('div', { class: 'seg' }, [['month', 'Rank by sales'], ['expCash', 'Rank by 12-mo cash']].map(([k, lab]) => el('button', { class: 'btn' + ((S.leagueSort || 'month') === k ? ' on' : ''), onclick: () => { S.leagueSort = k; rankBy.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === lab)); redraw(); } }, lab)));
    const tableHost = el('div', {});
    redraw();
    out.push(el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'League table'), el('div', { class: 'row' }, rankBy, filter)), tableHost,
      el('p', { class: 'note', style: 'margin:12px 0 0' }, 'vs base = this month against each registrar’s baseline daily rate × recorded days: the August rate where it exists, otherwise their own last full month; new starters show “first month” until they have one. Registrars with no sale for 30 days are left out. Proj. = current daily rate carried to month end. Cancel req. = cancellation requests this cycle on sales attributed to the registrar. 12-mo cash = monthly instalments signed × 12 × (1 − cancellation rate this and last cycle, capped at 50%) + upfront cash: an estimate for ranking, not a forecast. D/O wk and Incentive come from the weekly incentive sheet. Quality (0–100, needs 10+ sales) = debit-order rate 35% + first payment within 7 days 25% + paid upfront 10% + cancellation index 30% (100 minus 10 per cancellation request per 100 sales over this and last month). Cancellation attribution uses the first name in the sheet, so shared first names (e.g. Christa) are merged.')));
    out.push(courseEconomics(D, C));

    requestAnimationFrame(() => {
      chart(trendCv, { type: 'bar', data: { labels: D.monthDays.map(dShort), datasets: [
        { label: 'Registrations', data: t.series, backgroundColor: '#f5b942', borderRadius: 3 },
        { type: 'line', label: 'Baseline pace', data: D.monthDays.map(() => t.augPerDay), borderColor: '#9aa5b1', borderDash: [6, 4], pointRadius: 0, borderWidth: 2 },
      ] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } } });
    });
    if (S.leads) out.push(el('section', { class: 'grid two' }, speedCard(S.leads, 'registrar'), leadsPerSaleCard(S.leads)));
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
    const myQ = qualityFor(p, myCancels ? myCancels.total : 0);

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
          p.pct != null ? pill(`${Math.round(p.pct)}% of your ${p.baseline_source === 'August' ? 'August' : monthLabel(p.baseline_source)} pace`, paceClass(p.pct)) : pill(p.status === 'inactive' ? 'no sales for 30 days' : 'first month: no baseline yet'),
          pill(`on track for ${n0(Math.round(p.projection))} this month`),
          p.streak >= 2 ? pill(`${p.streak}-day streak`, 'good') : null,
          p.today > 0 && p.today >= p.prevBest && p.prevBest > 0 ? pill('personal best today', 'good') : null,
          myQ ? pill(`quality ${myQ.score}/100`, qualityClass(myQ.score)) : null,
          copyButton(agentLink(p.key), 'Copy my link'),
        )),
      el('div', {}, inc ? el('div', { class: 'ring' },
        el('div', { class: 'ring-svg', html: `<svg viewBox="0 0 150 150" width="150" height="150"><circle cx="75" cy="75" r="${r}" fill="none" stroke="#1d242c" stroke-width="12"/><circle cx="75" cy="75" r="${r}" fill="none" stroke="#f5b942" stroke-width="12" stroke-linecap="round" transform="rotate(-90 75 75)" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - ringPct / 100)}"/></svg>` }),
        el('div', { class: 'ring-label' }, el('b', { class: 'num' }, n0(inc.debit_orders)), el('span', { class: 'xs muted' }, needed ? `of ${needed} D/Os` : 'D/Os this week'))) : el('div', { class: 'empty' }, 'Not on the incentive sheet'),
        inc ? el('div', { style: 'text-align:center;margin-top:10px' }, el('div', { class: 'small' }, needed ? `${inc.to_next_level} more debit order${inc.to_next_level === 1 ? '' : 's'} this week unlocks ${rand(inc.next_level_amount)}` : 'Top incentive level reached'), el('div', { class: 'xs muted' }, `Earned so far: ${rand(inc.total)} (${rand(inc.enrolment_incentive)} enrolment + ${rand(inc.cash_incentive)} cash)`)) : null)));

    const { card: dayCard, canvas: dayCv } = chartCard('Your sales per day this month', 'dashed = your baseline pace');
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
        el('li', {}, el('span', { class: 'muted' }, 'Baseline per day' + (p.baseline_source ? ` (${p.baseline_source === 'August' ? 'August' : p.baseline_source === 'first month' ? 'first month' : monthLabel(p.baseline_source)})` : '')), el('span', { class: 'num' }, p.base != null ? n1(p.base) : '–')),
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
        { key: 'pct', label: 'vs base', num: true, render: v => v == null ? el('span', { class: 'faint' }, '–') : el('span', { class: paceClass(v) }, Math.round(v) + '%') },
      ], rows, 'month', { rank: true, highlight: r => r.key === p.key })));

    requestAnimationFrame(() => {
      chart(dayCv, { type: 'bar', data: { labels: D.monthDays.map(dShort), datasets: [
        { label: 'Sales', data: p.series, backgroundColor: p.series.map(v => v >= p.best && v > 0 ? '#4fc98a' : '#f5b942'), borderRadius: 3 },
        p.base != null ? { type: 'line', label: 'Baseline pace', data: D.monthDays.map(() => p.base), borderColor: '#9aa5b1', borderDash: [6, 4], pointRadius: 0, borderWidth: 2 } : null,
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
    const withActual = g ? g.filter(r => r.actual_cum != null && !r.partial) : [];
    const last = withActual[withActual.length - 1];
    const goalAtDay = last ? g.find(r => r.dom === last.dom).goal_cum : null;
    const bankMonth = C.bankMonths[C.bankMonths.length - 1];
    const bank = bankMonth ? C.cycleBank(CYCLE) : null; // per college, 8th of the cycle month to the 7th of the next
    const bankTot = bank ? Object.fromEntries(Object.entries(bank).map(([c, o]) => [c, { sales: o.sales, collections: o.collections, unclaimed: o.unclaimed }])) : null;
    const bankAll = bankTot ? Object.values(bankTot).reduce((o, r) => ({ sales: o.sales + r.sales, collections: o.collections + r.collections, unclaimed: o.unclaimed + r.unclaimed }), { sales: 0, collections: 0, unclaimed: 0 }) : null;
    const stale = goalMonth && goalMonth < CYCLE;
    // Day view: the latest complete day (yesterday or earlier) against its goal, and the goal for today.
    const dayGoal = dom => g ? g.find(r => r.dom === dom) : null;
    const bankDays = bank ? [...new Set(Object.values(bank).flatMap(o => o.days.map(d => d.date)))].sort() : [];
    const isWeekend = d => [0, 6].includes(new Date(d + 'T00:00:00').getDay()) || SA_HOLIDAYS.has(d);
    const completeDays = bankDays.filter(d => d < TODAY && !isWeekend(d)); // weekends and public holidays bank nothing; judge the last banking day
    const lastDay = completeDays.length ? completeDays[completeDays.length - 1] : null;
    const dayColl = date => bank ? Object.values(bank).reduce((t, o) => t + o.days.filter(d => d.date === date).reduce((u, d) => u + (d.collections || 0), 0), 0) : null;
    const lastDayColl = lastDay ? dayColl(lastDay) : null;
    const lastDayGoal = lastDay ? dayGoal(+lastDay.slice(8, 10)) : null;
    const todayGoal = dayGoal(+TODAY.slice(8, 10));
    const fc = cashForecast(C);

    out.push(el('section', { class: 'grid two' }, actionsCard(D, C, 'collections'), alertsCard(D, C, 'collections')));
    out.push(el('section', { class: 'grid kpis' },
      kpi(lastDay ? `${dShort(lastDay)} vs its goal` : 'Latest complete day', lastDayColl != null && lastDayGoal && lastDayGoal.goal_day ? pct(lastDayColl, lastDayGoal.goal_day) : lastDayColl != null ? randK(lastDayColl) : '–', lastDay ? `${randK(lastDayColl)} banked${lastDayGoal && lastDayGoal.goal_day ? ` vs ${randK(lastDayGoal.goal_day)} day goal` : ' · no day goal'} · a day is complete the next day` : 'no bank data', lastDayGoal && lastDayGoal.goal_day ? (lastDayColl >= lastDayGoal.goal_day ? 'good' : lastDayColl >= 0.9 * lastDayGoal.goal_day ? 'warn' : 'bad') : ''),
      kpi(`Today's goal · ${dShort(TODAY)}`, todayGoal && todayGoal.goal_day != null ? randK(todayGoal.goal_day) : '–', todayGoal ? `cycle ${cycleLabel(goalMonth)} · ${randK(todayGoal.goal_cum)} planned by tonight` : stale ? `no goal tab yet for ${cycleLabel(CYCLE)}` : 'no goal for today', stale ? 'bad' : ''),
      kpi(goalMonth ? `Cycle cash vs goal · ${cycleLabel(goalMonth)}` : 'Cash vs goal', last ? pct(last.actual_cum, goalAtDay) : '–', last ? `${randK(last.actual_cum)} banked to ${dShort(last.date || cycleDayDate(goalMonth, last.dom))} vs ${randK(goalAtDay)} planned` : 'no data', stale ? 'bad' : last && last.actual_cum >= goalAtDay ? 'good' : 'warn'),
      kpi('Cycle cash forecast', fc ? randK(fc.total) : '–', fc ? `${randK(fc.actual)} by day ${fc.lastDom} · shape of ${fc.cycles} past cycles · goal ${randK(fc.goalTotal)}` : 'needs two completed cycles in the bank tabs', fc && fc.goalTotal ? (fc.total >= fc.goalTotal ? 'good' : fc.total >= 0.9 * fc.goalTotal ? 'warn' : 'bad') : ''),
      kpi(`Collections banked · cycle ${cycleLabel(CYCLE)}`, bankAll ? randK(bankAll.collections) : '–', bankAll ? `+ ${randK(bankAll.sales)} sales cash · ${randK(bankAll.unclaimed)} unclaimed · to yesterday` : '', bankMonth && bankMonth < CYCLE ? 'bad' : ''),
      kpi(`Cancellation requests · from ${dShort(cur.start)}`, n0(a.total), prev ? `${n0(prev.agg.total)} in the previous cycle` : ''),
      kpi('Save rate', a.saveRate != null ? Math.round(a.saveRate) + '%' : '–', `${n0(a.saved)} saved of ${n0(a.decided)} decided${prev && prev.agg.saveRate != null ? ' · prev ' + Math.round(prev.agg.saveRate) + '%' : ''}`, a.saveRate != null && prev && prev.agg.saveRate != null ? (a.saveRate >= prev.agg.saveRate ? 'good' : 'bad') : ''),
      kpi('Open cases', n0(a.open + a.unprocessed), `${n0(a.open)} not finalised · ${n0(a.unprocessed)} logged, not yet worked`, a.unprocessed > 20 ? 'warn' : ''),
      kpi('Reached on first call', pct(cur.rows.filter(r => r.attempts[0] && /success/i.test(r.attempts[0])).length, cur.rows.filter(r => r.attempts.length).length), `${n0(a.contacts)} successful of ${n0(a.attempts)} attempts · ${n0(a.offers)} offers made`),
    ));

    const { card: c1, canvas: cv1 } = chartCard(goalMonth ? `Cash goal vs actual · cycle ${cycleLabel(goalMonth)}` : 'Cash goal vs actual', goalMonth ? goalNote(g, goalMonth, D) : '');
    const { card: c2, canvas: cv2 } = chartCard(`Daily collections banked by college · cycle ${cycleLabel(CYCLE)}`, 'from the bank tabs · today is incomplete until tomorrow');
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
    out.push(el('section', { class: 'grid two' }, cancelParetoCard(D, C), catCard));
    out.push(el('section', { class: 'grid two' }, colCard, c3));

    out.push(queueCard(C, cur, 'Open requests · exceptions queue'));
    out.push(testsCard(C, /sms|call|script|offer|debit|mailer|other|^$/i));

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
        fc ? { label: 'Forecast', data: fc.line, borderColor: '#4fc98a', borderDash: [2, 4], pointRadius: 0, borderWidth: 2, spanGaps: false } : null,
      ].filter(Boolean) }, options: { maintainAspectRatio: false, scales: { x: { grid: { display: false }, title: { display: true, text: 'day of month' } }, y: { ticks: { callback: v => randK(v) } } }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${rand(c.parsed.y)}` } } } } });
      else cv1.replaceWith(el('div', { class: 'empty' }, 'No goal data'));
      if (bank) {
        const days = bankDays;
        chart(cv2, { type: 'bar', data: { labels: days.map(d => dShort(d) + (d >= TODAY ? ' (partial)' : '')), datasets: Object.entries(bank).map(([c, o]) => ({ label: c, data: days.map(d => o.days.filter(x => x.date === d).reduce((u, x) => u + (x.collections || 0), 0)), backgroundColor: collegeColor(c), stack: 's' })) },
          options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: v => randK(v) } } }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${rand(c.parsed.y)}` } } } } });
      } else cv2.replaceWith(el('div', { class: 'empty' }, 'No bank data'));
      const dayKeys = Object.keys(a.byDay).filter(d => d >= cur.start && d <= cur.end).sort();
      chart(cv3, { type: 'bar', data: { labels: dayKeys.map(dShort), datasets: [{ label: 'Requests', data: dayKeys.map(d => a.byDay[d]), backgroundColor: '#f06a6a', borderRadius: 3 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } } });
    });
    const payC = paymentsCard(D, 'collections'); if (payC) out.push(payC);
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
    out.push(queueCard(C, cur, 'Your open requests · oldest first', me.name));

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


  // ---------- v2.10: marketing signals — spend changes, cost per enquiry week on week, lead-volume anomalies ----------
  function marketingSignals(D, L, A) {
    const out = { spend: [], anomalies: [], wow: [], facebook: [], asOf: null, leadsTo: null };
    if (!A || !A.daily) return out;
    const genDay = ymd(new Date(A.generated_at || Date.now()));
    const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
    const asOf = addDays(genDay, -1); out.asOf = asOf; // the day before the refresh is the last complete spend day
    const sumPPC = (col, from, to) => { let s = 0; for (const [d, v] of Object.entries(A.daily[col] || {})) if (d >= from && d <= to) s += (v.PPC || {}).cost || 0; return s; };
    const ldaily = L && L.daily ? L.daily : {}; const leadsTo = L && L.window ? L.window.to : asOf; out.leadsTo = leadsTo;
    const sumLeads = (col, ch, from, to, key = 'leads') => { let s = 0; for (const [d, v] of Object.entries(ldaily)) if (d >= from && d <= to) s += (((v[col] || {})[ch]) || {})[key] || 0; return s; };
    for (const col of Object.keys(A.daily)) {
      // 1. spend change: last 7 complete days vs the 7 before
      const cur = sumPPC(col, addDays(asOf, -6), asOf), prev = sumPPC(col, addDays(asOf, -13), addDays(asOf, -7));
      const chg = prev ? 100 * (cur - prev) / prev : null;
      out.spend.push({ college: col, channel: 'PPC', cur, prev, chg, flag: prev > 1000 && chg != null && Math.abs(chg) > 25 });
      // zero-spend day: one of the last 3 calendar days under 5% of the same weekday's mean over the previous 4 weeks.
      // Days absent from the file count as zero (Google reports nothing for a day with no spend, e.g. the 27-29 Oct 2026 suspension);
      // comparing with the same weekday keeps scheduled quiet days (Saturdays) from alarming.
      const costOn = d => (((A.daily[col] || {})[d] || {}).PPC || {}).cost || 0;
      for (let i = 2; i >= 0; i--) {
        const d = addDays(asOf, -i); const mean = [7, 14, 21, 28].reduce((s, k) => s + costOn(addDays(d, -k)), 0) / 4; const c = costOn(d);
        if (mean > 500 && c < 0.05 * mean) out.spend.push({ college: col, channel: 'PPC', zeroDay: d, mean });
      }
      // 2. week on week: spend, new enquiries and registrations on the PPC channel (CRM) for the same two weeks
      const to = leadsTo < asOf ? leadsTo : asOf;
      const w = (from, until) => ({ spend: sumPPC(col, from, until), leads: sumLeads(col, 'PPC', from, until), reg: sumLeads(col, 'PPC', from, until, 'registered') });
      const tw = w(addDays(to, -6), to), lw = w(addDays(to, -13), addDays(to, -7));
      out.wow.push({ college: col, to, tw, lw, cpe: tw.leads ? tw.spend / tw.leads : null, cpeL: lw.leads ? lw.spend / lw.leads : null, cpr: tw.reg ? tw.spend / tw.reg : null, cprL: lw.reg ? lw.spend / lw.reg : null });
    }
    // Facebook: month-to-date daily pace vs the previous month's daily average (monthly totals only)
    const months = Object.keys(A.monthly || {}).sort(); const m = months[months.length - 1], pm = months[months.length - 2];
    if (m && pm) {
      const dim = mm => new Date(+mm.slice(0, 4), +mm.slice(5, 7), 0).getDate();
      const elapsed = Math.min(dim(m), Math.max(1, +asOf.slice(8, 10)));
      for (const col of Object.keys(A.monthly[m] || {})) {
        const c = ((A.monthly[m][col] || {}).Facebook || {}).cost, p = ((A.monthly[pm][col] || {}).Facebook || {}).cost;
        if (c == null || p == null || elapsed < 5) continue;
        const pace = c / elapsed, ppace = p / dim(pm); const chg = ppace ? 100 * (pace - ppace) / ppace : null;
        out.facebook.push({ college: col, pace, ppace, chg, flag: ppace > 300 && chg != null && Math.abs(chg) > 25 });
      }
    }
    // 3. lead-volume anomalies: each of the last 3 complete days vs the mean of the same weekday over the previous 4 weeks
    const dd = L && L.demand ? L.demand.daily : null;
    if (dd) {
      const ds = Object.keys(dd).sort().filter(d => d <= leadsTo);
      for (const d of ds.slice(-3)) {
        for (const col of Object.keys(dd[d])) {
          const n = dd[d][col].enquiries; const hist = [1, 2, 3, 4].map(k => addDays(d, -7 * k)).filter(h => dd[h] && dd[h][col]).map(h => dd[h][col].enquiries);
          if (hist.length < 3) continue; const mean = hist.reduce((s, v) => s + v, 0) / hist.length;
          if (mean < 30) continue; const ratio = n / mean;
          if (ratio < 0.6 || ratio > 1.6) {
            const sp = sumPPC(col, d, d), spHist = [1, 2, 3, 4].map(k => sumPPC(col, addDays(d, -7 * k), addDays(d, -7 * k))); const spMean = spHist.reduce((s, v) => s + v, 0) / (spHist.length || 1);
            const spRatio = spMean ? sp / spMean : null;
            const cause = d > asOf ? 'spend not yet reported for this day' : spRatio == null ? 'no Google Ads spend on this weekday either way' : (ratio < 1 && spRatio < 0.75) || (ratio > 1 && spRatio > 1.4) ? 'spend moved with it: marketing' : 'spend did not move: check routing and forms';
            out.anomalies.push({ date: d, college: col, n, mean, ratio, spRatio, cause });
          }
        }
      }
    }
    return out;
  }
  function signalsCards(D, L, A) {
    const sg = marketingSignals(D, L, A); const cards = [];
    if (!sg.asOf) return cards;
    const arrow = v => v == null ? '–' : (v > 0 ? '+' : '') + Math.round(v) + '%';
    const wcols = [{ key: 'college', label: 'College', render: v => el('span', {}, el('span', { class: 'dot ' + collegeClass(v) }), ' ', v) },
      { key: 'spend', label: 'Spend', num: true, render: (v, r) => el('span', {}, randK(r.tw.spend), ' ', el('span', { class: 'xs muted' }, arrow(pctN(r.tw.spend - r.lw.spend, r.lw.spend)))) },
      { key: 'leads', label: 'New enquiries', num: true, render: (v, r) => el('span', {}, n0(r.tw.leads), ' ', el('span', { class: 'xs muted' }, arrow(pctN(r.tw.leads - r.lw.leads, r.lw.leads)))) },
      { key: 'cpe', label: 'R / enquiry', num: true, render: (v, r) => el('span', { class: r.cpe != null && r.cpeL != null && r.cpe > 1.25 * r.cpeL ? 'bad' : r.cpe != null && r.cpeL != null && r.cpe < 0.8 * r.cpeL ? 'good' : '' }, rand(r.cpe), ' ', el('span', { class: 'xs muted' }, 'was ' + rand(r.cpeL))) },
      { key: 'reg', label: 'Registered so far', num: true, render: (v, r) => el('span', {}, n0(r.tw.reg), ' ', el('span', { class: 'xs muted' }, 'last wk ' + n0(r.lw.reg))) },
      { key: 'cpr', label: 'R / registration so far', num: true, render: (v, r) => el('span', { class: 'muted' }, rand(r.cpr), ' ', el('span', { class: 'xs muted' }, 'last wk ' + rand(r.cprL))) }];
    const wrows = sg.wow.map(r => ({ ...r, spend: r.tw.spend, leads: r.tw.leads, reg: r.tw.reg }));
    const to = sg.wow.length ? sg.wow[0].to : sg.asOf;
    cards.push(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Google Ads · this week vs last'), el('span', { class: 'xs muted' }, `7 days to ${dShort(to)} vs the 7 before`)),
      el('div', { class: 'table-wrap dense' }, sortableTable(wcols, wrows, 'spend')),
      el('p', { class: 'note' }, 'Spend from the Google Ads API per college account; enquiries and registrations are CRM new contacts on the PPC channel in the same days. Red when the cost per enquiry is up more than 25% on the previous week; green when down more than 20%. Registrations are shown as they stand: a lead takes two to three weeks to register, so this week will always look thinner than last, and cost per registration is not judged week on week. Facebook spend is only available monthly and is judged on its month-to-date pace in the Attention list.')));
    const items = [];
    for (const s of sg.spend) if (s.zeroDay) items.push(['bad', `${s.college}: no Google Ads spend on ${dDow(s.zeroDay)} ${dShort(s.zeroDay)} (normally ${randK(s.mean)} a day): paused campaign, budget cap or billing failure`]);
    for (const s of sg.spend) if (s.flag) items.push([Math.abs(s.chg) > 50 ? 'bad' : 'warn', `${s.college} Google Ads spend ${randK(s.cur)} in the 7 days to ${dShort(sg.asOf)}, ${s.chg > 0 ? 'up' : 'down'} ${Math.round(Math.abs(s.chg))}% on the 7 before (${randK(s.prev)})`]);
    for (const f of sg.facebook) if (f.flag) items.push([Math.abs(f.chg) > 50 ? 'bad' : 'warn', `${f.college} Facebook spend pace ${randK(f.pace)} a day this month vs ${randK(f.ppace)} last month (${arrow(f.chg)})`]);
    for (const x of sg.anomalies) items.push([x.ratio < 0.6 ? 'bad' : 'warn', `${x.college}: ${n0(x.n)} enquiries on ${dDow(x.date)} ${dShort(x.date)} vs ${n0(Math.round(x.mean))} normal for that weekday (${x.ratio < 1 ? '−' : '+'}${Math.round(Math.abs(100 - 100 * x.ratio))}%); ${x.cause}`]);
    cards.push(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Spend and volume signals'), el('span', { class: 'xs muted' }, `spend to ${dShort(sg.asOf)} · enquiries to ${dShort(sg.leadsTo || sg.asOf)}`)),
      items.length ? el('ul', { class: 'list' }, items.map(([sev, t]) => el('li', {}, el('span', {}, pill('Marketing', sev), ' ', t)))) : el('div', { class: 'empty' }, 'Spend steady week on week; no day outside the normal range for its weekday'),
      el('p', { class: 'note' }, 'A spend change is flagged above 25% week on week. A day is unusual when its enquiries are below 60% or above 160% of the same weekday over the previous four weeks; if Google Ads spend moved the same way it is marketing, otherwise it is a routing or form fault to check first.')));
    return cards;
  }
  // ---------- v2.3: lead funnel (data/leads.json, aggregates only, from the CRM) ----------
  const hrs = m => m == null ? '–' : m < 90 ? `${Math.round(m)} min` : m < 2880 ? `${n1(m / 60)} h` : `${n1(m / 1440)} days`;
  function channelRows(L, month) {
    const rows = [];
    for (const [col, chs] of Object.entries(L.monthly[month] || {})) for (const [ch, v] of Object.entries(chs)) if (v.registered) rows.push({ name: `${col.split(' ')[0]} ${ch}`, count: v.registered, cash: v.inst_sum * HORIZON, leads: v.leads });
    return rows;
  }
  function monthTotals(L, month) {
    const t = { leads: 0, allocated: 0, registered: 0, do: 0, inst_sum: 0, inst_n: 0 };
    for (const chs of Object.values(L.monthly[month] || {})) for (const v of Object.values(chs)) for (const k of Object.keys(t)) t[k] += v[k] || 0;
    return t;
  }
  function funnelStripCard(D, L) {
    const t = monthTotals(L, D.month); const link = L.sale_link[D.month] || {}; const age = L.lead_age_at_sale[D.month] || {};
    const salesLinked = Object.values(link).reduce((a, b) => a + b, 0); const old = (age['31–90 days'] || 0) + (age['over 90 days'] || 0);
    const steps = [['Leads', t.leads], ['Allocated', t.allocated], ['Registered', t.registered], ['Debit order', t.do]];
    const max = t.leads || 1;
    return el('div', { class: 'card funnel' }, el('div', { class: 'card-head' }, el('h2', {}, 'Lead funnel · ' + monthLabel(D.month)), el('span', { class: 'xs muted' }, `leads created this month in the CRM · window ${dShort(L.window.from)} – ${dShort(L.window.to)}`)),
      el('div', { class: 'funnel-steps' }, steps.map(([lab, v], i) => el('div', { class: 'funnel-step' }, el('div', { class: 'label' }, lab), el('div', { class: 'value num' }, n0(v)), el('div', { class: 'xs muted' }, i === 0 ? '' : `${pct(v, steps[i - 1][1], 1)} of ${steps[i - 1][0].toLowerCase()}`), progress(v, max, i === steps.length - 1 ? 'good' : '')))),
      el('p', { class: 'note' }, `Sales this month: ${n0(salesLinked)} · ${pct(old, salesLinked)} came from leads older than 30 days and ${pct(link.no_lead_found || 0, salesLinked)} had no enquiry in the CRM at all (walk-ins, referrals, re-enrolments). Lead-to-registration ${pct(t.registered, t.leads, 1)}.`));
  }
  function speedCard(L, mode) {
    const src = mode === 'registrar' ? L.speed.by_registrar : L.speed.by_college;
    const rows = Object.entries(src || {}).map(([k, v]) => ({ name: mode === 'registrar' ? k[0].toUpperCase() + k.slice(1) : k, ...v })).filter(r => r.n >= 10);
    const cols = [{ key: 'name', label: mode === 'registrar' ? 'Registrar' : 'College' }, { key: 'n', label: 'Leads', num: true }, { key: 'median_min', label: 'Median wait', num: true, fmt: hrs }, { key: 'p75_min', label: '75% within', num: true, fmt: hrs }, { key: 'within_24h_pct', label: 'Within 24 h', num: true, fmt: v => v == null ? '–' : v + '%' }];
    if (mode !== 'registrar') cols.push({ key: 'never_allocated_pct', label: 'No registrar', num: true, fmt: v => v == null ? '–' : v + '%' });
    return el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Speed to lead'), el('span', { class: 'xs muted' }, 'enquiry created → registrar assigned in the CRM · last ' + L.window.days + ' days')),
      rows.length ? sortableTable(cols, rows, 'median_min', { rank: mode === 'registrar' }) : el('div', { class: 'empty' }, 'no data'),
      el('p', { class: 'note' }, mode === 'registrar' ? 'Wait is measured on the leads each registrar received; it reflects the allocation process, not the registrar. A median in days means that registrar mostly receives old leads re-allocated in bulk. Registrars with fewer than 10 allocated leads are hidden.' : 'No registrar = leads older than 3 days still unallocated. Wait uses the last change of the registrar field, so bulk re-allocations of old leads inflate it. Benchmark: contact within 5 minutes converts far better than within a day.'));
  }
  function leadsPerSaleCard(L) {
    const rows = Object.entries(L.registrars || {}).map(([k, v]) => ({ name: k[0].toUpperCase() + k.slice(1), ...v })).filter(r => r.leads >= 30 && r.conv_pct != null && r.conv_pct < 60);
    return el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Allocated leads per sale'), el('span', { class: 'xs muted' }, 'CRM leads allocated in the window vs those that registered')),
      rows.length ? sortableTable([{ key: 'name', label: 'Registrar' }, { key: 'leads', label: 'Leads', num: true }, { key: 'registered', label: 'Registered', num: true }, { key: 'conv_pct', label: 'Conversion', num: true, fmt: v => v == null ? '–' : v + '%' }, { key: 'leads_per_sale', label: 'Per sale', num: true, fmt: v => v == null ? '–' : n1(v) }], rows, 'conv_pct', { rank: true }) : el('div', { class: 'empty' }, 'no data'),
      el('p', { class: 'note' }, 'Low conversion with many leads = dead-lead effort; check lead quality for that registrar before coaching. Registrars whose CRM field is only set at enrolment are hidden (fewer than 30 leads or conversion above 60%).'));
  }
  function viewMarketing(D, C) {
    const L = S.leads; const out = [];
    if (!L) { out.push(el('div', { class: 'empty' }, 'No lead data yet. The CRM funnel refresh has not published data/leads.json.')); return out; }
    const t = monthTotals(L, D.month); const sp = L.speed.by_college || {};
    const allLeads = Object.values(sp).reduce((a, v) => a + v.n, 0); const w24 = Object.values(sp).reduce((a, v) => a + (v.within_24h_pct || 0) * v.n, 0);
    const pools = { d7_30: 0, d30_plus: 0 }; for (const chs of Object.values(L.pools)) for (const v of Object.values(chs)) { pools.d7_30 += v.d7_30; pools.d30_plus += v.d30_plus; }
    out.push(el('section', { class: 'grid kpis' },
      kpi((S.leads.demand ? 'New leads · ' : 'Leads · ') + MONTHS_LONG[+D.month.slice(5, 7) - 1], n0(t.leads), `${pct(t.allocated, t.leads)} allocated to a registrar`),
      kpi('Lead → registration', pct(t.registered, t.leads, 1), `${n0(t.registered)} registered · ${pct(t.do, t.registered)} with debit order`, t.registered / (t.leads || 1) >= 0.04 ? 'good' : 'warn'),
      kpi('Allocated within 24 h', allLeads ? Math.round(w24 / allLeads) + '%' : '–', 'enquiry → registrar in the CRM', allLeads && w24 / allLeads < 60 ? 'bad' : ''),
      kpi('Unconverted leads', n0(pools.d7_30 + pools.d30_plus), `${n0(pools.d7_30)} aged 7–30 days · ${n0(pools.d30_plus)} older`),
    ));
    const sigs = signalsCards(D, L, S.ads); for (const c of sigs) out.push(c);
    // true demand: every submission (new contact or repeat enquiry), from the GF-list automation entries
    const DM = L.demand || null; const DMm = DM ? (DM.monthly[D.month] || {}) : {};
    if (DM) {
      const drows = Object.entries(DMm).map(([col, chs]) => { const v = { college: col, enquiries: 0, new: 0, repeat: 0, repeat_contacts: 0, new_registered: 0, repeat_registered: 0 }; for (const c of Object.values(chs)) for (const k of Object.keys(v)) if (k !== 'college') v[k] += c[k] || 0; return { ...v, repeatPct: pctN(v.repeat, v.enquiries), newConv: pctN(v.new_registered, v.new), repConv: pctN(v.repeat_registered, v.repeat_contacts) }; });
      const tot = drows.reduce((a, r) => ({ enquiries: a.enquiries + r.enquiries, new: a.new + r.new, repeat: a.repeat + r.repeat }), { enquiries: 0, new: 0, repeat: 0 });
      const dcols = [{ key: 'college', label: 'College' }, { key: 'enquiries', label: 'Enquiries', num: true }, { key: 'new', label: 'New contacts', num: true }, { key: 'repeat', label: 'Repeat enquiries', num: true }, { key: 'repeatPct', label: 'Repeat share', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' }, { key: 'newConv', label: 'New → registered', num: true, fmt: v => v == null ? '–' : n1(v) + '%' }, { key: 'repConv', label: 'Repeat → registered', num: true, fmt: v => v == null ? '–' : n1(v) + '%' }];
      const dcard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'True demand · ' + monthLabel(D.month)), el('span', { class: 'xs muted' }, 'every form submission, including people already in the CRM')),
        drows.length ? sortableTable(dcols, drows, 'enquiries') : el('div', { class: 'empty' }, 'no data'),
        el('p', { class: 'note' }, `${n0(tot.enquiries)} enquiries this month = ${n0(tot.new)} new contacts + ${n0(tot.repeat)} repeat enquiries (${pct(tot.repeat, tot.enquiries)}). The lead counts elsewhere on this board are new contacts only, so they understate demand by that share. ` + (DM.sales && DM.sales.total ? `${pct(DM.sales.from_repeat_enquirers, DM.sales.total)} of the last ${L.window.days} days' sales came from people who enquired again, so repeat enquiries must reach a registrar as fast as first ones. ` : '') + 'Repeat → registered counts each returning person once per month.'));
      const { card: dchart, canvas: dcv } = chartCard('Enquiries per day · new vs repeat', `all colleges · last ${L.window.days} days`, 'short');
      const ddays = Object.keys(DM.daily).sort();
      const dnew = ddays.map(d => Object.values(DM.daily[d]).reduce((a, v) => a + v.new, 0)); const drep = ddays.map(d => Object.values(DM.daily[d]).reduce((a, v) => a + v.repeat, 0));
      chart(dcv, { type: 'bar', data: { labels: ddays.map(dShort), datasets: [{ label: 'New contacts', data: dnew, backgroundColor: 'rgba(99,142,255,.75)' }, { label: 'Repeat enquiries', data: drep, backgroundColor: 'rgba(255,170,60,.8)' }] }, options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { stacked: true, beginAtZero: true } }, plugins: { legend: { position: 'bottom' } } } });
      const gaps = DM.repeat_gap || {}; const gtot = Object.values(gaps).reduce((a, b) => a + b, 0);
      if (gtot) dchart.append(el('p', { class: 'note' }, 'Time since the returning person first entered the CRM: ' + ['same week', '8–30 days', '1–3 months', '3–12 months', 'over a year'].filter(k => gaps[k]).map(k => `${k} ${pct(gaps[k], gtot)}`).join(' · ') + '. Same-week repeats are mostly people who were not phoned the first time.'));
      out.push(dcard); out.push(dchart);
    }
    // funnel per college × channel
    const funnelRows = (month) => { const rows = [];
    const ADS = S.ads && S.ads.monthly ? S.ads.monthly[month] || {} : null;
    const DMm2 = DM ? (DM.monthly || {})[month] || {} : {};
    for (const [col, chs] of Object.entries(L.monthly[month] || {})) for (const [ch, v] of Object.entries(chs)) if (v.leads >= 20) {
      const a = ADS && ADS[col] && ADS[col][ch]; const spend = a ? a.cost : null; const enq = DM ? ((DMm2[col] || {})[ch] || {}).enquiries || null : null;
      const cash = v.inst_sum * HORIZON; const perReg = v.registered ? cash / v.registered : null;
      rows.push({ college: col, channel: ch, enquiries: enq, leads: v.leads, allocPct: pctN(v.allocated, v.leads), registered: v.registered, conv: pctN(v.registered, v.leads), doPct: pctN(v.do, v.registered), inst: v.inst_n ? v.inst_sum / v.inst_n : null, cash,
        spend, cpl: spend != null && (enq || v.leads) ? spend / (enq || v.leads) : null, cpr: spend != null && v.registered ? spend / v.registered : null, perReg, roi: spend ? cash / spend : null });
    }
    return rows; };
    let fMonth = D.month, rows = funnelRows(D.month);
    if (!rows.some(r => r.registered >= 5) && D.prevMonth && L.monthly[D.prevMonth]) { fMonth = D.prevMonth; rows = funnelRows(D.prevMonth); }
    const hasSpend = rows.some(r => r.spend != null);
    const fcols = [{ key: 'college', label: 'College' }, { key: 'channel', label: 'Channel' }];
    if (DM) fcols.push({ key: 'enquiries', label: 'Enquiries', num: true, fmt: v => v == null ? '–' : n0(v) });
    fcols.push({ key: 'leads', label: DM ? 'New leads' : 'Leads', num: true }, { key: 'allocPct', label: 'Alloc.', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' }, { key: 'registered', label: 'Reg.', num: true }, { key: 'conv', label: 'Conv.', num: true, fmt: v => v == null ? '–' : n1(v) + '%' }, { key: 'doPct', label: 'D/O', num: true, fmt: v => v == null ? '–' : Math.round(v) + '%' }, { key: 'inst', label: 'Avg inst.', num: true, fmt: rand }, { key: 'cash', label: '12-mo value', num: true, fmt: randK });
    if (hasSpend) fcols.push({ key: 'spend', label: 'Ad spend', num: true, fmt: v => v == null ? '–' : randK(v) }, { key: 'cpl', label: 'per enquiry', num: true, fmt: v => v == null ? '–' : rand(v) },
      { key: 'cpr', label: 'per reg.', num: true, render: (v, r) => v == null ? '–' : el('span', { class: r.perReg && v > r.perReg ? 'bad' : r.perReg && v > 0.5 * r.perReg ? 'warn' : 'good' }, rand(v)) },
      { key: 'roi', label: 'Value÷spend', num: true, fmt: v => v == null ? '–' : n1(v) + '×' });
    const adsNote = S.ads && S.ads.accounts ? ' Ad spend: PPC = Google Ads account spend for the month; Facebook = Meta account spend per college (Skills Academy from the Skills_Academy_Backup account). Cost per registration is red when it exceeds the 12-month value of a registration on that channel, amber above half of it. Spend from channels with no CRM leads is not shown.' : ' Spend is not in this table yet.';
    out.push(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Funnel by college and channel'), el('span', { class: 'xs muted' }, monthLabel(fMonth) + (fMonth !== D.month ? ' (last full month; too few registrations yet in ' + monthLabel(D.month) + ')' : '') + (DM ? ' · enquiries incl. repeats; funnel on new leads' : ' · leads created this month'))), el('div', { class: 'table-wrap dense' }, sortableTable(fcols, rows, 'leads')),
      el('p', { class: 'note' }, (DM ? 'Enquiries = all submissions on the channel this month (repeats carry the channel of their latest enquiry). Allocation and conversion are measured on new leads. ' : '') + adsNote)));
    // landing pages + lead age at sale
    const colConv = {}; for (const [col, chs] of Object.entries(L.monthly[D.month] || {})) { let l = 0, r = 0; for (const v of Object.values(chs)) { l += v.leads; r += v.registered; } colConv[col] = l ? r / l : 0; }
    const prow = L.pages.filter(p => p.leads >= 50).slice(0, 25).map(p => ({ ...p, conv: pctN(p.registered, p.leads), vs: colConv[p.college] ? 100 * p.registered / p.leads / (100 * colConv[p.college]) : null }));
    const pcols = [{ key: 'path', label: 'Landing page' }, { key: 'college', label: 'College', fmt: v => v.split(' ')[0] }, { key: 'leads', label: 'Leads', num: true }, { key: 'registered', label: 'Registered', num: true }, { key: 'conv', label: 'Conversion', num: true, fmt: v => v == null ? '–' : n1(v) + '%' }, { key: 'vs', label: 'vs college', num: true, fmt: v => v == null ? '–' : (v >= 1.2 ? '▲ ' : v < 0.7 ? '▼ ' : '') + n1(v) + '×' }];
    const ageOrder = ['same day', '1–7 days', '8–30 days', '31–90 days', 'over 90 days', 'no lead found'];
    const age = L.lead_age_at_sale[D.month] || {}; const ageTot = ageOrder.reduce((a, k) => a + (age[k] || 0), 0);
    const { card: ageCard, canvas: ageCv } = chartCard('Lead age at sale', `${monthLabel(D.month)} · how old was the enquiry when the student registered`, 'short');
    ageCard.append(el('p', { class: 'note' }, `${pct((age['31–90 days'] || 0) + (age['over 90 days'] || 0), ageTot)} of this month's sales came from leads older than 30 days: the re-engagement pool is worth working. "No lead found" = the sale's CRM contact has no enquiry record in the ${L.window.days}-day window (walk-ins, referrals, re-enrolments, or leads older than the window).`));
    out.push(el('section', { class: 'grid two' }, speedCard(L, 'college'), ageCard));
    out.push(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Landing pages'), el('span', { class: 'xs muted' }, `top 25 pages by leads · last ${L.window.days} days`)), sortableTable(pcols, prow, 'leads'),
      el('p', { class: 'note' }, 'vs college = page conversion ÷ the college average. WhatsApp pages usually win; paid-landing pages with ▼ need a form or offer test (log it in the Tests register).')));
    // v2.8: paid landing pages — ad spend per page joined to CRM leads and registrations
    if (S.ads && S.ads.pages && S.ads.pages.rows) {
      const PG = S.ads.pages; const rows = PG.rows.filter(r => r.leads >= 20 && r.spend >= 1000);
      const colMed = {}; for (const c of new Set(rows.map(r => r.college))) { const xs = rows.filter(r => r.college === c && r.r_reg).map(r => r.r_reg).sort((a, b) => a - b); colMed[c] = xs.length ? xs[Math.floor(xs.length / 2)] : null; }
      const cols = [{ key: 'page', label: 'Landing page', render: v => el('span', { title: v }, v.replace(/^(skillsacademy|matric|bellview)\/(offers\/)?/, '')) }, { key: 'college', label: 'College', fmt: v => v.split(' ')[0] }, { key: 'camp', label: 'Campaign', render: v => el('span', { class: 'xs muted', title: v }, (v || '').slice(0, 26)) },
        { key: 'spend', label: 'Spend', num: true, fmt: randK }, { key: 'leads', label: 'Leads', num: true }, { key: 'reg', label: 'Reg.', num: true },
        { key: 'r_reg', label: 'R per reg.', num: true, render: (v, r) => { const m = colMed[r.college]; return el('span', { class: v == null ? 'bad' : m && v > 2 * m ? 'bad' : m && v > 1.3 * m ? 'warn' : m && v < 0.8 * m ? 'good' : '' }, v == null ? 'none' : rand(v)); } },
        { key: 'nofunds', label: 'No funds', num: true, render: v => el('span', { class: v >= 60 ? 'bad' : v >= 50 ? 'warn' : '' }, v + '%') }, { key: 'school', label: 'At school', num: true, render: v => el('span', { class: v >= 30 ? 'bad' : v >= 15 ? 'warn' : '' }, v + '%') },
        { key: 'funds_conv', label: 'Funded conv.', num: true, fmt: v => v == null ? '–' : n1(v) + '%' }];
      const rr = rows.map(r => ({ ...r, r_reg: r.r_reg == null ? null : r.r_reg }));
      out.push(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Paid landing pages · what a registration costs'), el('span', { class: 'xs muted' }, `${dShort(PG.window.from)} – ${dShort(PG.window.to)} · pages with 20+ leads and R1,000+ spend · sorted by spend`)),
        el('div', { class: 'table-wrap dense' }, sortableTable(cols, rr, 'spend')),
        el('p', { class: 'note' }, 'Spend is Google Ads spend on ads whose final URL is this page (Performance Max: campaign spend). Leads and registrations are CRM enquiries carrying the page as Source Page. R per reg. is red at twice the college median, "none" when the page produced no registration. No funds = share of enquirers answering "I have no funds"; At school = share answering "Still at High School". Funded conv. = conversion of enquirers who do have funds, so a low figure here is the page or traffic, not the audience’s wallet. Snapshot refreshed with ads.json.')));
    }
    // traffic-source quality (referrer groups; flags display-placement leads that never register)
    const SRC = L.sources || null;
    if (SRC) {
      const GL = { none: 'No referrer (lead forms)', search: 'Google / Bing', 'google-app': 'Google app · Discover · Gmail', social: 'Social', own: 'Our own sites', 'third-party': 'Third-party sites (placements)' };
      const grows = Object.entries(SRC.by_group).map(([g, v]) => ({ group: GL[g] || g, leads: v.leads, registered: v.registered, conv: v.conv_pct }));
      const gcols = [{ key: 'group', label: 'Where the visitor came from' }, { key: 'leads', label: 'Leads', num: true }, { key: 'registered', label: 'Registered', num: true }, { key: 'conv', label: 'Conversion', num: true, fmt: v => v == null ? '–' : n1(v) + '%' }];
      const srows = SRC.pages.filter(p => p.third_party_leads >= 30).map(p => ({ path: p.path, college: p.college, tp: p.third_party_leads, tpr: p.third_party_registered, tpc: p.third_party_conv, rest: p.rest_conv, flag: p.flag ? '▼ exclude' : '' }));
      const scols = [{ key: 'path', label: 'Landing page' }, { key: 'college', label: 'College', fmt: v => v.split(' ')[0] }, { key: 'tp', label: 'Via 3rd-party', num: true }, { key: 'tpr', label: 'Registered', num: true }, { key: 'tpc', label: 'Their conv.', num: true, fmt: v => v == null ? '–' : n1(v) + '%' }, { key: 'rest', label: 'Rest of page', num: true, fmt: v => v == null ? '–' : n1(v) + '%' }, { key: 'flag', label: 'Flag' }];
      const drows = (SRC.third_party_domains || []).slice(0, 15).map(d => ({ domain: d.domain, leads: d.leads, registered: d.registered, colleges: Object.entries(d.colleges).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · ') }));
      const dcols = [{ key: 'domain', label: 'Referring site' }, { key: 'leads', label: 'Leads', num: true }, { key: 'registered', label: 'Registered', num: true }, { key: 'colleges', label: 'Colleges' }];
      const flagNote = SRC.flags.length ? `${SRC.flags.length} page${SRC.flags.length > 1 ? 's' : ''} flagged: placement leads convert at under half the page's other traffic` : 'No page flagged: placement leads convert in line with other traffic.';
      out.push(el('section', { class: 'grid two' },
        el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Lead quality by traffic source'), el('span', { class: 'xs muted' }, `CRM first referrer · last ${L.window.days} days`)), sortableTable(gcols, grows, 'leads'),
          el('p', { class: 'note' }, 'Third-party sites are display and Performance Max placements. Expect them to convert lower; the flag below fires only when they convert at less than half of the same page\'s other traffic.')),
        el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Top third-party referring sites'), el('span', { class: 'xs muted' }, 'sites that sent 10+ leads')), sortableTable(dcols, drows, 'leads'),
          el('p', { class: 'note' }, 'Job-listing and content-farm names here usually mean people who thought they were applying for a job. Exclude them in Google Ads (placement exclusions) and check the next refresh.'))));
      out.push(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Placement leads per landing page'), el('span', { class: 'xs muted', style: SRC.flags.length ? 'color:var(--bad)' : '' }, flagNote)), sortableTable(scols, srows, 'tp')));
    }
    // pools + attribution
    const poolRows = []; for (const [col, chs] of Object.entries(L.pools)) for (const [ch, v] of Object.entries(chs)) if (v.d7_30 + v.d30_plus >= 20) poolRows.push({ college: col, channel: ch, d7_30: v.d7_30, d30_plus: v.d30_plus, total: v.d7_30 + v.d30_plus });
    const attrib = Object.entries(L.attribution || {}).map(([ref, chs]) => ({ ref: ref.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), ...chs, total: Object.values(chs).reduce((a, b) => a + b, 0) }));
    const chKeys = [...new Set(attrib.flatMap(a => Object.keys(a).filter(k => !['ref', 'total'].includes(k))))].slice(0, 4);
    out.push(el('section', { class: 'grid two' },
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'Re-engagement pools'), el('span', { class: 'xs muted' }, 'leads in the window that have not registered')), sortableTable([{ key: 'college', label: 'College', fmt: v => v.split(' ')[0] }, { key: 'channel', label: 'Channel' }, { key: 'd7_30', label: '7–30 days', num: true }, { key: 'd30_plus', label: '30+ days', num: true }, { key: 'total', label: 'Total', num: true }], poolRows, 'total'),
        el('p', { class: 'note' }, 'Counts only; names stay in the CRM. A re-engagement campaign for the 30+ pool is a Tests-register candidate: expose half, hold half.')),
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, 'First touch vs lead source'), el('span', { class: 'xs muted' }, 'CRM "First Referrer" × source field · multi-touch view')), sortableTable([{ key: 'ref', label: 'First referrer' }, ...chKeys.map(k => ({ key: k, label: k, num: true, fmt: v => v == null ? '' : n0(v) })), { key: 'total', label: 'Total', num: true }], attrib, 'total'),
        el('p', { class: 'note' }, 'Rows where the first referrer is Google but the source is Facebook (or the reverse) show channels assisting each other; judge channels on the pair, not on last click alone.'))));
    requestAnimationFrame(() => {
      chart(ageCv, { type: 'bar', data: { labels: ageOrder, datasets: [{ label: 'Sales', data: ageOrder.map(k => age[k] || 0), backgroundColor: ageOrder.map(k => k === 'no lead found' ? '#3a4552' : /31|over/.test(k) ? '#f5b942' : '#4da3ff'), borderRadius: 4 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } } });
    });
    out.push(el('p', { class: 'note' }, `Lead data refreshed ${timeAgo(L.generated_at)} from the CRM (aggregates only; no names, numbers or IDs are published). Lead month = date the enquiry was created; registrations are matched by CRM ID, with phone as a fallback.`));
    return out;
  }

  // ---------- shell ----------
  const VIEWS = { leadership: viewLeadership, 'sales-manager': viewSalesManager, 'sales-agent': viewSalesAgent, 'collections-manager': viewCollectionsManager, 'collections-agent': viewCollectionsAgent, marketing: viewMarketing };

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
    const [salesRes, collRes, leadsRes, adsRes, payRes] = await Promise.all([fetch('data/sales.json' + bust), fetch('data/collections.json' + bust).catch(() => null), fetch('data/leads.json' + bust).catch(() => null), fetch('data/ads.json' + bust).catch(() => null), fetch('data/payments.json' + bust).catch(() => null)]);
    if (!salesRes.ok) throw new Error('sales.json ' + salesRes.status);
    const sales = await salesRes.json();
    const coll = collRes && collRes.ok ? await collRes.json() : null;
    S.leads = leadsRes && leadsRes.ok ? await leadsRes.json() : null;
    S.ads = adsRes && adsRes.ok ? await adsRes.json() : null;
    S.pay = payRes && payRes.ok ? await payRes.json() : null;
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
