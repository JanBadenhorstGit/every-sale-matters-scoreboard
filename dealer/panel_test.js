const T=require('./mock_test.js');global.Session={getActiveUser:()=>({getEmail:()=>global.ME})};global.HtmlService={};
const D=require('./Dealer.gs.js');const {books,setNow,gfRow}=T;
books.control.s.Switch.v.push(['Panel editors','jan@skillsacademy.edu.za, johan@skillsacademy.edu.za'],['Switch editors','jan@skillsacademy.edu.za']);
books.control.insertSheet=function(n){const s=new (books.control.s.Log.constructor)(n,[]);this.s[n]=s;return s};
D.runDealer();const s=books.gfS.s.Sheet1;[['11/06/2026 07:40','101','Beauty','English'],['11/06/2026 07:41','102','Adult Matric','isiZulu']].forEach(r=>s.v.push(gfRow(...r)));
setNow('2026-11-06T08:00:00+02:00');D.runDealer();
global.ME='johan@skillsacademy.edu.za';const d=D.getPanelData();
console.log(d.user,d.modes,d.colleges.Skills.filter(p=>p.dealt).map(p=>p.name+':'+p.dealt));
console.log(D.savePanel({roster:[{college:'Skills',name:'Andre',onFloor:false,weight:0.5,cap:'20'}]}));
console.log(books.control.s.Roster.v[1], books.control.s.Changes.v);
try{D.savePanel({modes:{Skills:'LIVE'}})}catch(e){console.log('blocked:',e.message)}
global.ME='someone@skillsacademy.edu.za';try{D.savePanel({roster:[]})}catch(e){console.log('blocked:',e.message)}
global.ME='jan@skillsacademy.edu.za';console.log(D.savePanel({modes:{Skills:'LIVE'}}),books.control.s.Switch.v[1]);
require('fs').writeFileSync('/tmp/paneldata.json',JSON.stringify(Object.assign(d,{user:{me:'johan@skillsacademy.edu.za',canEdit:true,canSwitch:false}})));
