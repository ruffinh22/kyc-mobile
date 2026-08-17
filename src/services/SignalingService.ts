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
 *   REÇOIT  : incoming-call { numeroMtn, callUuid?, agentAppelantMatricule?, agentAppelantNom? }
 *             (les 2 derniers champs identifient l'agent back-office qui a
 *             déclenché l'appel — voir VideoCallPage.tsx / public-dossiers.ts.
 *             Optionnels pour compat ascendante.)
 *   REÇOIT  : webrtc        { payload: { kind:'offer'|'answer'|'ice', ... } }
 *   REÇOIT  : refus
 *   REÇOIT  : hangup
 *   REÇOIT  : pong
 *
 * NOTE : le serveur route par `numero` (pas de from/to dans les messages webrtc).
 *
 * ── EXTENSION APPEL SORTANT (terrain → back-office/numéro) ─────────────────
 * IMPLÉMENTÉE CÔTÉ SERVEUR (public-dossiers.ts) — ce commentaire indiquait
 * auparavant le contraire, ce qui n'était plus à jour. Résumé du protocole
 * réel :
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

import { MediaStream } from 'react-native-webrtc';
import type {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
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
  | { type: 'incoming-call'; numeroMtn: string; callUuid?: string; agentAppelantMatricule?: string; agentAppelantNom?: string }
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
  // callUuid : identifiant réel émis par le serveur (voir public-dossiers.ts).
  // Optionnel pour compat ascendante si un ancien build serveur ne l'envoie
  // pas encore — dans ce cas l'appelant doit générer un uuid de secours.
  // agentAppelantMatricule/Nom : identité de l'agent back-office à l'origine
  // de l'appel, elle aussi optionnelle pour compat ascendante (ancien build
  // serveur qui ne les transmet pas encore).
  onIncomingCall: (numeroMtn: string, callUuid?: string, agentAppelantMatricule?: string, agentAppelantNom?: string) => void;
  onCallEnded:    () => void;
  onError:        (msg: string) => void;
  onMediaError?:  (msg: string) => void;  // caméra/micro indisponible
};

// ─────────────────────────────────────────────────────────────────────────────
class SignalingService {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  // ── Garde-fou contre la double construction de PeerConnection ────────────
  // Même classe de bug que celui déjà corrigé pour ensureLocalStreamPromise
  // (voir son commentaire plus bas) : acceptCall() et handleOffer() peuvent
  // s'exécuter en concurrence, et buildPeerConnection() est asynchrone
  // (attend fetchIceServers()). Pendant cette attente, `this.pc` reste `null`
  // — donc SANS ce garde-fou, un `if (!this.pc) this.pc = await
  // buildPeerConnection()` exécuté depuis deux chemins en parallèle construit
  // DEUX PeerConnection pour le même appel. Conséquence observée en prod :
  // des candidats ICE destinés à la session SDP de l'un arrivent alors que
  // `this.pc` pointe déjà vers l'autre → rejetés en masse ("Error processing
  // ICE candidate") → l'ICE n'atteint jamais un état stable → la connexion
  // bascule en 'failed'/'disconnected' → l'appel raccroche de lui-même.
  private pcPromise: Promise<RTCPeerConnection> | null = null;

  // Point d'entrée UNIQUE pour obtenir/créer le PeerConnection de l'appel en
  // cours : à appeler partout où le code faisait auparavant
  // `if (!this.pc) this.pc = await this.buildPeerConnection();`.
  private ensurePeerConnection (): Promise<RTCPeerConnection> {
    if (this.pc) return Promise.resolve(this.pc);
    if (this.pcPromise) return this.pcPromise;

    this.pcPromise = this.buildPeerConnection().then((pc) => {
      this.pc = pc;
      return pc;
    }).catch((e) => {
      // Échec de construction : on libère le verrou pour permettre une
      // nouvelle tentative au prochain appel, sinon le call reste bloqué à
      // vie sur une promesse rejetée mise en cache.
      this.pcPromise = null;
      throw e;
    });
    return this.pcPromise;
  }
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

  private pendingCandidates: Array<{ candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null }> = [];
  private remoteDescriptionReady = false;

