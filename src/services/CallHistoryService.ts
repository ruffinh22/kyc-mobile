import AsyncStorage from '@react-native-async-storage/async-storage';

export type CallHistoryStatus =
  | 'incoming' | 'accepted' | 'declined' | 'missed' | 'ended'
  // ── Appels sortants (initiés par l'agent terrain) ─────────────────────────
  | 'outgoing' | 'outgoing-accepted' | 'outgoing-rejected'
  | 'outgoing-unavailable' | 'outgoing-cancelled';

export type CallHistoryEntry = {
  id: string;
  callUuid: string;
  numeroMtn: string;
  status: CallHistoryStatus;
  durationSec?: number;
  createdAt: string;
  updatedAt: string;
  // ── Identité de l'agent back-office à l'origine de l'appel ────────────────
  // Renseigné uniquement pour les appels ENTRANTS (reçus par le terrain) :
  // voir SignalingService/NotificationService, qui reçoivent ces champs dans
  // le message 'incoming-call' (WS et push FCM) transmis par le serveur
  // (public-dossiers.ts), lui-même alimenté par VideoCallPage.tsx.
  // Absents/undefined pour un appel sortant (initié par le terrain lui-même).
  agentAppelantMatricule?: string;
  agentAppelantNom?: string;
};

const STORAGE_KEY = 'call_history_v1';
const MAX_ENTRIES = 50;

const nowIso = () => new Date().toISOString();

export const callHistoryService = {
  async getHistory (): Promise<CallHistoryEntry[]> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as CallHistoryEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('[CallHistory] load failed', err);
      return [];
    }
  },

  async upsert (input: {
    callUuid?: string;
    numeroMtn: string;
    status?: CallHistoryStatus;
    durationSec?: number;
    agentAppelantMatricule?: string;
    agentAppelantNom?: string;
  }): Promise<CallHistoryEntry[]> {
    const callUuid = input.callUuid || `call-${Date.now()}`;
    const nextEntry: CallHistoryEntry = {
      id: `${callUuid}-${Date.now()}`,
      callUuid,
      numeroMtn: input.numeroMtn || 'Inconnu',
      status: input.status ?? 'accepted',
      durationSec: input.durationSec,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      agentAppelantMatricule: input.agentAppelantMatricule,
      agentAppelantNom: input.agentAppelantNom,
    };

    try {
      const current = await this.getHistory();
      const existingIndex = current.findIndex((item) => item.callUuid === callUuid);

      let merged: CallHistoryEntry[];
      if (existingIndex >= 0) {
        merged = [...current];
        merged[existingIndex] = {
          ...merged[existingIndex],
          ...nextEntry,
          createdAt: merged[existingIndex].createdAt,
          updatedAt: nextEntry.updatedAt,
          numeroMtn: input.numeroMtn || merged[existingIndex].numeroMtn,
          durationSec: typeof input.durationSec === 'number' ? input.durationSec : merged[existingIndex].durationSec,
          // Une entrée d'historique passe par plusieurs upsert() successifs
          // (ex. 'incoming' → 'accepted' → 'ended') ; seul le tout premier
          // appel (celui qui a le contexte 'incoming-call') connaît l'agent
          // appelant. Les mises à jour de statut suivantes n'ont pas cette
          // info dans leur payload — on préserve donc la valeur déjà stockée
          // au lieu de l'écraser par undefined.
          agentAppelantMatricule: input.agentAppelantMatricule ?? merged[existingIndex].agentAppelantMatricule,
          agentAppelantNom: input.agentAppelantNom ?? merged[existingIndex].agentAppelantNom,
        };
      } else {
        merged = [nextEntry, ...current];
      }

      const trimmed = merged.slice(0, MAX_ENTRIES);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return trimmed;
    } catch (err) {
      console.warn('[CallHistory] save failed', err);
      return [];
    }
  },

  async clear (): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEY);
  },
};