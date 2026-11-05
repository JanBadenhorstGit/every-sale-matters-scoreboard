const T=require('./mock_test.js');const D=require('./Dealer.gs.js');
const {books,setNow,gfRow}=T;
const log=()=>books.control.s.Log.v.slice(1);
// run 1: initialise pointers
D.runDealer(); console.log('sources after init',books.control.s.Sources.v.slice(1).map(r=>r[7]));
// add leads: Skills (5 English other, 3 Afrikaans, 2 matric African, 1 dup), Bellview (4 English, one coloured by staff)
const s=books.gfS.s.Sheet1, b=books.gfB.s['Leads Sheet'];
[['11/06/2026 07:40','101','Bookkeeping ICB','English'],['11/06/2026 07:41','102','Beauty','English'],['11/06/2026 07:42','103','Beauty','Afrikaans'],['11/06/2026 07:43','104','Adult Matric','isiZulu'],['11/06/2026 07:44','102','Beauty','English'],['11/06/2026 07:45','105','Adult Matric','English'],['11/06/2026 15:59','106','Beauty','English'],['11/06/2026 16:05','107','Beauty','English']].forEach(r=>s.v.push(gfRow(...r)));
[['11/06/2026 07:40','201','Adult Matric','English'],['11/06/2026 07:41','202','Adult Matric','English'],['11/06/2026 07:42','203','Educare','Afrikaans'],['11/06/2026 07:43','204','Bookkeeping','English']].forEach(r=>b.v.push(gfRow(...r)));
b.bg[(b.v.length-1)+',1']='#ffff00'; // row 203 coloured yellow by staff
setNow('2026-11-06T08:00:00+02:00'); D.runDealer();
console.table(log().map(r=>({src:r[4],row:r[5],crm:r[6],lang:r[7],course:r[8],route:r[9],team:r[10],pick:r[11],day:r[12],tab:r[13],mode:r[14],status:r[15],note:r[21]})));
console.log('status',books.control.s.Switch.v.slice(-3));
console.log('pointer',books.control.s.Sources.v.slice(1).map(r=>r[7]));
// Bellview pages got rows?
for(const [id,bk] of Object.entries(books)) if(bk.s['06 Nov']&&bk.s['06 Nov'].v.length>2) console.log('page',id.slice(0,6),bk.s['06 Nov'].v.slice(2).map(r=>r[1]));
console.log('gfB colours',b.bg);
// Simulate Johan putting Skills 102 on Kenneth's page and run page check
const P=require('/tmp/pages.json');const pid=n=>P.find(x=>x.name.startsWith(n+' ')).id;
books[pid('Kenneth')].s['06 Nov'].v.push(['11/06/2026 07:41','102']);
books[pid('Andre')].s['06 Nov'].v.push(['11/06/2026 07:42','103']);
setNow('2026-11-06T09:00:00+02:00'); D.checkPages();
console.table(log().filter(r=>r[16]).map(r=>({crm:r[6],pick:r[11],team:r[10],actual:r[16],tab:r[17],seen:r[18],sameTeam:r[19],samePerson:r[20]})));
console.log(books.control.s.Summary.v.slice(0,4));
// 16:05 lead should wait until next working day (Monday 9 Nov)
setNow('2026-11-06T17:00:00+02:00'); D.runDealer(); console.log('after 17:00 rows',log().length,'pointer',books.control.s.Sources.v[1][7]);
setNow('2026-11-09T07:35:00+02:00'); D.runDealer(); const L=log().slice(-1)[0]; console.log('Monday', L[6],L[12],L[13],L[15]);
