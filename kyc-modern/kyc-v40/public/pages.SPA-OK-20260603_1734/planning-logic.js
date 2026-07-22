// ============================================================================
// KYC V3 - Logique Import Planning (parsing Excel V1 + envoi backend)
// ============================================================================
'use strict';
function plToken(){return sessionStorage.getItem('kyc_token');}
function plStatus(msg,type){
  const el=document.getElementById('pl-status');
  if(!el)return;
  el.style.display='block';el.textContent=msg;
  if(type==='ok'){el.style.background='#d1e7dd';el.style.color='#0f5132';el.style.border='1px solid #badbcc';}
  else{el.style.background='#f8d7da';el.style.color='#842029';el.style.border='1px solid #f5c2c7';}
}

function plImporter(){
  const file=document.getElementById('pl-file').files[0];
  if(!file){plStatus('Sélectionnez un fichier Excel','er');return;}
  if(typeof XLSX==='undefined'){plStatus('Librairie XLSX non chargée','er');return;}
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      const data=new Uint8Array(e.target.result);
      const wb=XLSX.read(data,{type:'array',cellDates:true});
      // Trouver la feuille planning
      let candidats=wb.SheetNames.filter(function(sn){return /^PLANNING\s/i.test(sn.trim())&&!/LEGENDE|CRITERES|HEBDO/i.test(sn);});
      if(candidats.length===0)candidats=[wb.SheetNames[0]];
      const sheetName=candidats[candidats.length-1];
      const ws=wb.Sheets[sheetName];
      const aoa=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
      if(aoa.length<5){plStatus('Feuille "'+sheetName+'" vide ou format invalide','er');return;}
      // Ligne d'en-tête (Nom + STATUT)
      let headerRow=-1;
      for(let i=0;i<Math.min(aoa.length,10);i++){
        const r=aoa[i]||[];
        const c0=String(r[0]||'').trim().toLowerCase();
        const c1=String(r[1]||'').trim().toLowerCase();
        if(c0.indexOf('nom')>=0&&c1.indexOf('statut')>=0){headerRow=i;break;}
      }
      if(headerRow<0){plStatus("Ligne d'en-tête introuvable (Nom et prénoms | STATUT | QUARTIER | ...)",'er');return;}
      // 7 dates à partir de la colonne D (index 3)
      const headerCells=aoa[headerRow]||[];
      const dates=[];
      for(let j=3;j<3+7;j++){
        const cellVal=headerCells[j];
        let dateStr=null;
        if(cellVal instanceof Date){
          dateStr=cellVal.getFullYear()+'-'+String(cellVal.getMonth()+1).padStart(2,'0')+'-'+String(cellVal.getDate()).padStart(2,'0');
        }else if(typeof cellVal==='number'){
          const d=new Date(Math.round((cellVal-25569)*86400*1000));
          dateStr=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        }else if(typeof cellVal==='string'&&cellVal.trim()){
          const s=cellVal.trim();
          let m=s.match(/(\d{4})-(\d{2})-(\d{2})/);
          if(m){dateStr=m[1]+'-'+m[2]+'-'+m[3];}
          else{m=s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);if(m){dateStr=m[3]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[1]).padStart(2,'0');}}
        }
        dates.push(dateStr);
      }
      if(!dates[0]){plStatus('Impossible de lire les dates en ligne '+(headerRow+1),'er');return;}

      function parseHoraire(val){
        if(val===null||val===undefined)return {type:'vide'};
        const s=String(val).trim();
        if(!s)return {type:'vide'};
        if(/^FREE$/i.test(s))return {type:'repos',libelle:'FREE'};
        if(/malade|maladie/i.test(s))return {type:'indispo',libelle:'Maladie'};
        if(/permission/i.test(s))return {type:'indispo',libelle:'Permissionnaire'};
        if(/congé|conge/i.test(s))return {type:'indispo',libelle:'Congé annuel'};
        if(/démission|demission/i.test(s))return {type:'indispo',libelle:'Démission'};
        const m=s.match(/(\d{1,2})\s*[hH:]\s*(\d{2})\s*[-–]\s*(\d{1,2})\s*[hH:]\s*(\d{2})/);
        if(m){return {type:'travail',debut:String(m[1]).padStart(2,'0')+':'+m[2],fin:String(m[3]).padStart(2,'0')+':'+m[4],libelle:s};}
        return {type:'autre',libelle:s};
      }

      const aEnvoyer=[];
      let agentsLus=0;
      for(let r=headerRow+1;r<aoa.length;r++){
        const row=aoa[r]||[];
        const nom=String(row[0]||'').trim();
        const statut=String(row[1]||'').trim();
        const quartier=String(row[2]||'').trim();
        if(!nom)continue;
        if(/^\d{1,2}[hH:]\d{2}/.test(nom))break;
        if(/^Total/i.test(nom))break;
        if(!statut||!/CDD|PRESTATAIRE/i.test(statut))continue;
        agentsLus++;
        const matricule=nom.toUpperCase().replace(/[^A-Z0-9 ]/g,'').replace(/\s+/g,'_').substring(0,50);
        for(let j=0;j<7;j++){
          const dateStr=dates[j];
          if(!dateStr)continue;
          const h=parseHoraire(row[3+j]);
          if(h.type==='vide')continue;
          aEnvoyer.push({
            id:matricule+'_'+dateStr,matricule:matricule,nom:nom,statut:statut,quartier:quartier,date:dateStr,
            type:h.type,horaire:h.libelle||'',heure_debut:h.debut||'',heure_fin:h.fin||'',
            activite:(h.type==='travail'?'Service':h.type==='repos'?'Repos':h.type==='indispo'?h.libelle:''),lieu:quartier
          });
        }
      }
      if(aEnvoyer.length===0){plStatus('❌ Aucune entrée valide trouvée dans la feuille "'+sheetName+'"','er');return;}
      plStatus('⏳ Import en cours ('+aEnvoyer.length+' entrées)...','ok');
      fetch('/api/planning/import',{method:'POST',headers:{'Authorization':'Bearer '+plToken(),'Content-Type':'application/json'},body:JSON.stringify({entrees:aEnvoyer})})
        .then(function(rep){return rep.json().then(function(d){return {ok:rep.ok,d:d};});})
        .then(function(res){
          if(res.ok){
            plStatus('✅ Import réussi — Feuille "'+sheetName+'" | '+agentsLus+' agents | '+dates[0]+' → '+dates[6]+' | '+res.d.count+' entrée(s)','ok');
            document.getElementById('pl-file').value='';
            plChargerListe();
          }else{plStatus('❌ '+(res.d.error||'Erreur serveur'),'er');}
        })
        .catch(function(err){plStatus('❌ Erreur réseau : '+err.message,'er');});
    }catch(err){console.error(err);plStatus('❌ Erreur : '+err.message,'er');}
  };
  reader.readAsArrayBuffer(file);
}

