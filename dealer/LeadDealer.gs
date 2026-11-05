// Lead Dealer v1.1 – paste this whole file into Extensions > Apps Script (Code.gs), replacing everything there.
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

/**
 * Lead Dealer: Apps Script glue for the "Lead Dealer – Control" sheet.
 *
 * Tabs in the Control sheet:
 *   Switch  – one mode per college (OFF / SHADOW / LIVE) and the settings.
 *   Roster  – registrars, teams, on-floor switch, weight, daily cap, page ID.
 *   Routes  – which team gets which kind of lead (first match wins).
 *   Sources – the GF lists the dealer reads, their column layout and the next row to read.
 *   Log     – one row per lead (CRM ID only, no names or phone numbers).
 *   Seen    – where each lead actually landed on the registrar pages, and when it was first seen.
 *   Summary – daily comparison of the dealer with the real hand-out.
 *
 * SHADOW: deal on paper only. Nothing on the GF lists or registrar pages changes.
 * LIVE:   write the lead into the registrar's page tab and colour the GF-list row.
 *         Rows already coloured by staff are left alone, so Johan's team and the dealer
 *         can run side by side during the switch-over.
 */

var TZ = 'Africa/Johannesburg';
var LOG_HEADERS = ['Logged at', 'Arrived', 'College', 'Kind', 'Source', 'GF row', 'CRM ID', 'Language', 'Course', 'Route', 'Team',
  'Dealer pick', 'Day', 'Tab', 'Mode', 'Status', 'Actual registrar', 'Actual tab', 'Seen on page at', 'Same team', 'Same person', 'Note'];
var C = {}; LOG_HEADERS.forEach(function (h, i) { C[h] = i; });
var MAX_ROWS_PER_SOURCE = 400;

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Lead Dealer')
    .addItem('Run dealer now', 'runDealer')
    .addItem('Check registrar pages now', 'checkPages')
    .addSeparator()
    .addItem('Install timers (run once)', 'installTriggers')
    .addItem('Remove timers', 'removeTriggers')
    .addToUi();
}

function installTriggers() {
  removeTriggers();
  ScriptApp.newTrigger('runDealer').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('checkPages').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('onOpen').forSpreadsheet(SpreadsheetApp.getActive()).onOpen().create();
  setStatus_('Timers', 'Installed ' + nowStr_());
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  setStatus_('Timers', 'Removed ' + nowStr_());
}

/* ---------- helpers ---------- */

function ss_() { return SpreadsheetApp.getActive(); }
function nowStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function nowWall_() {
  var p = Utilities.formatDate(new Date(), TZ, 'yyyy-M-d-H-m').split('-');
  return { y: +p[0], mo: +p[1], d: +p[2], h: +p[3], mi: +p[4] };
}
function todayYmd_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function ymdOf_(wc) { return wc.y + '-' + ('0' + wc.mo).slice(-2) + '-' + ('0' + wc.d).slice(-2); }
function hm_(s) { var c = String(s).split(':'); return (+c[0]) * 60 + (+c[1] || 0); }
function yes_(v) { return /^(yes|y|true|1|ja)$/i.test(String(v).trim()); }
function colIndex_(letter) { var n = 0; String(letter).toUpperCase().split('').forEach(function (ch) { n = n * 26 + ch.charCodeAt(0) - 64; }); return n - 1; }

function settings_() {
  var sh = ss_().getSheetByName('Switch');
  var v = sh.getRange(1, 1, sh.getLastRow(), 2).getDisplayValues();
  var s = {};
  v.forEach(function (r) { if (r[0]) s[String(r[0]).trim()] = String(r[1]).trim(); });
  return {
    mode: { Skills: (s['Skills mode'] || 'OFF').toUpperCase(), Bellview: (s['Bellview mode'] || 'OFF').toUpperCase(), Matric: (s['Matric mode'] || 'OFF').toUpperCase() },
    cutoff: s['Cut-off time'] || '16:30',
    start: s['Start time'] || '07:30',
    weekend: yes_(s['Weekend hand-out']),
    dupDays: +(s['Duplicate window (days)'] || 7),
    colour: s['Dealer colour'] || '#d9d2e9',
    alertEmail: s['Alert email'] || ''
  };
}

function setStatus_(name, value) {
  var sh = ss_().getSheetByName('Switch');
  var v = sh.getRange(1, 1, sh.getLastRow(), 1).getDisplayValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === name) { sh.getRange(i + 1, 2).setValue(value); return; }
  sh.appendRow([name, value]);
}

