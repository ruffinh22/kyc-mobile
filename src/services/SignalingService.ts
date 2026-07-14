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

// ── Config ICE ───────────────────────────────────────────────────────────────
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // TURN conseillé pour les réseaux contraints (Afrique centrale) :
  // { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' },
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
  | { kind: 'ice';    candidate: RTCIceCandidateInit };

// ── Stream listeners (CallScreen s'y abonne) ─────────────────────────────────
type StreamListener = (event: StreamEvent) => void;
type StreamEvent =
  | { type: 'local';   stream: MediaStream }
  | { type: 'remote';  stream: MediaStream }
  | { type: 'ended' };

// ── Callbacks principaux ─────────────────────────────────────────────────────
export type SignalingCallbacks = {
  onConnected:    () => void;
  onDisconnected: () => void;
  onIncomingCall: (numeroMtn: string) => void;
  onCallEnded:    () => void;
  onError:        (msg: string) => void;
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
  private pingTimer:      ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = 2000;
  private destroyed      = false;

  private pendingCandidates: RTCIceCandidateInit[] = [];
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

    this.ws.onmessage = (e: { data: string }) => {
      try {
        const msg: SignalMsg = JSON.parse(e.data);
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
        // keepalive OK
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

  // ── Accepter l'appel (terrain → ouvre caméra + prépare PC) ──────────────────
  async acceptCall (): Promise<MediaStream> {
    // Créer le PC avant l'offer au cas où l'offer arrive entre-temps
    if (!this.pc) this.pc = this.buildPeerConnection();

    const { mediaDevices } = getWebRTC();
    const stream: MediaStream = await mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: this.facingMode, width: 640, height: 480, frameRate: 24 },
    });
    this.localStream = stream;

    stream.getTracks().forEach((track: MediaStreamTrack) => {
      this.pc!.addTrack(track, stream);
    });

    this.emitStream({ type: 'local', stream });
    return stream;
  }

  // ── Traitement de l'offer (reçu du back-office) ───────────────────────────
  private async handleOffer (sdp: string) {
    if (!this.pc) this.pc = this.buildPeerConnection();

    try {
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

  // ── Construction RTCPeerConnection ────────────────────────────────────────
  private buildPeerConnection (): RTCPeerConnection {
    const { RTCPeerConnection } = getWebRTC();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS }) as RTCPeerConnection;

    pc.addEventListener('icecandidate', (e: any) => {
      if (e.candidate) {
        this.sendRaw({
          type: 'webrtc',
          payload: { kind: 'ice', candidate: e.candidate.toJSON() },
        });
      }
    });

    pc.addEventListener('track', (e: any) => {
      const stream: MediaStream = e.streams?.[0];
      if (stream) {
        useCallStore.getState().setCallActive(true);
        this.emitStream({ type: 'remote', stream });
      }
    });

    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.endCallCleanup();
        this.emitStream({ type: 'ended' });
        this.callbacks?.onCallEnded();
      }
    });

    return pc;
  }

  // ── Refuser l'appel ──────────────────────────────────────────────────────
  refuseCall () {
    this.sendRaw({ type: 'refus' });
    this.endCallCleanup();
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
    this.localStream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    this.localStream = null;
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.pendingCandidates = [];
    useCallStore.getState().resetCall();
  }

  // ── Ping heartbeat ────────────────────────────────────────────────────────
  private startPing () {
    this.pingTimer = setInterval(() => this.sendRaw({ type: 'ping' }), 25000);
  }
  private stopPing () {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
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
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30_000);
      this.connect();
    }, this.reconnectDelay);
  }

  // ── Déconnexion propre ────────────────────────────────────────────────────
  destroy () {
    this.destroyed = true;
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.endCallCleanup();
    this.streamListeners = [];
    this.ws?.close();
    this.ws = null;
  }
}

export const signalingService = new SignalingService();
