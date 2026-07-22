import React, { useCallback, useEffect, useState } from 'react';
import { Amplify } from 'aws-amplify';
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness';
import { ThemeProvider } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';

const REGION = import.meta.env.VITE_AWS_REGION as string;
const API_BASE = (() => {
  const envUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  const runtimeOrigin = window.location.origin;
  if (!envUrl) return runtimeOrigin;
  if (envUrl.startsWith('http://localhost') || envUrl.startsWith('https://localhost')) {
    const host = window.location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') {
      return runtimeOrigin;
    }
  }
  return envUrl;
})();
const IDENTITY_POOL_ID = import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID as string;

const isLivenessConfigValid = Boolean(REGION && IDENTITY_POOL_ID);

if (isLivenessConfigValid) {
  Amplify.configure({
    Auth: {
      Cognito: {
        identityPoolId: IDENTITY_POOL_ID,
        allowGuestAccess: true,
      },
    },
  });
}

type Phase = 'loading' | 'ready' | 'analyzing' | 'done' | 'error';

function getDossierId(): string | null {
  const params = new URLSearchParams(window.location.search);
  const dossierId = params.get('dossierId');
  return dossierId ? dossierId.trim() : null;
}

function notifyNative(payload: unknown) {
  const win = window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } };
  win.ReactNativeWebView?.postMessage(JSON.stringify(payload));
}

export function FaceLivenessCheck() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [region, setRegion] = useState<string>(REGION);
  const [errorMsg, setErrorMsg] = useState('');
  const [resultMsg, setResultMsg] = useState('');
  const dossierId = getDossierId();

  useEffect(() => {
    if (!dossierId) {
      setErrorMsg('Identifiant de dossier manquant dans l’URL');
      setPhase('error');
      return;
    }

    const init = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public/dossiers/${encodeURIComponent(dossierId)}/liveness-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Erreur session (${res.status})`);
        }
        if (!data.sessionId) {
          throw new Error('Session AWS manquante');
        }
        setSessionId(data.sessionId);
        if (data.region) {
          setRegion(data.region);
        }
        setPhase('ready');
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Erreur de création de session');
        setPhase('error');
      }
    };

    init();
  }, [dossierId]);

  const handleAnalysisComplete = useCallback(async () => {
    if (!dossierId || !sessionId) return;
    setPhase('analyzing');
    try {
      const res = await fetch(`${API_BASE}/api/public/dossiers/${encodeURIComponent(dossierId)}/liveness-session/${encodeURIComponent(sessionId)}/result`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Erreur résultat (${res.status})`);
      }
      setResultMsg(data.message || 'Vérification terminée');
      setPhase('done');
      notifyNative({ type: 'liveness-result', ...data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur de vérification';
      setErrorMsg(message);
      setPhase('error');
      notifyNative({ type: 'liveness-error', error: message });
    }
  }, [dossierId, sessionId]);

  const handleError = useCallback((err: { state: string; error: Error }) => {
    const message = err?.error?.message || 'Erreur du composant de vivacité';
    setErrorMsg(message);
    setPhase('error');
    notifyNative({ type: 'liveness-error', error: message });
  }, []);

  if (phase === 'loading') {
    return <CenterMessage text="Préparation de la vérification…" />;
  }

  if (phase === 'error') {
    return <CenterMessage text={`Erreur : ${errorMsg}`} isError />;
  }

  if (phase === 'analyzing') {
    return <CenterMessage text="Analyse en cours…" />;
  }

  if (phase === 'done') {
    return <CenterMessage text={resultMsg} />;
  }

  if (!isLivenessConfigValid) {
    return <CenterMessage text="Configuration client manquante : VITE_AWS_REGION ou VITE_COGNITO_IDENTITY_POOL_ID" isError />;
  }

  if (!sessionId) {
    return <CenterMessage text="Session non disponible" isError />;
  }

  return (
    <ThemeProvider>
      <div style={{ width: '100%', height: '100vh', backgroundColor: '#0f172a' }}>
        <FaceLivenessDetector
          sessionId={sessionId}
          region={region}
          onAnalysisComplete={handleAnalysisComplete}
          onError={handleError}
        />
      </div>
    </ThemeProvider>
  );
}

function CenterMessage({ text, isError }: { text: string; isError?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        padding: 24,
        textAlign: 'center',
        color: isError ? '#F87171' : '#F8FAFC',
        backgroundColor: '#0f172a',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 16,
      }}
    >
      {text}
    </div>
  );
}