function roster_() {
  var sh = ss_().getSheetByName('Roster');
  var v = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 7).getDisplayValues();
  return v.filter(function (r) { return r[0]; }).map(function (r) {
    return { name: r[0].trim(), college: r[1].trim(), teams: r[2].split(',').map(function (x) { return x.trim(); }),
      onFloor: yes_(r[3]), weight: +r[4] || 1, cap: +r[5] || 0, pageId: r[6].trim() };
  });
}

function routes_() {
  var sh = ss_().getSheetByName('Routes');
  var v = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 7).getDisplayValues();
  return v.filter(function (r) { return r[0]; }).map(function (r) {
    return { label: r[0], college: r[1], kind: r[2], lang: r[3], course: r[4], source: r[5], teams: r[6] };
  });
}

function sources_() {
  var sh = ss_().getSheetByName('Sources');
  var v = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 9).getDisplayValues();
  return v.map(function (r, i) {
    var cols = {};
    String(r[6]).split(',').forEach(function (p) { var a = p.split('='); if (a.length === 2) cols[a[0].trim()] = colIndex_(a[1].trim()); });
    return { row: i + 2, name: r[0], college: r[1], kind: r[2].toUpperCase(), tag: (r[3] || '*').toUpperCase(),
      id: r[4].trim(), tab: r[5], cols: cols, next: +r[7] || 0, liveDeal: r[8] === '' ? true : yes_(r[8]) };
  }).filter(function (s) { return s.id; });
}

/** Read recent Log rows (last n) as arrays. */
function recentLog_(n) {
  var sh = ss_().getSheetByName('Log');
  var last = sh.getLastRow();
  if (last < 2) return { sheet: sh, first: 2, rows: [] };
  var first = Math.max(2, last - n + 1);
  return { sheet: sh, first: first, rows: sh.getRange(first, 1, last - first + 1, LOG_HEADERS.length).getDisplayValues() };
}

/** Make sure a sheet has room for n more rows after its last used row. */
function ensureRows_(sh, n) {
  var need = sh.getLastRow() + n - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 500);
}

/* ---------- the dealer ---------- */

function runDealer() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    runDealer_();
    setStatus_('Last run', nowStr_() + ' – ok');
  } catch (e) {
    setStatus_('Last run', nowStr_() + ' – ERROR: ' + e.message);
    var st = settings_();
    if (st.alertEmail) MailApp.sendEmail(st.alertEmail, 'Lead Dealer error', String(e.stack || e));
    throw e;
  } finally { lock.releaseLock(); }
}

