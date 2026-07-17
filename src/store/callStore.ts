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
export type CallStatus = 'idle' | 'incoming' | 'connecting' | 'active' | 'ended';

interface CallState {
  status:       CallStatus;
  numeroMtn:    string;
  callUuid:     string;   // uuid FCM si dispo, sinon `ws-<timestamp>`
  isCallActive: boolean;
  isMicOn:      boolean;
  isCameraOn:   boolean;
  callDuration: number;   // secondes
  errorMessage: string | null;

  setIncomingCall: (numeroMtn: string, uuid?: string) => void;
  setConnecting:   () => void;
  setCallActive:   (active: boolean) => void;
  setMicOn:        (on: boolean) => void;
  setCameraOn:     (on: boolean) => void;
  setCallDuration: (s: number) => void;
  setFailed:       (message: string) => void;
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
  errorMessage: null,

  // uuid est optionnel : absent sur le chemin WebSocket, présent sur le chemin FCM
  setIncomingCall: (numeroMtn, uuid = '') =>
    set({ status: 'incoming', numeroMtn, callUuid: uuid, errorMessage: null }),

  setConnecting: () => set({ status: 'connecting', errorMessage: null }),

  setCallActive: (active) =>
    set({ status: active ? 'active' : 'connecting', isCallActive: active, errorMessage: null }),

  setMicOn:        (on) => set({ isMicOn: on }),
  setCameraOn:     (on) => set({ isCameraOn: on }),
  setCallDuration: (s)  => set({ callDuration: s }),
  setFailed:       (message) => set({ status: 'ended', errorMessage: message }),

  resetCall: () => set({
    status: 'idle', numeroMtn: '', callUuid: '',
    isCallActive: false, isMicOn: true, isCameraOn: true, callDuration: 0, errorMessage: null,
  }),
}));

// ── Store de session agent ────────────────────────────────────────────────────
interface AgentState {
  numeroAgent: string;
  serverUrl:   string;
  country?:     string | null;
  fonctionAgent?: string | null;
  zoneAgent?:    string | null;
  preferredCamera?: 'front' | 'back' | null;
  isConnected: boolean;
  setAgent:    (numOrProfile: string | {
    numeroAgent: string; serverUrl: string; country?: string; fonctionAgent?: string; zoneAgent?: string
  }, url?: string) => void;
  setPreferredCamera: (camera: 'front' | 'back') => void;
  setConnected:(v: boolean) => void;
  logout:      () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  numeroAgent: '',
  serverUrl:   '',
  country:     null,
  fonctionAgent: null,
  zoneAgent:    null,
  preferredCamera: null,
  isConnected: false,
  setAgent:    (numOrProfile: any, url?: string) => {
    if (typeof numOrProfile === 'string') {
      return set({ numeroAgent: numOrProfile, serverUrl: url ?? '' });
    }
    // object form
    const p = numOrProfile || {};
    return set({
      numeroAgent: p.numeroAgent ?? '',
      serverUrl:   p.serverUrl ?? '',
      country:     p.country ?? null,
      fonctionAgent: p.fonctionAgent ?? null,
      zoneAgent:    p.zoneAgent ?? null,
    });
  },
  setPreferredCamera: (camera) => set({ preferredCamera: camera }),
  setConnected:(v)        => set({ isConnected: v }),
  logout:      ()         => set({ numeroAgent: '', serverUrl: '', country: null, fonctionAgent: null, zoneAgent: null, preferredCamera: null, isConnected: false }),
}));
