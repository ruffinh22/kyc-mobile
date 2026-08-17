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
// COMPLÉTÉ : 'outgoing', 'reconnecting', 'declined', 'failed' avaient disparu
// de cette union dans la version incomplète, alors que SignalingService.ts
// les référence explicitement comme des états distincts et attendus (voir
// handleOffer : "'idle' / 'declined' / 'failed' / 'ended' / etc.").
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
  errorMessage: string | null;
  // COMPLÉTÉ : ces deux champs avaient disparu alors qu'IncomingCallScreen.tsx
  // les lit directement (callStore.agentAppelantMatricule / .agentAppelantNom)
  // pour afficher "Appel de {agent}" — sans eux, ce champ était toujours
  // undefined et l'écran retombait systématiquement sur le texte générique.
  agentAppelantMatricule: string;
  agentAppelantNom:       string;

  setIncomingCall: (numeroMtn: string, uuid?: string, agentMatricule?: string, agentNom?: string) => void;
  setOutgoingCall: (numeroMtn: string, uuid?: string) => void;
  setConnecting:   () => void;
  setCallActive:   (active: boolean) => void;
  setReconnecting: () => void;
  setDeclined:     () => void;
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
  agentAppelantMatricule: '',
  agentAppelantNom:       '',

  // uuid est optionnel : absent sur le chemin WebSocket, présent sur le chemin FCM
  //
  // COMPLÉTÉ : ce garde-fou avait disparu dans la version incomplète. Sans
  // lui, un doublon d'appel entrant (le serveur peut émettre plusieurs
  // 'incoming-call' avec des callUuid DIFFÉRENTS pour le même appel logique —
  // redial back-office, retry réseau) écrase silencieusement un appel déjà
  // en cours de traitement. En le mettant ici, dans le store, c'est
  // structurellement impossible à contourner : tant qu'un appel est en cours
  // (status !== 'idle'), tout nouvel appel entrant est un no-op silencieux.
  setIncomingCall: (numeroMtn, uuid = '', agentMatricule = '', agentNom = '') =>
    set((state) => {
      if (state.status !== 'idle') {
        console.log('[CallStore] appel déjà en cours, setIncomingCall ignoré', {
          statutActuel: state.status, callUuidActuel: state.callUuid, callUuidIgnore: uuid,
        });
        return state;
      }
      return {
        status: 'incoming', numeroMtn, callUuid: uuid, errorMessage: null,
        agentAppelantMatricule: agentMatricule, agentAppelantNom: agentNom,
      };
    }),

  // COMPLÉTÉ : même garde-fou pour l'appel sortant, et statut remis à
  // 'outgoing' (pas 'connecting' directement) — sinon un écran qui navigue
  // vers CallScreen dès que status passe à 'connecting'/'active' sauterait
  // l'écran de sonnerie (OutgoingCallScreen) dès que l'agent appuie sur
  // "Appeler", avant même que la cible n'ait décroché.
  setOutgoingCall: (numeroMtn, uuid = '') =>
    set((state) => {
      if (state.status !== 'idle') {
        console.log('[CallStore] appel déjà en cours, setOutgoingCall ignoré', { statutActuel: state.status });
        return state;
      }
      return { status: 'outgoing', numeroMtn, callUuid: uuid, isCallActive: false, errorMessage: null };
    }),

  setConnecting: () => set({ status: 'connecting', errorMessage: null }),

  setCallActive: (active) =>
    set({ status: active ? 'active' : 'connecting', isCallActive: active, errorMessage: null }),

  // COMPLÉTÉ : méthode absente de la version incomplète — nécessaire pour
  // représenter une coupure réseau transitoire pendant l'appel (voir
  // SignalingService.ts, événement stream 'reconnecting'), distincte d'une
  // fin d'appel définitive.
  setReconnecting: () => set({ status: 'reconnecting' }),

  // COMPLÉTÉ : méthode absente — appel refusé par l'agent terrain, distinct
  // de 'failed' (échec technique) et 'ended' (fin normale).
  setDeclined: () => set({ status: 'declined' }),

  setMicOn:        (on) => set({ isMicOn: on }),
  setCameraOn:     (on) => set({ isCameraOn: on }),
  setCallDuration: (s)  => set({ callDuration: s }),

  // COMPLÉTÉ : statut remis à 'failed' (pas 'ended') — SignalingService.ts
  // traite déjà ces deux valeurs comme sémantiquement différentes.
  setFailed: (message) => set({ status: 'failed', errorMessage: message }),

  resetCall: () => set({
    status: 'idle', numeroMtn: '', callUuid: '',
    isCallActive: false, isMicOn: true, isCameraOn: true, callDuration: 0, errorMessage: null,
    agentAppelantMatricule: '', agentAppelantNom: '',
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