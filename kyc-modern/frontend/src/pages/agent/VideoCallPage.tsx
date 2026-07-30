import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import * as api from '../../services/api';
import { Alert } from '../../components/ui';

const normalizeNumero = (value: string | null | undefined) => String(value || '').replace(/\D/g, '');

// 'disconnected' est un état transitoire fréquent (changement wifi/4G côté
// terrain, brève coupure) : on lui laisse une fenêtre de grâce avant de
// tenter un ICE restart, plutôt que de couper l'appel immédiatement.
const ICE_DISCONNECT_GRACE_MS = 6_000;

// Comme WhatsApp/Messenger : on ne lâche pas l'appel au premier accroc ICE.
// Plusieurs tentatives de restart, et à partir de la 2e on force le passage
// par TURN (iceTransportPolicy 'relay') — la cause n°1 d'échec définitif ici
// est un NAT symétrique où les candidats host/srflx ne matchent jamais des
// deux côtés ; forcer le relais TURN contourne ce cas au prix de la latence.
const MAX_ICE_RESTART_ATTEMPTS = 4;
const ICE_RESTART_RETRY_DELAY_MS = 1_500;
const FORCE_RELAY_FROM_ATTEMPT = 2;

type SignalMessage =
  | { type: 'registered'; role: string; numero: string }
  | { type: 'terrain-presence'; enLigne: boolean; numero: string }
  | { type: 'call-delivered'; numero: string; callUuid: string }
  | { type: 'call-ringing' }
  | { type: 'call-accepted' }
  | { type: 'call-rejected' }
  | { type: 'call-unavailable'; reason?: string }
  | { type: 'no-answer'; numero: string; callUuid: string }
  | { type: 'incoming-call'; numero: string; numeroMtn: string }
  | { type: 'hangup' }
  | { type: 'webrtc'; payload: any }
  | { type: 'pong' }
  | { type: 'terrain-absent'; numero: string };

// ── Icônes ────────────────────────────────────────────────────────────────
// Traits fins, cohérents, plutôt que des emoji (rendu variable selon l'OS).
type IconProps = { size?: number };
const strokeProps = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const IconMic = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...strokeProps}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
  </svg>
);
const IconMicOff = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...strokeProps}>
    <path d="M3 3l18 18" />
    <path d="M9 9v5a3 3 0 0 0 4.6 2.55M15 9.5V5a3 3 0 0 0-5.9-.8" />
    <path d="M5 11a7 7 0 0 0 10.3 6.2M19 11a7 7 0 0 1-1 3.6" />
    <path d="M12 18v4M8 22h8" />
  </svg>
);
const IconCam = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...strokeProps}>
    <rect x="2" y="6" width="14" height="12" rx="3" />
    <path d="M16 10.5l5-3v9l-5-3" />
  </svg>
);
const IconCamOff = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...strokeProps}>
    <path d="M2 2l20 20" />
    <path d="M16 10.5l5-3v9l-5-3" />
    <path d="M14 6H5a3 3 0 0 0-3 3v6c0 .9.4 1.7 1 2.3" />
    <path d="M9.5 18H13a3 3 0 0 0 3-3v-1.5" />
  </svg>
);
const IconPhoneCall = ({ size = 22 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...strokeProps}>
    <path d="M4 5c0 8.5 6.5 15 15 15l1.5-3.6a1.5 1.5 0 0 0-.9-2L15.8 13a1.5 1.5 0 0 0-1.7.4l-1.4 1.6a11 11 0 0 1-4.7-4.7L9.6 8.9a1.5 1.5 0 0 0 .4-1.7L8.6 3.4A1.5 1.5 0 0 0 6.6 2.5L4 4Z" />
  </svg>
);
const IconPhoneOff = ({ size = 22 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...strokeProps}>
    <path d="M3 3l18 18" />
    <path d="M20.5 16.4l.5-1.2a1.5 1.5 0 0 0-.9-2L15.8 12a1.5 1.5 0 0 0-1.7.4l-1.4 1.6a11.1 11.1 0 0 1-3.2-2.4M9.6 7.9L8.6 3.4A1.5 1.5 0 0 0 6.6 2.5L4 4c0 3.4 1 6.6 2.7 9.3" />
  </svg>
);
const IconRotate = ({ size = 18 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...strokeProps}>
    <path d="M3 12a9 9 0 1 1 2.6 6.3" />
    <path d="M3 21v-5h5" />
  </svg>
);
const IconExpand = ({ size = 18 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...strokeProps}>
    <path d="M9 3H3v6M15 21h6v-6M21 3l-7 7M3 21l7-7" />
  </svg>
);
const IconShrink = ({ size = 18 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...strokeProps}>
    <path d="M9 3v4a2 2 0 0 1-2 2H3M15 21v-4a2 2 0 0 1 2-2h4M21 3l-7 7M3 21l7-7" />
  </svg>
);
const IconUser = ({ size = 36 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...strokeProps}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
  </svg>
);