function runDealer_() {
  var st = settings_(), roster = roster_(), routes = routes_(), sources = sources_();
  var now = nowWall_(), today = ymdOf_(now), nowMin = now.h * 60 + now.mi;
  // Nothing can be dealt outside working hours, so skip those runs to save time.
  var dow = new Date(Date.UTC(now.y, now.mo - 1, now.d)).getUTCDay();
  if ((!st.weekend && (dow === 0 || dow === 6)) || nowMin < hm_(st.start) - 5 || nowMin > 20 * 60) return;
  var log = recentLog_(20000);

  // Rebuild today's piles and the duplicate list from the Log.
  var states = {}, seenKeys = {};
  var dupFrom = addDays(today, -st.dupDays);
  log.rows.forEach(function (r) {
    var status = r[C['Status']];
    if (status !== 'shadow' && status !== 'written') return;
    var key = r[C['College']] + '|' + r[C['CRM ID']];
    if (r[C['Day']] >= dupFrom) seenKeys[key] = true;
    var sk = r[C['College']] + '|' + r[C['Day']];
    var s = states[sk] || (states[sk] = newState());
    var who = r[C['Dealer pick']], team = r[C['Team']], label = r[C['Route']];
    s.pile[who] = (s.pile[who] || 0) + 1;
    var rc = s.routeCounts[label] || (s.routeCounts[label] = {});
    rc[team] = (rc[team] || 0) + 1;
  });

  var out = [], srcSheet = ss_().getSheetByName('Sources'), pageCache = {};
  var warnings = [];

  sources.forEach(function (src) {
    var mode = st.mode[src.college] || 'OFF';
    var gf; try { gf = SpreadsheetApp.openById(src.id).getSheetByName(src.tab); } catch (e) { warnings.push(src.name + ': cannot open'); return; }
    if (!gf) { warnings.push(src.name + ': tab "' + src.tab + '" missing'); return; }
    var last = gf.getLastRow();
    if (!src.next || src.next > last + 1) { // first run, or rows were deleted/sorted: start from the end.
      if (src.next > last + 1) warnings.push(src.name + ': rows disappeared, restarted at row ' + (last + 1));
      srcSheet.getRange(src.row, 8).setValue(last + 1);
      return;
    }
    if (src.next > last) return;
    var n = Math.min(last - src.next + 1, MAX_ROWS_PER_SOURCE);
    var width = Math.max(gf.getLastColumn(), 10);
    var rng = gf.getRange(src.next, 1, n, width);
    var vals = rng.getDisplayValues();
    var bgs = mode === 'LIVE' ? rng.getBackgrounds() : null;
    var processed = 0;

    for (var i = 0; i < vals.length; i++) {
      var row = vals[i], rowNo = src.next + i;
      var get = function (k) { return src.cols[k] === undefined ? '' : String(row[src.cols[k]] || '').trim(); };
      var crm = get('crm'), wc = parseWallClock(get('time'));
      if (!crm && !get('email')) { processed++; continue; }      // blank row
      if (!wc) { out.push(logRow_(get('time'), src, rowNo, crm, '', '', {}, '', '', mode, 'skipped', 'unreadable time')); processed++; continue; }
      var day = handoutDay(wc, st);
      // Wait until the lead's hand-out day and start time. Rows are in time order, so stop here.
      if (day > today || (day === today && nowMin < hm_(st.start))) break;
      processed++;
      if (mode === 'OFF') continue;

      var lead = { college: src.college, kind: src.kind, lang: normLang(get('lang')), course: courseGroup(get('course')), source: src.tag };
      var key = src.college + '|' + crm;
      if (seenKeys[key]) { out.push(logRow_(get('time'), src, rowNo, crm, lead.lang, lead.course, {}, day, '', mode, 'duplicate', '')); continue; }

      if (mode === 'LIVE' && src.liveDeal) {
        var bg = String(bgs[i][0]).toLowerCase();
        if (bg !== '#ffffff' && bg !== '') { out.push(logRow_(get('time'), src, rowNo, crm, lead.lang, lead.course, {}, day, '', mode, 'taken by staff', bg)); seenKeys[key] = true; continue; }
      }

      var sk = src.college + '|' + day;
      var state = states[sk] || (states[sk] = newState());
      // Use today's on-floor switch for today; later days are not dealt until they arrive.
      var res = dealLead(lead, routes, roster, state);
      var tab = tabName(day, lead.kind, lead.college);
      if (!res.registrar) { out.push(logRow_(get('time'), src, rowNo, crm, lead.lang, lead.course, res, day, tab, mode, 'not dealt', res.reason)); continue; }
      seenKeys[key] = true;

      if (mode === 'LIVE' && src.liveDeal) {
        var person = roster.filter(function (p) { return p.name === res.registrar && p.college === src.college; })[0];
        var err = writeToPage_(person, tab, [get('time'), crm, get('email'), get('first'), get('last'), get('phone'), get('course'), get('lang'), '', get('pays')], pageCache);
        if (err) { out.push(logRow_(get('time'), src, rowNo, crm, lead.lang, lead.course, res, day, tab, mode, 'error', err)); state.pile[res.registrar]--; continue; }
        gf.getRange(rowNo, 1, 1, width).setBackground(st.colour);
        out.push(logRow_(get('time'), src, rowNo, crm, lead.lang, lead.course, res, day, tab, mode, 'written', res.reason));
      } else {
        out.push(logRow_(get('time'), src, rowNo, crm, lead.lang, lead.course, res, day, tab, mode, 'shadow', res.reason));
      }
    }
    if (processed) srcSheet.getRange(src.row, 8).setValue(src.next + processed);
    srcSheet.getRange(src.row, 10).setValue(nowStr_());
  });

  if (out.length) ensureRows_(log.sheet, out.length);
  if (out.length) log.sheet.getRange(log.sheet.getLastRow() + 1, 1, out.length, LOG_HEADERS.length).setValues(out);
  setStatus_('Warnings', warnings.length ? warnings.join('; ') : 'none');
}

function logRow_(arrived, src, rowNo, crm, lang, course, res, day, tab, mode, status, note) {
  var r = new Array(LOG_HEADERS.length).fill('');
  r[C['Logged at']] = nowStr_(); r[C['Arrived']] = arrived; r[C['College']] = src.college; r[C['Kind']] = src.kind;
  r[C['Source']] = src.name; r[C['GF row']] = rowNo; r[C['CRM ID']] = crm; r[C['Language']] = lang; r[C['Course']] = course;
  r[C['Route']] = res.rule || ''; r[C['Team']] = res.team || ''; r[C['Dealer pick']] = res.registrar || '';
  r[C['Day']] = day; r[C['Tab']] = tab; r[C['Mode']] = mode; r[C['Status']] = status; r[C['Note']] = note || '';
  return r;
}

