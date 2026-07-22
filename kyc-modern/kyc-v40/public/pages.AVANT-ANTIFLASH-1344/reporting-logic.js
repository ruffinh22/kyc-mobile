// ============================================================================
// KYC V3 - Logique Reporting (exports Excel) - reproduite de la V1
// Données : GET /api/dossiers (dossiers) + GET /api/gsm/compilation (GSM)
// ============================================================================
'use strict';
let REP_TOAST_TIMER=null;
function repToast(msg,type){
  const el=document.getElementById('rep-toast');
  if(!el)return;
  el.textContent=msg;
  el.style.background=type==='er'?'#dc2626':'#16a34a';
  el.style.display='block';
  if(REP_TOAST_TIMER)clearTimeout(REP_TOAST_TIMER);
  REP_TOAST_TIMER=setTimeout(()=>{el.style.display='none'},3000);
}
function repToken(){return sessionStorage.getItem('kyc_token');}

// Charge les dossiers d'une plage via API
async function repGetDossiers(debut,fin){
  const r=await fetch('/api/dossiers?debut='+debut+'&fin='+fin,{headers:{'Authorization':'Bearer '+repToken()}});
  if(r.status===401){window.location.href='/login';return[];}
  if(!r.ok)return[];
  const d=await r.json();return d.dossiers||[];
}
// Charge les GSM d'une plage via API
async function repGetGSM(debut,fin){
  const r=await fetch('/api/gsm/compilation?debut='+debut+'&fin='+fin,{headers:{'Authorization':'Bearer '+repToken()}});
  if(!r.ok)return[];
  const d=await r.json();return d.saisies||[];
}

function repFmtDuree(ms){
  const s=Math.round(ms/1000);
  if(s<60)return s+'s';
  const m=Math.floor(s/60);
  if(m<60)return m+'min '+(s%60)+'s';
  return Math.floor(m/60)+'h '+(m%60)+'min';
}
function repWaiting(d){
  if(d.created_at&&d.heure_prise){
    const dC=new Date(d.created_at*1000);
    const minC=dC.getHours()*60+dC.getMinutes();
    const p=d.heure_prise.split(':');
    const minP=parseInt(p[0],10)*60+parseInt(p[1],10);
    let diff=minP-minC; if(diff<0)diff+=1440;
    if(diff>=0&&diff<1440)return diff<60?diff+' min':Math.floor(diff/60)+'h '+(diff%60)+'min';
  }
  return '—';
}
function repProc(d){
  if(d.created_at&&d.closed_at){
    const s=d.closed_at-d.created_at;
    return s<60?s+'s':Math.floor(s/60)+'min '+(s%60)+'s';
  }
  return '—';
}
function repWaitMin(d){
  if(d.created_at&&d.heure_prise){
    const dC=new Date(d.created_at*1000);
    const p=d.heure_prise.split(':');
    const w=(parseInt(p[0],10)*60+parseInt(p[1],10))-(dC.getHours()*60+dC.getMinutes());
    if(w>=0&&w<1440)return w;
  }
  return null;
}
function repProcMin(d){
  if(d.heure_reception&&d.heure_cloture){
    const pr=d.heure_reception.split(':'),pc=d.heure_cloture.split(':');
    const p=Math.abs((parseInt(pc[0],10)*60+parseInt(pc[1],10))-(parseInt(pr[0],10)*60+parseInt(pr[1],10)));
    if(p>=0&&p<1440)return p;
  }
  return null;
}
function repMoy(a){if(!a||!a.length)return '-';const s=a.reduce((x,y)=>x+y,0);return Math.round(s/a.length)+' min';}
function repNbCapt(d){return ['capture_a','capture_p','capture_aa'].filter(k=>d[k]).length;}

