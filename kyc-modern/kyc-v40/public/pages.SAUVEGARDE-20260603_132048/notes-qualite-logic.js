// ============================================================================
// KYC V3 - Logique Import Notes qualité (parsing Excel V1 + envoi backend)
// ============================================================================
'use strict';
function nqToken(){return sessionStorage.getItem('kyc_token');}
function nqStatus(msg,type){
  const el=document.getElementById('nq-status');
  if(!el)return;
  el.style.display='block';el.textContent=msg;
  if(type==='ok'){el.style.background='#d1e7dd';el.style.color='#0f5132';el.style.border='1px solid #badbcc';}
  else{el.style.background='#f8d7da';el.style.color='#842029';el.style.border='1px solid #f5c2c7';}
}

// Parsing Excel — reproduit la logique V1 (3 feuilles, blocs Cleave/Dandy, W1-W4)
function nqImporter(){
  const file=document.getElementById('nq-file').files[0];
  if(!file){nqStatus('Sélectionnez un fichier Excel','er');return;}
  if(typeof XLSX==='undefined'){nqStatus('Librairie XLSX non chargée','er');return;}
  const mois=parseInt(document.getElementById('nq-mois').value,10);
  const annee=parseInt(document.getElementById('nq-annee').value,10);
  if(isNaN(mois)||mois<1||mois>12){nqStatus('Mois invalide','er');return;}
  if(isNaN(annee)||annee<2024||annee>2030){nqStatus('Année invalide','er');return;}

  const reader=new FileReader();
  reader.onload=function(e){
    try{
      const data=new Uint8Array(e.target.result);
      const wb=XLSX.read(data,{type:'array'});
      const campagnesMap={'CAMPAGNE BO MTN':'BO_MTN','CAMPAGNE AIRTEL MONEY':'AIRTEL_MONEY','CAMPAGNE HVC COMBO':'HVC_COMBO'};
      const aEnvoyer=[];
      const campagnesLues=[];

      Object.keys(campagnesMap).forEach(function(sheetName){
        const realSheetName=wb.SheetNames.find(function(sn){return sn.trim().toUpperCase()===sheetName.toUpperCase();});
        if(!realSheetName)return;
        const ws=wb.Sheets[realSheetName];
        const campagne=campagnesMap[sheetName];
        const isHvc=(campagne==='HVC_COMBO');
        const aoa=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
        if(aoa.length<5)return;
        const cols={
          g:{num:1,nom:2,statut:3,w1:4,w2:5,w3:6,w4:7,moy:8,quiz:9,tl:10,backup:11,com:11},
          d:{num:13,nom:14,statut:15,w1:16,w2:17,w3:18,w4:19,moy:20,quiz:21,tl:22,backup:23,com:23}
        };
        function parseNote(v){
          if(v===null||v===undefined)return null;
          let s=String(v).trim();
          if(!s||s==='-'||s==='–')return null;
          if(/démission|demission/i.test(s))return {special:'Démission'};
          if(/^malade$/i.test(s))return {special:'Malade'};
          if(/permissionnaire/i.test(s))return {special:'Permissionnaire'};
          if(/^N\.?E$/i.test(s))return {special:'N.E'};
          if(/congé|conge/i.test(s))return {special:'Congé'};
          const cleaned=s.replace('%','').replace(',','.').trim();
          let n=parseFloat(cleaned);
          if(isNaN(n))return null;
          if(n>1.01)n=n/100;
          return {val:n};
        }
        for(let r=0;r<aoa.length;r++){
          const row=aoa[r]||[];
          ['g','d'].forEach(function(side){
            const c=cols[side];
            const nom=String(row[c.nom]||'').trim();
            const statut=String(row[c.statut]||'').trim();
            if(!nom||nom.length<3)return;
            if(!statut)return;
            if(/^NOM\s*ET\s*PRENOM/i.test(nom))return;
            if(/^Moyenne/i.test(nom))return;
            if(!/CDD|PRESTATAIRE/i.test(statut))return;
            const equipe=side==='g'?'Cleave':'Dandy';
            function extract(col){
              const p=parseNote(row[col]);
              if(!p)return {note:null,statut_w:null};
              if(p.special)return {note:null,statut_w:p.special};
              return {note:p.val,statut_w:null};
            }
            const w1=extract(c.w1),w2=extract(c.w2),w3=extract(c.w3),w4=extract(c.w4);
            const matricule=nom.toUpperCase().replace(/[^A-Z0-9 ]/g,'').replace(/\s+/g,'_').substring(0,50);
            const id=matricule+'_'+annee+'_'+String(mois).padStart(2,'0')+'_'+campagne;
            const commentaire=isHvc?String(row[c.com]||'').trim():'';
            const note={
              id:id,matricule:matricule,nom:nom,statut:statut,campagne:campagne,equipe:equipe,mois:mois,annee:annee,
              note_w1:w1.note,note_w2:w2.note,note_w3:w3.note,note_w4:w4.note,
              statut_w1:w1.statut_w,statut_w2:w2.statut_w,statut_w3:w3.statut_w,statut_w4:w4.statut_w,
              commentaire_w4:isHvc?commentaire:'',
              tl:String(row[c.tl]||'').trim(),backup:String(row[c.backup]||'').trim()
            };
            const notes=[note.note_w1,note.note_w2,note.note_w3,note.note_w4].filter(function(n){return n!==null&&!isNaN(n);});
            note.moyenne=notes.length?(notes.reduce(function(a,b){return a+b;},0)/notes.length):null;
            aEnvoyer.push(note);
          });
        }
        campagnesLues.push(campagne);
      });

      if(campagnesLues.length===0){
        nqStatus('❌ Aucune feuille reconnue. Attendues : CAMPAGNE BO MTN, CAMPAGNE AIRTEL MONEY, CAMPAGNE HVC COMBO','er');
        return;
      }
      if(aEnvoyer.length===0){
        nqStatus('❌ Aucune ligne valide trouvée dans les feuilles.','er');
        return;
      }
      // Envoi backend
      nqStatus('⏳ Import en cours ('+aEnvoyer.length+' lignes)...','ok');
      fetch('/api/notes-qualite/import',{method:'POST',headers:{'Authorization':'Bearer '+nqToken(),'Content-Type':'application/json'},body:JSON.stringify({notes:aEnvoyer})})
        .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
        .then(function(res){
          if(res.ok){
            nqStatus('✅ Import réussi — Campagnes : '+campagnesLues.join(', ')+' | '+res.d.count+' note(s) enregistrée(s) (mois '+mois+'/'+annee+')','ok');
            document.getElementById('nq-file').value='';
            nqChargerListe();
          }else{
            nqStatus('❌ '+(res.d.error||'Erreur serveur'),'er');
          }
        })
        .catch(function(err){nqStatus('❌ Erreur réseau : '+err.message,'er');});
    }catch(err){
      console.error(err);
      nqStatus('❌ Erreur : '+err.message,'er');
    }
  };
  reader.readAsArrayBuffer(file);
}