function writeToPage_(person, tab, values, cache) {
  if (!person || !person.pageId) return 'no page ID for ' + (person ? person.name : '?');
  var book = cache[person.pageId];
  if (!book) { try { book = cache[person.pageId] = SpreadsheetApp.openById(person.pageId); } catch (e) { return 'cannot open page'; } }
  var sh = book.getSheetByName(tab);
  if (!sh) return 'tab "' + tab + '" missing on ' + person.name + "'s page";
  var colB = sh.getRange(1, 2, Math.max(sh.getLastRow(), 1), 1).getDisplayValues();
  var lastUsed = 0;
  for (var i = colB.length - 1; i >= 0; i--) if (String(colB[i][0]).trim() !== '') { lastUsed = i + 1; break; }
  if (lastUsed + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
  sh.getRange(Math.max(lastUsed, 1) + 1, 1, 1, values.length).setValues([values]);
  return '';
}

/* ---------- comparison with the real hand-out ---------- */

function checkPages() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try { checkPages_(); setStatus_('Last page check', nowStr_() + ' – ok'); }
  catch (e) { setStatus_('Last page check', nowStr_() + ' – ERROR: ' + e.message); throw e; }
  finally { lock.releaseLock(); }
}

function checkPages_() {
  var roster = roster_(), today = todayYmd_(), now = nowWall_();
  if (now.h < 7 || now.h > 19) return;
  var days = [today, addDays(today, -1), addDays(today, -2), addDays(today, -3)];
  var seenSh = ss_().getSheetByName('Seen');
  var lastSeen = seenSh.getLastRow();
  var seen = {};
  if (lastSeen >= 2) seenSh.getRange(Math.max(2, lastSeen - 30000), 1, Math.min(lastSeen - 1, 30001), 1).getDisplayValues()
    .forEach(function (r) { seen[r[0]] = true; });

  var add = [], stamp = nowStr_(), pagesDone = {};
  roster.forEach(function (p) {
    if (!p.pageId || pagesDone[p.pageId]) return;
    pagesDone[p.pageId] = true;
    var book; try { book = SpreadsheetApp.openById(p.pageId); } catch (e) { return; }
    days.forEach(function (d) {
      ['', ' NF', ' VM'].forEach(function (suffix) {
        var tab = tabName(d, 'FRESH', p.college) + suffix;
        var sh = book.getSheetByName(tab);
        if (!sh || sh.getLastRow() < 2) return;
        sh.getRange(2, 2, sh.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) {
          var crm = String(r[0]).trim();
          if (!/^\d+$/.test(crm)) return;
          var key = p.college + '|' + crm;
          if (seen[key]) return;
          seen[key] = true;
          add.push([key, crm, p.college, p.name, tab, stamp]);
        });
      });
    });
  });
  if (add.length) ensureRows_(seenSh, add.length);
  if (add.length) seenSh.getRange(seenSh.getLastRow() + 1, 1, add.length, 6).setValues(add);

  // Fill in the Log's "actual" columns.
  var map = {};
  var allSeen = seenSh.getLastRow() >= 2 ? seenSh.getRange(Math.max(2, seenSh.getLastRow() - 30000), 1, Math.min(seenSh.getLastRow() - 1, 30001), 6).getDisplayValues() : [];
  allSeen.forEach(function (r) { if (!map[r[0]]) map[r[0]] = r; });
  var teamsOf = {}; roster.forEach(function (p) { teamsOf[p.college + '|' + p.name] = p.teams; });
  var log = recentLog_(4000);
  var changed = false;
  log.rows.forEach(function (r) {
    if (r[C['Actual registrar']] || (r[C['Status']] !== 'shadow' && r[C['Status']] !== 'written')) return;
    var s = map[r[C['College']] + '|' + r[C['CRM ID']]];
    if (!s) return;
    r[C['Actual registrar']] = s[3]; r[C['Actual tab']] = s[4]; r[C['Seen on page at']] = s[5];
    var at = teamsOf[r[C['College']] + '|' + s[3]] || [];
    r[C['Same person']] = s[3] === r[C['Dealer pick']] ? 'Yes' : 'No';
    r[C['Same team']] = (s[3] === r[C['Dealer pick']] || at.indexOf(r[C['Team']]) >= 0) ? 'Yes' : 'No';
    changed = true;
  });
  if (changed) log.sheet.getRange(log.first, 1, log.rows.length, LOG_HEADERS.length).setValues(log.rows);
  writeSummary_(roster);
}