// ── Période ──────────────────────────────────────────────────
function repMajLabel(){
  const debut=document.getElementById('rep-date-debut').value;
  const fin=document.getElementById('rep-date-fin').value;
  const el=document.getElementById('rep-periode-label');
  if(!el)return;
  if(debut&&fin){
    const f=v=>{const p=v.split('-');return p[2]+'/'+p[1]+'/'+p[0];};
    el.style.display='block';
    el.innerHTML=debut===fin?'📅 Journée du <strong style="color:#d97706">'+f(debut)+'</strong>':'📅 Du <strong style="color:#d97706">'+f(debut)+'</strong> → <strong style="color:#d97706">'+f(fin)+'</strong>';
  }else{el.style.display='none';}
}
function setRepPeriode(type){
  const today=new Date();
  const pad=n=>String(n).padStart(2,'0');
  const fmt=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  let debut,fin;
  if(type==='today'){debut=fin=fmt(today);}
  else if(type==='week'){const dow=today.getDay()===0?6:today.getDay()-1;const l=new Date(today);l.setDate(today.getDate()-dow);const di=new Date(l);di.setDate(l.getDate()+6);debut=fmt(l);fin=fmt(di);}
  else if(type==='month'){debut=fmt(new Date(today.getFullYear(),today.getMonth(),1));fin=fmt(new Date(today.getFullYear(),today.getMonth()+1,0));}
  document.getElementById('rep-date-debut').value=debut;
  document.getElementById('rep-date-fin').value=fin;
  repMajLabel();
}

// ── Dispatcher ───────────────────────────────────────────────
async function exporterReporting(quoi){
  const debut=document.getElementById('rep-date-debut').value;
  const fin=document.getElementById('rep-date-fin').value;
  if(!debut||!fin){repToast('⚠ Sélectionnez une période.','er');return;}
  if(debut>fin){repToast('⚠ La date de début doit être avant la fin.','er');return;}
  if(quoi==='heures_agents'){repToast('⏳ Rapport "Heures agents" bientôt disponible.','er');return;}
  try{
    if(quoi==='dossiers'||quoi==='gsm'||quoi==='tout') await exportHistoGsm(quoi,debut,fin);
    else if(quoi==='prod_agent') await exportProdAgent(debut,fin);
    else if(quoi==='prod_global') await exportProdGlobal(debut,fin);
    else if(quoi==='rejets_acceptations') await exportRejets(debut,fin);
    else if(quoi==='traitement_heure') await exportTraitementHeure(debut,fin);
    else if(quoi==='aafo_username') await exportAAFO('username',debut,fin);
    else if(quoi==='aafo_zone') await exportAAFO('zone',debut,fin);
    else if(quoi==='aafo_fonction') await exportAAFO('fonction',debut,fin);
  }catch(err){console.error(err);repToast('✗ Erreur export : '+err.message,'er');}
}