export function AgentVideoCallPage() {
  const { user } = useAuth();
  const params = useMemo(() => new URLSearchParams(window.location.search), [window.location.search]);
  const [terrain, setTerrain] = useState(params.get('terrain') || '');
  const [numeroMtn, setNumeroMtn] = useState(params.get('mtn') || '');
  const [dossierId, setDossierId] = useState(params.get('dossier') || '');
  // Déclenche l'appel automatiquement dès que la signalisation est prête,
  // quand on arrive depuis le bouton "Appeler terrain" (DossierPages).
  // useRef (pas useState) car on ne veut PAS re-render sur ce changement,
  // juste empêcher un second appel automatique si le composant re-rend
  // avant que le flag ne soit nettoyé de l'URL.
  const autoCallRef = useRef(params.get('autocall') === '1');
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'ready' | 'calling' | 'connected' | 'ended'>('disconnected');
  const [presence, setPresence] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [callElapsed, setCallElapsed] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Mode "focus" : clic sur le flux terrain → il occupe toute la scène,
  // ma caméra devient une vignette minuscule. Indépendant du plein écran
  // navigateur (isFullscreen), qui reste géré séparément.
  const [focusTerrain, setFocusTerrain] = useState(false);
  const [callOutcome, setCallOutcome] = useState<'idle' | 'connecting' | 'ringing' | 'connected' | 'ended' | 'rejected' | 'no-answer' | 'unavailable'>('idle');
  const [networkQuality, setNetworkQuality] = useState<'excellent' | 'good' | 'fair' | 'poor' | 'unknown'>('unknown');
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidatesRef = useRef<any[]>([]);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const [connected, setConnected] = useState(false);
  // Fenêtre de grâce avant de considérer un 'disconnected' comme définitif,
  // et flag pour n'essayer l'ICE restart qu'une seule fois par appel.
  const iceDisconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceRestartCountRef = useRef(0);
  const iceRestartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const nextPath = `/video-call${terrain ? `?terrain=${encodeURIComponent(terrain)}` : ''}${numeroMtn ? `${terrain ? '&' : '?'}mtn=${encodeURIComponent(numeroMtn)}` : ''}${dossierId ? `${terrain || numeroMtn ? '&' : '?'}dossier=${encodeURIComponent(dossierId)}` : ''}`;
    const currentUrl = new URL(window.location.href);
    if (currentUrl.pathname !== '/video-call' || currentUrl.search !== new URL(nextPath, window.location.origin).search) {
      window.history.replaceState({}, '', nextPath);
      window.dispatchEvent(new Event('popstate'));
    }
  }, [terrain, numeroMtn, dossierId]);

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video) return;
    if (localStream) {
      if (video.srcObject !== localStream) {
        video.srcObject = localStream;
      }
      video.muted = true;
      video.play().catch(() => undefined);
    } else {
      video.srcObject = null;
    }
  }, [localStream]);

  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video) return;
    if (remoteStream) {
      if (video.srcObject !== remoteStream) {
        video.srcObject = remoteStream;
      }
      video.play().catch((err) => {
        logRtcWarn('lecture vidéo distante impossible', err);
      });
    } else {
      video.srcObject = null;
    }
  }, [remoteStream]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!terrain) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      registerBackoffice();
      return;
    }
    connect();
    return () => {
      cleanupConnection();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain]);

  useEffect(() => {
    if (status !== 'calling' && status !== 'connected') return;
    if (!callStartedAt) {
      setCallElapsed(0);
      return;
    }
    const interval = window.setInterval(() => {
      setCallElapsed(Math.floor((Date.now() - callStartedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [status, callStartedAt]);

  useEffect(() => {
    if (!connected || !pcRef.current) {
      if (!connected) {
        setNetworkQuality('unknown');
      }
      return;
    }

    let cancelled = false;

    const evaluateNetwork = async () => {
      if (!pcRef.current || cancelled) return;
      try {
        const statsReport = await pcRef.current.getStats();
        let bestRttMs: number | null = null;
        let packetsLost = 0;
        let packetsTotal = 0;

        statsReport.forEach((report) => {
          if (report.type === 'candidate-pair' && typeof report.currentRoundTripTime === 'number') {
            if (bestRttMs === null || report.currentRoundTripTime * 1000 < bestRttMs) {
              bestRttMs = report.currentRoundTripTime * 1000;
            }
          }

          if (report.type === 'inbound-rtp' || report.type === 'outbound-rtp') {
            if (typeof report.packetsLost === 'number') {
              packetsLost += report.packetsLost;
            }
            if (typeof report.packetsReceived === 'number') {
              packetsTotal += report.packetsReceived;
            }
            if (typeof report.packetsSent === 'number') {
              packetsTotal += report.packetsSent;
            }
          }
        });

        const lossRatio = packetsTotal > 0 ? packetsLost / packetsTotal : 0;
        if (bestRttMs !== null && bestRttMs <= 80 && lossRatio <= 0.01) {
          setNetworkQuality('excellent');
        } else if (bestRttMs !== null && bestRttMs <= 180 && lossRatio <= 0.03) {
          setNetworkQuality('good');
        } else if (bestRttMs !== null && bestRttMs <= 400 && lossRatio <= 0.08) {
          setNetworkQuality('fair');
        } else {
          setNetworkQuality('poor');
        }
      } catch {
        setNetworkQuality('fair');
      }
    };

    void evaluateNetwork();
    const interval = window.setInterval(() => {
      void evaluateNetwork();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [connected]);

  const addInfo = (message: string) => {
    setInfo(message);
    setTimeout(() => setInfo(null), 6000);
  };

  const logRtc = (...args: unknown[]) => {
    console.log('[VideoCall][RTC]', ...args);
  };

  const logRtcWarn = (...args: unknown[]) => {
    console.warn('[VideoCall][RTC]', ...args);
  };

  const connect = () => {
    if (!terrain) {
      setError('Numéro terrain requis pour ouvrir l’interface vidéo.');
      return;
    }
    setError(null);
    setStatus('connecting');

    const ws = new WebSocket(api.getSignalingWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('ready');
      registerBackoffice();
      addInfo('Signalisation connectée');
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data) as SignalMessage;
        logRtc('message WebSocket reçu', msg.type, msg);
        handleSignalMessage(msg);
      } catch (e) {
        console.warn('[VideoCall] impossible de parser message WS', e);
      }
    };

    ws.onclose = () => {
      setStatus('disconnected');
      setPresence(false);
      addInfo('Signalisation déconnectée');
    };

    ws.onerror = () => {
      setError('Erreur WebSocket de signalisation.');
    };
  };

  const cleanupConnection = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    cleanupCallResources();
  };

  const cleanupCallResources = () => {
    if (iceDisconnectTimeoutRef.current) {
      clearTimeout(iceDisconnectTimeoutRef.current);
      iceDisconnectTimeoutRef.current = null;
    }
    iceRestartCountRef.current = 0;
    if (iceRestartTimeoutRef.current) {
      clearTimeout(iceRestartTimeoutRef.current);
      iceRestartTimeoutRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    pendingCandidatesRef.current = [];
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    remoteStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setConnected(false);
    setActiveCallId(null);
    setCallStartedAt(null);
    setCallElapsed(0);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } catch {
        setError('Plein écran indisponible sur ce navigateur.');
      }
    } else {
      try {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } catch {
        // ignore
      }
    }
  };

  const sendWs = (payload: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  };

  const registerBackoffice = () => {
    if (!terrain || wsRef.current?.readyState !== WebSocket.OPEN) return;
    sendWs({ type: 'register', role: 'backoffice', numero: normalizeNumero(terrain) });
  };

  const handleSignalMessage = async (msg: SignalMessage) => {
    switch (msg.type) {
      case 'registered':
        setStatus('ready');
        addInfo('Back-office enregistré');
        break;
      case 'terrain-presence':
        setPresence(msg.enLigne);
        addInfo(msg.enLigne ? 'Terrain en ligne' : 'Terrain hors ligne');
        break;
      case 'call-delivered':
        setActiveCallId(msg.callUuid);
        setStatus('calling');
        setCallOutcome('ringing');
        addInfo('Appel transmis au terrain');
        void sendOffer();
        break;
      case 'call-ringing':
        setStatus('calling');
        setCallOutcome('ringing');
        addInfo('Le terrain sonne');
        break;
      case 'call-accepted':
        setStatus('connected');
        setConnected(true);
        setCallOutcome('connected');
        addInfo('Appel accepté');
        break;
      case 'call-rejected':
        setStatus('ended');
        setCallOutcome('rejected');
        setError('L’agent terrain a refusé l’appel');
        cleanupCallResources();
        break;
      case 'call-unavailable':
        setStatus('ended');
        setCallOutcome('unavailable');
        setError(msg.reason || 'Terrain indisponible');
        cleanupCallResources();
        break;
      case 'no-answer':
        setStatus('ended');
        setCallOutcome('no-answer');
        setError('Aucun réponse du terrain');
        cleanupCallResources();
        break;
      case 'hangup':
        setStatus('ready');
        setCallOutcome('ended');
        setError(null);
        setInfo('L’appel a été raccroché par l’autre partie');
        cleanupCallResources();
        break;
      case 'incoming-call':
        addInfo('Incoming-call reçu (back-office)');
        break;
      case 'webrtc':
        await handleWebRTC(msg.payload);
        break;
      case 'terrain-absent':
        setStatus('ended');
        setError('Terrain absent');
        cleanupCallResources();
        break;
      case 'pong':
        break;
      default:
        break;
    }
  };

  const createPeerConnection = async () => {
    if (pcRef.current) return pcRef.current;

    let iceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];

    try {
      const result = await api.getTurnCredentials(normalizeNumero(terrain));
      if (result.success && Array.isArray(result.iceServers) && result.iceServers.length > 0) {
        iceServers = result.iceServers;
      }
    } catch (e) {
      console.warn('[VideoCall] TURN impossible, utilisation STUN seul', e);
    }

    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;
    logRtc('PeerConnection créée', { iceServers });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        logRtc('candidat ICE généré', event.candidate.toJSON());
        sendWs({ type: 'webrtc', numero: normalizeNumero(terrain), payload: { kind: 'ice', candidate: event.candidate.toJSON() } });
      }
    };

    pc.ontrack = (event) => {
      const incomingStream = event.streams && event.streams[0] ? event.streams[0] : null;
      const baseStream = remoteStreamRef.current ?? incomingStream ?? new MediaStream();
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = baseStream;
      }

      if (incomingStream) {
        incomingStream.getTracks().forEach((track) => {
          if (!baseStream.getTracks().some((existingTrack) => existingTrack.id === track.id)) {
            baseStream.addTrack(track);
          }
        });
      } else if (event.track) {
        if (!baseStream.getTracks().some((existingTrack) => existingTrack.id === event.track.id)) {
          baseStream.addTrack(event.track);
        }
      }

      if (baseStream instanceof MediaStream) {
        logRtc('flux distant reçu', {
          trackCount: baseStream.getTracks().length,
          connectionState: pc.connectionState,
          kind: event.track?.kind,
        });
        if (!remoteStreamRef.current) {
          remoteStreamRef.current = baseStream;
        }
        setRemoteStream(baseStream);
      } else {
        logRtcWarn('ontrack appelé sans MediaStream valide', event);
      }
    };

    pc.oniceconnectionstatechange = () => {
      logRtc('état ICE', pc.iceConnectionState);
    };

    pc.onnegotiationneeded = () => {
      logRtc('nécessité de renégociation');
    };

    pc.onconnectionstatechange = () => {
      logRtc('état de connexion RTCPeerConnection', pc.connectionState);

      if (pc.connectionState === 'connected') {
        // La connexion est rétablie (ou établie pour la première fois) :
        // on annule toute fenêtre de grâce en cours et on réarme le
        // restart pour une éventuelle prochaine coupure.
        if (iceDisconnectTimeoutRef.current) {
          clearTimeout(iceDisconnectTimeoutRef.current);
          iceDisconnectTimeoutRef.current = null;
        }
        iceRestartCountRef.current = 0;
        if (iceRestartTimeoutRef.current) {
          clearTimeout(iceRestartTimeoutRef.current);
          iceRestartTimeoutRef.current = null;
        }
        setConnected(true);
        setStatus('connected');
        setCallOutcome('connected');
        return;
      }

      if (pc.connectionState === 'disconnected') {
        if (remoteStreamRef.current?.getTracks().length) {
          logRtc('ICE disconnected mais un flux distant est déjà présent, on garde l’appel actif');
          return;
        }

        // Transitoire dans la majorité des cas (bascule wifi/4G, brève perte
        // de paquets ICE) : on attend la fenêtre de grâce avant d'agir. Si
        // l'état revient à 'connected' entre-temps, le timer est annulé
        // ci-dessus. Sinon on tente un ICE restart.
        if (!iceDisconnectTimeoutRef.current) {
          logRtc('ICE disconnected — fenêtre de grâce avant restart', ICE_DISCONNECT_GRACE_MS);
          iceDisconnectTimeoutRef.current = setTimeout(() => {
            iceDisconnectTimeoutRef.current = null;
            if (pcRef.current && pcRef.current.connectionState !== 'connected') {
              logRtc('toujours déconnecté après la fenêtre de grâce, tentative d’ICE restart');
              void attemptIceRestart();
            }
          }, ICE_DISCONNECT_GRACE_MS);
        }
        return;
      }

      if (pc.connectionState === 'failed') {
        if (remoteStreamRef.current?.getTracks().length) {
          logRtc('connexion ICE en échec mais le flux distant est déjà présent, on ne coupe pas l’appel');
          setStatus('connected');
          setCallOutcome('connected');
          setConnected(true);
          return;
        }
        if (iceDisconnectTimeoutRef.current) {
          clearTimeout(iceDisconnectTimeoutRef.current);
          iceDisconnectTimeoutRef.current = null;
        }
        if (iceRestartCountRef.current < MAX_ICE_RESTART_ATTEMPTS) {
          logRtc(`connexion ICE en échec — tentative d’ICE restart ${iceRestartCountRef.current + 1}/${MAX_ICE_RESTART_ATTEMPTS} avant abandon`);
          void attemptIceRestart();
          return;
        }
        // Toutes les tentatives (dont plusieurs forcées en relais TURN) ont
        // échoué : on abandonne réellement l'appel.
        logRtc('ICE restart épuisé (relais TURN inclus) sans succès, fin de l’appel');
        if (status !== 'ended') {
          setStatus('ready');
          setCallOutcome('ended');
          setError(null);
          setInfo('La connexion vidéo a été interrompue');
        }
        cleanupCallResources();
        return;
      }

      if (pc.connectionState === 'closed') {
        if (iceDisconnectTimeoutRef.current) {
          clearTimeout(iceDisconnectTimeoutRef.current);
          iceDisconnectTimeoutRef.current = null;
        }
      }
    };

    return pc;
  };

  // Renégociation avec iceRestart:true : on reste offerer (le back-office
  // est toujours l'offerer SDP dans cette architecture — cf. mobile
  // OutgoingCallScreen/SignalingService), on peut donc regénérer une offre
  // et la renvoyer via le canal de signalisation existant sans changer les
  // rôles ni rouvrir un nouvel appel côté terrain.
  const attemptIceRestart = async () => {
    const pc = pcRef.current;
    if (!pc || iceRestartCountRef.current >= MAX_ICE_RESTART_ATTEMPTS) return;
    if (iceRestartTimeoutRef.current) return; // une tentative est déjà planifiée

    iceRestartCountRef.current += 1;
    const attemptNumber = iceRestartCountRef.current;
    const forceRelay = attemptNumber >= FORCE_RELAY_FROM_ATTEMPT;

    const runRestart = async () => {
      iceRestartTimeoutRef.current = null;
      if (!pcRef.current || pcRef.current !== pc) return;
      try {
        if (forceRelay) {
          // NAT symétrique probable des deux côtés : on force le passage par
          // TURN plutôt que de retenter la même négociation P2P qui a déjà
          // échoué. setConfiguration() s'applique dès la prochaine négociation.
          try {
            const current = pc.getConfiguration();
            pc.setConfiguration({ ...current, iceTransportPolicy: 'relay' });
            logRtc(`ICE restart ${attemptNumber}/${MAX_ICE_RESTART_ATTEMPTS} : relais TURN forcé`);
          } catch (e) {
            logRtcWarn('impossible de forcer iceTransportPolicy=relay', e);
          }
        } else {
          logRtc(`ICE restart ${attemptNumber}/${MAX_ICE_RESTART_ATTEMPTS} : création d’une nouvelle offre (iceRestart=true)`);
        }
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        sendWs({ type: 'webrtc', payload: { kind: 'offer', sdp: (pc.localDescription as RTCSessionDescriptionInit).sdp } });
        setInfo(forceRelay ? 'Reconnexion vidéo via relais sécurisé…' : 'Reconnexion vidéo en cours…');
      } catch (e) {
        logRtcWarn('ICE restart impossible', e);
      }
    };

    // Petite pause avant chaque nouvelle tentative pour laisser le réseau se
    // stabiliser (évite de marteler autant de renégociations que d'attempts).
    if (attemptNumber === 1) {
      void runRestart();
    } else {
      iceRestartTimeoutRef.current = setTimeout(runRestart, ICE_RESTART_RETRY_DELAY_MS);
    }
  };

  const ensureLocalStream = async () => {
    if (localStream) return localStream;
    logRtc('demande d’accès caméra/micro');
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    logRtc('flux local obtenu', { videoTracks: stream.getVideoTracks().length, audioTracks: stream.getAudioTracks().length });
    setLocalStream(stream);
    if (pcRef.current) {
      stream.getTracks().forEach((track) => {
        logRtc('ajout du track local au PC', track.kind);
        pcRef.current?.addTrack(track, stream);
      });
    }
    return stream;
  };

  const flushPendingCandidates = async (pc: RTCPeerConnection) => {
    if (pendingCandidatesRef.current.length === 0) return;
    const candidates = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    logRtc('flush candidats ICE en attente', candidates.length);
    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (e) {
        logRtcWarn('addIceCandidate (flush) failed', e);
      }
    }
  };

  const handleWebRTC = async (payload: any) => {
    const pc = await createPeerConnection();
    if (!pc) return;
    if (!payload || typeof payload.kind !== 'string') return;

    logRtc('traitement payload WebRTC', payload.kind);

    if (payload.kind === 'answer') {
      try {
        logRtc('réception answer SDP');
        await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
        logRtc('remoteDescription answer appliquée');
        await flushPendingCandidates(pc);
      } catch (e) {
        logRtcWarn('erreur remoteDescription answer', e);
      }
      return;
    }

    if (payload.kind === 'offer') {
      try {
        logRtc('réception offer SDP');
        await ensureLocalStream();
        await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
        await flushPendingCandidates(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        logRtc('answer SDP créée et envoyée');
        sendWs({ type: 'webrtc', numero: normalizeNumero(terrain), payload: { kind: 'answer', sdp: (pc.localDescription as RTCSessionDescriptionInit).sdp } });
      } catch (e) {
        logRtcWarn('erreur handle offer', e);
      }
      return;
    }

    if (payload.kind === 'ice' && payload.candidate) {
      // Si l'offer/answer distant n'a pas encore été appliqué, addIceCandidate
      // échoue (InvalidStateError) et le candidat était jusqu'ici perdu
      // silencieusement (pendingCandidatesRef existait mais n'était jamais
      // rempli). On le met en attente et on le rejoue dès que
      // remoteDescription est posée, y compris lors d'un ICE restart.
      if (!pc.remoteDescription) {
        logRtc('candidat ICE reçu avant remoteDescription, mise en attente');
        pendingCandidatesRef.current.push(payload.candidate);
        return;
      }
      try {
        logRtc('ajout candidat ICE distant');
        await pc.addIceCandidate(payload.candidate);
        logRtc('candidat ICE ajouté');
      } catch (e) {
        logRtcWarn('addIceCandidate failed', e);
      }
      return;
    }
  };

  const sendOffer = async () => {
    const pc = await createPeerConnection();
    await ensureLocalStream();
    if (!pc) return;
    try {
      logRtc('création de l’offre WebRTC');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      logRtc('offre WebRTC créée et envoyée');
      sendWs({ type: 'webrtc', numero: normalizeNumero(terrain), payload: { kind: 'offer', sdp: offer.sdp } });
    } catch (e) {
      logRtcWarn('impossible de créer l’offre', e);
      setError('Impossible de préparer l’appel WebRTC.');
    }
  };

  const startCall = async () => {
    if (!terrain) {
      setError('Numéro terrain requis.');
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Signalisation non connectée.');
      return;
    }
    setError(null);
    setStatus('calling');
    setCallOutcome('connecting');
    setCallStartedAt(Date.now());
    setCallElapsed(0);
    setInfo('Lancement de l’appel vers le terrain...');
    logRtc('début d’appel', { terrain: normalizeNumero(terrain), numeroMtn });
    sendWs({ type: 'call', numero: normalizeNumero(terrain), numeroMtn });
  };

  // ── Auto-dial ────────────────────────────────────────────────────────────
  // Déclenché uniquement quand on arrive depuis "Appeler terrain" (DossierPages),
  // qui pose ?autocall=1 dans l'URL. Dès que le WS est enregistré (status
  // passe à 'ready'), on lance l'appel automatiquement — l'agent back-office
  // n'a qu'un seul clic à faire, depuis le dossier, jusqu'à voir l'appel
  // sonner puis se connecter. Le flag est consommé une seule fois (retiré de
  // l'URL juste après) pour qu'un rafraîchissement de la page ou un retour
  // arrière ne relance pas un appel non désiré.
  useEffect(() => {
    if (status !== 'ready' || !autoCallRef.current) return;
    autoCallRef.current = false;

    const url = new URL(window.location.href);
    url.searchParams.delete('autocall');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);

    void startCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const hangUp = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendWs({ type: 'hangup' });
    }
    cleanupCallResources();
    setStatus('ready');
    setCallOutcome('ended');
    setCallElapsed(0);
    setError(null);
    setInfo('Appel terminé');
  };

  const restartCall = async () => {
    // Avant de relancer, on informe le serveur que la tentative précédente
    // est abandonnée (même si aucun appel n'est réellement en cours — un
    // 'hangup' sans callUuid actif est un no-op côté serveur). Sans ça, le
    // serveur gardait l'ancien callUuid dans pendingCalls, et un nouveau
    // 'call' juste après créait un DEUXIÈME callUuid pour le même terrain :
    // c'était la source de la tempête de doublons côté mobile.
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendWs({ type: 'hangup' });
    }
    cleanupCallResources();
    setStatus('ready');
    setCallOutcome('idle');
    setCallStartedAt(null);
    setCallElapsed(0);
    setError(null);
    setInfo('Nouvel essai prêt');
    if (!terrain) {
      setError('Numéro terrain requis.');
      return;
    }
    window.setTimeout(() => {
      void startCall();
    }, 250);
  };

  const toggleMic = () => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  };

  const toggleCamera = () => {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
  };

  const statusLabel = useMemo(() => {
    if (status === 'disconnected') return 'Déconnecté';
    if (status === 'connecting') return 'Connexion...';
    if (status === 'ready') return 'Prêt';
    if (status === 'calling') return 'Appel en cours';
    if (status === 'connected') return 'Connecté';
    if (status === 'ended') return 'Terminé';
    return '—';
  }, [status]);

  const statusTone = useMemo(() => {
    if (status === 'connected') return 'success';
    if (status === 'calling' || status === 'connecting') return 'gold';
    if (status === 'ended') return 'danger';
    return 'muted';
  }, [status]);

  const stageMessage = useMemo(() => {
    if (callOutcome === 'rejected') return 'L’agent terrain a refusé l’appel.';
    if (callOutcome === 'no-answer') return 'Aucune réponse n’a été reçue.';
    if (callOutcome === 'unavailable') return 'Le terrain est indisponible pour l’instant.';
    if (status === 'connected') return 'Communication stable avec l’agent terrain.';
    if (status === 'calling') return 'Le terrain est en train de répondre à l’appel…';
    if (status === 'connecting') return 'Préparation de la liaison audio et vidéo…';
    return 'Prêt à lancer l’appel vers le terrain.';
  }, [status, callOutcome]);

  const networkLabel = useMemo(() => {
    if (networkQuality === 'excellent') return 'Réseau excellent';
    if (networkQuality === 'good') return 'Réseau bon';
    if (networkQuality === 'fair') return 'Réseau moyen';
    if (networkQuality === 'poor') return 'Réseau faible';
    return 'Analyse réseau';
  }, [networkQuality]);

  return (
    <div className="kvc">
      <style>{`
        .kvc {
          --ink: #0B1220;
          --ink-2: #101A2E;
          --panel: rgba(255,255,255,0.05);
          --hairline: rgba(255,255,255,0.10);
          --gold: #FFCC00;
          --gold-dim: rgba(255,204,0,0.14);
          --success: #22C55E;
          --success-dim: rgba(34,197,94,0.14);
          --danger: #EF4444;
          --danger-dim: rgba(239,68,68,0.14);
          --text: #F8FAFC;
          --text-muted: rgba(226,232,240,0.60);
          --text-soft: rgba(226,232,240,0.82);
          --mono: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace;
          font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          color: var(--text);
          max-width: clamp(360px, 94vw, 1560px);
          margin: 0 auto;
          padding: clamp(8px, 1.4vw, 14px) clamp(4px, 1vw, 10px) clamp(18px, 3vw, 28px);
          box-sizing: border-box;
        }
        .kvc *, .kvc *::before, .kvc *::after { box-sizing: border-box; }

        .kvc-topbar {
          display: flex; align-items: center; justify-content: space-between;
          gap: 14px; flex-wrap: wrap;
          padding: clamp(9px, 1.4vw, 13px) clamp(12px, 2vw, 18px);
          margin-bottom: clamp(9px, 1.4vw, 13px);
          color: #0F172A;
          background: #fff;
          border: 1px solid rgba(15,23,42,0.07);
          border-radius: 16px;
          box-shadow: 0 10px 26px -18px rgba(15,23,42,0.35);
        }
        .kvc-topbar-left { display: flex; align-items: center; gap: 11px; min-width: 0; }
        .kvc-brand-orb {
          width: clamp(32px, 3.6vw, 38px); height: clamp(32px, 3.6vw, 38px); flex-shrink: 0;
          border-radius: 11px; display: flex; align-items: center; justify-content: center;
          background: linear-gradient(145deg, #FFD633, var(--gold) 60%, #C99A00);
          color: #1A1300; box-shadow: 0 6px 14px -6px rgba(255,204,0,0.55);
        }
        .kvc-live-dot {
          width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
          background: #CBD5E1;
          box-shadow: 0 0 0 3px rgba(15,23,42,0.06);
        }
        .kvc-live-dot[data-state="success"] { background: var(--success); box-shadow: 0 0 0 3px var(--success-dim); }
        .kvc-live-dot[data-state="gold"] { background: var(--gold); box-shadow: 0 0 0 3px var(--gold-dim); animation: kvc-pulse 1.5s ease-in-out infinite; }
        .kvc-live-dot[data-state="danger"] { background: var(--danger); box-shadow: 0 0 0 3px var(--danger-dim); }
        @keyframes kvc-pulse { 0%,100% { opacity:1; } 50% { opacity:.45; } }
        .kvc-title-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .kvc-title {
          font-size: clamp(15px, 1.6vw, 18px); font-weight: 800; letter-spacing: -0.2px; margin: 0; line-height: 1.2;
          color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .kvc-sub {
          font-size: clamp(11px, 1vw, 12px); color: #64748B; margin: 1px 0 0;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .kvc-topbar-right { display: flex; gap: 7px; flex-wrap: wrap; }
        .kvc-chip {
          font-size: 11.5px; font-weight: 700; padding: 5px 11px; border-radius: 999px;
          background: #F8FAFC; border: 1px solid rgba(15,23,42,0.10); color: #334155;
          white-space: nowrap; letter-spacing: 0.1px;
        }
        .kvc-chip--success { color: #166534; border-color: rgba(34,197,94,0.30); background: rgba(220,252,231,0.85); }
        .kvc-chip--gold { color: #8A5A00; border-color: rgba(255,204,0,0.35); background: rgba(255,247,205,0.9); }
        .kvc-chip--danger { color: #991B1B; border-color: rgba(239,68,68,0.30); background: rgba(254,226,226,0.85); }

        .kvc-alerts { margin-bottom: 10px; }

        .kvc-config {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px;
          padding: clamp(9px, 1.4vw, 12px);
          margin-bottom: clamp(9px, 1.4vw, 13px);
          background: #fff; border: 1px solid rgba(15,23,42,0.07); border-radius: 14px;
          box-shadow: 0 10px 26px -20px rgba(15,23,42,0.3);
        }
        .kvc-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .kvc-field span { font-size: 10px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: #94A3B8; }
        .kvc-field input {
          background: #F8FAFC; border: 1px solid #E7EBF1; color: #0F172A;
          border-radius: 10px; padding: 8px 11px; font-size: 13px; font-family: var(--mono);
          outline: none; transition: border-color .15s ease, background .15s ease; width: 100%;
        }
        .kvc-field input::placeholder { color: #A6B0BE; }
        .kvc-field input:focus { border-color: rgba(255,204,0,0.65); background: #fff; }

        .kvc-stage {
          position: relative; border-radius: clamp(16px, 2vw, 24px); overflow: hidden;
          background: linear-gradient(180deg, var(--ink-2) 0%, var(--ink) 100%);
          border: 1px solid var(--hairline);
          width: 100%;
          height: clamp(440px, 74vh, 880px);
          box-shadow: 0 24px 60px -22px rgba(0,0,0,0.65);
        }
        .kvc-stage.is-focus {
          position: fixed; inset: 0; z-index: 60; border-radius: 0;
          aspect-ratio: unset; max-width: none;
        }
        .kvc-remote {
          position: absolute; inset: 0; cursor: zoom-in;
        }
        .kvc-stage.is-focus .kvc-remote { cursor: zoom-out; }
        .kvc-video { width: 100%; height: 100%; object-fit: cover; display: block; background: #060A12; }
        .kvc-placeholder {
          position: absolute; inset: 0; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 10px;
          color: var(--text-muted); text-align: center; padding: 0 20px;
        }
        .kvc-placeholder svg { opacity: 0.5; }
        .kvc-placeholder p { font-size: 13px; margin: 0; max-width: 280px; }

        .kvc-expand-btn {
          position: absolute; top: 14px; right: 14px; z-index: 3;
          width: 34px; height: 34px; border-radius: 10px; border: 1px solid var(--hairline);
          background: rgba(11,18,32,0.55); backdrop-filter: blur(6px); color: #fff;
          display: flex; align-items: center; justify-content: center; cursor: pointer;
          opacity: 0; transition: opacity .15s ease;
        }
        .kvc-remote:hover .kvc-expand-btn { opacity: 1; }

        .kvc-local {
          position: absolute; right: clamp(10px, 1.6vw, 18px); bottom: clamp(10px, 1.6vw, 18px); z-index: 4;
          width: clamp(104px, 15vw, 190px); aspect-ratio: 4/3; border-radius: clamp(10px, 1.4vw, 16px); overflow: hidden;
          border: 1.5px solid rgba(255,255,255,0.18);
          box-shadow: 0 10px 30px -8px rgba(0,0,0,0.6);
          transition: width .2s ease, bottom .2s ease, right .2s ease;
        }
        .kvc-local.is-mini { width: clamp(72px, 9vw, 110px); bottom: clamp(84px, 11vw, 108px); right: clamp(10px, 1.6vw, 18px); opacity: 0.92; }
        .kvc-cam-off {
          position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          background: #0D1526; color: var(--text-muted);
        }

        .kvc-stage-meta {
          position: absolute; top: 14px; left: 14px; z-index: 3;
          display: flex; gap: 8px; flex-wrap: wrap; max-width: 60%;
          pointer-events: none;
        }
        .kvc-meta-pill {
          font-size: 12px; font-weight: 600; padding: 5px 10px; border-radius: 999px;
          background: rgba(6,10,18,0.55); backdrop-filter: blur(6px);
          border: 1px solid rgba(255,255,255,0.12); color: var(--text-soft);
        }
        .kvc-mono { font-family: var(--mono); font-variant-numeric: tabular-nums; letter-spacing: 0.3px; }
        .kvc-signal--excellent { color: #86EFAC; }
        .kvc-signal--good { color: #BEF264; }
        .kvc-signal--fair { color: #FDE68A; }
        .kvc-signal--poor { color: #FCA5A5; }

        .kvc-stage-caption {
          position: absolute; left: 14px; bottom: 14px; z-index: 3;
          max-width: 46%; pointer-events: none;
        }
        .kvc-stage-caption p {
          margin: 0; font-size: 12.5px; color: var(--text-soft);
          background: rgba(6,10,18,0.5); backdrop-filter: blur(6px);
          border: 1px solid rgba(255,255,255,0.10); border-radius: 10px;
          padding: 7px 11px; line-height: 1.4;
        }

        .kvc-dock {
          position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
          z-index: 5; display: flex; align-items: center; gap: 10px;
          background: rgba(6,10,18,0.55); backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,0.10); border-radius: 999px;
          padding: 8px; box-shadow: 0 12px 30px -10px rgba(0,0,0,0.6);
        }
        .kvc-dock-btn {
          width: 46px; height: 46px; border-radius: 50%; border: none;
          background: rgba(255,255,255,0.08); color: #fff;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: background .15s ease, transform .1s ease;
        }
        .kvc-dock-btn:hover { background: rgba(255,255,255,0.15); }
        .kvc-dock-btn:active { transform: scale(0.94); }
        .kvc-dock-btn.is-off { background: rgba(239,68,68,0.22); color: #FCA5A5; }
        .kvc-dock-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .kvc-dock-btn--call {
          width: 56px; height: 56px; background: var(--gold); color: #1A1300;
          box-shadow: 0 0 0 0 rgba(255,204,0,0.5);
        }
        .kvc-dock-btn--call:not(:disabled):hover { background: #FFD633; }
        .kvc-dock-btn--hangup { width: 56px; height: 56px; background: var(--danger); color: #fff; }
        .kvc-dock-btn--hangup:hover { background: #F87171; }

        .kvc-footer {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          margin-top: 12px; padding: 0 4px; font-size: 12.5px; color: #64748B;
        }
        .kvc-footer .dot { opacity: 0.5; }

        @media (max-width: 640px) {
          .kvc-config { grid-template-columns: 1fr; }
          .kvc-stage { height: clamp(360px, 58vh, 520px); }
          .kvc-stage-caption { max-width: 72%; }
          .kvc-topbar { padding: 10px 12px; }
          .kvc-sub { display: none; }
        }
        @media (min-width: 641px) and (max-width: 1024px) {
          .kvc-config { grid-template-columns: repeat(3, 1fr); }
          .kvc-stage { height: clamp(420px, 66vh, 620px); }
        }
        @media (min-width: 1600px) {
          .kvc-stage { height: clamp(600px, 76vh, 920px); }
        }
      `}</style>

      <div className="kvc-topbar">
        <div className="kvc-topbar-left">
          <div className="kvc-brand-orb">
            <IconPhoneCall size={18} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="kvc-title-row">
              <span className="kvc-live-dot" data-state={statusTone} />
              <h1 className="kvc-title">Appel vidéo terrain</h1>
            </div>
            <p className="kvc-sub">Centre de certification KYC · MTN Congo</p>
          </div>
        </div>
        <div className="kvc-topbar-right">
          <span className={`kvc-chip ${presence ? 'kvc-chip--success' : ''}`}>
            Terrain {presence ? 'en ligne' : 'hors ligne'}
          </span>
          <span className={`kvc-chip kvc-chip--${statusTone}`}>{statusLabel}</span>
        </div>
      </div>

      {(error || info) && (
        <div className="kvc-alerts">
          {error && <Alert kind="error">{error}</Alert>}
          {info && <Alert kind="success">{info}</Alert>}
        </div>
      )}

      {!focusTerrain && (
        <div className="kvc-config">
          <label className="kvc-field">
            <span>Agent terrain (WA)</span>
            <input value={terrain} onChange={(e) => setTerrain(e.target.value)} placeholder="Ex: 0700000000" />
          </label>
          <label className="kvc-field">
            <span>Dossier</span>
            <input value={dossierId} onChange={(e) => setDossierId(e.target.value)} placeholder="ID dossier" />
          </label>
          <label className="kvc-field">
            <span>Numéro MTN</span>
            <input value={numeroMtn} onChange={(e) => setNumeroMtn(e.target.value)} placeholder="Numéro MTN du dossier" />
          </label>
        </div>
      )}

      <div className={`kvc-stage ${focusTerrain ? 'is-focus' : ''}`}>
        <div
          className="kvc-remote"
          onClick={() => remoteStream && setFocusTerrain((f) => !f)}
        >
          <video ref={remoteVideoRef} autoPlay playsInline className="kvc-video" />
          {!remoteStream && (
            <div className="kvc-placeholder">
              <IconUser size={40} />
              <p>{callOutcome === 'ringing' ? 'Le terrain sonne, en attente de réponse…' : status === 'connecting' ? 'Préparation de la liaison…' : 'En attente du flux vidéo terrain'}</p>
            </div>
          )}
          {remoteStream && (
            <button
              className="kvc-expand-btn"
              onClick={(e) => { e.stopPropagation(); setFocusTerrain((f) => !f); }}
              title={focusTerrain ? 'Réduire' : 'Agrandir le flux terrain'}
            >
              {focusTerrain ? <IconShrink /> : <IconExpand />}
            </button>
          )}
        </div>

        <div className={`kvc-local ${focusTerrain ? 'is-mini' : ''}`}>
          <video ref={localVideoRef} autoPlay muted playsInline className="kvc-video" />
          {!camOn && <div className="kvc-cam-off"><IconCamOff size={22} /></div>}
        </div>

        <div className="kvc-stage-meta">
          <span className="kvc-meta-pill kvc-mono">⏱ {formatDuration(callElapsed)}</span>
          <span className={`kvc-meta-pill kvc-mono kvc-signal--${networkQuality}`}>{networkLabel}</span>
        </div>

        {!focusTerrain && (
          <div className="kvc-stage-caption">
            <p>{stageMessage}</p>
          </div>
        )}

        <div className="kvc-dock">
          {status !== 'calling' && status !== 'connected' && (
            <button className="kvc-dock-btn" onClick={restartCall} title="Recommencer">
              <IconRotate />
            </button>
          )}
          <button className={`kvc-dock-btn ${!micOn ? 'is-off' : ''}`} onClick={toggleMic} title={micOn ? 'Couper le micro' : 'Activer le micro'}>
            {micOn ? <IconMic /> : <IconMicOff />}
          </button>

          {status === 'calling' || status === 'connected' ? (
            <button className="kvc-dock-btn kvc-dock-btn--hangup" onClick={hangUp} title="Raccrocher">
              <IconPhoneOff />
            </button>
          ) : (
            <button className="kvc-dock-btn kvc-dock-btn--call" disabled={!terrain} onClick={startCall} title="Démarrer l’appel">
              <IconPhoneCall />
            </button>
          )}

          <button className={`kvc-dock-btn ${!camOn ? 'is-off' : ''}`} onClick={toggleCamera} title={camOn ? 'Couper la caméra' : 'Activer la caméra'}>
            {camOn ? <IconCam /> : <IconCamOff />}
          </button>
          <button className="kvc-dock-btn" onClick={toggleFullscreen} title={isFullscreen ? 'Quitter le plein écran' : 'Plein écran navigateur'}>
            {isFullscreen ? <IconShrink /> : <IconExpand />}
          </button>
        </div>
      </div>

      {!focusTerrain && (
        <div className="kvc-footer">
          <span>{user?.prenom} {user?.nom}</span>
          <span className="dot">·</span>
          <span>Dossier {dossierId || '—'}</span>
          <span className="dot">·</span>
          <span className="kvc-mono">{terrain || '—'}</span>
        </div>
      )}
    </div>
  );
}