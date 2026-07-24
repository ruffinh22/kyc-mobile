import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import * as api from '../../services/api';
import { Alert } from '../../components/ui';

const normalizeNumero = (value: string | null | undefined) => String(value || '').replace(/\D/g, '');

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
  | { type: 'webrtc'; payload: any }
  | { type: 'pong' }
  | { type: 'terrain-absent'; numero: string };

export function AgentVideoCallPage() {
  const { user } = useAuth();
  const params = useMemo(() => new URLSearchParams(window.location.search), [window.location.search]);
  const [terrain, setTerrain] = useState(params.get('terrain') || '');
  const [numeroMtn, setNumeroMtn] = useState(params.get('mtn') || '');
  const [dossierId, setDossierId] = useState(params.get('dossier') || '');
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
  const [callOutcome, setCallOutcome] = useState<'idle' | 'connecting' | 'ringing' | 'connected' | 'ended' | 'rejected' | 'no-answer' | 'unavailable'>('idle');
  const [networkQuality, setNetworkQuality] = useState<'excellent' | 'good' | 'fair' | 'poor' | 'unknown'>('unknown');
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidatesRef = useRef<any[]>([]);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
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
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    pendingCandidatesRef.current = [];
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach((track) => track.stop());
      setRemoteStream(null);
    }
    setConnected(false);
    setActiveCallId(null);
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
        addInfo('Appel transmis au terrain');
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

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendWs({ type: 'webrtc', payload: { kind: 'ice', candidate: event.candidate.toJSON() } });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams && event.streams[0] ? event.streams[0] : null;
      if (stream instanceof MediaStream) {
        setRemoteStream(stream);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setConnected(true);
        setStatus('connected');
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (status !== 'ended') setStatus('ended');
      }
    };

    return pc;
  };

  const ensureLocalStream = async () => {
    if (localStream) return localStream;
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    setLocalStream(stream);
    if (pcRef.current) {
      stream.getTracks().forEach((track) => pcRef.current?.addTrack(track, stream));
    }
    return stream;
  };

  const handleWebRTC = async (payload: any) => {
    const pc = await createPeerConnection();
    if (!pc) return;
    if (!payload || typeof payload.kind !== 'string') return;

    if (payload.kind === 'answer') {
      try {
        await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
      } catch (e) {
        console.warn('[VideoCall] erreur remoteDescription answer', e);
      }
      return;
    }

    if (payload.kind === 'offer') {
      try {
        await ensureLocalStream();
        await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendWs({ type: 'webrtc', payload: { kind: 'answer', sdp: (pc.localDescription as RTCSessionDescriptionInit).sdp } });
      } catch (e) {
        console.warn('[VideoCall] erreur handle offer', e);
      }
      return;
    }

    if (payload.kind === 'ice' && payload.candidate) {
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch (e) {
        console.warn('[VideoCall] addIceCandidate failed', e);
      }
      return;
    }
  };

  const sendOffer = async () => {
    const pc = await createPeerConnection();
    await ensureLocalStream();
    if (!pc) return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendWs({ type: 'webrtc', payload: { kind: 'offer', sdp: offer.sdp } });
    } catch (e) {
      console.warn('[VideoCall] impossible de créer l’offre', e);
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
    sendWs({ type: 'call', numero: normalizeNumero(terrain), numeroMtn });
    await sendOffer();
  };

  const hangUp = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendWs({ type: 'hangup' });
    }
    cleanupCallResources();
    setStatus('ready');
    setCallOutcome('ended');
    setCallElapsed(0);
    setInfo('Appel terminé');
  };

  const restartCall = async () => {
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

  const networkLabel = useMemo(() => {
    if (networkQuality === 'excellent') return 'Réseau excellent';
    if (networkQuality === 'good') return 'Réseau bon';
    if (networkQuality === 'fair') return 'Réseau moyen';
    if (networkQuality === 'poor') return 'Réseau faible';
    return 'Analyse réseau';
  }, [networkQuality]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Appel vidéo terrain</h1>
          <p className="page-sub">Interface professionnelle pour joindre l’agent terrain depuis le back-office.</p>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {info && <Alert kind="success">{info}</Alert>}

      <div className="card">
        <div className="field-grid">
          <div className="field">
            <label>Numéro agent terrain (WA)</label>
            <input value={terrain} onChange={(e) => setTerrain(e.target.value)} placeholder="Ex: 0700000000" />
          </div>
          <div className="field">
            <label>Dossier</label>
            <input value={dossierId} onChange={(e) => setDossierId(e.target.value)} placeholder="ID dossier" />
          </div>
          <div className="field">
            <label>Numéro abonné MTN</label>
            <input value={numeroMtn} onChange={(e) => setNumeroMtn(e.target.value)} placeholder="Numéro MTN du dossier" />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="call-status-row">
          <div>
            <p className="card-title">État de l’appel</p>
            <p className="page-sub">Signalisation : {statusLabel} · Terrain : {presence ? 'en ligne' : 'hors ligne'}</p>
          </div>
          <div className="call-actions-row">
            <span className={`role-chip ${connected ? 'admin' : status === 'calling' ? 'superviseur' : 'agent'}`} style={{ padding: '6px 10px' }}>
              {connected ? 'connecté' : status === 'calling' ? 'sonne' : 'prêt'}
            </span>
            <button className="btn btn-primary btn-sm" disabled={!terrain || status === 'calling' || status === 'connected'} onClick={startCall}>
              Démarrer l’appel
            </button>
            <button className="btn btn-ghost btn-sm" disabled={!connected && status !== 'calling'} onClick={hangUp}>
              Raccrocher
            </button>
            <button className="btn btn-sm" onClick={restartCall}>
              Recommencer
            </button>
            <button className="btn btn-sm" onClick={toggleFullscreen}>
              {isFullscreen ? '🗗 Sortir plein écran' : '🗖 Plein écran'}
            </button>
          </div>
        </div>
      </div>

      <div className={`call-stage ${status === 'connected' ? 'connected' : status === 'calling' ? 'calling' : status === 'ended' ? 'ended' : status === 'connecting' ? 'connecting' : 'idle'}`}>
        <div className="connection-indicator">
          <span className="pulse-dot" />
          <div>
            <strong>{status === 'connected' ? 'Connexion établie' : status === 'calling' ? 'Appel en cours' : status === 'connecting' ? 'Connexion en cours' : status === 'ended' ? 'Fin d’appel' : 'Prêt à appeler'}</strong>
            <p>{callOutcome === 'rejected' ? 'L’agent terrain a refusé l’appel.' : callOutcome === 'no-answer' ? 'Aucune réponse n’a été reçue.' : callOutcome === 'unavailable' ? 'Le terrain est indisponible pour l’instant.' : status === 'connected' ? 'Communication stable avec l’agent terrain.' : 'La plateforme prépare la liaison audio et vidéo.'}</p>
          </div>
        </div>
        <div className="call-stage-meta">
          <span className="timer-pill">⏱ {formatDuration(callElapsed)}</span>
          <span className={`signal-pill ${networkQuality}`}>{networkLabel}</span>
          <span className="signal-pill">{statusLabel}</span>
        </div>
      </div>

      <div className={`call-hero ${status === 'connected' ? 'connected' : status === 'calling' ? 'calling' : status === 'connecting' ? 'connecting' : ''}`}>
        <div className="call-hero-badge">Session vidéo</div>
        <div className="call-hero-title">{status === 'connected' ? 'Connexion sécurisée établie' : status === 'calling' ? 'Raccordement en cours…' : status === 'connecting' ? 'Préparation de la liaison' : 'Interface de communication prête'}</div>
        <div className="call-hero-sub">{status === 'connected' ? 'Les flux audio et vidéo sont maintenant synchronisés avec l’agent terrain.' : status === 'calling' ? 'Le terrain est actuellement en train de répondre à l’appel.' : 'La plateforme initialise la connexion et prépare l’échange vidéo.'}</div>
      </div>

      <div className="video-grid">
        <div className={`video-panel ${status === 'calling' || status === 'connecting' ? 'is-calling' : ''} ${connected ? 'is-connected' : ''}`}>
          <div className="card-header" style={{ marginBottom: '.75rem' }}>
            <span className="card-title" style={{ marginBottom: 0 }}>Ma caméra</span>
            <span className="role-chip agent">local</span>
          </div>
          <video ref={localVideoRef} autoPlay muted playsInline />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={toggleMic}>{micOn ? '🎙 Micro activé' : '🔇 Micro coupé'}</button>
            <button className="btn btn-sm" onClick={toggleCamera}>{camOn ? '📹 Caméra activée' : '📷 Caméra coupée'}</button>
          </div>
        </div>
        <div className="video-panel">
          <div className="card-header" style={{ marginBottom: '.75rem' }}>
            <span className="card-title" style={{ marginBottom: 0 }}>Flux terrain</span>
            <span className={`role-chip ${connected ? 'admin' : 'superviseur'}`}>{connected ? 'en direct' : 'en attente'}</span>
          </div>
          <video ref={remoteVideoRef} autoPlay playsInline />
          <div style={{ marginTop: 10, fontSize: 13, color: 'rgba(255,255,255,.72)' }}>
            {connected ? 'Flux distant connecté et stable' : 'Attente de la réponse du terrain'}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="field-grid">
          <div className="field"><label>Opérateur</label><div>{user?.prenom} {user?.nom}</div></div>
          <div className="field"><label>Dossier</label><div>{dossierId || 'Aucun'}</div></div>
          <div className="field"><label>Numéro terrain</label><div>{terrain || 'Aucun'}</div></div>
          <div className="field"><label>Numéro MTN</label><div>{numeroMtn || 'Aucun'}</div></div>
        </div>
      </div>
    </>
  );
}