function writeSummary_(roster) {
  var log = recentLog_(20000);
  var g = {};
  log.rows.forEach(function (r) {
    var st = r[C['Status']];
    if (st !== 'shadow' && st !== 'written' && st !== 'duplicate' && st !== 'not dealt') return;
    var k = r[C['Day']] + '|' + r[C['College']];
    var o = g[k] || (g[k] = { day: r[C['Day']], college: r[C['College']], dealt: 0, dup: 0, notDealt: 0, found: 0, team: 0, person: 0, waitsActual: [], dealer: {}, actual: {} });
    if (st === 'duplicate') { o.dup++; return; }
    if (st === 'not dealt') { o.notDealt++; return; }
    o.dealt++;
    o.dealer[r[C['Dealer pick']]] = (o.dealer[r[C['Dealer pick']]] || 0) + 1;
    if (r[C['Actual registrar']]) {
      o.found++;
      if (r[C['Same team']] === 'Yes') o.team++;
      if (r[C['Same person']] === 'Yes') o.person++;
      o.actual[r[C['Actual registrar']]] = (o.actual[r[C['Actual registrar']]] || 0) + 1;
      var a = parseWallClock(r[C['Arrived']]), s = parseWallClock(r[C['Seen on page at']]);
      if (a && s && ymdOf_(a) === ymdOf_(s)) o.waitsActual.push((s.h * 60 + s.mi) - (a.h * 60 + a.mi));
    }
  });
  var spread = function (m) { var v = Object.keys(m).map(function (k) { return m[k]; }); return v.length ? Math.max.apply(null, v) - Math.min.apply(null, v) : ''; };
  var median = function (a) { if (!a.length) return ''; a = a.slice().sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; };
  var rows = Object.keys(g).sort().reverse().map(function (k) {
    var o = g[k];
    var absent = Object.keys(o.dealer).filter(function (n) { return !o.actual[n]; });
    return [o.day, o.college, o.dealt, o.dup, o.notDealt, o.found,
      o.found ? Math.round(100 * o.team / o.found) + '%' : '', o.found ? Math.round(100 * o.person / o.found) + '%' : '',
      spread(o.dealer), spread(o.actual), median(o.waitsActual), absent.join(', ')];
  });
  var sh = ss_().getSheetByName('Summary');
  sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 12).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 12).setValues(rows);
  sh.getRange(1, 14).setValue('Updated ' + nowStr_());
}

/* ---------- Johan's panel (web app) ---------- */
/* Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone within Skills Academy.
   Only people listed under "Panel editors" on the Switch tab can save changes; only "Switch editors" can change a mode. */

function doGet() {
  return HtmlService.createHtmlOutput(PANEL_HTML).setTitle('Lead Dealer – Johan’s panel')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function emails_(name, dflt) {
  var sh = ss_().getSheetByName('Switch');
  var v = sh.getRange(1, 1, sh.getLastRow(), 2).getDisplayValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === name) return String(v[i][1]).toLowerCase().split(/[,; ]+/).filter(String);
  return dflt;
}

function who_() {
  var me = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  return { me: me,
    canEdit: emails_('Panel editors', ['jan@skillsacademy.edu.za']).indexOf(me) >= 0,
    canSwitch: emails_('Switch editors', ['jan@skillsacademy.edu.za']).indexOf(me) >= 0 };
}

function getPanelData() {
  var u = who_(), st = settings_(), roster = roster_(), today = todayYmd_();
  var sw = ss_().getSheetByName('Switch').getRange(1, 1, 20, 2).getDisplayValues();
  var info = {}; sw.forEach(function (r) { info[r[0]] = r[1]; });
  var dealt = {}, notDealt = {}, dup = {};
  recentLog_(6000).rows.forEach(function (r) {
    if (r[C['Day']] !== today) return;
    var c = r[C['College']], s = r[C['Status']];
    if (s === 'shadow' || s === 'written') { var k = c + '|' + r[C['Dealer pick']]; dealt[k] = (dealt[k] || 0) + 1; }
    else if (s === 'not dealt' || s === 'error') notDealt[c] = (notDealt[c] || 0) + 1;
    else if (s === 'duplicate') dup[c] = (dup[c] || 0) + 1;
  });
  var actual = {};
  var seenSh = ss_().getSheetByName('Seen'), n = seenSh.getLastRow();
  if (n >= 2) seenSh.getRange(Math.max(2, n - 20000), 1, Math.min(n - 1, 20001), 6).getDisplayValues().forEach(function (r) {
    if (String(r[4]).indexOf(tabName(today, 'FRESH', r[2])) === 0) { var k = r[2] + '|' + r[3]; actual[k] = (actual[k] || 0) + 1; }
  });
  var colleges = {};
  roster.forEach(function (p) {
    (colleges[p.college] = colleges[p.college] || []).push({ name: p.name, teams: p.teams.join(', '), onFloor: p.onFloor,
      weight: p.weight, cap: p.cap || '', dealt: dealt[p.college + '|' + p.name] || 0, actual: actual[p.college + '|' + p.name] || 0 });
  });
  return { user: u, today: today, modes: st.mode, start: st.start, cutoff: st.cutoff, weekend: st.weekend,
    lastRun: info['Last run'] || '', lastCheck: info['Last page check'] || '', warnings: info['Warnings'] || '',
    colleges: colleges, notDealt: notDealt, dup: dup, at: nowStr_() };
}

