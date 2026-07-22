'use strict';
// ---- Polyfill getUserMedia (compat tous navigateurs : Chrome, Edge, Safari, Firefox, anciens) ----
(function(){
  if (!navigator.mediaDevices) { navigator.mediaDevices = {}; }
  if (!navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia = function(constraints){
      var legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
      if (!legacy) {
        return Promise.reject(new Error('getUserMedia non supporte par ce navigateur'));
      }
      return new Promise(function(resolve, reject){
        legacy.call(navigator, constraints, resolve, reject);
      });
    };
  }
})();
// ---- Compat RTCPeerConnection (Safari/anciens) ----
window.RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
window.RTCSessionDescription = window.RTCSessionDescription || window.webkitRTCSessionDescription || window.mozRTCSessionDescription;
window.RTCIceCandidate = window.RTCIceCandidate || window.webkitRTCIceCandidate || window.mozRTCIceCandidate;
// ============================================================================
// Module d'appel video WebRTC partage - KYC V4
// Utilise par : back-office (initie l'appel) et agent terrain (recoit l'appel)
// Routage par numero d'agent terrain (wa_agent).
// ============================================================================

window.VideoCall = (function () {
  let ws = null;
  let pc = null;
  let facingActuel = 'user';   // user = avant, environment = arriere
  let deconnexionVolontaire = false;
  let offreEnAttente = null;   // offre recue avant acceptation (terrain)
  let aAccepte = false;        // le terrain a-t-il clique Accepter ?            // RTCPeerConnection
  let localStream = null;
  let role = null;          // 'terrain' ou 'backoffice'
  let numero = null;        // numero de l'agent terrain (cle de routage)
  let onStateChange = null; // callback pour informer l'UI

  // Configuration ICE : STUN public (gratuit). TURN sera ajoute plus tard.
  const ICE_CONFIG = {

    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'turn:192.168.10.77:3478', username: 'kycturn', credential: 'KycVideo2026' }
    ]
  };

  function log(...a) { console.log('[VideoCall]', ...a); }
  function setState(s, extra) { if (onStateChange) onStateChange(s, extra || {}); }

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/ws/video';
  }

  function envoyer(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  // ---- Connexion WebSocket + enregistrement ----
  function connecter(monRole, monNumero) {
    role = monRole;
    deconnexionVolontaire = false;
    numero = String(monNumero || '').replace(/\D/g, '');
    if (!numero) { log('numero manquant'); return; }

    ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      log('WS ouvert, enregistrement', role, numero);
      envoyer({ type: 'register', role: role, numero: numero });
      setState('connected');
    };
    ws.onclose = () => {
      log('WS ferme');
      setState('disconnected');
      // Reconnexion automatique apres 2s (sauf deconnexion volontaire)
      if (!deconnexionVolontaire && role && numero) {
        setTimeout(() => { try { connecter(role, numero); } catch(e){} }, 2000);
      }
    };
    ws.onerror = (e) => { log('WS erreur', e); };
    ws.onmessage = async (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      console.log('[VideoCall] MESSAGE RECU:', JSON.stringify(msg), 'role=', role);
      await traiterMessage(msg);
    };
  }

  async function traiterMessage(msg) {
    switch (msg.type) {
      case 'registered':
        log('enregistre comme', msg.role);
        break;
      case 'terrain-presence':
        setState('terrain-presence', { enLigne: msg.enLigne });
        break;
      case 'terrain-absent':
        setState('terrain-absent');
        break;
      case 'refus':
        setState('refus');
        break;
      case 'incoming-call':
        // Cote terrain : un appel arrive
        setState('incoming-call', { numero: msg.numero, numeroMtn: msg.numeroMtn });
        try { window.dispatchEvent(new CustomEvent('kyc-incoming-call', { detail: { numero: msg.numero, numeroMtn: msg.numeroMtn } })); } catch(e){}
        break;
      case 'webrtc':
        await traiterWebRTC(msg.payload);
        break;
      case 'hangup':
        terminer(false);
        setState('remote-hangup');
        break;
    }
  }

  // ---- Acces camera ----
  async function obtenirCamera() {
    if (localStream) return localStream;
    // Compat : verifier que le navigateur supporte la camera
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('NavigateurIncompatible');
    }
    try {
      // Essai 1 : contraintes ideales (mobile frontale, 640x480)
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 15, max: 20 } },
        audio: true
      });
    } catch (e1) {
      log('camera essai 1 echoue, fallback:', e1 && e1.name);
      // Si l'utilisateur a REFUSE la permission, ne pas insister
      if (e1 && (e1.name === 'NotAllowedError' || e1.name === 'PermissionDeniedError')) {
        throw new Error('PermissionRefusee');
      }
      try {
        // Essai 2 : video simple (marche sur PC sans facingMode)
        localStream = await navigator.mediaDevices.getUserMedia({ video: { width:{max:640}, height:{max:480}, frameRate:{max:20} }, audio: true });
      } catch (e2) {
        log('camera essai 2 echoue, audio seul:', e2 && e2.name);
        if (e2 && (e2.name === 'NotAllowedError' || e2.name === 'PermissionDeniedError')) {
          throw new Error('PermissionRefusee');
        }
        // Essai 3 : audio seul
        localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      }
    }
    try{ console.log('[VideoCall] PISTES OBTENUES - video:', localStream.getVideoTracks().length, 'audio:', localStream.getAudioTracks().length); }catch(e){}
    return localStream;
  }

  // ---- Creer la connexion peer ----
  function creerPeer() {
    pc = new RTCPeerConnection(ICE_CONFIG);
    // Envoyer nos candidats ICE a l'autre
    pc.onicecandidate = (e) => {
      if (e.candidate) envoyer({ type: 'webrtc', payload: { kind: 'ice', candidate: e.candidate } });
    };
    // Recevoir le flux distant
    pc.ontrack = (e) => {
      try{ console.log('[VideoCall] FLUX DISTANT recu - video:', e.streams[0].getVideoTracks().length, 'audio:', e.streams[0].getAudioTracks().length); }catch(err){}
      setState('remote-stream', { stream: e.streams[0] });
    };
    pc.onconnectionstatechange = () => {
      log('etat connexion', pc.connectionState);
      if (pc.connectionState === 'connected') setState('call-connected');
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) setState('call-ended');
    };
    // Ajouter nos pistes locales
    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    return pc;
  }

  // ---- Back-office : demarrer l'appel ----
  async function appeler(numeroMtn) {
    window._numMtnAppel = numeroMtn || '';
    if (pc) { try { pc.close(); } catch(e){} pc = null; }
    setState('calling');
    await obtenirCamera();
    setState('local-stream', { stream: localStream });
    envoyer({ type: 'call', numeroMtn: window._numMtnAppel || '' });  // prevenir le serveur -> sonne chez le terrain
    creerPeer();
    const offre = await pc.createOffer();
    await pc.setLocalDescription(offre);
    envoyer({ type: 'webrtc', payload: { kind: 'offer', sdp: offre } });
  }

  // ---- Terrain : accepter l'appel entrant ----
  async function accepter() {
    aAccepte = true;
    setState('accepting');
    await obtenirCamera();
    setState('local-stream', { stream: localStream });
    if (!pc) creerPeer();
    // S'il y a une offre recue en attente, on la traite maintenant
    if (offreEnAttente) {
      const offre = offreEnAttente; offreEnAttente = null;
      await pc.setRemoteDescription(new RTCSessionDescription(offre));
      const reponse = await pc.createAnswer();
      await pc.setLocalDescription(reponse);
      envoyer({ type: 'webrtc', payload: { kind: 'answer', sdp: reponse } });
    }
  }

  // ---- Traiter les messages WebRTC recus ----
  async function traiterWebRTC(payload) {
    if (!payload) return;
    if (payload.kind === 'offer') {
      // Si le terrain n'a pas encore accepte, on met l'offre en attente (sonnerie)
      if (!aAccepte) { offreEnAttente = payload.sdp; log('offre mise en attente (pas encore accepte)'); return; }
      if (!pc) creerPeer();
      if (pc.signalingState !== 'stable') { log('offre ignoree, etat =', pc.signalingState); return; }
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const reponse = await pc.createAnswer();
      await pc.setLocalDescription(reponse);
      envoyer({ type: 'webrtc', payload: { kind: 'answer', sdp: reponse } });
    } else if (payload.kind === 'answer') {
      if (pc && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      } else {
        log('answer ignoree, etat =', pc ? pc.signalingState : 'no pc');
      }
    } else if (payload.kind === 'ice') {
      try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch (e) { log('ice err', e); }
    }
  }

  // ---- Raccrocher ----
  function terminer(prevenir) {
    if (prevenir !== false) envoyer({ type: 'hangup' });
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    offreEnAttente = null; aAccepte = false;
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    setState('idle');
  }

  function deconnecter() {
    deconnexionVolontaire = true;
    terminer(false);
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
  }

  async function changerCamera() {
    if (!localStream) return facingActuel;
    // Lister les cameras video disponibles
    var cams = [];
    try {
      var devices = await navigator.mediaDevices.enumerateDevices();
      cams = devices.filter(function(d){ return d.kind === 'videoinput'; });
    } catch(e) { log('enumerate echoue', e); }
    if (cams.length < 2) { throw new Error('UneSeuleCamera'); }
    // Trouver la camera actuelle et choisir la suivante
    var oldTrack = localStream.getVideoTracks()[0];
    var currentId = oldTrack && oldTrack.getSettings ? oldTrack.getSettings().deviceId : null;
    var idx = 0;
    for (var i=0;i<cams.length;i++){ if(cams[i].deviceId===currentId){ idx=i; break; } }
    var next = cams[(idx+1) % cams.length];
    // Liberer la camera actuelle
    if (oldTrack) { try{ oldTrack.stop(); }catch(e){} }
    // Ouvrir la nouvelle camera par deviceId (avec timeout de securite)
    var newStream = await Promise.race([
      navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: next.deviceId } }, audio: false }),
      new Promise(function(_,rej){ setTimeout(function(){ rej(new Error('Timeout')); }, 5000); })
    ]);
    var newTrack = newStream.getVideoTracks()[0];
    if (!newTrack) throw new Error('PasDePiste');
    if (pc) {
      var sender = pc.getSenders().find(function(sd){ return sd.track && sd.track.kind === 'video'; });
      if (sender) await sender.replaceTrack(newTrack);
    }
    if (oldTrack) { try{ localStream.removeTrack(oldTrack); }catch(e){} }
    localStream.addTrack(newTrack);
    facingActuel = (facingActuel === 'user') ? 'environment' : 'user';
    setState('local-stream', { stream: localStream });
    return 'cam ' + (idx+1>=cams.length?1:idx+2) + '/' + cams.length;
  }
  function toggleMicro() {
    if (!localStream) return true;
    const t = localStream.getAudioTracks()[0];
    if (t) { t.enabled = !t.enabled; return t.enabled; }
    return true;
  }
  function toggleCamera() {
    if (!localStream) return true;
    const t = localStream.getVideoTracks()[0];
    if (t) { t.enabled = !t.enabled; return t.enabled; }
    return true;
  }
  return {
    connecter,        // (role, numero)
    toggleMicro,
    toggleCamera,
    changerCamera,
    appeler,          // back-office lance l'appel
    accepter,         // terrain accepte l'appel
    terminer,         // raccrocher
    deconnecter,
    envoyerRefus: () => { envoyer({ type: 'refus' }); if (ws) { try { ws.close(); } catch(e){} ws = null; } },
    setOnStateChange: (fn) => { onStateChange = fn; }
  };
})();
