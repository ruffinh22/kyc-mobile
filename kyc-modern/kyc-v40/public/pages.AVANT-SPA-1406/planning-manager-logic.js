// ============================================================================
// KYC V3 - Logique Planning Manager (grille shift × jours éditable)
// ============================================================================
function planningManager(){
  const pad=n=>String(n).padStart(2,'0');
  const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const joursFr=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
  // Modèle par défaut (d'après le fichier PROPOSITION)
  const modeleDefaut=()=>([
    {vacation:'MATINÉE',horaire:'07H30-14H00',cells:['','','','','','','']},
    {vacation:'MATINÉE',horaire:'08H00-17H00',cells:['','','','','','','']},
    {vacation:'MATINÉE',horaire:'10H00-18H00',cells:['','','','','','','']},
    {vacation:'SOIRÉE',horaire:'14H00-20H00',cells:['','','','','','','']}
  ]);
  return {
    user:{},
    lundi:null,
    titre:'',
    shifts:[],
    chargement:false,
    sauvegarde:false,
    message:'',
    messageType:'ok',
    nomsConnus:[],
    async init(){
      await chargerSidebarSup('planning-manager');
      try{this.user=JSON.parse(sessionStorage.getItem('kyc_user')||'{}')}catch(e){}
      this.lundi=this.trouverLundi(new Date());
      await this.charger();
    },
    trouverLundi(d){const x=new Date(d);const day=x.getDay();const diff=day===0?-6:1-day;x.setDate(x.getDate()+diff);x.setHours(0,0,0,0);return x;},
    addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;},
    get semaineISO(){return ymd(this.lundi);},
    get labelSemaine(){
      const l=this.lundi,d=this.addDays(this.lundi,6);
      return 'Semaine du '+pad(l.getDate())+'/'+pad(l.getMonth()+1)+' au '+pad(d.getDate())+'/'+pad(d.getMonth()+1)+'/'+d.getFullYear();
    },
    jourEntete(i){
      const d=this.addDays(this.lundi,i);
      return joursFr[i]+' '+pad(d.getDate())+'/'+pad(d.getMonth()+1);
    },
    navSemaine(dir){this.lundi=this.addDays(this.lundi,dir*7);this.charger();},
    async charger(){
      this.chargement=true;this.message='';
      const t=sessionStorage.getItem('kyc_token');
      try{
        const r=await fetch('/api/planning-managers?semaine='+this.semaineISO,{headers:{'Authorization':'Bearer '+t}});
        if(r.status===401){window.location.href='/login';return}
        if(r.ok){
          const d=await r.json();
          this.titre=d.titre||'';
          this.shifts=(d.shifts&&d.shifts.length)?d.shifts.map(s=>({vacation:s.vacation||'',horaire:s.horaire||'',cells:(s.cells||['','','','','','','']).slice(0,7)})):modeleDefaut();
        }else{this.shifts=modeleDefaut();}
      }catch(e){this.shifts=modeleDefaut();}
      this.majNomsConnus();
      this.chargement=false;
    },
    majNomsConnus(){
      const set=new Set();
      this.shifts.forEach(s=>s.cells.forEach(c=>{const v=(c||'').trim();if(v&&v!=='-'&&v!=='FREE')set.add(v);}));
      this.nomsConnus=Array.from(set).sort();
    },
    ajouterShift(){this.shifts.push({vacation:'',horaire:'',cells:['','','','','','','']});},
    supprimerShift(i){if(confirm('Supprimer cette ligne de shift ?'))this.shifts.splice(i,1);},
    async enregistrer(){
      this.sauvegarde=true;this.message='';
      const t=sessionStorage.getItem('kyc_token');
      try{
        const r=await fetch('/api/planning-managers',{method:'POST',headers:{'Authorization':'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify({semaine:this.semaineISO,titre:this.titre,shifts:this.shifts})});
        const d=await r.json();
        if(r.ok){this.message='✅ Planning enregistré ('+d.shifts+' shifts) — '+this.labelSemaine;this.messageType='ok';this.majNomsConnus();}
        else{this.message='❌ '+(d.error||'Erreur');this.messageType='er';}
      }catch(e){this.message='❌ Erreur réseau : '+e.message;this.messageType='er';}
      this.sauvegarde=false;
      setTimeout(()=>{this.message=''},4000);
    },
    reinitGrille(){if(confirm('Réinitialiser la grille avec le modèle par défaut ? (non enregistré tant que vous ne cliquez pas Enregistrer)')){this.shifts=modeleDefaut();}}
  };
}