// Génère un modèle Excel (reproduit la V1)
function nqTemplate(){
  if(typeof XLSX==='undefined'){nqStatus('XLSX non chargé','er');return;}
  const wb=XLSX.utils.book_new();
  function makeSheet(titreG,titreD){
    const headers=['N°','NOM ET PRENOM','STATUT','Tx W1','Tx W2','Tx W3','Tx W4','Moyenne','QUIZ','TL','Backup'];
    const data=[];
    data.push([]);
    const r2=new Array(24).fill('');r2[1]=titreG;r2[13]=titreD;data.push(r2);
    data.push([]);data.push([]);
    const r5=new Array(24).fill('');
    for(let i=0;i<headers.length;i++){r5[1+i]=headers[i];r5[13+i]=headers[i];}
    data.push(r5);
    const ex=[['CDD','AIDOU LYLA',1,1,1,1],['CDD','BENDO TCHICK Sethi',1,1,0.95,1],['An. PRESTATAIRES','AMELE MIERE Dieu-Veille',1,1,1,1]];
    for(let k=0;k<ex.length;k++){
      const row=new Array(24).fill('');
      row[1]=k+1;row[2]=ex[k][1];row[3]=ex[k][0];
      row[4]=ex[k][2];row[5]=ex[k][3];row[6]=ex[k][4];row[7]=ex[k][5];
      // côté Dandy
      row[13]=k+1;row[14]=ex[k][1]+' (D)';row[15]=ex[k][0];
      row[16]=1;row[17]=1;row[18]=1;row[19]=1;
      data.push(row);
    }
    return XLSX.utils.aoa_to_sheet(data);
  }
  XLSX.utils.book_append_sheet(wb,makeSheet('EQUIPE CLEAVE','EQUIPE DANDY'),'CAMPAGNE BO MTN');
  XLSX.utils.book_append_sheet(wb,makeSheet('EQUIPE CLEAVE','EQUIPE DANDY'),'CAMPAGNE AIRTEL MONEY');
  XLSX.utils.book_append_sheet(wb,makeSheet('EQUIPE CLEAVE','EQUIPE DANDY'),'CAMPAGNE HVC COMBO');
  XLSX.writeFile(wb,'modele_notes_qualite.xlsx');
}