// ── Historique / GSM / Tout ──────────────────────────────────
async function exportHistoGsm(quoi,debut,fin){
  const periode=debut+' au '+fin;
  const dossiers=(quoi==='dossiers'||quoi==='tout')?await repGetDossiers(debut,fin):[];
  const gsm=(quoi==='gsm'||quoi==='tout')?await repGetGSM(debut,fin):[];
  const wb=XLSX.utils.book_new();
  if(quoi==='dossiers'||quoi==='tout'){
    if(dossiers.length===0&&quoi==='dossiers'){repToast('⚠ Aucun dossier sur cette période ('+periode+')','er');return;}
    if(dossiers.length>0){
      const data=[['ID','Numéro MTN','Tous numéros','Agent WA','Date','Heure Réception','Heure Prise','Heure Clôture','Statut','Agent de saisie','Waiting Time','Processing Time','Motif Rejet','CRM']];
      dossiers.forEach(d=>{
        const motif=(d.statut==='rejete')?(d.raison_rejet||'Non précisé'):'';
        let tous=d.numero_mtn||'';
        try{if(d.numeros_all){const a=Array.isArray(d.numeros_all)?d.numeros_all:JSON.parse(d.numeros_all);if(a&&a.length)tous=a.join(' / ');}}catch(e){}
        data.push([d.id||'',d.numero_mtn||'',tous,d.wa_agent||'',d.created_at?new Date(d.created_at*1000).toLocaleDateString('fr-FR'):'',d.heure_reception||'',d.heure_prise||'',d.heure_cloture||'',d.statut||'',d.agent_saisie||'',repWaiting(d),repProc(d),motif,d.resultat_crm||'']);
      });
      const ws=XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb,ws,'Dossiers MTN');
    }
  }
  if(quoi==='gsm'||quoi==='tout'){
    if(gsm.length===0&&quoi==='gsm'){repToast('⚠ Aucune ligne GSM sur cette période ('+periode+')','er');return;}
    if(gsm.length>0){
      const data=[['Agent','Numéro','Date','Coach Mobile','Constat Webcare','Type Pièce','Verbatim','Action Prise GSM','Statut Final','Traitement','Type ID','Raison Retard','Nb Captures']];
      gsm.forEach(d=>data.push([d.agent_ctrl||'',d.numero||'',d.date_saisie||'',d.coach||'',d.constat||'',d.piece||'',d.verbatim||'',d.action||'',d.statut_final||'',d.traitement||'',d.type_id||'',d.raison||'',repNbCapt(d)]));
      const ws=XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb,ws,'GROSS-ADD GSM');
    }
  }
  if(!wb.SheetNames.length){repToast('⚠ Aucune donnée à exporter ('+periode+')','er');return;}
  // Résumé
  const nbAcc=dossiers.filter(d=>d.statut==='accepte').length;
  const nbRej=dossiers.filter(d=>d.statut==='rejete').length;
  const nbGsmAcc=gsm.filter(d=>d.action==='Accepté'||d.action==='Edité et Accepté').length;
  const resume=[["RAPPORT D'ACTIVITÉ — "+periode],[''],['DOSSIERS MTN',''],['Total dossiers',dossiers.length],['Acceptés',nbAcc],['Rejetés',nbRej],['Taux acceptation',dossiers.length?Math.round(nbAcc/dossiers.length*100)+'%':'—'],[''],['GROSS-ADD GSM',''],['Total lignes GSM',gsm.length],['Acceptés GSM',nbGsmAcc],['Taux acceptation GSM',gsm.length?Math.round(nbGsmAcc/gsm.length*100)+'%':'—']];
  const wsR=XLSX.utils.aoa_to_sheet(resume);
  wsR['!cols']=[{wch:30},{wch:15}];
  XLSX.utils.book_append_sheet(wb,wsR,'Résumé');
  wb.SheetNames=['Résumé',...wb.SheetNames.filter(s=>s!=='Résumé')];
  let fn;
  if(quoi==='dossiers')fn='HISTORIQUE_'+debut+'_au_'+fin+'.xlsx';
  else if(quoi==='gsm')fn='COMPILATION_GSM_'+debut+'_au_'+fin+'.xlsx';
  else fn='RAPPORT_COMPLET_'+debut+'_au_'+fin+'.xlsx';
  XLSX.writeFile(wb,fn);
  repToast('✅ Export réussi — '+(dossiers.length+gsm.length)+' ligne(s)','ok');
}