function plTemplate(){
  if(typeof XLSX==='undefined'){plStatus('XLSX non chargé','er');return;}
  const today=new Date();
  const day=today.getDay();const diff=day===0?-6:1-day;
  const lundi=new Date(today);lundi.setDate(today.getDate()+diff);
  const dates=[];for(let i=0;i<7;i++){const d=new Date(lundi);d.setDate(lundi.getDate()+i);dates.push(d);}
  const fmtDate=function(d){return d.getDate()+'/'+(d.getMonth()+1)+'/'+d.getFullYear();};
  const moisFr=['JANVIER','FEVRIER','MARS','AVRIL','MAI','JUIN','JUILLET','AOUT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DECEMBRE'];
  const titre='PLANNING BACKOFFICE DU '+String(lundi.getDate()).padStart(2,'0')+' AU '+String(dates[6].getDate()).padStart(2,'0')+' '+moisFr[lundi.getMonth()]+' '+lundi.getFullYear();
  const data=[
    [titre],['MATINEE / SOIREE / NUIT'],
    ['','','','LUNDI','MARDI','MERCREDI','JEUDI','VENDREDI','SAMEDI','DIMANCHE'],
    ['Nom et prénoms','STATUT','QUARTIER',fmtDate(dates[0]),fmtDate(dates[1]),fmtDate(dates[2]),fmtDate(dates[3]),fmtDate(dates[4]),fmtDate(dates[5]),fmtDate(dates[6])],
    ['AIDOU LYLA','CDD','TALANGAI','08h00-17h00','08h00-17h00','08h00-17h00','08h00-17h00','08h00-17h00','FREE','FREE'],
    ['BILAYI Harvely Reine','CDD','PLATEAUX','08H00-17H00','08H00-17H00','08H00-17H00','08H00-17H00','08H00-17H00','FREE','FREE'],
    ['BENDO TCHICK SETHI','CDD','OUENZE','Maladie','Maladie','Maladie','Maladie','Maladie','Maladie','Maladie'],
    ['BONGO RICHI','PRESTATAIRES-D','OUENZE','Permissionnaire','Permissionnaire','Permissionnaire','Permissionnaire','Permissionnaire','Permissionnaire','Permissionnaire']
  ];
  const ws=XLSX.utils.aoa_to_sheet(data);
  ws['!cols']=[{wch:28},{wch:18},{wch:16},{wch:14},{wch:14},{wch:14},{wch:14},{wch:14},{wch:14},{wch:14}];
  const wb=XLSX.utils.book_new();
  const sn='PLANNING DU '+String(lundi.getDate()).padStart(2,'0')+' AU '+String(dates[6].getDate()).padStart(2,'0')+' '+moisFr[lundi.getMonth()].substring(0,4);
  XLSX.utils.book_append_sheet(wb,ws,sn.substring(0,31));
  XLSX.writeFile(wb,'modele_planning.xlsx');
}