  // ── Offer reçue avant acceptation utilisateur ────────────────────────────
  // GARDE-FOU : avant, l'offer WebRTC était traitée (setRemoteDescription +
  // createAnswer + ouverture caméra/micro + envoi de l'answer) dès sa
  // réception WebSocket, AVANT que l'utilisateur n'ait tapé "Accepter" sur
  // IncomingCallScreen. Conséquence en prod : l'appel devenait 'connected'
  // tout seul quelques secondes après l'affichage de la sonnerie, sans
  // aucune action de l'agent — puis CallKeep/le timeout coupait cet appel
  // "accepté par erreur" en local, donnant l'impression d'un appel qui se
  // termine tout seul après ~3s.
  //
  // Correctif : si l'offer arrive pendant que le store est encore 'incoming'
  // (l'utilisateur n'a pas encore répondu), on la RETIENT ici sans toucher
  // ni au PeerConnection ni à la caméra/micro. Elle n'est rejouée que
  // lorsque acceptCall() est réellement invoqué (tap sur "Accepter",
  // acceptation native CallKeep, ou flux d'appel sortant où l'acceptation a
  // déjà eu lieu côté agent). Si l'appel est refusé/terminé avant que
  // l'utilisateur ait tranché, endCallCleanup() vide ce champ : l'offer
  // en attente est alors simplement jetée, jamais traitée.
  private pendingOfferSdp: string | null = null;
  // Horodatage de mise en attente — sert de garde-fou de fraîcheur (voir
  // BUG CORRIGÉ ci-dessous) : une offer bufferée trop longtemps ne doit
  // jamais être rejouée pour un appel sans rapport.
  private pendingOfferSdpAt = 0;
  private static readonly PENDING_OFFER_MAX_AGE_MS = 15000;
  private localStream: MediaStream | null = null;
  // ── Garde-fou "caméra fantôme" ────────────────────────────────────────────
  // Incrémenté à chaque endCallCleanup(). getUserMedia() (ensureLocalStream)
  // peut prendre 1 à 3s sur du matériel terrain ; si un hangup/refus distant
  // arrive PENDANT cette fenêtre, endCallCleanup() tourne et remet tout à
  // zéro AVANT que la promesse getUserMedia() ne se résolve. Sans ce
  // compteur, la caméra qui finit par s'ouvrir plus tard se rattachait quand
  // même à un PeerConnection flambant neuf, pour un appel déjà terminé — une
  // caméra restait allumée "pour rien" et bloquait le décroché de l'appel
  // suivant (matériel caméra déjà occupé par ce flux orphelin).
  private callGeneration = 0;
  private facingMode: 'user' | 'environment' = 'environment'; // Caméra arrière par défaut (terrain)

  private normalizeIceCandidate (candidate: any): { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } | null {
    if (!candidate || typeof candidate.candidate !== 'string' || !candidate.candidate.trim()) {
      return null;
    }

    const normalized = {
      candidate: candidate.candidate.trim(),
      sdpMid: candidate.sdpMid != null ? String(candidate.sdpMid) : undefined,
      sdpMLineIndex: candidate.sdpMLineIndex != null ? Number(candidate.sdpMLineIndex) : undefined,
    };

    if (normalized.sdpMid == null && typeof normalized.sdpMLineIndex !== 'number') {
      return null;
    }
    return normalized;
  }

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
  private getHttpServerUrl () {
    const base = this.serverUrl.replace(/\/$/, '');
    if (base.startsWith('http://') || base.startsWith('https://')) {
      return base;
    }
    return `https://${base}`;
  }

