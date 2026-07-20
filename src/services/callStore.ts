/**
 * callStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * État global de l'appel partagé entre tous les écrans et services.
 *
 * Deux stores Zustand :
 *   useCallStore  — état de l'appel en cours
 *   useAgentStore — session de l'agent (numero, serveur, token FCM)
 */

import { create } from 'zustand';

// ── Types ────────────────────────────────────────────────────────────────────
export type CallStatus =
  | 'idle' | 'incoming' | 'outgoing' | 'connecting' | 'active'
  | 'reconnecting' | 'declined' | 'failed' | 'ended';

interface CallState {
  status:       CallStatus;
  numeroMtn:    string;
  callUuid:     string;   // uuid FCM si dispo, sinon `ws-<timestamp>`
  isCallActive: boolean;
  isMicOn:      boolean;
  isCameraOn:   boolean;
  callDuration: number;   // secondes
  lastError:    string | null;

  setIncomingCall: (numeroMtn: string, uuid?: string) => void;
  setOutgoingCall: (numeroMtn: string) => void;
  setConnecting:   () => void;
  setCallActive:   (active: boolean) => void;
  setReconnecting: () => void;
  setDeclined:     () => void;
  setFailed:       (reason?: string) => void;
  setMicOn:        (on: boolean) => void;
  setCameraOn:     (on: boolean) => void;
  setCallDuration: (s: number) => void;
  resetCall:       () => void;
}

export const useCallStore = create<CallState>((set) => ({
  status:       'idle',
  numeroMtn:    '',
  callUuid:     '',
  isCallActive: false,
  isMicOn:      true,
  isCameraOn:   true,
  callDuration: 0,
  lastError:    null,

  // uuid est optionnel : absent sur le chemin WebSocket, présent sur le chemin FCM
  setIncomingCall: (numeroMtn, uuid = '') =>
    set({ status: 'incoming', numeroMtn, callUuid: uuid, lastError: null }),

  // Appel initié par l'agent terrain lui-même (sonnerie sortante)
  setOutgoingCall: (numeroMtn) =>
    set({ status: 'outgoing', numeroMtn, callUuid: `out-${Date.now()}`, lastError: null }),

  setConnecting: () => set({ status: 'connecting', lastError: null }),

  setCallActive: (active) =>
    set({ status: active ? 'active' : 'connecting', isCallActive: active }),

  // Coupure réseau transitoire pendant l'appel (grâce ICE avant abandon définitif)
  setReconnecting: () => set({ status: 'reconnecting' }),

  // Appel refusé par l'agent terrain
  setDeclined: () => set({ status: 'declined' }),

  // Échec définitif (caméra/micro indisponible, ICE failed, timeout…)
  setFailed: (reason) => set({ status: 'failed', lastError: reason ?? null }),

  setMicOn:        (on) => set({ isMicOn: on }),
  setCameraOn:     (on) => set({ isCameraOn: on }),
  setCallDuration: (s)  => set({ callDuration: s }),

  resetCall: () => set({
    status: 'idle', numeroMtn: '', callUuid: '',
    isCallActive: false, isMicOn: true, isCameraOn: true, callDuration: 0, lastError: null,
  }),
}));

// ── Store de session agent ────────────────────────────────────────────────────
type CameraFacing = 'front' | 'back';

type AgentProfile = {
  numeroAgent: string; serverUrl: string; country?: string;
  fonctionAgent?: string; zoneAgent?: string;
};

interface AgentState {
  numeroAgent: string;
  serverUrl:   string;
  country?:     string | null;
  fonctionAgent?: string | null;
  zoneAgent?:    string | null;
  isConnected: boolean;
  // Caméra retenue entre deux sessions (Acquisition/FaceVerify) pour éviter à
  // l'agent de re-sélectionner avant/arrière à chaque dossier.
  preferredCamera: CameraFacing | null;
  setAgent: {
    (numero: string, url?: string): void;
    (profile: AgentProfile): void;
  };
  setPreferredCamera: (facing: CameraFacing) => void;
  setConnected:(v: boolean) => void;
  logout:      () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  numeroAgent: '',
  serverUrl:   '',
  country:     null,
  fonctionAgent: null,
  zoneAgent:    null,
  isConnected: false,
  preferredCamera: null,
  setAgent:    ((numOrProfile: string | AgentProfile, url?: string) => {
    if (typeof numOrProfile === 'string') {
      return set({ numeroAgent: numOrProfile, serverUrl: url ?? '' });
    }
    // object form
    const p = numOrProfile;
    return set({
      numeroAgent: p.numeroAgent ?? '',
      serverUrl:   p.serverUrl ?? '',
      country:     p.country ?? null,
      fonctionAgent: p.fonctionAgent ?? null,
      zoneAgent:    p.zoneAgent ?? null,
    });
  }) as AgentState['setAgent'],
  setPreferredCamera: (facing) => set({ preferredCamera: facing }),
  setConnected:(v)        => set({ isConnected: v }),
  logout:      ()         => set({ numeroAgent: '', serverUrl: '', country: null, fonctionAgent: null, zoneAgent: null, isConnected: false }),
}));