function plTypeColor(t){
  if(t==='travail')return '#198754';
  if(t==='repos')return '#0d6efd';
  if(t==='indispo')return '#dc3545';
  return '#6c757d';
}
function plChargerListe(){
  const el=document.getElementById('pl-liste');
  if(!el)return;
  el.innerHTML='<div style="padding:20px;text-align:center;color:#6c757d">Chargement…</div>';
  fetch('/api/planning',{headers:{'Authorization':'Bearer '+plToken()}})
    .then(function(r){return r.json();})
    .then(function(d){
      const plans=d.entrees||[];
      if(plans.length===0){el.innerHTML='<div style="padding:20px;text-align:center;color:#6c757d">Aucun planning importé.</div>';return;}
      const limite=plans.slice(0,300);
      el.innerHTML='<table style="width:100%;font-size:12px;border-collapse:collapse">'+
        '<thead><tr style="background:#e9ecef">'+
        '<th style="padding:6px 10px;text-align:left">Agent</th><th style="padding:6px 10px">Statut</th><th style="padding:6px 10px">Quartier</th><th style="padding:6px 10px">Date</th><th style="padding:6px 10px">Horaire</th><th style="padding:6px 10px">Type</th>'+
        '</tr></thead><tbody>'+limite.map(function(p){
          return '<tr style="border-top:1px solid #dee2e6">'+
            '<td style="padding:5px 10px;font-weight:600">'+(p.nom||p.matricule||'—')+'</td>'+
            '<td style="padding:5px 10px;text-align:center;font-size:11px">'+(p.statut||'—')+'</td>'+
            '<td style="padding:5px 10px;text-align:center">'+(p.quartier||p.lieu||'—')+'</td>'+
            '<td style="padding:5px 10px;text-align:center">'+p.date+'</td>'+
            '<td style="padding:5px 10px;text-align:center;font-weight:600">'+(p.horaire||((p.heure_debut||'—')+' – '+(p.heure_fin||'—')))+'</td>'+
            '<td style="padding:5px 10px;text-align:center"><span style="color:'+plTypeColor(p.type)+';font-weight:700">'+(p.type||p.activite||'—')+'</span></td>'+
          '</tr>';
        }).join('')+'</tbody></table>'+
        (plans.length>300?'<div style="padding:8px;text-align:center;color:#6c757d;font-size:11px">… et '+(plans.length-300)+' autres (affichage limité)</div>':'');
    })
    .catch(function(e){el.innerHTML='<div style="padding:20px;text-align:center;color:#dc3545">Erreur de chargement</div>';});
}

function initPlanningSup(){ plChargerListe(); }