// ── AAFO Username / Zone / Fonction ──────────────────────────
async function exportAAFO(mode,debut,fin){
  const tous=await repGetDossiers(debut,fin);
  const champ=mode==='username'?'username_agent':mode==='zone'?'zone_agent':'fonction_agent';
  const liste=tous.filter(d=>d[champ]);
  if(liste.length===0){repToast('Aucun dossier avec '+mode+' dans la période','er');return;}
  const par={};
  liste.forEach(d=>{
    const k=d[champ];
    if(!par[k])par[k]={cle:k,fonction:d.fonction_agent||'-',zone:d.zone_agent||'-',agents:new Set(),recus:0,acceptes:0,rejetes:0,en_cours:0,en_attente:0,waits:[],procs:[]};
    par[k].recus++;
    if(d.username_agent)par[k].agents.add(d.username_agent);
    if(d.statut==='accepte')par[k].acceptes++;
    else if(d.statut==='rejete')par[k].rejetes++;
    else if(d.statut==='en_cours')par[k].en_cours++;
    else if(d.statut==='en_attente')par[k].en_attente++;
    const w=repWaitMin(d);if(w!==null)par[k].waits.push(w);
    const p=repProcMin(d);if(p!==null)par[k].procs.push(p);
  });
  const rows=Object.values(par).sort((a,b)=>b.recus-a.recus);
  const wb=XLSX.utils.book_new();
  let data,nomFeuille,fn;
  if(mode==='username'){
    data=[['Username','Fonction','Zone','Recus','Acceptes','Rejetes','En cours','En attente','Attente moy.','Traitement moy.','Taux acceptation']];
    rows.forEach(r=>{const t=r.acceptes+r.rejetes;data.push([r.cle,r.fonction,r.zone,r.recus,r.acceptes,r.rejetes,r.en_cours,r.en_attente,repMoy(r.waits),repMoy(r.procs),t>0?Math.round(r.acceptes/t*100)+'%':'-']);});
    nomFeuille='Par Username';fn='aafo_par_username_'+debut+'_au_'+fin+'.xlsx';
  }else{
    const libelle=mode==='zone'?'Zone':'Fonction';
    data=[[libelle,'Nb agents','Recus','Acceptes','Rejetes','En cours','En attente','Attente moy.','Traitement moy.','Taux acceptation']];
    rows.forEach(r=>{const t=r.acceptes+r.rejetes;data.push([r.cle,r.agents.size,r.recus,r.acceptes,r.rejetes,r.en_cours,r.en_attente,repMoy(r.waits),repMoy(r.procs),t>0?Math.round(r.acceptes/t*100)+'%':'-']);});
    nomFeuille='Par '+libelle;fn='aafo_par_'+mode+'_'+debut+'_au_'+fin+'.xlsx';
  }
  const ws=XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb,ws,nomFeuille);
  XLSX.writeFile(wb,fn);
  repToast('✅ Rapport exporté ('+rows.length+' lignes)','ok');
}

// ── Traitement par heure ─────────────────────────────────────
async function exportTraitementHeure(debut,fin){
  const dossiers=await repGetDossiers(debut,fin);
  if(dossiers.length===0){repToast('Aucun dossier dans la période','er');return;}
  const par={};
  dossiers.forEach(d=>{
    if(!d.created_at)return;
    const dt=new Date(d.created_at*1000);
    const date=dt.toISOString().slice(0,10);
    const heure=String(dt.getHours()).padStart(2,'0')+'h';
    const key=date+'|'+heure;
    if(!par[key])par[key]={date:date,heure:heure,recus:0,acceptes:0,rejetes:0,en_cours:0,en_attente:0};
    par[key].recus++;
    if(d.statut==='accepte')par[key].acceptes++;
    else if(d.statut==='rejete')par[key].rejetes++;
    else if(d.statut==='en_cours')par[key].en_cours++;
    else if(d.statut==='en_attente')par[key].en_attente++;
  });
  const rows=Object.values(par).sort((a,b)=>a.date!==b.date?a.date.localeCompare(b.date):a.heure.localeCompare(b.heure));
  const data=[['Date','Heure','Recus','Acceptes','Rejetes','En cours','En attente','Taux acceptation']];
  rows.forEach(r=>{const t=r.acceptes+r.rejetes;data.push([r.date,r.heure,r.recus,r.acceptes,r.rejetes,r.en_cours,r.en_attente,t>0?Math.round(r.acceptes/t*100)+'%':'-']);});
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb,ws,'Traitement par heure');
  XLSX.writeFile(wb,'traitement_par_heure_'+debut+'_au_'+fin+'.xlsx');
  repToast('✅ Rapport exporté ('+rows.length+' lignes)','ok');
}

