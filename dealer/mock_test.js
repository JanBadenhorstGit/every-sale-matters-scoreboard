// Minimal in-memory mock of the Apps Script services used by Dealer.gs.
const fs=require('fs');
function Sheet(name,rows){this.name=name;this.v=rows.map(r=>r.map(String));this.bg={};}
Sheet.prototype.getLastRow=function(){for(let i=this.v.length-1;i>=0;i--) if(this.v[i].some(x=>x!=='')) return i+1;return 0};
Sheet.prototype.getLastColumn=function(){return Math.max(0,...this.v.map(r=>r.length))};
Sheet.prototype.getRange=function(r,c,nr=1,nc=1){const s=this;return{
 getDisplayValues(){const o=[];for(let i=0;i<nr;i++){const row=[];for(let j=0;j<nc;j++){row.push(((s.v[r-1+i]||[])[c-1+j])??'')}o.push(row)}return o},
 getBackgrounds(){const o=[];for(let i=0;i<nr;i++){const row=[];for(let j=0;j<nc;j++)row.push(s.bg[(r+i)+','+(c+j)]||'#ffffff');o.push(row)}return o},
 setValues(vals){vals.forEach((row,i)=>{while(s.v.length<r+i)s.v.push([]);row.forEach((x,j)=>{const R=s.v[r-1+i];while(R.length<c+j)R.push('');R[c-1+j]=String(x)})})},
 setValue(x){this.setValues([[x]])},
 setBackground(col){for(let i=0;i<nr;i++)for(let j=0;j<nc;j++)s.bg[(r+i)+','+(c+j)]=col},
 clearContent(){for(let i=0;i<nr;i++){const R=s.v[r-1+i];if(R)for(let j=0;j<nc;j++)if(R.length>c-1+j)R[c-1+j]=''}}
}};
Sheet.prototype.getMaxRows=function(){return 100000};Sheet.prototype.insertRowsAfter=function(){};Sheet.prototype.appendRow=function(row){this.v.splice(this.getLastRow(),0,row.map(String))};
function Book(sheets){this.s={};sheets.forEach(x=>this.s[x.name]=x)}
Book.prototype.getSheetByName=function(n){return this.s[n]||null};
let NOW=new Date('2026-11-06T08:00:00+02:00');
global.Utilities={formatDate(d,tz,f){const p=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(NOW).reduce((a,x)=>(a[x.type]=x.value,a),{});
 if(f==='yyyy-M-d-H-m')return [+p.year,+p.month,+p.day,+p.hour,+p.minute].join('-');
 if(f==='yyyy-MM-dd')return `${p.year}-${p.month}-${p.day}`;return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`}};
global.LockService={getScriptLock:()=>({tryLock:()=>true,waitLock(){},releaseLock(){}})};
global.MailApp={sendEmail(){}};
const books={};
global.SpreadsheetApp={getActive:()=>books.control,openById:id=>{if(!books[id])throw new Error('no');return books[id]}};
// Control sheet
const cfg=require('./config.json');
const P={};JSON.parse(fs.readFileSync('/tmp/pages.json')).forEach(x=>P[x.name.trim().split(' ')[0]]=x.id);
books.control=new Book([
 new Sheet('Switch',[['Setting','Value'],['Skills mode','SHADOW'],['Bellview mode','LIVE'],['Matric mode','SHADOW'],['Start time','07:30'],['Cut-off time','16:00'],['Weekend hand-out','NO'],['Duplicate window (days)','7'],['Dealer colour','#d9d2e9']]),
 new Sheet('Roster',[['h']].concat(cfg.roster.map(([n,c,t])=>[n,c,t,n==='Mpumi'?'NO':'YES','1','',P[n]||'']))),
 new Sheet('Routes',[['h']].concat(cfg.routes.map(r=>[r.label,r.college,r.kind,r.lang,r.course,r.source,r.teams]))),
 new Sheet('Sources',[['h'],
  ['New Skills','Skills','FRESH','*','gfS','Sheet1','time=A,crm=B,email=C,first=D,last=E,phone=F,course=G,lang=H,pays=J','',''],
  ['Bellview New','Bellview','FRESH','*','gfB','Leads Sheet','time=A,crm=B,email=C,first=D,last=E,phone=F,course=G,lang=H,pays=J','','']]),
 new Sheet('Log',[[]]),new Sheet('Seen',[['Key']]),new Sheet('Summary',[['Day']])]);
books.control.s.Log.v=[require('./Dealer.gs.js').LOG_HEADERS||[]];
// GF lists with 3 existing rows
const gfRow=(t,crm,course,lang)=>[t,crm,'x@y.z','A','B','0820000000',course,lang,'','Myself'];
books.gfS=new Book([new Sheet('Sheet1',[['Timestamp','CRM ID'],gfRow('11/05/2026 10:00','1','Adult Matric','English')])]);
books.gfB=new Book([new Sheet('Leads Sheet',[['Timestamp','CRM ID'],gfRow('11/05/2026 10:00','9','Volwasse Matriek','Afrikaans')])]);
// registrar pages with tab 06 Nov
for(const [n,c] of cfg.roster){ if(P[n]) books[P[n]]=new Book([new Sheet('06 Nov',[['Timestamp','CRM ID'],['11/05/2026 09:00','555']]),new Sheet('06 Nov NF',[['Timestamp','CRM ID']])]); }
module.exports={books,setNow:d=>NOW=new Date(d),gfRow};
