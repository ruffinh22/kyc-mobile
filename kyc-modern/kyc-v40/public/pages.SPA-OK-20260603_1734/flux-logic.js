// ============================================================================
// KYC V3 - Logique Flux & Prédiction (reproduite fidèlement de la V1)
// Source historique : GET /api/dossiers (60 jours) au lieu de localStorage
// Présence : GET /api/presence/resume
// ============================================================================
'use strict';
let FLUX_DATA = [];      // dossiers chargés (équivaut à l'historique localStorage V1)
let FLUX_AGENTS = 1;     // agents actifs (en ligne ou en pause)
let chartFluxHisto = null;
let fluxPeriodeJours = 7;

function _dateLocale(){ return new Date().toISOString().split('T')[0]; }
function fluxGetHistorique(){ return FLUX_DATA; }

function fluxVolParHeure(liste, dateStr){
  const h = Array(24).fill(0);
  liste.forEach(d => {
    if (!d.created_at) return;
    const dt = new Date(d.created_at * 1000);
    if (dt.toISOString().split('T')[0] === dateStr) h[dt.getHours()]++;
  });
  return h;
}
function fluxMoyenneH(liste, nbJours){
  const today = _dateLocale();
  const dates = [...new Set(
    liste.map(d => d.created_at ? new Date(d.created_at*1000).toISOString().split('T')[0] : null)
         .filter(d => d && d < today)
  )].sort().slice(-nbJours);
  const somme = Array(24).fill(0), cnt = Array(24).fill(0);
  dates.forEach(date => { fluxVolParHeure(liste, date).forEach((v, h) => { somme[h] += v; cnt[h]++; }); });
  return { moyennes: somme.map((s,h) => cnt[h] ? +(s/cnt[h]).toFixed(2) : 0), nbJours: dates.length };
}
function fluxTendance(liste, nbJours){
  const today = _dateLocale();
  const dates = [...new Set(
    liste.map(d => d.created_at ? new Date(d.created_at*1000).toISOString().split('T')[0] : null)
         .filter(d => d && d < today)
  )].sort().slice(-nbJours);
  if (dates.length < 3) return { pente:0, pct:0 };
  const vols = dates.map(date => fluxVolParHeure(liste, date).reduce((s,v)=>s+v,0));
  const n = vols.length, meanX=(n-1)/2, meanY=vols.reduce((s,v)=>s+v,0)/n;
  let num=0, den=0;
  vols.forEach((y,x) => { num+=(x-meanX)*(y-meanY); den+=(x-meanX)**2; });
  const pente = den ? num/den : 0;
  return { pente:+pente.toFixed(2), pct: meanY>0 ? Math.round((pente/meanY)*100) : 0 };
}
function fluxAgentsActifs(){ return FLUX_AGENTS; }
function fluxCapAgent(liste){
  const t = liste.filter(d => d.created_at && d.closed_at && d.closed_at > d.created_at);
  if (!t.length) return 10;
  const moy = t.reduce((s,d) => s+(d.closed_at-d.created_at), 0) / t.length;
  return Math.min(Math.max(Math.round(3600/moy), 3), 30);
}
function fluxPrev(moyH, tendance, h){
  const base = moyH[h] || 0;
  const f = 1 + Math.max(-0.5, Math.min(1, tendance.pct/100));
  return Math.max(0, Math.round(base * f));
}
function fluxConfiance(nbJ){
  if (nbJ>=14) return {label:'Élevée ✓', c:'#16a34a', bg:'#dcfce7'};
  if (nbJ>=7)  return {label:'Bonne',    c:'#FFC300', bg:'#fff8e1'};
  if (nbJ>=3)  return {label:'Faible',   c:'#d97706', bg:'#fef9c3'};
  return              {label:'Insuffisante', c:'#dc2626', bg:'#fee2e2'};
}
function setFluxPeriode(n){
  fluxPeriodeJours = n;
  ['7','14','30'].forEach(v => {
    const b = document.getElementById('fbtn-'+v);
    if (b){ if(v==n) b.classList.add('on'); else b.classList.remove('on'); }
  });
  chargerFlux();
}
function setEffVue(v){
  const map={journee:'feff-journee',jour:'feff-jour',semaine:'feff-semaine'};
  const tabs={journee:'feff-tab-jour',jour:'feff-tab-day',semaine:'feff-tab-sem'};
  Object.values(map).forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none'});
  Object.values(tabs).forEach(id=>{const e=document.getElementById(id);if(e)e.classList.remove('on')});
  const panel=document.getElementById(map[v]);if(panel)panel.style.display='block';
  const tab=document.getElementById(tabs[v]);if(tab)tab.classList.add('on');
}

