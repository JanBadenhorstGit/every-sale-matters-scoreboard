/**
 * Lead Dealer engine: pure rules, no Google calls.
 * Shared by the Apps Script (Dealer.gs) and the local back-test (backtest.js).
 */

var ENGINE_VERSION = '1.0';

function normLang(s) {
  var x = String(s || '').trim().toLowerCase();
  if (x === '') return 'BLANK';
  if (x === 'afrikaans' || x === 'engels') return 'AF';
  if (x === 'english') return 'EN';
  return 'AFRICAN';
}

function courseGroup(s) {
  var x = String(s || '').toLowerCase();
  if (x.trim() === '') return 'BLANK';
  if (x.indexOf('icb') >= 0 || x.indexOf('bookkeep') >= 0 || (x.indexOf('account') >= 0 && x.indexOf('nqf') < 0)) return 'ICB';
  if (/matric|matriek|senior cert/.test(x)) return 'MATRIC';
  return 'OTHER';
}

function _m(pattern, value) {
  var p = String(pattern || '*').trim().toUpperCase();
  if (p === '*' || p === '') return true;
  var opts = p.split('|');
  return opts.indexOf(String(value).toUpperCase()) >= 0;
}

/** Parse "OTHER:83, AF:17" or "Henry" into [{team, share}]. */
function parseShares(s) {
  return String(s).split(',').map(function (p) {
    var a = p.split(':');
    return { team: a[0].trim(), share: a.length > 1 ? Number(a[1]) : 100 };
  }).filter(function (x) { return x.team; });
}

/**
 * Find the first route that matches the lead.
 * route row: {college, kind, lang, course, source, teams, label}
 */
function findRoute(lead, routes) {
  for (var i = 0; i < routes.length; i++) {
    var r = routes[i];
    if (_m(r.college, lead.college) && _m(r.kind, lead.kind) && _m(r.lang, lead.lang) &&
        _m(r.course, lead.course) && _m(r.source, lead.source)) return r;
  }
  return null;
}

/** Choose a team within a route by share deficit (deterministic). */
function chooseTeam(route, state) {
  var shares = parseShares(route.teams);
  if (shares.length === 1) return shares[0].team;
  var key = route.label;
  var rc = state.routeCounts[key] || (state.routeCounts[key] = {});
  var total = 0, sum = 0;
  shares.forEach(function (s) { total += rc[s.team] || 0; sum += s.share; });
  var best = null, bestGap = -1e9;
  shares.forEach(function (s) {
    var gap = (s.share / sum) * (total + 1) - (rc[s.team] || 0);
    if (gap > bestGap) { bestGap = gap; best = s.team; }
  });
  return best;
}

/**
 * Choose a registrar in the team: on floor, under cap, lowest pile relative to weight.
 * roster row: {name, college, teams:[..], onFloor:bool, weight:number, cap:number}
 */
function chooseRegistrar(team, college, roster, state) {
  var best = null, bestScore = 1e9;
  roster.forEach(function (p) {
    if (p.college !== college || !p.onFloor) return;
    if (p.name !== team && p.teams.indexOf(team) < 0) return;
    var n = state.pile[p.name] || 0;
    if (p.cap > 0 && n >= p.cap) return;
    var w = p.weight > 0 ? p.weight : 1;
    var score = (n + 1) / w + (state.lastAt[p.name] || 0) * 1e-12;
    if (score < bestScore) { bestScore = score; best = p.name; }
  });
  return best;
}

/** Deal one lead. Mutates state. Returns {registrar, team, rule, reason}. */
function dealLead(lead, routes, roster, state) {
  var r = findRoute(lead, routes);
  if (!r) return { registrar: '', team: '', rule: '', reason: 'no route' };
  var team = chooseTeam(r, state);
  var who = chooseRegistrar(team, lead.college, roster, state);
  var reason = '';
  if (!who) {
    // Team empty (everyone off or capped): fall back to any other team in the route, then report.
    var others = parseShares(r.teams).map(function (s) { return s.team; }).filter(function (t) { return t !== team; });
    for (var i = 0; i < others.length && !who; i++) { who = chooseRegistrar(others[i], lead.college, roster, state); if (who) { reason = 'team ' + team + ' unavailable'; team = others[i]; } }
  }
  if (!who) return { registrar: '', team: team, rule: r.label, reason: 'nobody available' };
  var rc = state.routeCounts[r.label] || (state.routeCounts[r.label] = {});
  rc[team] = (rc[team] || 0) + 1;
  state.pile[who] = (state.pile[who] || 0) + 1;
  state.seq = (state.seq || 0) + 1;
  state.lastAt[who] = state.seq;
  return { registrar: who, team: team, rule: r.label, reason: reason };
}

function newState() { return { pile: {}, routeCounts: {}, lastAt: {}, seq: 0 }; }

/**
 * Parse a GF-list timestamp as South African wall-clock time.
 * Accepts "11/05/2026 17:11", "11/5/2026 17:09:00", "2026-11-05T17:10:09+02:00", "2026-11-05 17:10".
 * Returns {y, mo, d, h, mi} or null.
 */
function parseWallClock(s) {
  var x = String(s || '').trim(), m;
  if ((m = x.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})/))) return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
  if ((m = x.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T]+(\d{1,2}):(\d{2})/))) return { y: +m[3], mo: +m[1], d: +m[2], h: +m[4], mi: +m[5] };
  if ((m = x.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return { y: +m[1], mo: +m[2], d: +m[3], h: 0, mi: 0 };
  if ((m = x.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return { y: +m[3], mo: +m[1], d: +m[2], h: 0, mi: 0 };
  return null;
}

function _ymd(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }

/** The page day a lead belongs to. wc: wall clock; settings {cutoff:"16:30", weekend:bool}. Returns "YYYY-MM-DD". */
function handoutDay(wc, settings) {
  var c = String(settings.cutoff || '16:30').split(':');
  var t = Date.UTC(wc.y, wc.mo - 1, wc.d);
  if (wc.h * 60 + wc.mi >= (+c[0]) * 60 + (+c[1] || 0)) t += 86400000;
  if (!settings.weekend) { while ([0, 6].indexOf(new Date(t).getUTCDay()) >= 0) t += 86400000; }
  return _ymd(t);
}

function addDays(ymd, n) { var p = ymd.split('-'); return _ymd(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000); }

var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Page tab for a day: "06 Nov", or "06 Nov NF" for no-funds leads (Matric has no NF tabs). */
function tabName(ymd, kind, college) {
  var p = ymd.split('-');
  var s = p[2] + ' ' + MONTHS[+p[1] - 1];
  if (kind === 'NF' && college !== 'Matric') s += ' NF';
  return s;
}

if (typeof module !== 'undefined') module.exports = { normLang: normLang, courseGroup: courseGroup, findRoute: findRoute, chooseTeam: chooseTeam, chooseRegistrar: chooseRegistrar, dealLead: dealLead, newState: newState, handoutDay: handoutDay, tabName: tabName, parseWallClock: parseWallClock, addDays: addDays, parseShares: parseShares };
