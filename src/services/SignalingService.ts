/**
 * SignalingService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Connexion WebSocket au serveur KYC et signalisation WebRTC.
 *
 * Protocole serveur réel (implémentation active du backend) :
 *   ENVOI   : register { role:'terrain', numero, fcmToken? }
 *   ENVOI   : webrtc   { payload: { kind:'answer'|'ice', sdp?, candidate? } }
 *   ENVOI   : refus
 *   ENVOI   : hangup
 *   ENVOI   : ping
 *
 *   REÇOIT  : registered
 *   REÇOIT  : incoming-call { numeroMtn }
 *   REÇOIT  : webrtc        { payload: { kind:'offer'|'answer'|'ice', ... } }
 *   REÇOIT  : refus
 *   REÇOIT  : hangup
 *   REÇOIT  : pong
 *
 * NOTE : le serveur route par `numero` (pas de from/to dans les messages webrtc).
 *
 * ── EXTENSION APPEL SORTANT (terrain → back-office/numéro) ─────────────────
 * NON ENCORE IMPLÉMENTÉE CÔTÉ SERVEUR — voir SERVER_SPEC.md pour le contrat
 * exact à ajouter dans video-signal.js. Résumé :
 *   ENVOI   : call-request { numero: string }   // le terrain demande à joindre `numero`
 *   ENVOI   : call-cancel  {}                   // annule pendant la sonnerie sortante
 *
 *   REÇOIT  : call-ringing     {}                        // la cible sonne
 *   REÇOIT  : call-accepted    {}                         // la cible a décroché,
 *             un message webrtc/offer suit immédiatement (même flux que l'appel
 *             entrant existant : on réutilise handleOffer()/acceptCall() tel quel,
 *             c'est TOUJOURS le back-office qui crée l'offer SDP, jamais le terrain)
 *   REÇOIT  : call-rejected    {}                         // la cible a refusé
 *   REÇOIT  : call-unavailable { reason?: string }        // numéro injoignable/hors ligne
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  MediaStream,
  MediaStreamTrack,
} from 'react-native-webrtc';
import { useCallStore } from '../store/callStore';

const getWebRTC = () => require('react-native-webrtc') as any;

// ── Config ICE de secours ───────────────────────────────────────────────────
const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// ── Types protocole ──────────────────────────────────────────────────────────
type SignalMsg =
  | { type: 'registered' }
  | { type: 'incoming-call'; numeroMtn: string }
  | { type: 'webrtc';        payload: WebRTCPayload }
  | { type: 'refus' }
  | { type: 'hangup' }
  | { type: 'pong' }
  // ── Extension appel sortant (voir SERVER_SPEC.md) ─────────────────────────
  | { type: 'call-ringing' }
  | { type: 'call-accepted' }
  | { type: 'call-rejected' }
  | { type: 'call-unavailable'; reason?: string };

// ── Événements d'appel sortant (pour OutgoingCallScreen) ────────────────────
export type OutgoingCallEvent =
  | { type: 'ringing' }
  | { type: 'accepted' }
  | { type: 'rejected' }
  | { type: 'unavailable'; reason?: string }
  | { type: 'cancelled' };
type OutgoingCallListener = (event: OutgoingCallEvent) => void;

type WebRTCPayload =
  | { kind: 'offer';  sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice';    candidate: any };

// ── Stream listeners (CallScreen s'y abonne) ─────────────────────────────────
type StreamListener = (event: StreamEvent) => void;
type StreamEvent =
  | { type: 'local';        stream: MediaStream }
  | { type: 'remote';       stream: MediaStream }
  | { type: 'reconnecting' }   // coupure réseau transitoire, tentative de reprise en cours
  | { type: 'reconnected' }    // ICE rétabli après une coupure transitoire
  | { type: 'ended' };

// ── Callbacks principaux ─────────────────────────────────────────────────────
export type SignalingCallbacks = {
  onConnected:    () => void;
  onDisconnected: () => void;
  onIncomingCall: (numeroMtn: string) => void;
  onCallEnded:    () => void;
  onError:        (msg: string) => void;
  onMediaError?:  (msg: string) => void;  // caméra/micro indisponible
};

// ─────────────────────────────────────────────────────────────────────────────
class SignalingService {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private serverUrl     = '';
  private numeroAgent   = '';
  private fcmToken      = '';
  private callbacks: SignalingCallbacks | null = null;
  private streamListeners: StreamListener[] = [];
  // Écouteurs dédiés à l'appel SORTANT (OutgoingCallScreen s'y abonne). Séparés
  // de `callbacks` qui est unique et déjà occupé par IdleScreen pour toute la
  // durée de vie de l'app — un écran ne peut pas se substituer à ces callbacks
  // globaux sans casser la réception des appels entrants pendant qu'il est monté.
  private outgoingCallListeners: OutgoingCallListener[] = [];
  private isOutgoingRinging = false;

  private reconnectTimer: ReturnType<typeof setTimeout>  | null = null;
  private pingTimer:      ReturnType<typeof setTimeout>  | null = null;
  private reconnectDelay = 2000;
  private destroyed      = false;

  // Watchdog ping/pong : si le serveur ne répond plus, on force une reconnexion
  private missedPongs    = 0;
  private awaitingPong   = false;

  // Grâce ICE : un état 'disconnected' est souvent transitoire (réseau
  // instable), on laisse une chance de reprise avant d'abandonner l'appel.
  private iceGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly ICE_GRACE_MS = 10_000;

  private pendingCandidates: Array<{ candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null }> = [];
  private localStream: MediaStream | null = null;
  private facingMode: 'user' | 'environment' = 'environment'; // Caméra arrière par défaut (terrain)

  // ── État "rejouable" pour abonnés tardifs ────────────────────────────────
  // La négociation WebRTC (offer reçue, réponse, ICE) est pilotée par ce
  // service, pas par l'écran affiché. Elle peut donc démarrer ET se terminer
  // pendant qu'aucun écran n'est encore abonné à addStreamListener (ex :
  // l'offer arrive pendant que IncomingCallScreen sonne encore, avant que
  // CallScreen ne soit monté). Sans état rejouable, l'événement 'remote' est
  // perdu et l'appel reste bloqué sur "connexion en cours" indéfiniment côté
  // UI alors que le flux existe déjà bel et bien côté PeerConnection.
  private lastRemoteStream: MediaStream | null = null;
  private lastConnectionPhase: 'idle' | 'connecting' | 'reconnecting' | 'connected' | 'ended' = 'idle';

  // ── Initialisation ──────────────────────────────────────────────────────────
  init (serverUrl: string, numeroAgent: string, fcmToken: string, cbs: SignalingCallbacks) {
    this.serverUrl    = serverUrl;
    this.numeroAgent  = numeroAgent;
    this.fcmToken     = fcmToken;
    this.callbacks    = cbs;
    this.destroyed    = false;
    this.reconnectDelay = 2000;
    this.connect();
  }

  // ── Abonnement aux événements stream (pour CallScreen) ──────────────────────
  addStreamListener (listener: StreamListener): () => void {
    this.streamListeners.push(listener);

    // Rejoue immédiatement l'état déjà connu pour cet abonné : s'il arrive
    // après coup (voir commentaire sur lastRemoteStream), il doit recevoir
    // tout de suite ce qu'il aurait manqué au lieu de rester bloqué.
    if (this.localStream)     listener({ type: 'local',  stream: this.localStream });
    if (this.lastRemoteStream) listener({ type: 'remote', stream: this.lastRemoteStream });
    if (this.lastConnectionPhase === 'reconnecting') listener({ type: 'reconnecting' });

    return () => {
      this.streamListeners = this.streamListeners.filter(l => l !== listener);
    };
  }

  addOutgoingCallListener (listener: OutgoingCallListener): () => void {
    this.outgoingCallListeners.push(listener);
    return () => {
      this.outgoingCallListeners = this.outgoingCallListeners.filter(l => l !== listener);
    };
  }

  private emitOutgoingCall (event: OutgoingCallEvent) {
    this.outgoingCallListeners.forEach(l => l(event));
  }

  private emitStream (event: StreamEvent) {
    if (event.type === 'remote')       this.lastRemoteStream = event.stream;
    if (event.type === 'reconnecting') this.lastConnectionPhase = 'reconnecting';
    if (event.type === 'reconnected')  this.lastConnectionPhase = 'connected';
    if (event.type === 'ended')        { this.lastConnectionPhase = 'ended'; this.lastRemoteStream = null; }
    this.streamListeners.forEach(l => l(event));
  }

  // ── Connexion WebSocket ──────────────────────────────────────────────────────
  private connect () {
    if (this.destroyed) return;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const base = this.serverUrl.replace(/\/$/, '');
    const httpUrl = base.startsWith('http') ? base : `http://${base}`;
    const wsUrl = httpUrl.replace(/^http/, 'ws') + '/api/signaling';

    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 2000;
      // Envoie le register avec le bon champ "numero" (pas "numeroAgent")
      this.sendRaw({
        type:     'register',
        role:     'terrain',
        numero:   this.numeroAgent,
        fcmToken: this.fcmToken || undefined,
      });
      this.startPing();
    };

    this.ws.onmessage = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? e.data : String(e.data ?? '');
        const msg: SignalMsg = JSON.parse(data);
        this.handleMessage(msg);
      } catch {}
    };

    this.ws.onclose = () => {
      this.stopPing();
      this.callbacks?.onDisconnected();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose est toujours déclenché après — pas de double-handling
    };
  }

  // ── Traitement messages serveur ──────────────────────────────────────────────
  private async handleMessage (msg: SignalMsg) {
    const store = useCallStore.getState();

    switch (msg.type) {

      case 'registered':
        this.callbacks?.onConnected();
        break;

      // ── Appel entrant : back-office appelle le terrain ─────────────────────
      case 'incoming-call':
        store.setIncomingCall(msg.numeroMtn);
        this.callbacks?.onIncomingCall(msg.numeroMtn);
        break;

      // ── Signalisation WebRTC (offer / answer / ice) ───────────────────────
      case 'webrtc':
        await this.handleWebRTC(msg.payload);
        break;

      // ── Raccrochage ou refus distant ──────────────────────────────────────
      case 'refus':
      case 'hangup':
        this.endCallCleanup();
        this.emitStream({ type: 'ended' });
        this.callbacks?.onCallEnded();
        break;

      case 'pong':
        console.log('[Signal] pong reçu, missedPongs remis à 0');
        this.awaitingPong = false;
        this.missedPongs = 0;
        break;

      // ── Extension appel sortant ─────────────────────────────────────────
      case 'call-ringing':
        this.emitOutgoingCall({ type: 'ringing' });
        break;

      case 'call-accepted':
        // La cible a décroché. Comme pour l'appel entrant, c'est le
        // back-office qui va créer l'offer SDP — on prépare juste le flux
        // local (caméra/micro) dès maintenant pour que l'answer puisse
        // partir avec le média dès que l'offer arrive (voir handleOffer).
        this.isOutgoingRinging = false;
        this.emitOutgoingCall({ type: 'accepted' });
        break;

      case 'call-rejected':
        this.isOutgoingRinging = false;
        this.emitOutgoingCall({ type: 'rejected' });
        break;

      case 'call-unavailable':
        this.isOutgoingRinging = false;
        this.emitOutgoingCall({ type: 'unavailable', reason: msg.reason });
        break;
    }
  }

  // ── Lancer un appel sortant (terrain → numéro/back-office) ────────────────
  // NÉCESSITE le support serveur décrit dans SERVER_SPEC.md (message
  // 'call-request' non géré par video-signal.js actuellement). Tant que le
  // serveur ne répond pas, l'appelant restera en 'ringing' indéfiniment —
  // OutgoingCallScreen doit donc garder un timeout local (voir cet écran).
  startOutgoingCall (numero: string) {
    this.isOutgoingRinging = true;
    this.sendRaw({ type: 'call-request', numero });
  }

  // ── Annuler un appel sortant en cours de sonnerie ──────────────────────────
  cancelOutgoingCall () {
    if (!this.isOutgoingRinging) return;
    this.isOutgoingRinging = false;
    this.sendRaw({ type: 'call-cancel' });
    this.emitOutgoingCall({ type: 'cancelled' });
  }

  // ── Dispatch WebRTC payload ──────────────────────────────────────────────────
  private async handleWebRTC (payload: WebRTCPayload) {
    switch (payload.kind) {

      case 'offer':
        await this.handleOffer(payload.sdp);
        break;

      case 'answer':
        if (this.pc) {
          try {
            const { RTCSessionDescription } = getWebRTC();
            await this.pc.setRemoteDescription(
              new RTCSessionDescription({ type: 'answer', sdp: payload.sdp })
            );
            await this.flushPendingCandidates();
          } catch (e) {
            console.warn('[Signal] setRemoteDescription answer:', e);
          }
        }
        break;

      case 'ice':
        if (this.pc?.remoteDescription) {
          try {
            const { RTCIceCandidate } = getWebRTC();
            await this.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch (e) {
            console.warn('[Signal] addIceCandidate a échoué (candidat ignoré) :', e);
          }
        } else {
          this.pendingCandidates.push(payload.candidate);
        }
        break;
    }
  }

  // ── Acquisition du flux local (caméra/micro) ─────────────────────────────────
  // Idempotent et partagée entre acceptCall() et handleOffer() : quel que soit
  // l'ordre d'arrivée (l'utilisateur appuie sur "Accepter" avant ou après que
  // l'offer WebRTC arrive du serveur), les tracks locaux sont TOUJOURS ajoutés
  // au PeerConnection avant qu'une answer ne soit créée/envoyée.
  //
  // BUG CORRIGÉ : auparavant, acceptCall() (déclenché par le tap utilisateur)
  // et handleOffer() (déclenché par le message WS 'webrtc/offer') tournaient
  // en parallèle sans se coordonner. getUserMedia() prenant ~3s (init caméra),
  // handleOffer() créait et envoyait l'answer SDP AVANT que les tracks locaux
  // ne soient ajoutés au PC — l'answer partait donc sans média. Comme il n'y a
  // pas de renégociation (pas de re-offer après addTrack tardif), le
  // back-office ne recevait jamais le flux vidéo/audio du terrain : la
  // connexion ICE pouvait s'établir mais aucune image n'apparaissait jamais.
  private ensureLocalStreamPromise: Promise<MediaStream> | null = null;

  private ensureLocalStream (): Promise<MediaStream> {
    if (this.localStream) return Promise.resolve(this.localStream);
    if (this.ensureLocalStreamPromise) return this.ensureLocalStreamPromise;

    this.ensureLocalStreamPromise = (async () => {
      if (!this.pc) {
        this.pc = await this.buildPeerConnection();
      }

      const { mediaDevices } = getWebRTC();
      let stream: MediaStream;
      try {
        stream = await mediaDevices.getUserMedia({
          audio: true,
          video: { facingMode: this.facingMode, width: 640, height: 480, frameRate: 24 },
        });
      } catch (e: any) {
        const msg = e?.name === 'NotAllowedError'
          ? 'Permission caméra/micro refusée'
          : 'Caméra ou micro indisponible';
        this.callbacks?.onMediaError?.(msg);
        this.endCallCleanup();
        this.ensureLocalStreamPromise = null;
        throw e;
      }

      this.localStream = stream;
      stream.getTracks().forEach((track: MediaStreamTrack) => {
        this.pc!.addTrack(track, stream);
      });
      this.emitStream({ type: 'local', stream });
      return stream;
    })();

    return this.ensureLocalStreamPromise;
  }

  // ── Accepter l'appel (terrain → ouvre caméra + prépare PC) ──────────────────
  // Idempotent : si déjà accepté (ex. réponse natives + in-app quasi simultanées,
  // ou si handleOffer a déjà déclenché l'acquisition), on renvoie le flux
  // existant/en cours au lieu de rouvrir la caméra une 2e fois.
  async acceptCall (): Promise<MediaStream> {
    return this.ensureLocalStream();
  }

  // ── Traitement de l'offer (reçu du back-office) ───────────────────────────
  private async handleOffer (sdp: string) {
    if (!this.pc) this.pc = await this.buildPeerConnection();

    try {
      // Attendre que le flux local (caméra/micro) soit prêt et ses tracks
      // ajoutés au PC AVANT de créer l'answer, sinon l'answer part sans média.
      await this.ensureLocalStream();

      const { RTCSessionDescription } = getWebRTC();
      await this.pc.setRemoteDescription(
        new RTCSessionDescription({ type: 'offer', sdp })
      );
      await this.flushPendingCandidates();

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      this.sendRaw({
        type: 'webrtc',
        payload: { kind: 'answer', sdp: (this.pc.localDescription as any).sdp },
      });
    } catch (e) {
      console.warn('[Signal] handleOffer:', e);
    }
  }

  // ── Drainer les candidats ICE mis en attente ──────────────────────────────
  private async flushPendingCandidates () {
    if (!this.pc) return;
    const { RTCIceCandidate } = getWebRTC();
    for (const c of this.pendingCandidates) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) {
        console.warn('[Signal] flushPendingCandidates: candidat en attente rejeté :', e);
      }
    }
    this.pendingCandidates = [];
  }

  private async fetchIceServers (): Promise<any[]> {
    try {
      const base = this.serverUrl.replace(/\/$/, '');
      const apiBase = base.startsWith('http') ? base : `http://${base}`;
      const res = await fetch(`${apiBase}/api/turn-credentials?numero=${this.numeroAgent}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const uris = Array.isArray(data?.uris) ? data.uris : [];
      return [
        ...STUN_SERVERS,
        ...uris.map((urls: string) => ({
          urls,
          username: data?.username,
          credential: data?.password,
        })),
      ];
    } catch (e) {
      console.warn('[Signal] TURN credentials indisponibles, repli sur STUN seul', e);
      return STUN_SERVERS;
    }
  }

  // ── Construction RTCPeerConnection ────────────────────────────────────────
  private async buildPeerConnection (): Promise<RTCPeerConnection> {
    const { RTCPeerConnection } = getWebRTC();
    const iceServers = await this.fetchIceServers();
    const pc = new RTCPeerConnection({ iceServers }) as RTCPeerConnection;

    pc.addEventListener('icecandidate', (e: any) => {
      if (e.candidate) {
        this.sendRaw({
          type: 'webrtc',
          payload: { kind: 'ice', candidate: e.candidate.toJSON() },
        });
      }
    });

    const handleIncomingStream = (e: any) => {
      const stream: MediaStream | undefined = e.stream ?? e.streams?.[0];
      if (!stream) return;
      console.log('[Signal] flux distant reçu', {
        trackCount: stream.getTracks?.().length ?? 0,
        connectionState: pc.connectionState,
      });
      useCallStore.getState().setCallActive(true);
      this.emitStream({ type: 'remote', stream });
    };

    pc.addEventListener('track', handleIncomingStream);
    pc.addEventListener('addstream', handleIncomingStream);
    (pc as any).ontrack = handleIncomingStream;

    pc.addEventListener('iceconnectionstatechange', () => {
      console.log('[Signal] ICE state', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        useCallStore.getState().setCallActive(true);
      }
    });

    pc.addEventListener('connectionstatechange', () => {
      console.log('[Signal] connection state', pc.connectionState);
      if (pc.connectionState === 'connected') {
        // Reprise après une coupure — annule la grâce en cours s'il y en a une
        if (this.iceGraceTimer) {
          clearTimeout(this.iceGraceTimer);
          this.iceGraceTimer = null;
          this.emitStream({ type: 'reconnected' });
        }
        return;
      }

      if (pc.connectionState === 'disconnected') {
        // Souvent transitoire (perte réseau brève) — on laisse une chance de
        // reprise avant de considérer l'appel comme terminé.
        if (this.iceGraceTimer) return; // grâce déjà en cours
        this.emitStream({ type: 'reconnecting' });
        if (typeof (pc as any).restartIce === 'function') {
          try { (pc as any).restartIce(); } catch {}
        }
        this.iceGraceTimer = setTimeout(() => {
          this.iceGraceTimer = null;
          if (pc.connectionState !== 'connected') {
            this.endCallCleanup();
            this.emitStream({ type: 'ended' });
            this.callbacks?.onCallEnded();
          }
        }, this.ICE_GRACE_MS);
        return;
      }

      if (pc.connectionState === 'failed') {
        // Échec définitif — pas de grâce
        if (this.iceGraceTimer) { clearTimeout(this.iceGraceTimer); this.iceGraceTimer = null; }
        this.endCallCleanup();
        this.emitStream({ type: 'ended' });
        this.callbacks?.onCallEnded();
      }
    });

    return pc;
  }

  // ── Re-synchroniser le token FCM (après refresh Firebase) ───────────────
  updateFcmToken (fcmToken: string) {
    this.fcmToken = fcmToken;
    this.sendRaw({ type: 'register', role: 'terrain', numero: this.numeroAgent, fcmToken });
  }

  // ── Refuser l'appel ──────────────────────────────────────────────────────
  refuseCall () {
    this.sendRaw({ type: 'refus' });
    this.endCallCleanup();
    this.emitStream({ type: 'ended' });
    this.callbacks?.onCallEnded();
  }

  // ── Raccrocher ───────────────────────────────────────────────────────────
  hangUp () {
    this.sendRaw({ type: 'hangup' });
    this.endCallCleanup();
    this.emitStream({ type: 'ended' });
    this.callbacks?.onCallEnded();
  }

  // ── Toggle micro ─────────────────────────────────────────────────────────
  toggleMic (): boolean {
    const track = this.localStream?.getAudioTracks()[0];
    if (!track) return false;
    track.enabled = !track.enabled;
    return track.enabled;
  }

  // ── Toggle caméra ────────────────────────────────────────────────────────
  toggleCamera (): boolean {
    const track = this.localStream?.getVideoTracks()[0];
    if (!track) return false;
    track.enabled = !track.enabled;
    return track.enabled;
  }

  // ── Retourner la caméra ──────────────────────────────────────────────────
  async switchCamera () {
    const track = this.localStream?.getVideoTracks()[0] as any;
    if (!track) {
      console.warn('[Signal] switchCamera: aucune piste vidéo locale disponible');
      return;
    }
    if (typeof track._switchCamera === 'function') {
      track._switchCamera();
      this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    } else {
      console.warn('[Signal] switchCamera: non supporté sur ce module natif react-native-webrtc');
    }
  }

  // ── Lecture d'état synchrone (utile pour un écran qui monte tardivement) ──
  getLocalStream ():  MediaStream | null { return this.localStream; }
  getRemoteStream (): MediaStream | null { return this.lastRemoteStream; }

  // ── Nettoyage fin d'appel ─────────────────────────────────────────────────
  private endCallCleanup () {
    if (this.iceGraceTimer) { clearTimeout(this.iceGraceTimer); this.iceGraceTimer = null; }
    this.stopPing();
    this.localStream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    this.localStream = null;
    this.ensureLocalStreamPromise = null;
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.pendingCandidates = [];
    this.lastRemoteStream = null;
    this.lastConnectionPhase = 'idle';
    useCallStore.getState().resetCall();
  }

  // ── Ping heartbeat ────────────────────────────────────────────────────────
  // Réseaux mobiles instables (Afrique centrale) : le WebSocket peut rester
  // "zombie" (readyState OPEN mais aucune donnée ne circule plus). Si 2 pings
  // d'affilée restent sans pong, on force la fermeture pour déclencher onclose
  // → reconnexion, plutôt que d'attendre un timeout TCP qui peut prendre des minutes.
  private startPing () {
    this.missedPongs  = 0;
    this.awaitingPong = false;
    this.stopPing();

    const tick = () => {
      if (this.destroyed || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.pingTimer = null;
        return;
      }

      if (this.awaitingPong) {
        this.missedPongs += 1;
        if (this.missedPongs >= 2) {
          console.warn('[Signal] Watchdog : pas de pong reçu, maintien de la session malgré tout');
          this.awaitingPong = false;
          this.missedPongs = 0;
        }
      }

      this.awaitingPong = true;
      console.log('[Signal] ping envoyé, en attente de pong...');
      this.sendRaw({ type: 'ping' });
      this.pingTimer = setTimeout(tick, 15000);
    };

    this.pingTimer = setTimeout(tick, 15000);
  }

  private stopPing () {
    if (this.pingTimer) {
      clearTimeout(this.pingTimer);
      this.pingTimer = null;
    }
    this.missedPongs  = 0;
    this.awaitingPong = false;
  }

  // ── Envoi brut (si WS ouvert) ─────────────────────────────────────────────
  private sendRaw (msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // ── Reconnexion auto (backoff exponentiel) ────────────────────────────────
  private scheduleReconnect () {
    if (this.destroyed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.destroyed) return;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30_000);
      this.connect();
    }, this.reconnectDelay);
  }

  // ── Déconnexion propre ────────────────────────────────────────────────────
  destroy () {
    this.destroyed = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.endCallCleanup();
    this.streamListeners = [];
    this.ws?.close();
    this.ws = null;
  }
}

export const signalingService = new SignalingService();