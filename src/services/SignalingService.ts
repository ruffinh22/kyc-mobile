/**
 * SignalingService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Connexion WebSocket au serveur KYC et signalisation WebRTC.
 *
 * Protocole serveur réel (video-signal.js) :
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
  | { type: 'pong' };

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

  private pendingCandidates: any[] = [];
  private localStream: MediaStream | null = null;
  private facingMode: 'user' | 'environment' = 'environment'; // Caméra arrière par défaut (terrain)

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
    return () => {
      this.streamListeners = this.streamListeners.filter(l => l !== listener);
    };
  }

  private emitStream (event: StreamEvent) {
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
    }
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
          } catch {}
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
      try { await this.pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
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
    if (!track) return;
    if (typeof track._switchCamera === 'function') {
      track._switchCamera();
      this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    }
  }

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