const E=require('./Engine.gs.js');const cfg=require('./config.json');const rows=require('./oct_handouts.json');
const teamsOf={};cfg.roster.forEach(([n,c,t])=>teamsOf[c+'|'+n]=t.split(','));
const out={};
for(const r of rows){
  const tA=teamsOf[r.college+'|'+r.registrar]; if(!tA) continue;
  const lead={college:r.college,kind:r.kind,lang:E.normLang(r.lang),course:E.courseGroup(r.course),source:'*'};
  const rt=E.findRoute(lead,cfg.routes); const sh=E.parseShares(rt.teams).map(s=>s.team);
  const o=out[rt.label]=out[rt.label]||{n:0,allowed:0,byTeam:{},cfg:rt.teams};
  o.n++; if(sh.some(t=>tA.includes(t)||t===r.registrar)) o.allowed++;
  // attribute to first listed team the registrar belongs to
  const t=sh.find(t=>tA.includes(t)||t===r.registrar)||'outside';
  o.byTeam[t]=(o.byTeam[t]||0)+1;
}
let N=0,A=0;
for(const [k,o] of Object.entries(out)){N+=o.n;A+=o.allowed;
 console.log(k.padEnd(28),String(o.n).padStart(6),(100*o.allowed/o.n).toFixed(0).padStart(4)+'%','cfg',o.cfg.padEnd(16),'actual',Object.entries(o.byTeam).map(([t,v])=>t+':'+Math.round(100*v/o.n)).join(','));}
console.log('overall within allowed teams',(100*A/N).toFixed(1)+'%',N);