function chargerFlux(){
  const now = new Date(), todayStr = now.toISOString().split('T')[0], hNow = now.getHours();
  const liste = fluxGetHistorique();
  const upd = document.getElementById('flux-last-update');
  if (upd) upd.textContent = 'Mise à jour : ' + now.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});

  const auj = liste.filter(d => d.created_at && new Date(d.created_at*1000).toISOString().split('T')[0]===todayStr);
  const enAttente = auj.filter(d=>d.statut==='en_attente').length;
  const enCours   = auj.filter(d=>d.statut==='en_cours').length;
  const il1h = Date.now()/1000 - 3600;
  const fluxH = liste.filter(d=>d.created_at && d.created_at>il1h).length;
  const nbAgents = Math.max(fluxAgentsActifs(),1);
  const capAgent = fluxCapAgent(liste);
  const capTotale = nbAgents * capAgent;
  const charge = enAttente + enCours;
  const satPct = capTotale>0 ? Math.round((charge/capTotale)*100) : 0;

  const se = id => document.getElementById(id);
  if(se('fkpi-entrant'))  se('fkpi-entrant').textContent  = fluxH;
  if(se('fkpi-cours'))    se('fkpi-cours').textContent    = enCours;
  if(se('fkpi-attente'))  se('fkpi-attente').textContent  = enAttente;
  if(se('fkpi-capacite')) se('fkpi-capacite').textContent = capTotale;
  if(se('fkpi-saturation')) se('fkpi-saturation').textContent = satPct+'%';
  if(se('flux-agents-actifs')) se('flux-agents-actifs').textContent = nbAgents+' agent'+(nbAgents>1?'s':'')+' actif'+(nbAgents>1?'s':'');

  const satCard = se('fkpi-sat-card'), satEl = se('fkpi-saturation');
  if (satCard && satEl) {
    const [sc,sb,sbo] = satPct>=90?['#dc2626','#fff8e1','#dc2626']:satPct>=70?['#d97706','#fff8e1','#d97706']:['#16a34a','#f0fdf4','#16a34a'];
    satEl.style.color=sc; satCard.style.borderTop='3px solid '+sbo; satCard.style.background=sb;
  }

  const alerteEl = se('flux-alerte');
  const agentsNec = Math.max(1, Math.ceil(charge/Math.max(capAgent,1)));
  if(se('flux-agents-rec')) se('flux-agents-rec').textContent = Math.max(agentsNec,nbAgents);
  if (alerteEl) {
    if (satPct>=90||enAttente>15) {
      alerteEl.style.cssText='display:flex;background:#fef2f2;border:1.5px solid #fca5a5;border-radius:10px;padding:13px 16px;margin-bottom:14px;align-items:center;gap:12px';
      if(se('flux-alerte-ico')) se('flux-alerte-ico').textContent='🚨';
      if(se('flux-alerte-titre')) se('flux-alerte-titre').innerHTML='<span style="color:#dc2626">Saturation critique — Renfort immédiat</span>';
      if(se('flux-alerte-msg')) se('flux-alerte-msg').textContent="File d'attente : "+enAttente+" dossiers. Saturation à "+satPct+"%. Mobilisez au moins "+Math.max(agentsNec,nbAgents)+" agents.";
    } else if (satPct>=65||enAttente>8) {
      alerteEl.style.cssText='display:flex;background:#fff8e1;border:1.5px solid #FFC300;border-radius:10px;padding:13px 16px;margin-bottom:14px;align-items:center;gap:12px';
      if(se('flux-alerte-ico')) se('flux-alerte-ico').textContent='⚠️';
      if(se('flux-alerte-titre')) se('flux-alerte-titre').innerHTML='<span style="color:#d97706">Flux tendu — Surveiller</span>';
      if(se('flux-alerte-msg')) se('flux-alerte-msg').textContent='Saturation à '+satPct+'%. Si la cadence continue, prévoir un agent supplémentaire.';
    } else {
      alerteEl.style.display='none';
    }
  }

  const mh = fluxMoyenneH(liste, fluxPeriodeJours);
  const moyH = mh.moyennes, nbJ = mh.nbJours;
  const tendance = fluxTendance(liste, fluxPeriodeJours);
  const conf = fluxConfiance(nbJ);
  if(se('flux-base-hist')) se('flux-base-hist').textContent = nbJ+"j d'historique";
  if(se('flux-confiance-badge')) { se('flux-confiance-badge').textContent='Confiance : '+conf.label; se('flux-confiance-badge').style.background=conf.bg; se('flux-confiance-badge').style.color=conf.c; }

  const NIVEAUX=[{s:0,l:'Faible',c:'#16a34a',bg:'#dcfce7'},{s:5,l:'Modéré',c:'#FFC300',bg:'#fff8e1'},{s:12,l:'Élevé',c:'#d97706',bg:'#fef9c3'},{s:20,l:'Critique',c:'#dc2626',bg:'#fee2e2'}];
  const getNiv = v => [...NIVEAUX].reverse().find(n=>v>=n.s)||NIVEAUX[0];

  const prev4hEl = se('flux-prev4h');
  if (prev4hEl) {
    let h4='';
    for(let i=1;i<=4;i++){
      const h=(hNow+i)%24, p=fluxPrev(moyH,tendance,h), hist=Math.round(moyH[h]);
      const niv=getNiv(p), agMin=Math.max(1,Math.ceil(p/Math.max(capAgent,1)));
      const diff=hist>0?Math.round(((p-hist)/hist)*100):0;
      const dt=diff>10?'↑ +'+diff+'%':diff<-10?'↓ '+diff+'%':'→ stable';
      const dc=diff>10?'#dc2626':diff<-10?'#16a34a':'#9ca3af';
      h4+='<div style="border:1.5px solid '+niv.c+';border-radius:10px;padding:10px 6px;text-align:center;background:'+niv.bg+'">'
        +'<div style="font-size:12px;font-weight:700;color:#1A1A1A;margin-bottom:5px">'+h+'h00</div>'
        +'<div style="font-size:26px;font-weight:900;color:'+niv.c+';line-height:1">'+p+'</div>'
        +'<div style="font-size:9px;color:var(--muted);margin-top:2px">dossiers</div>'
        +'<div style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:6px;background:rgba(0,0,0,.07);color:'+niv.c+';margin-top:5px">'+niv.l+'</div>'
        +'<div style="font-size:10px;font-weight:600;color:'+dc+';margin-top:3px">'+dt+'</div>'
        +'<div style="font-size:9px;color:#6b7280;margin-top:4px;border-top:1px solid rgba(0,0,0,.08);padding-top:4px">👤 '+agMin+' min</div>'
        +'</div>';
    }
    prev4hEl.innerHTML=h4;
  }

  let picH=8,picV=0;
  for(let h=6;h<=21;h++){const v=fluxPrev(moyH,tendance,h);if(v>picV){picV=v;picH=h;}}
  if(se('flux-pic-heure')) se('flux-pic-heure').textContent=picH+'h – '+(picH+1)+'h';
  if(se('flux-pic-vol'))   se('flux-pic-vol').textContent='~'+picV+' dossiers attendus';

  const dejaVus=auj.length;
  const restantPrev=Array.from({length:Math.max(0,21-hNow-1)},(_,i)=>fluxPrev(moyH,tendance,hNow+1+i)).reduce((s,v)=>s+v,0);
  if(se('flux-fin-jour')) se('flux-fin-jour').textContent='~'+(dejaVus+restantPrev)+' dossiers';
  if(se('flux-fin-sub'))  se('flux-fin-sub').textContent=dejaVus+' reçus + ~'+restantPrev+' prévus';

  const insightsEl=se('flux-insights');
  if(insightsEl){
    const ins=[];
    const tPct=tendance.pct;
    if(Math.abs(tPct)>=5){
      const ico=tPct>0?'📈':'📉',col=tPct>20?'#dc2626':tPct>0?'#d97706':'#16a34a';
      ins.push({ico:ico,col:col,txt:'Tendance <strong>'+(tPct>0?'+':'')+tPct+'%</strong> sur '+nbJ+' jours.'});
    }
    let creuxH=8,creuxV=Infinity;
    for(let h=8;h<=18;h++){const v=Math.round(moyH[h]);if(v<creuxV){creuxV=v;creuxH=h;}}
    ins.push({ico:'💤',col:'#6b7280',txt:'Creux à <strong>'+creuxH+'h</strong> (~'+creuxV+' dossiers). Idéal pour pauses.'});
    const cov=Math.round((nbAgents/Math.max(1,Math.ceil(picV/capAgent)))*100);
    if(cov<80) ins.push({ico:'⚡',col:'#dc2626',txt:'Couverture <strong>'+cov+'%</strong> au pic — '+(Math.ceil(picV/capAgent)-nbAgents)+' agent(s) manquant(s).'});
    else       ins.push({ico:'✅',col:'#16a34a',txt:'Couverture <strong>'+cov+'%</strong> au pic prévu de '+picH+'h.'});
    insightsEl.innerHTML=ins.map(i=>'<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border-radius:7px;background:rgba(0,0,0,.03)"><span style="font-size:14px;flex-shrink:0">'+i.ico+'</span><span style="font-size:11px;color:#1A1A1A;line-height:1.5">'+i.txt+'</span></div>').join('');
  }

  // Courbe historique
  const labels=[],dataR=[],dataMoy=[],dataPrev=[];
  const moyTot=Math.round(moyH.reduce((s,v)=>s+v,0));
  for(let i=fluxPeriodeJours-1;i>=0;i--){
    const d=new Date();d.setDate(d.getDate()-i);
    const ds=d.toISOString().split('T')[0];
    labels.push(d.getDate()+'/'+(d.getMonth()+1));
    dataR.push(fluxVolParHeure(liste,ds).reduce((s,v)=>s+v,0));
    dataMoy.push(moyTot);
    dataPrev.push(null);
  }
  const dem=new Date();dem.setDate(dem.getDate()+1);
  const prevDem=Array.from({length:16},(_,i)=>fluxPrev(moyH,tendance,6+i)).reduce((s,v)=>s+v,0);
  labels.push(dem.getDate()+'/'+(dem.getMonth()+1)+' ★');
  dataR.push(null);dataMoy.push(null);dataPrev.push(prevDem);

  if(chartFluxHisto) chartFluxHisto.destroy();
  const ctx=document.getElementById('chart-flux-histo');
  if(ctx && window.Chart){
    chartFluxHisto=new Chart(ctx,{
      type:'line',
      data:{labels:labels,datasets:[
        {label:'Volume réel',data:dataR,borderColor:'#FFC300',backgroundColor:'rgba(255,195,0,.12)',borderWidth:2.5,pointRadius:4,pointBackgroundColor:'#FFC300',fill:true,tension:0.35,spanGaps:true},
        {label:'Moyenne',data:dataMoy,borderColor:'#FFC300',borderWidth:1.5,borderDash:[5,4],pointRadius:0,fill:false,tension:0,spanGaps:true},
        {label:'Prévision J+1',data:dataPrev,borderColor:'#FFC300',backgroundColor:'rgba(255,195,0,.15)',borderWidth:2,pointRadius:6,pointBackgroundColor:'#FFC300',fill:false,tension:0,spanGaps:true}
      ]},
      options:{responsive:true,plugins:{legend:{position:'bottom',labels:{font:{size:11},boxWidth:12,padding:10}},tooltip:{mode:'index',intersect:false}},scales:{x:{ticks:{font:{size:10}}},y:{beginAtZero:true,ticks:{font:{size:10}}}}}
    });
  }

  // Heatmap
  const jours=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
  const tranches=[6,8,10,12,14,16,18,20];
  const today=new Date().toISOString().split('T')[0];
  const mat=Array.from({length:7},()=>Array(tranches.length).fill(0));
  liste.forEach(d=>{
    if(!d.created_at)return;
    const dt=new Date(d.created_at*1000),ds=dt.toISOString().split('T')[0];
    if(ds>=today)return;
    const dow=(dt.getDay()+6)%7,h=dt.getHours();
    const ti=tranches.findIndex((t,i)=>h>=t&&(i===tranches.length-1||h<tranches[i+1]));
    if(ti>=0){mat[dow][ti]++;}
  });
  let maxV=1;mat.forEach(r=>r.forEach(v=>{if(v>maxV)maxV=v;}));
  const heatEl=se('flux-heatmap');
  if(heatEl){
    let hh='<div style="display:inline-block;min-width:100%">';
    hh+='<div style="display:flex"><div style="width:36px"></div>';
    tranches.forEach(t=>{hh+='<div style="width:54px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);padding-bottom:4px">'+t+'h</div>';});
    hh+='</div>';
    mat.forEach((row,di)=>{
      hh+='<div style="display:flex;align-items:center"><div style="width:36px;font-size:10px;font-weight:700;color:#1A1A1A">'+jours[di]+'</div>';
      row.forEach((v,ti)=>{
        const norm=v/maxV,alpha=0.08+norm*0.85,bg='rgba(255,195,0,'+alpha.toFixed(2)+')',tc=norm>0.6?'#fff':'#1A1A1A';
        const val=nbJ>0?Math.round(v/nbJ):0;
        hh+='<div style="width:54px;height:30px;background:'+bg+';border:1px solid rgba(255,255,255,.5);display:flex;align-items:center;justify-content:center;font-weight:700;color:'+tc+';font-size:11px;border-radius:2px" title="'+jours[di]+' '+tranches[ti]+'h : ~'+val+'/j">'+(val||'·')+'</div>';
      });
      hh+='</div>';
    });
    hh+='</div>';
    heatEl.innerHTML=hh;
  }

  // Tableau effectif journée (tranches 2h)
  const tranchesEff=[[6,8],[8,10],[10,12],[12,14],[14,16],[16,18],[18,20],[20,22]];
  const maxF=Math.max.apply(null,tranchesEff.map(function(p){return Array.from({length:p[1]-p[0]},function(_,i){return fluxPrev(moyH,tendance,p[0]+i)}).reduce(function(s,v){return s+v},0)}).concat([1]));
  const tbEff=se('flux-tbody-effectif');
  if(tbEff){
    tbEff.innerHTML=tranchesEff.map(function(p){
      const debut=p[0],fin=p[1];
      const fp=Array.from({length:fin-debut},function(_,i){return fluxPrev(moyH,tendance,debut+i)}).reduce(function(s,v){return s+v},0);
      const agMin=Math.max(1,Math.ceil(fp/(capAgent*(fin-debut))));
      const agOpt=Math.max(agMin,Math.ceil(fp/(capAgent*(fin-debut)*0.8)));
      const bp=Math.round((fp/maxF)*100);
      const NIV=[{s:0,l:'Faible',c:'#16a34a',bg:'#dcfce7'},{s:8,l:'Modéré',c:'#FFC300',bg:'#fff8e1'},{s:20,l:'Élevé',c:'#d97706',bg:'#fef9c3'},{s:35,l:'Critique',c:'#dc2626',bg:'#fee2e2'}];
      const niv=[...NIV].reverse().find(function(n){return fp>=n.s})||NIV[0];
      const isCur=hNow>=debut&&hNow<fin;
      const cov=nbAgents>=agOpt?{ico:'✅',txt:'Couvert',c:'#16a34a'}:nbAgents>=agMin?{ico:'⚠️',txt:'Limite',c:'#d97706'}:{ico:'🚨',txt:'Insuffisant',c:'#dc2626'};
      const act=nbAgents<agMin?'Mobiliser '+(agMin-nbAgents)+' agent(s) supplémentaire(s)':nbAgents<agOpt?'Surveiller — renfort en standby':nbAgents>agOpt+2?'Effectif excédentaire — former/repos':'Maintenir la configuration';
      return '<tr style="background:'+(isCur?'#fff8e1':'')+';border-left:'+(isCur?'3px solid #FFC300':'3px solid transparent')+'">'
        +'<td style="padding:8px 12px;font-weight:'+(isCur?800:500)+';color:'+(isCur?'#FFC300':'#1A1A1A')+'">'+debut+'h–'+fin+'h '+(isCur?'<span style="font-size:9px;background:#FFC300;color:#1A1A1A;border-radius:5px;padding:1px 6px;margin-left:4px">● EN COURS</span>':'')+'</td>'
        +'<td style="padding:8px 12px;text-align:center;font-weight:700">'+fp+'</td>'
        +'<td style="padding:8px 12px;text-align:center;color:#6b7280">'+agMin+'</td>'
        +'<td style="padding:8px 12px;text-align:center;font-weight:800;font-size:14px">'+agOpt+'</td>'
        +'<td style="padding:8px 12px"><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden"><div style="height:100%;width:'+bp+'%;background:'+niv.c+';border-radius:3px"></div></div><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;background:'+niv.bg+';color:'+niv.c+';white-space:nowrap">'+niv.l+'</span></div></td>'
        +'<td style="padding:8px 12px;text-align:center"><span style="font-size:11px;font-weight:700;color:'+cov.c+'">'+cov.ico+' '+cov.txt+'</span></td>'
        +'<td style="padding:8px 12px;font-size:11px;color:#374151">'+act+'</td>'
        +'</tr>';
    }).join('');
  }

  fluxRenderParJour(liste, capAgent, nbAgents);
  fluxRenderParSemaine(liste, capAgent, nbAgents);
}