function savePanel(ch) {
  var u = who_();
  if (!u.canEdit) throw new Error('You can view this panel but not change it. Ask Jan to add you as a panel editor.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var log = [], stamp = nowStr_();
    var sh = ss_().getSheetByName('Roster'), n = sh.getLastRow();
    var v = sh.getRange(2, 1, n - 1, 6).getDisplayValues();
    (ch.roster || []).forEach(function (c) {
      for (var i = 0; i < v.length; i++) {
        if (v[i][0].trim() !== c.name || v[i][1].trim() !== c.college) continue;
        var row = i + 2, w = Number(c.weight), cap = c.cap === '' ? '' : Number(c.cap);
        if (!(w > 0 && w <= 5)) throw new Error('Weight for ' + c.name + ' must be between 0.1 and 5.');
        if (cap !== '' && !(cap >= 0 && cap <= 500)) throw new Error('Daily cap for ' + c.name + ' must be blank or 0–500.');
        var nv = [c.onFloor ? 'YES' : 'NO', String(w), cap === '' ? '' : String(cap)];
        var old = [v[i][3], v[i][4], v[i][5]];
        if (nv.join('|') !== old.join('|')) {
          sh.getRange(row, 4, 1, 3).setValues([nv]);
          log.push([stamp, u.me, c.college, c.name, 'On floor ' + old[0] + '→' + nv[0] + ', weight ' + old[1] + '→' + nv[1] + ', cap ' + (old[2] || '-') + '→' + (nv[2] || '-')]);
        }
      }
    });
    if (ch.modes) {
      if (!u.canSwitch) throw new Error('Only switch editors can change a mode.');
      Object.keys(ch.modes).forEach(function (c) {
        var m = String(ch.modes[c]).toUpperCase();
        if (['OFF', 'SHADOW', 'LIVE'].indexOf(m) < 0) return;
        var cur = settings_().mode[c];
        if (cur !== m) { setStatus_(c + ' mode', m); log.push([stamp, u.me, c, '', 'Mode ' + cur + '→' + m]); }
      });
    }
    if (log.length) {
      var cs = ss_().getSheetByName('Changes') || ss_().insertSheet('Changes');
      if (cs.getLastRow() === 0) cs.appendRow(['When', 'Who', 'College', 'Registrar', 'Change']);
      cs.getRange(cs.getLastRow() + 1, 1, log.length, 5).setValues(log);
    }
    return { saved: log.length };
  } finally { lock.releaseLock(); }
}