// Charge et affiche la liste des notes
function nqChargerListe(){
  const el=document.getElementById('nq-liste');
  if(!el)return;
  el.innerHTML='<div style="padding:20px;text-align:center;color:#6c757d">Chargement…</div>';
  fetch('/api/notes-qualite',{headers:{'Authorization':'Bearer '+nqToken()}})
    .then(function(r){return r.json();})
    .then(function(d){
      const notes=d.notes||[];
      if(notes.length===0){el.innerHTML='<div style="padding:20px;text-align:center;color:#6c757d">Aucune note importée.</div>';return;}
      const moisFr=['','Jan','Fév','Mar','Avr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Déc'];
      const campFr={'BO_MTN':'BO MTN','AIRTEL_MONEY':'Airtel Money','HVC_COMBO':'HVC Combo'};
      const fmt=function(v,s){
        if(s)return '<span style="color:#dc3545;font-size:10px">'+s+'</span>';
        return (v===null||isNaN(v)||v===undefined)?'<span style="color:#adb5bd">—</span>':(v*100).toFixed(0)+'%';
      };
      const limite=notes.slice(0,300);
      el.innerHTML='<table style="width:100%;font-size:12px;border-collapse:collapse">'+
        '<thead><tr style="background:#e9ecef">'+
        '<th style="padding:6px 10px;text-align:left">Nom</th><th style="padding:6px 10px">Campagne</th><th style="padding:6px 10px">Équipe</th><th style="padding:6px 10px">Période</th>'+
        '<th style="padding:6px 10px">W1</th><th style="padding:6px 10px">W2</th><th style="padding:6px 10px">W3</th><th style="padding:6px 10px">W4</th><th style="padding:6px 10px">Moy.</th><th style="padding:6px 10px">TL</th>'+
        '</tr></thead><tbody>'+limite.map(function(n){
          const moy=n.moyenne;
          const moyC=moy==null?'#6c757d':moy>=0.95?'#198754':moy>=0.90?'#d97706':'#dc3545';
          return '<tr style="border-top:1px solid #dee2e6">'+
            '<td style="padding:5px 10px;font-weight:600">'+(n.nom||n.matricule||'—')+'</td>'+
            '<td style="padding:5px 10px;text-align:center">'+(campFr[n.campagne]||n.campagne||'—')+'</td>'+
            '<td style="padding:5px 10px;text-align:center">'+(n.equipe||'—')+'</td>'+
            '<td style="padding:5px 10px;text-align:center">'+moisFr[n.mois]+' '+n.annee+'</td>'+
            '<td style="padding:5px 10px;text-align:center">'+fmt(n.note_w1,n.statut_w1)+'</td>'+
            '<td style="padding:5px 10px;text-align:center">'+fmt(n.note_w2,n.statut_w2)+'</td>'+
            '<td style="padding:5px 10px;text-align:center">'+fmt(n.note_w3,n.statut_w3)+'</td>'+
            '<td style="padding:5px 10px;text-align:center">'+fmt(n.note_w4,n.statut_w4)+'</td>'+
            '<td style="padding:5px 10px;text-align:center;font-weight:700;color:'+moyC+'">'+fmt(moy)+'</td>'+
            '<td style="padding:5px 10px;text-align:center">'+(n.tl||'—')+'</td>'+
          '</tr>';
        }).join('')+'</tbody></table>'+
        (notes.length>300?'<div style="padding:8px;text-align:center;color:#6c757d;font-size:11px">… et '+(notes.length-300)+' autres (affichage limité)</div>':'');
    })
    .catch(function(e){el.innerHTML='<div style="padding:20px;text-align:center;color:#dc3545">Erreur de chargement</div>';});
}

function initNotesQualite(){
  const now=new Date();
  const m=document.getElementById('nq-mois');
  const a=document.getElementById('nq-annee');
  if(m)m.value=now.getMonth()+1;
  if(a)a.value=now.getFullYear();
  nqChargerListe();
}