function fluxRenderParJour(liste, capAgent, nbAgents){
  const JOURS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
  const today = new Date();
  const todayDow = (today.getDay() + 6) % 7;
  const totaux = Array(7).fill(0);
  const cnts   = Array(7).fill(0);
  const parHeure = Array.from({length:7}, () => Array(24).fill(0));
  const todayStr = today.toISOString().split('T')[0];
  liste.forEach(d => {
    if (!d.created_at) return;
    const dt = new Date(d.created_at * 1000);
    const ds = dt.toISOString().split('T')[0];
    if (ds >= todayStr) return;
    const dow = (dt.getDay() + 6) % 7;
    totaux[dow] += 1;
    parHeure[dow][dt.getHours()]++;
  });
  const dates = new Set(liste.filter(d=>d.created_at).map(d=>new Date(d.created_at*1000).toISOString().split('T')[0]).filter(d=>d<todayStr));
  dates.forEach(ds => { const dt=new Date(ds); cnts[(dt.getDay()+6)%7]++; });
  const maxVol = Math.max.apply(null, totaux.map((t,i) => cnts[i]>0 ? t/cnts[i] : 0).concat([1]));
  const NIV = [{s:0,l:'Léger',c:'#16a34a',bg:'#dcfce7'},{s:10,l:'Modéré',c:'#FFC300',bg:'#fff8e1'},{s:25,l:'Chargé',c:'#d97706',bg:'#fef9c3'},{s:45,l:'Intense',c:'#dc2626',bg:'#fee2e2'}];
  const getNiv = v => [...NIV].reverse().find(n=>v>=n.s)||NIV[0];
  const tb = document.getElementById('flux-tbody-day');
  if (!tb) return;
  tb.innerHTML = JOURS.map((jour, dow) => {
    const moy   = cnts[dow] > 0 ? +(totaux[dow]/cnts[dow]).toFixed(1) : 0;
    const agMin = Math.max(1, Math.ceil(moy / (capAgent * 8)));
    const agOpt = Math.max(agMin, Math.ceil(moy / (capAgent * 8 * 0.8)));
    const bp    = Math.round((moy / maxVol) * 100);
    const niv   = getNiv(moy);
    const isToday = dow === todayDow;
    const heures = parHeure[dow];
    const picH   = heures.indexOf(Math.max.apply(null, heures));
    const picVal = cnts[dow]>0 ? Math.round(heures[picH]/cnts[dow]) : 0;
    let profil = '';
    if (moy === 0)          profil = '⬜ Pas de données';
    else if (dow === 6)     profil = '🌙 Activité réduite';
    else if (dow === 5)     profil = '📉 Samedi — flux faible';
    else if (moy >= maxVol*0.85) profil = '🔥 Jour de pic';
    else if (moy >= maxVol*0.6)  profil = '⚡ Jour chargé';
    else                         profil = '✅ Journée normale';
    const bgRow = isToday ? '#fff8e1' : '';
    const borderL = isToday ? '3px solid #FFC300' : '3px solid transparent';
    return '<tr style="background:'+bgRow+';border-left:'+borderL+'">'
      +'<td style="padding:8px 12px;font-weight:'+(isToday?800:600)+';color:'+(isToday?'#FFC300':'#1A1A1A')+'">'+jour+(isToday?' <span style="font-size:9px;background:#FFC300;color:#1A1A1A;border-radius:5px;padding:1px 6px;margin-left:4px">● AUJOURD\'HUI</span>':'')+'</td>'
      +'<td style="padding:8px 12px;text-align:center"><div style="display:flex;align-items:center;gap:6px;justify-content:center"><div style="width:60px;height:5px;background:#f0f0f0;border-radius:3px;overflow:hidden"><div style="height:100%;width:'+bp+'%;background:'+niv.c+';border-radius:3px"></div></div><strong style="color:'+niv.c+'">'+(moy>0?moy:'–')+'</strong></div></td>'
      +'<td style="padding:8px 12px;text-align:center;color:#6b7280">'+(picVal>0?picH+'h (~'+picVal+')':'–')+'</td>'
      +'<td style="padding:8px 12px;text-align:center;color:#6b7280;font-weight:600">'+(moy>0?agMin:'–')+'</td>'
      +'<td style="padding:8px 12px;text-align:center;font-weight:800;font-size:14px;color:#1A1A1A">'+(moy>0?agOpt:'–')+'</td>'
      +'<td style="padding:8px 12px"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;background:'+niv.bg+';color:'+niv.c+'">'+niv.l+'</span></td>'
      +'<td style="padding:8px 12px;font-size:11px;color:#374151">'+profil+'</td>'
      +'</tr>';
  }).join('');
}