  private connect () {
    if (this.destroyed) return;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // BUG CORRIGÉ : connect() créait toujours un `new WebSocket(...)` sans
    // jamais fermer une éventuelle connexion précédente encore ouverte.
    // init() peut être appelé plusieurs fois par session (IdleScreen se
    // remonte à chaque retour à l'accueil après un appel) — sans ce
    // nettoyage, chaque remontage laissait une ancienne socket orpheline
    // ouverte en parallèle de la nouvelle : double 'register' envoyé au
    // serveur, doublons potentiels de tout message entrant (dont
    // 'incoming-call'/'offer') traités deux fois côté client.
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    // Garde la présence terrain active même si l'app reste longtemps en arrière-plan.
    // On ne veut pas que la connexion WebSocket se perde en silence et fasse croire
    // que l'agent n'est plus disponible.
    this.reconnectDelay = Math.min(this.reconnectDelay, 4000);

    const httpUrl = this.getHttpServerUrl();
    const wsUrl = httpUrl.replace(/^http/i, 'ws') + '/api/signaling';

    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 2000;
      this.reRegister();
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

  private reRegister () {
    this.sendRaw({
      type:     'register',
      role:     'terrain',
      numero:   this.numeroAgent,
      fcmToken: this.fcmToken || undefined,
    });
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
        console.log('[Signal] incoming-call reçu', {
          numeroMtn: msg.numeroMtn, callUuid: msg.callUuid,
          agentAppelantMatricule: msg.agentAppelantMatricule, agentAppelantNom: msg.agentAppelantNom,
        });
        // IMPORTANT : on ne doit pas mettre à jour le callStore directement ici
        // car ce chemin est un canal de livraison parmi d'autres (WS vs FCM).
        // La centralisation de la déduplication et de l'affichage natif doit se
        // faire dans NotificationService.registerIncomingCall() afin que le
        // même comportement s'applique à tous les canaux.
        if (store.status !== 'idle') {
          console.log('[Signal] appel déjà en cours de traitement, incoming-call ignoré', {
            statut: store.status, numeroMtn: msg.numeroMtn, callUuid: msg.callUuid,
          });
          break;
        }
        if (this.callbacks?.onIncomingCall) {
          setTimeout(() => {
            console.log('[Signal] déclenche onIncomingCall', { numeroMtn: msg.numeroMtn, callUuid: msg.callUuid });
            this.callbacks?.onIncomingCall(msg.numeroMtn, msg.callUuid, msg.agentAppelantMatricule, msg.agentAppelantNom);
          }, 80);
        }
        break;

      // ── Signalisation WebRTC (offer / answer / ice) ───────────────────────
      case 'webrtc':
        await this.handleWebRTC(msg.payload);
        break;

      // ── Raccrochage ou refus distant ──────────────────────────────────────
      case 'refus':
      case 'hangup':
        // Ce cas ne loggait rien avant de fermer le PeerConnection : un appel
        // qui se coupait à cause d'un hangup légitime envoyé par le serveur
        // (ex. le back-office web ferme son socket pendant que pendingCalls
        // le tient encore comme "en cours" — voir public-dossiers.ts,
        // socket.on('close')) apparaissait dans les logs comme une coupure
        // sans raison. Ce log permet de trancher immédiatement : coupure
        // distante confirmée vs. échec ICE local.
        console.log('[Signal] hangup/refus reçu du serveur — fin d’appel', { type: msg.type });
        this.endCallCleanup('remote-hangup');
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

      case 'offer': {
        console.log('[Signal] offer reçu', { sdpLength: payload.sdp?.length ?? 0, sdpType: typeof payload.sdp });

        const status = useCallStore.getState().status;

        // BUG CORRIGÉ : cette branche ne bufferisait l'offer QUE si status
        // === 'incoming'. Or le serveur envoie l'offer quasiment en même
        // temps que le signal "appel entrant" (push FCM + message WS), alors
        // que côté client callStore.status ne passe à 'incoming' qu'après
        // ~220ms de délais volontaires enchaînés (100ms dans
        // NotificationService.registerIncomingCall, puis 120ms dans
        // App.tsx — anti-doublon WS/FCM). Si l'offer arrivait dans cette
        // fenêtre, status valait encore 'idle', et la branche du bas
        // ("offer hors contexte, ignorée") la jetait — pensant à tort qu'il
        // s'agissait d'un appel déjà refusé/terminé. Résultat observé en
        // prod : acceptCall() ne trouvait plus jamais d'offer à rejouer,
        // aucune answer n'était envoyée au serveur, et l'appel restait
        // bloqué (remoteDescriptionReady toujours false) jusqu'au timeout.
        // On bufferise donc aussi sur 'idle' — sans risque de réintroduire
        // l'ancien bug (répondre à un appel explicitement refusé) car
        // refuseCall()/hangUp() appellent endCallCleanup(), qui vide déjà
        // pendingOfferSdp immédiatement ; le garde-fou de fraîcheur
        // (PENDING_OFFER_MAX_AGE_MS, vérifié dans acceptCall()) couvre en
        // plus le cas résiduel d'une offer bufferée trop longtemps.
        if (status === 'incoming' || status === 'idle') {
          console.log('[Signal] offer reçue avant acceptation utilisateur, mise en attente (aucune answer envoyée)', { status });
          this.pendingOfferSdp = payload.sdp;
          this.pendingOfferSdpAt = Date.now();
          break;
        }

        // 'connecting' (l'utilisateur/le flux sortant a déjà accepté) ou
        // 'active' (redial/renégociation sur un appel déjà en cours) :
        // traitement immédiat, comportement inchangé.
        if (status === 'connecting' || status === 'active') {
          await this.handleOffer(payload.sdp);
          break;
        }

        // 'declined' / 'failed' / 'ended' / etc. (mais plus 'idle', bufferisé
        // ci-dessus) : cette offer concerne un appel déjà refusé/terminé
        // côté client (race avec le serveur). On ne répond surtout pas —
        // sinon on rouvre une caméra et on accepte un appel que
        // l'utilisateur a explicitement refusé.
        console.warn('[Signal] offer reçue hors contexte d’appel actif, ignorée', { status });
        break;
      }

      case 'answer': {
        const pc = this.pc;
        if (pc) {
          try {
            const { RTCSessionDescription } = getWebRTC();
            await pc.setRemoteDescription(
              new RTCSessionDescription({ type: 'answer', sdp: payload.sdp })
            );
            this.remoteDescriptionReady = true;
            await this.flushPendingCandidates(pc);
          } catch (e) {
            console.warn('[Signal] setRemoteDescription answer:', e);
          }
        }
        break;
      }

      case 'ice': {
        const pc = this.pc;
        const normalizedCandidate = this.normalizeIceCandidate(payload.candidate);
        console.log('[Signal] ICE candidate reçu', {
          hasPC: Boolean(pc),
          signalingState: pc?.signalingState,
          connectionState: pc?.connectionState,
          hasRemoteDescription: Boolean(pc?.remoteDescription),
          remoteDescriptionReady: this.remoteDescriptionReady,
          candidate: normalizedCandidate ? {
            sdpMid: normalizedCandidate.sdpMid,
            sdpMLineIndex: normalizedCandidate.sdpMLineIndex,
            candidate: normalizedCandidate.candidate.slice(0, 64),
          } : null,
          callStatus: useCallStore.getState().status,
        });
        if (!normalizedCandidate) {
          console.warn('[Signal] ICE candidate invalide ignorée', {
            candidate: payload.candidate,
            candidateJson: JSON.stringify(payload.candidate),
          });
          break;
        }
        if (!pc || pc.connectionState === 'closed' || pc.iceConnectionState === 'closed') {
          if (!this.remoteDescriptionReady) {
            console.log('[Signal] ICE candidat reçu avant PeerConnection ou avant remoteDescription, mise en attente', {
              candidate: normalizedCandidate,
              hasPC: Boolean(pc),
              signalingState: pc?.signalingState,
            });
            this.pendingCandidates.push(normalizedCandidate);
            break;
          }
          console.warn('[Signal] ICE candidate ignorée : PeerConnection fermée ou absente', { candidate: normalizedCandidate });
          break;
        }
        if (!this.remoteDescriptionReady) {
          console.log('[Signal] ICE candidat mis en attente (remote description pas encore prête)', {
            candidate: normalizedCandidate,
            signalingState: pc.signalingState,
          });
          this.pendingCandidates.push(normalizedCandidate);
          break;
        }
        try {
          const { RTCIceCandidate } = getWebRTC();
          await pc.addIceCandidate(new RTCIceCandidate(normalizedCandidate));
          console.log('[Signal] addIceCandidate réussi');
        } catch (e) {
          console.warn('[Signal] addIceCandidate a échoué (candidat ignoré) :', e, { candidate: normalizedCandidate });
        }
        break;
      }
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

    const generationAtStart = this.callGeneration;

    this.ensureLocalStreamPromise = (async () => {
      await this.ensurePeerConnection();

      const { mediaDevices } = getWebRTC();
      let stream: MediaStream;
        try {
        stream = await mediaDevices.getUserMedia({
          audio: true,
          video: { facingMode: this.facingMode, width: 640, height: 480, frameRate: 24 },
        });
      } catch (e: any) {
        try {
          console.warn('[Signal] getUserMedia vidéo impossible, repli audio seul', e);
          stream = await mediaDevices.getUserMedia({ audio: true, video: false });
          console.log('[Signal] flux local audio seul prêt');
        } catch (audioErr: any) {
          const msg = audioErr?.name === 'NotAllowedError'
            ? 'Permission caméra/micro refusée'
            : 'Caméra ou micro indisponible';
          this.callbacks?.onMediaError?.(msg);
          this.endCallCleanup('media-error');
          this.ensureLocalStreamPromise = null;
          throw audioErr;
        }
      }

      // L'appel pour lequel on vient d'ouvrir la caméra a pu se terminer
      // (hangup/refus distant, timeout) PENDANT que getUserMedia() tournait
      // — endCallCleanup() a alors déjà tout nettoyé et bumped callGeneration.
      // On refuse de rattacher ce flux "orphelin" : on le ferme tout de
      // suite au lieu de le stocker comme this.localStream / l'ajouter au
      // PeerConnection (potentiellement déjà celui d'un TOUT nouvel appel).
      if (this.callGeneration !== generationAtStart) {
        console.warn('[Signal] flux local obtenu pour un appel déjà terminé — abandon (caméra fantôme évitée)');
        stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        if (this.ensureLocalStreamPromise) this.ensureLocalStreamPromise = null;
        throw new Error('call-superseded');
      }

      this.localStream = stream;
      stream.getTracks().forEach((track: MediaStreamTrack) => {
        track.enabled = track.kind === 'audio' ? true : track.enabled;
        this.pc!.addTrack(track, stream);
      });
      const trackKinds = stream.getTracks().map((track: MediaStreamTrack) => track.kind).join(',');
      console.log('[Signal] flux local prêt', { trackKinds, audioEnabled: stream.getAudioTracks().some((t: MediaStreamTrack) => t.enabled) });
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
    const stream = await this.ensureLocalStream();

    // Si une offer était arrivée pendant que l'appel sonnait encore
    // (statut 'incoming'), c'est SEULEMENT maintenant — l'utilisateur ayant
    // réellement accepté — qu'on la traite : setRemoteDescription,
    // createAnswer, envoi de l'answer. Avant ce point, aucune answer n'a
    // jamais été envoyée au serveur pour cet appel.
    if (this.pendingOfferSdp) {
      const age = Date.now() - this.pendingOfferSdpAt;
      if (age > SignalingService.PENDING_OFFER_MAX_AGE_MS) {
        // Garde-fou de fraîcheur : une offer bufferée pendant l'état 'idle'
        // (voir handleWebRTC ci-dessus) peut, dans un cas résiduel très rare,
        // concerner un appel déjà abandonné dont endCallCleanup() n'a pas
        // encore eu l'occasion de vider pendingOfferSdp. On refuse de la
        // rejouer si elle date de trop longtemps plutôt que de risquer de
        // répondre au mauvais appel.
        console.warn('[Signal] pendingOfferSdp trop ancienne, abandonnée plutôt que rejouée', { ageMs: age });
        this.pendingOfferSdp = null;
      } else {
        const sdp = this.pendingOfferSdp;
        this.pendingOfferSdp = null;
        await this.handleOffer(sdp);
      }
    }

    return stream;
  }

  // Empêche deux négociations de tourner en parallèle sur le même PC : sans
  // ça, un doublon de redial arrivant PENDANT la fenêtre d'ouverture caméra
  // (~3s, voir ensureLocalStream) passait à travers le contrôle
  // "alreadyConnected" ci-dessous (rien n'est encore connecté à ce stade) et
  // lançait un 2e setRemoteDescription sur le même PC avant que le premier
  // n'ait fini — c'est la vraie cause du "order of m-lines doesn't match".
  private handlingOffer = false;

  // ── Traitement de l'offer (reçu du back-office) ───────────────────────────
  private async handleOffer (sdp: string) {
    if (this.handlingOffer) {
      console.log('[Signal] offer ignoré : une négociation est déjà en cours pour cet appel');
      return;
    }

    // BUG CORRIGÉ : le verrou était posé APRÈS un premier `await`
    // (ensurePeerConnection(), qui va chercher les credentials TURN en
    // réseau — potentiellement plusieurs centaines de ms). JS étant
    // mono-thread mais async, une 2e offre arrivant PENDANT cette fenêtre
    // passait le check `this.handlingOffer` (encore `false`) avant que la
    // 1re exécution n'ait eu le temps de le mettre à `true`. Les deux
    // négociations tournaient alors en parallèle sur le même
    // RTCPeerConnection (2x setRemoteDescription, 2x createAnswer, 2x
    // setLocalDescription quasi simultanés) → "Called in wrong state:
    // stable" et échec ICE. En posant le verrou ICI, avant tout `await`,
    // il n'y a plus aucun point de suspension entre le check et la prise
    // du verrou : c'est atomique, une 2e offre concurrente est bloquée à
    // coup sûr.
    this.handlingOffer = true;

    try {
      if (!this.pc) await this.ensurePeerConnection();
      if (!this.pc) {
        console.warn('[Signal] handleOffer: PeerConnection absent après ensurePeerConnection');
        return;
      }

      const pc = this.pc;
      const alreadyConnected =
        pc.connectionState === 'connected' &&
        !!this.lastRemoteStream?.getTracks().length;
      if (alreadyConnected) {
        console.log('[Signal] offer ignoré : connexion déjà établie pour cet appel');
        return;
      }

      this.remoteDescriptionReady = false;
      await this.ensureLocalStream();
      if (!this.pc || this.pc !== pc) {
        console.warn('[Signal] handleOffer: PeerConnection remplacé pendant l’init locale');
        return;
      }

      if (!sdp || typeof sdp !== 'string') {
        console.warn('[Signal] handleOffer: offre SDP invalide', { sdpLength: sdp?.length ?? 0, sdp });
        return;
      }

      const { RTCSessionDescription } = getWebRTC();
      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: 'offer', sdp })
      );
      this.remoteDescriptionReady = true;
      await this.flushPendingCandidates(pc);

      const answer = await pc.createAnswer();
      console.log('[Signal] createAnswer result', {
        type: answer?.type,
        sdpLength: (answer as any)?.sdp?.length ?? 0,
      });
      if (!answer || typeof (answer as any).sdp !== 'string') {
        throw new Error('Answer SDP absent après createAnswer');
      }
      await pc.setLocalDescription(answer);

      const localSdp = (pc.localDescription as any)?.sdp;
      if (!localSdp) throw new Error('Local SDP absent après setLocalDescription');

      this.sendRaw({
        type: 'webrtc',
        numero: this.numeroAgent,
        payload: { kind: 'answer', sdp: localSdp },
      });
    } catch (e) {
      console.warn('[Signal] handleOffer:', e);
    } finally {
      this.handlingOffer = false;
    }
  }