// ── Production par agent ─────────────────────────────────────
async function exportProdAgent(debut,fin){
  const dossiers=await repGetDossiers(debut,fin);
  const par={};
  dossiers.forEach(d=>{
    const a=d.agent_saisie||'(non assigné)';
    if(!par[a])par[a]={total:0,acceptes:0,rejetes:0,en_cours:0,en_attente:0,temps_total:0,nb_temps:0};
    par[a].total++;
    if(d.statut==='accepte')par[a].acceptes++;
    if(d.statut==='rejete')par[a].rejetes++;
    if(d.statut==='en_cours')par[a].en_cours++;
    if(d.statut==='en_attente')par[a].en_attente++;
    if(d.created_at&&d.closed_at){par[a].temps_total+=(d.closed_at-d.created_at);par[a].nb_temps++;}
  });
  const rows=[['Agent','Total dossiers','Acceptés','Rejetés','En cours','En attente','Taux acceptation','Taux rejet','Temps moyen traitement']];
  Object.entries(par).sort((a,b)=>b[1].total-a[1].total).forEach(([nom,s])=>{
    rows.push([nom,s.total,s.acceptes,s.rejetes,s.en_cours,s.en_attente,s.total?Math.round(s.acceptes/s.total*100)+'%':'0%',s.total?Math.round(s.rejetes/s.total*100)+'%':'0%',s.nb_temps?repFmtDuree(s.temps_total/s.nb_temps*1000):'—']);
  });
  const tot={total:0,acc:0,rej:0,ec:0,ea:0};
  Object.values(par).forEach(s=>{tot.total+=s.total;tot.acc+=s.acceptes;tot.rej+=s.rejetes;tot.ec+=s.en_cours;tot.ea+=s.en_attente;});
  rows.push(['TOTAL',tot.total,tot.acc,tot.rej,tot.ec,tot.ea,tot.total?Math.round(tot.acc/tot.total*100)+'%':'0%',tot.total?Math.round(tot.rej/tot.total*100)+'%':'0%','—']);
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb,ws,'Production par agent');
  XLSX.writeFile(wb,'rapport_production_agent_'+debut+'_'+fin+'.xlsx');
  repToast('✅ Rapport production par agent exporté','ok');
}

// ── Production globale ───────────────────────────────────────
async function exportProdGlobal(debut,fin){
  const dossiers=await repGetDossiers(debut,fin);
  const periode=debut+' au '+fin;
  const total=dossiers.length;
  const acc=dossiers.filter(d=>d.statut==='accepte').length;
  const rej=dossiers.filter(d=>d.statut==='rejete').length;
  const ec=dossiers.filter(d=>d.statut==='en_cours').length;
  const ea=dossiers.filter(d=>d.statut==='en_attente').length;
  const vals=dossiers.filter(d=>d.created_at&&d.closed_at).map(d=>d.closed_at-d.created_at);
  const tpsMoy=vals.length?repFmtDuree(vals.reduce((a,b)=>a+b,0)/vals.length*1000):'—';
  const wb=XLSX.utils.book_new();
  const wsKpi=XLSX.utils.aoa_to_sheet([['Indicateur','Valeur'],['Période',periode],['Total dossiers',total],['Acceptés',acc],['Rejetés',rej],['En cours',ec],['En attente',ea],['Taux acceptation',total?Math.round(acc/total*100)+'%':'0%'],['Taux rejet',total?Math.round(rej/total*100)+'%':'0%'],['Temps moyen traitement',tpsMoy]]);
  XLSX.utils.book_append_sheet(wb,wsKpi,'KPIs globaux');
  const parJour={};
  dossiers.forEach(d=>{if(!d.created_at)return;const j=new Date(d.created_at*1000).toLocaleDateString('fr-FR');if(!parJour[j])parJour[j]={total:0,acc:0,rej:0};parJour[j].total++;if(d.statut==='accepte')parJour[j].acc++;if(d.statut==='rejete')parJour[j].rej++;});
  const rowsJour=[['Date','Total','Acceptés','Rejetés','Taux acceptation']];
  Object.entries(parJour).forEach(([j,s])=>rowsJour.push([j,s.total,s.acc,s.rej,s.total?Math.round(s.acc/s.total*100)+'%':'0%']));
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rowsJour),'Production par jour');
  const parHeure={};
  for(let h=0;h<24;h++)parHeure[h]={total:0,acc:0,rej:0};
  dossiers.forEach(d=>{if(!d.created_at)return;const h=new Date(d.created_at*1000).getHours();parHeure[h].total++;if(d.statut==='accepte')parHeure[h].acc++;if(d.statut==='rejete')parHeure[h].rej++;});
  const rowsH=[['Heure','Total','Acceptés','Rejetés']];
  for(let h=0;h<24;h++)rowsH.push([h+'h00',parHeure[h].total,parHeure[h].acc,parHeure[h].rej]);
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rowsH),'Production par heure');
  XLSX.writeFile(wb,'rapport_production_globale_'+debut+'_'+fin+'.xlsx');
  repToast('✅ Rapport production globale exporté','ok');
}