function fluxRenderParSemaine(liste, capAgent, nbAgents){
  const today   = new Date();
  const dowToday = (today.getDay() + 6) % 7;
  const lundiCourant = new Date(today);
  lundiCourant.setDate(today.getDate() - dowToday);
  lundiCourant.setHours(0,0,0,0);
  const semaines = [];
  for (let s = 0; s < 5; s++) {
    const lundi  = new Date(lundiCourant);
    lundi.setDate(lundiCourant.getDate() - s * 7);
    const dimanche = new Date(lundi);
    dimanche.setDate(lundi.getDate() + 6);
    semaines.push({ lundi:lundi, dimanche:dimanche, isCurrent: s === 0 });
  }
  const data = semaines.map(function(sm){
    const lundi=sm.lundi,dimanche=sm.dimanche,isCurrent=sm.isCurrent;
    const lundiStr   = lundi.toISOString().split('T')[0];
    const dimStr     = dimanche.toISOString().split('T')[0];
    const dossiersSem = liste.filter(function(d){
      if (!d.created_at) return false;
      const ds = new Date(d.created_at*1000).toISOString().split('T')[0];
      return ds >= lundiStr && ds <= dimStr;
    });
    const parJour = {};
    dossiersSem.forEach(function(d){
      const ds = new Date(d.created_at*1000).toISOString().split('T')[0];
      parJour[ds] = (parJour[ds]||0) + 1;
    });
    const vols = Object.values(parJour);
    const total  = dossiersSem.length;
    const nbJours = Object.keys(parJour).length || 1;
    const moyJour = +(total / nbJours).toFixed(1);
    const picJour = vols.length ? Math.max.apply(null,vols) : 0;
    const agMin = Math.max(1, Math.ceil(moyJour / (capAgent * 8)));
    const agOpt = Math.max(agMin, Math.ceil(moyJour / (capAgent * 8 * 0.8)));
    const fmt = function(d){return d.getDate()+'/'+(d.getMonth()+1)};
    const periode = fmt(lundi)+' – '+fmt(dimanche);
    return { periode:periode, total:total, moyJour:moyJour, picJour:picJour, agMin:agMin, agOpt:agOpt, isCurrent:isCurrent, nbJours:nbJours };
  });
  const tb = document.getElementById('flux-tbody-semaine');
  if (!tb) return;
  const NIV = [{s:0,l:'Faible',c:'#16a34a',bg:'#dcfce7'},{s:50,l:'Normale',c:'#FFC300',bg:'#fff8e1'},{s:150,l:'Chargée',c:'#d97706',bg:'#fef9c3'},{s:300,l:'Intense',c:'#dc2626',bg:'#fee2e2'}];
  const getNiv = v => [...NIV].reverse().find(n=>v>=n.s)||NIV[0];
  tb.innerHTML = data.map(function(sem, idx){
    const prev = data[idx+1];
    const vsS1 = prev && prev.total > 0 ? Math.round(((sem.total - prev.total) / prev.total) * 100) : null;
    const vsIco  = vsS1===null ? '–' : vsS1>10 ? '📈 +'+vsS1+'%' : vsS1<-10 ? '📉 '+vsS1+'%' : '→ stable';
    const vsCol  = vsS1===null ? '#6b7280' : vsS1>10 ? '#dc2626' : vsS1<-10 ? '#16a34a' : '#6b7280';
    const niv    = getNiv(sem.total);
    const bgRow  = sem.isCurrent ? '#fff8e1' : idx%2===0 ? '#fafafa' : '#fff';
    const borderL = sem.isCurrent ? '3px solid #FFC300' : '3px solid transparent';
    let reco = '';
    if (sem.total === 0)              reco = 'Pas de données pour cette semaine';
    else if (vsS1 !== null && vsS1 > 20)  reco = 'Flux en forte hausse — renforcer l\'équipe';
    else if (vsS1 !== null && vsS1 < -20) reco = 'Flux en baisse — possible rotation/formation';
    else if (sem.agOpt > nbAgents)    reco = 'Prévoir '+(sem.agOpt-nbAgents)+' agent(s) supplémentaire(s)';
    else if (sem.agOpt < nbAgents-2)  reco = 'Effectif surdimensionné — optimiser les plannings';
    else                              reco = 'Effectif adapté — maintenir la configuration';
    const sLabel = idx === 0 ? 'Semaine actuelle ●' : 'Semaine S-'+idx;
    return '<tr style="background:'+bgRow+';border-left:'+borderL+'">'
      +'<td style="padding:8px 12px;font-weight:'+(sem.isCurrent?800:600)+';color:'+(sem.isCurrent?'#FFC300':'#1A1A1A')+'"><div style="font-weight:700">'+sLabel+'</div><div style="font-size:10px;color:var(--muted);margin-top:2px">'+sem.periode+'</div></td>'
      +'<td style="padding:8px 12px;text-align:center"><strong style="font-size:15px;color:'+niv.c+'">'+sem.total+'</strong><div style="font-size:9px;color:var(--muted)">'+sem.nbJours+'j actifs</div></td>'
      +'<td style="padding:8px 12px;text-align:center;font-weight:600;color:#1A1A1A">'+(sem.moyJour>0?sem.moyJour:'–')+'</td>'
      +'<td style="padding:8px 12px;text-align:center"><span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:8px;background:'+niv.bg+';color:'+niv.c+'">'+(sem.picJour>0?sem.picJour:'–')+'</span></td>'
      +'<td style="padding:8px 12px;text-align:center;color:#6b7280;font-weight:600">'+(sem.total>0?sem.agMin:'–')+'</td>'
      +'<td style="padding:8px 12px;text-align:center;font-weight:800;font-size:14px;color:#1A1A1A">'+(sem.total>0?sem.agOpt:'–')+'</td>'
      +'<td style="padding:8px 12px;text-align:center;font-weight:700;color:'+vsCol+'">'+vsIco+'</td>'
      +'<td style="padding:8px 12px;font-size:11px;color:#374151">'+reco+'</td>'
      +'</tr>';
  }).join('');
  const cur = data[0];
  const resume = document.getElementById('flux-semaine-resume');
  const resumeTxt = document.getElementById('flux-semaine-resume-txt');
  if (resume && resumeTxt && cur.total > 0) {
    const prev = data[1];
    const trend = prev && prev.total > 0 ? Math.round(((cur.total-prev.total)/prev.total)*100) : null;
    const trendTxt = trend===null ? '' : trend>0 ? ' (↑ +'+trend+'% vs semaine précédente)' : trend<0 ? ' (↓ '+trend+'% vs semaine précédente)' : ' (stable vs semaine précédente)';
    resumeTxt.innerHTML = '<span style="display:inline-block;margin-right:16px">📦 <strong>'+cur.total+'</strong> dossiers traités'+trendTxt+'</span><br>'
      +'<span style="display:inline-block;margin-right:16px;margin-top:4px">📅 Moyenne : <strong>'+cur.moyJour+'/jour</strong> sur '+cur.nbJours+' jour(s)</span>'
      +'<span style="display:inline-block;margin-right:16px">🔝 Pic journalier : <strong>'+cur.picJour+'</strong></span><br>'
      +'<span style="display:inline-block;margin-top:4px">👥 Effectif recommandé : <strong>'+cur.agMin+' min</strong> — <strong>'+cur.agOpt+' optimal</strong> pour cette semaine</span>';
    resume.style.display = 'block';
  } else if (resume) {
    resume.style.display = 'none';
  }
}

// ── Chargement initial : API ────────────────────────────────
async function initFlux(){
  const t = sessionStorage.getItem('kyc_token');
  if(!t){ window.location.href='/login'; return; }
  const pad=n=>String(n).padStart(2,'0');
  const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const now=new Date();
  const d60=new Date(now); d60.setDate(d60.getDate()-60);
  try{
    const r=await fetch('/api/dossiers?debut='+ymd(d60)+'&fin='+ymd(now),{headers:{'Authorization':'Bearer '+t}});
    if(r.status===401){ window.location.href='/login'; return; }
    if(r.ok){ const d=await r.json(); FLUX_DATA=d.dossiers||[]; }
  }catch(e){ console.error('flux dossiers',e); }
  try{
    const rp=await fetch('/api/presence/resume',{headers:{'Authorization':'Bearer '+t}});
    if(rp.ok){ const dp=await rp.json(); FLUX_AGENTS=Math.max((dp.en_ligne||0)+(dp.en_pause||0),1); }
  }catch(e){ console.error('flux presence',e); }
  chargerFlux();
}