  // ── Drainer les candidats ICE mis en attente ──────────────────────────────
  private async flushPendingCandidates (pc?: RTCPeerConnection) {
    const targetPc = pc ?? this.pc;
    if (!targetPc) return;
    const { RTCIceCandidate } = getWebRTC();
    for (const c of this.pendingCandidates) {
      if (!this.normalizeIceCandidate(c)) {
        console.warn('[Signal] flushPendingCandidates: candidat invalide ignoré', { candidate: c });
        continue;
      }
      try {
        await targetPc.addIceCandidate(new RTCIceCandidate(c));
        console.log('[Signal] flushPendingCandidates: candidat accepté', { candidate: c });
      } catch (e) {
        console.warn('[Signal] flushPendingCandidates: candidat en attente rejeté :', e, { candidate: c });
      }
    }
    this.pendingCandidates = [];
  }

  private async fetchIceServers (): Promise<any[]> {
    try {
      const apiBase = this.getHttpServerUrl();
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
          numero: this.numeroAgent,
          payload: { kind: 'ice', candidate: e.candidate.toJSON() },
        });
      }
    });

    const handleIncomingStream = (e: any) => {
      const incoming: MediaStream | undefined = e.stream ?? e.streams?.[0];
      if (!incoming && !e.track) return;

      // BUG CORRIGÉ : muter this.lastRemoteStream EN PLACE (addTrack sur le
      // même objet) puis réémettre CE MÊME objet cassait l'affichage vidéo.
      // L'audio arrive quasi toujours avant la vidéo (2 événements 'track'
      // séparés) : au 1er événement, CallScreen fait setRemoteStream(merged)
      // → vraie transition null→objet → re-render → RTCView s'affiche (avec
      // l'audio seul). Au 2e événement (piste vidéo ajoutée), on rappelait
      // setRemoteStream(merged) avec EXACTEMENT LA MÊME référence d'objet
      // JS : React voit `Object.is(prev, next) === true` et ne re-render
      // JAMAIS. Le `useMemo` de remoteStreamUrl (et le `key` du RTCView qui
      // en dépend) n'est donc jamais recalculé — RTCView ne se remonte pas
      // pour prendre en compte la piste vidéo pourtant bien arrivée côté
      // WebRTC (l'appel se connecte, le son passe, mais l'image reste vide).
      // Correctif : reconstruire un MediaStream FLAMBANT NEUF à chaque piste
      // reçue, en reprenant les pistes déjà connues + la nouvelle. Un nouvel
      // objet à chaque évolution garantit une vraie transition d'état React
      // (donc un re-render) à chaque piste ajoutée, pas seulement à la 1re.
      const previousTracks = this.lastRemoteStream?.getTracks() ?? [];
      const nextTracks = [...previousTracks];
      const addIfNew = (track: MediaStreamTrack) => {
        if (!nextTracks.some((t) => t.id === track.id)) nextTracks.push(track);
      };

      if (incoming) {
        incoming.getTracks?.().forEach(addIfNew);
      } else if (e.track) {
        addIfNew(e.track);
      }

      const merged = new MediaStream(nextTracks);
      this.lastRemoteStream = merged;

      console.log('[Signal] flux distant reçu', {
        trackCount: merged.getTracks?.().length ?? 0,
        connectionState: pc.connectionState,
      });
      useCallStore.getState().setCallActive(true);
      this.emitStream({ type: 'remote', stream: merged });
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
        //
        // BUG CORRIGÉ : la présence d'un flux distant (this.lastRemoteStream)
        // faisait auparavant `return` immédiatement ICI, sans jamais armer
        // iceGraceTimer ni appeler restartIce(). Or lastRemoteStream reste
        // rempli pour le reste de l'appel dès la première piste reçue — ça
        // ne dit rien sur l'état ACTUEL de la connexion. Résultat : dès
        // qu'un appel avait été connecté une fois, une coupure réseau réelle
        // en plein appel n'était plus jamais détectée comme telle : pas de
        // tentative de reprise ICE, pas de timeout, l'agent restait bloqué
        // indéfiniment sur un écran d'appel figé (caméra/micro jamais
        // libérés, onCallEnded() jamais déclenché). On traite maintenant
        // 'disconnected' de façon uniforme, qu'un flux ait déjà existé ou
        // non : on tente toujours restartIce() et on arme toujours la grâce.
        this.emitStream({ type: 'reconnecting' });
        if (typeof (pc as any).restartIce === 'function') {
          try { (pc as any).restartIce(); } catch {}
        }
        if (this.iceGraceTimer) return; // grâce déjà en cours, ne pas la redémarrer
        this.iceGraceTimer = setTimeout(() => {
          this.iceGraceTimer = null;
          if (pc.connectionState !== 'connected') {
            this.endCallCleanup('ice-grace-timeout');
            this.emitStream({ type: 'ended' });
            this.callbacks?.onCallEnded();
          }
        }, this.ICE_GRACE_MS);
        return;
      }

      if (pc.connectionState === 'failed') {
        // BUG CORRIGÉ : 'failed' est l'état TERMINAL du protocole ICE — par
        // définition, aucun média ne peut plus circuler sur cette
        // PeerConnection, qu'un flux distant ait ou non déjà existé par le
        // passé. Le même `if (lastRemoteStream) return` qu'en 'disconnected'
        // ci-dessus laissait alors l'appel bloqué à vie dès qu'un flux avait
        // été vu une fois : plus aucun nettoyage possible pour cet appel.
        // 'failed' met donc toujours fin à l'appel, sans exception.
        if (this.iceGraceTimer) { clearTimeout(this.iceGraceTimer); this.iceGraceTimer = null; }
        this.endCallCleanup('ice-failed');
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
    this.endCallCleanup('local-refuse');
    this.emitStream({ type: 'ended' });
    this.callbacks?.onCallEnded();
  }

  // ── Raccrocher ───────────────────────────────────────────────────────────
  hangUp () {
    this.sendRaw({ type: 'hangup' });
    this.endCallCleanup('local-hangup');
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
  private endCallCleanup (reason?: string) {
    this.callGeneration += 1;
    if (this.iceGraceTimer) { clearTimeout(this.iceGraceTimer); this.iceGraceTimer = null; }
    try {
      console.log('[Signal] endCallCleanup invoked', {
        reason: reason || 'unspecified',
        callUuid: useCallStore.getState().callUuid,
        remoteDescriptionReady: this.remoteDescriptionReady,
        pendingCandidates: this.pendingCandidates.length,
        hasPC: Boolean(this.pc),
      });
      console.trace();
    } catch (e) {
      console.warn('[Signal] endCallCleanup: unable to log diagnostics', e);
    }
    this.stopPing();
    this.handlingOffer = false;
    this.pendingOfferSdp = null;
    this.remoteDescriptionReady = false;
    this.localStream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    this.localStream = null;
    this.ensureLocalStreamPromise = null;
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.pcPromise = null;
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
          // BUG CORRIGÉ : cette branche se contentait auparavant de logguer un
          // avertissement puis de réinitialiser silencieusement les compteurs
          // ("maintien de la session malgré tout") — le watchdog ne watchait
          // donc jamais rien. Sur une socket "zombie" (readyState OPEN mais
          // plus aucune donnée ne circule, cas fréquent sur réseau mobile
          // instable), l'agent restait indéfiniment enregistré comme
          // disponible côté serveur sans jamais recevoir le moindre message,
          // y compris 'incoming-call' — silencieusement, jusqu'au prochain
          // redémarrage manuel de l'app. On force maintenant la fermeture
          // pour déclencher onclose() → scheduleReconnect(), comme le
          // décrivait déjà le commentaire au-dessus de startPing().
          console.warn('[Signal] Watchdog : pas de pong après 2 tentatives, fermeture forcée pour reconnexion', {
            missedPongs: this.missedPongs,
          });
          this.pingTimer = null;
          try {
            this.ws?.close();
          } catch (e) {
            console.warn('[Signal] Watchdog : échec fermeture socket zombie, reconnexion forcée manuellement', e);
            this.stopPing();
            this.scheduleReconnect();
          }
          return; // onclose (ou le catch ci-dessus) prend le relais — pas de nouveau ping ici
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

  // Appelé quand l'application reprend le premier plan : on renvoie un register
  // immédiat pour réaffirmer la disponibilité terrain, même si la session avait
  // été en sommeil longtemps.
  resumePresence () {
    if (!this.numeroAgent) return;
    this.reRegister();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.startPing();
    } else {
      this.reconnectDelay = 2000;
      this.connect();
    }
  }

  // ── Déconnexion propre ────────────────────────────────────────────────────
  destroy () {
    this.destroyed = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.endCallCleanup('destroy');
    this.streamListeners = [];
    this.ws?.close();
    this.ws = null;
  }
}

export const signalingService = new SignalingService();