// ── Rejets & Acceptations ────────────────────────────────────
async function exportRejets(debut,fin){
  const dossiers=await repGetDossiers(debut,fin);
  const par={};
  dossiers.forEach(d=>{
    const a=d.agent_saisie||'(non assigné)';
    if(!par[a])par[a]={acceptes:0,rejetes:0,raisons:{}};
    if(d.statut==='accepte')par[a].acceptes++;
    if(d.statut==='rejete'){par[a].rejetes++;const r=d.raison_rejet||d.resultat_crm||'Non spécifiée';par[a].raisons[r]=(par[a].raisons[r]||0)+1;}
  });
  const wb=XLSX.utils.book_new();
  const rowsResume=[['Agent','Acceptés','Rejetés','Total','Taux acceptation','Taux rejet']];
  Object.entries(par).sort((a,b)=>(b[1].acceptes+b[1].rejetes)-(a[1].acceptes+a[1].rejetes)).forEach(([nom,s])=>{const t=s.acceptes+s.rejetes;rowsResume.push([nom,s.acceptes,s.rejetes,t,t?Math.round(s.acceptes/t*100)+'%':'0%',t?Math.round(s.rejetes/t*100)+'%':'0%']);});
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rowsResume),'Résumé');
  const toutes={};
  dossiers.filter(d=>d.statut==='rejete').forEach(d=>{const r=d.raison_rejet||d.resultat_crm||'Non spécifiée';toutes[r]=(toutes[r]||0)+1;});
  const totRej=dossiers.filter(d=>d.statut==='rejete').length;
  const rowsRaisons=[['Raison de rejet','Nombre','%']];
  Object.entries(toutes).sort((a,b)=>b[1]-a[1]).forEach(([r,n])=>rowsRaisons.push([r,n,totRej?Math.round(n/totRej*100)+'%':'0%']));
  if(rowsRaisons.length===1)rowsRaisons.push(['Aucun rejet sur la période','0','0%']);
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rowsRaisons),'Raisons de rejet');
  const rowsDetail=[['Agent','Raison de rejet','Nombre']];
  Object.entries(par).forEach(([nom,s])=>{Object.entries(s.raisons).sort((a,b)=>b[1]-a[1]).forEach(([r,n])=>rowsDetail.push([nom,r,n]));});
  if(rowsDetail.length===1)rowsDetail.push(['Aucun rejet','—','0']);
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rowsDetail),'Rejets par agent');
  XLSX.writeFile(wb,'rapport_rejets_acceptations_'+debut+'_'+fin+'.xlsx');
  repToast('✅ Rapport rejets & acceptations exporté','ok');
}

function initReporting(){ setRepPeriode('today'); }