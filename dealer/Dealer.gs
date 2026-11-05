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