var PANEL_HTML = String.raw`<!doctype html><html><head><meta charset="utf-8"><base target="_top">
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1d2433;--mute:#5b6577;--line:#e3e6eb;--acc:#3b5bdb;--ok:#2b8a3e;--warn:#b35c00;--bad:#c92a2a}
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
header{background:#1d2433;color:#fff;padding:14px 20px}header h1{margin:0;font-size:19px;font-weight:600}header p{margin:2px 0 0;color:#c5cad3;font-size:13px}
main{max-width:1050px;margin:0 auto;padding:16px}
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:14px}
.box{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.box h3{margin:0 0 6px;font-size:13px;color:var(--mute);font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.mode{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:600;font-size:13px}
.m-SHADOW{background:#e7ecff;color:#2541b2}.m-LIVE{background:#d3f9d8;color:#1b6b2c}.m-OFF{background:#eceef1;color:#5b6577}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}.seg button{border:0;background:#fff;padding:5px 10px;font:inherit;font-size:13px;cursor:pointer;color:var(--ink)}
.seg button+button{border-left:1px solid var(--line)}.seg button.on{background:var(--acc);color:#fff}
.tabs{display:flex;gap:6px;margin:6px 0 10px}.tabs button{border:1px solid var(--line);background:#fff;border-radius:8px;padding:7px 14px;font:inherit;cursor:pointer;color:var(--ink)}
.tabs button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}th{font-size:12.5px;color:var(--mute);font-weight:600;background:#fafbfc}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}tr.off td{color:#98a1b0}tr.changed td{background:#fff9db}
.sw{position:relative;width:44px;height:24px;display:inline-block}.sw input{opacity:0;width:0;height:0}
.sl{position:absolute;inset:0;background:#cfd4dc;border-radius:999px;transition:.15s;cursor:pointer}.sl:before{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.15s}
.sw input:checked+.sl{background:var(--ok)}.sw input:checked+.sl:before{transform:translateX(20px)}.sw input:disabled+.sl{cursor:not-allowed;opacity:.6}
select,input[type=number]{font:inherit;padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink)}input[type=number]{width:70px}
.bar{position:sticky;bottom:0;background:#fff;border-top:1px solid var(--line);padding:10px 16px;display:none;justify-content:space-between;align-items:center;gap:10px;box-shadow:0 -2px 8px rgba(0,0,0,.05)}
.bar.show{display:flex}.btn{background:var(--acc);color:#fff;border:0;border-radius:8px;padding:8px 16px;font:inherit;font-weight:600;cursor:pointer}.btn.sec{background:#fff;color:var(--ink);border:1px solid var(--line)}
.note{color:var(--mute);font-size:13px}.warn{color:var(--warn)}.bad{color:var(--bad)}.msg{margin:8px 0;padding:8px 12px;border-radius:8px;display:none}.msg.show{display:block}.msg.ok{background:#d3f9d8}.msg.err{background:#ffe3e3}
@media(max-width:640px){th:nth-child(2),td:nth-child(2){display:none}}
</style></head><body>
<header><h1>Lead Dealer – Johan’s panel</h1><p id="sub">Loading…</p></header>
<main>
<div id="msg" class="msg"></div>
<div class="strip" id="strip"></div>
<div class="note" id="explain"></div>
<div class="tabs" id="tabs"></div>
<div id="tbl"></div>
<p class="note">On floor = gets new leads today. Weight 1 = an equal share; 0.5 = half a share; 2 = a double share. Daily cap = the most leads someone gets in a day (blank = no limit). Changes apply at the next run, within 5 minutes. Every change is recorded with your name.</p>
</main>
<div class="bar" id="bar"><span id="count"></span><span><button class="btn sec" onclick="discard()">Undo changes</button> <button class="btn" id="save" onclick="save()">Save</button></span></div>
<script>
var D=null, college='Skills', edits={}, modeEdits={};
function el(t,a,h){var e=document.createElement(t);if(a)for(var k in a)e.setAttribute(k,a[k]);if(h!=null)e.innerHTML=h;return e}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function load(){google.script.run.withSuccessHandler(function(d){D=d;render()}).withFailureHandler(fail).getPanelData()}
function fail(e){show(String(e.message||e),'err')}
function show(t,k){var m=document.getElementById('msg');m.textContent=t;m.className='msg show '+k;if(k==='ok')setTimeout(function(){m.className='msg'},4000)}
function dirty(){return Object.keys(edits).length+Object.keys(modeEdits).length}
function render(){
  var u=D.user;document.getElementById('sub').textContent='Today '+D.today+' · updated '+D.at+' · '+(u.me||'unknown user')+(u.canEdit?'':' (view only)');
  var s=document.getElementById('strip');s.innerHTML='';
  ['Skills','Bellview','Matric'].forEach(function(c){
    var m=modeEdits[c]||D.modes[c],b=el('div',{class:'box'});b.appendChild(el('h3',null,c));
    if(u.canSwitch){var g=el('div',{class:'seg'});['OFF','SHADOW','LIVE'].forEach(function(x){var bt=el('button',x===m?{class:'on'}:null,x);bt.onclick=function(){if(x===D.modes[c])delete modeEdits[c];else{if(x==='LIVE'&&!confirm('Switch '+c+' to LIVE? From the next run the dealer writes new leads onto the registrar pages.'))return;modeEdits[c]=x}render()};g.appendChild(bt)});b.appendChild(g)}
    else b.appendChild(el('span',{class:'mode m-'+m},m));
    var nd=D.notDealt[c]||0;b.appendChild(el('div',{class:'note',style:'margin-top:6px'},(nd?'<span class="bad">'+nd+' lead(s) could not be dealt today</span>':'All leads dealt')+(D.dup[c]?' · '+D.dup[c]+' duplicates skipped':'')));
    s.appendChild(b)});
  var st=el('div',{class:'box'});st.appendChild(el('h3',null,'Dealer status'));
  st.appendChild(el('div',{class:'note'},'Last run: '+esc(D.lastRun||'–')+'<br>Last page check: '+esc(D.lastCheck||'–')+'<br>Hand-out from '+esc(D.start)+'; leads after '+esc(D.cutoff)+' go to the next working day'+(D.weekend?'':'; weekend leads go to Monday')+(D.warnings&&D.warnings!=='none'?'<br><span class="warn">'+esc(D.warnings)+'</span>':'')));
  s.appendChild(st);
  var anyShadow=['Skills','Bellview','Matric'].some(function(c){return D.modes[c]==='SHADOW'});
  document.getElementById('explain').innerHTML=anyShadow?'<p><b>Shadow</b> means the dealer only works out who it would give each lead to. Nothing changes on the pages. <b>Dealer today</b> shows its picks; <b>On pages today</b> shows the real hand-out.</p>':'';
  var t=document.getElementById('tabs');t.innerHTML='';
  Object.keys(D.colleges).forEach(function(c){var b=el('button',c===college?{class:'on'}:null,c);b.onclick=function(){college=c;render()};t.appendChild(b)});
  var rows=D.colleges[college]||[],h='<table><thead><tr><th>Registrar</th><th>Teams</th><th>On floor</th><th>Weight</th><th>Daily cap</th><th class="num">Dealer today</th><th class="num">On pages today</th></tr></thead><tbody>';
  rows.forEach(function(p,i){var k=college+'|'+p.name,e=edits[k]||{},on=e.onFloor!=null?e.onFloor:p.onFloor,w=e.weight!=null?e.weight:p.weight,cap=e.cap!=null?e.cap:p.cap,dis=u.canEdit?'':' disabled';
    var ws=[0.25,0.5,0.75,1,1.25,1.5,2,3];if(ws.indexOf(Number(w))<0)ws.push(Number(w));ws.sort(function(a,b){return a-b});
    h+='<tr class="'+(on?'':'off ')+(edits[k]?'changed':'')+'"><td><b>'+esc(p.name)+'</b></td><td class="note">'+esc(teamLabel(p.teams))+'</td>'+
    '<td><label class="sw"><input type="checkbox" data-k="'+esc(k)+'" data-f="onFloor"'+(on?' checked':'')+dis+'><span class="sl"></span></label></td>'+
    '<td><select data-k="'+esc(k)+'" data-f="weight"'+dis+'>'+ws.map(function(x){return '<option'+(Number(w)===x?' selected':'')+'>'+x+'</option>'}).join('')+'</select></td>'+
    '<td><input type="number" min="0" max="500" placeholder="none" value="'+esc(cap)+'" data-k="'+esc(k)+'" data-f="cap"'+dis+'></td>'+
    '<td class="num">'+p.dealt+'</td><td class="num">'+p.actual+'</td></tr>'});
  document.getElementById('tbl').innerHTML='<div style="overflow-x:auto">'+h+'</tbody></table></div>';
  document.querySelectorAll('#tbl [data-k]').forEach(function(x){x.onchange=function(){var k=x.dataset.k,f=x.dataset.f,p=find(k),v=f==='onFloor'?x.checked:x.value;var e=edits[k]||{};e[f]=f==='weight'?Number(v):v;
    var same=(e.onFloor==null||e.onFloor===p.onFloor)&&(e.weight==null||Number(e.weight)===Number(p.weight))&&(e.cap==null||String(e.cap)===String(p.cap));if(same)delete edits[k];else edits[k]=e;render()}});
  var n=dirty();document.getElementById('bar').className='bar'+(n?' show':'');document.getElementById('count').textContent=n+' unsaved change'+(n===1?'':'s');
}
var TL={'AF':'Afrikaans','OTHER':'English & African languages','ICB':'ICB','NF':'No funds','NF-AF':'No funds (Afrikaans)'};
function teamLabel(t){if(!t)return '–';return t.split(/,\s*/).map(function(x){return TL[x]||x}).join(' · ')}
function find(k){var a=k.split('|');return D.colleges[a[0]].filter(function(p){return p.name===a[1]})[0]}
function discard(){edits={};modeEdits={};render()}
function save(){var r=[];Object.keys(edits).forEach(function(k){var p=find(k),e=edits[k],a=k.split('|');r.push({college:a[0],name:a[1],onFloor:e.onFloor!=null?e.onFloor:p.onFloor,weight:e.weight!=null?e.weight:p.weight,cap:e.cap!=null?e.cap:p.cap})});
  var b=document.getElementById('save');b.disabled=true;b.textContent='Saving…';
  google.script.run.withSuccessHandler(function(res){edits={};modeEdits={};b.disabled=false;b.textContent='Save';show('Saved '+res.saved+' change(s). They apply at the next run.','ok');load()})
  .withFailureHandler(function(e){b.disabled=false;b.textContent='Save';fail(e)}).savePanel({roster:r,modes:Object.keys(modeEdits).length?modeEdits:null})}
setInterval(function(){if(!dirty())load()},120000);load();
</script></body></html>
`;
