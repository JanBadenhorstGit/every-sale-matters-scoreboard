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
