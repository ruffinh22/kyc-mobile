import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, StatusBar, SafeAreaView, RefreshControl, Modal
} from 'react-native';
import { useAgentStore } from '../store/callStore';
import { C, R, T } from '../theme/tokens';
import { AppHeader } from '../components/AppHeader';

interface DossierItem {
  id: string;
  numero_mtn: string;
  statut: string;
  date: string;
  heure_reception: string;
  heure_cloture?: string | null;
  raison_rejet?: string | null;
  score_visage?: number | null;
  visage_match?: number | null;
  visage_motif?: string | null;
  nom_titulaire?: string | null;
  prenom_titulaire?: string | null;
  date_naissance?: string | null;
  lieu_naissance?: string | null;
  adresse_complete?: string | null;
  numero_cni?: string | null;
  sexe?: string | null;
  nationalite?: string | null;
  profession?: string | null;
  autre_numero?: string | null;
  nom_pere?: string | null;
  nom_mere?: string | null;
}

function getStatusMeta(status: string) {
  const normalized = String(status || '').toLowerCase();

  if (['accepte', 'accepted', 'valide', 'validé'].includes(normalized)) {
    return {
      label: 'Accepté',
      icon: '✓',
      textColor: '#047857',
      chip: { backgroundColor: 'rgba(16,185,129,0.14)', borderColor: 'rgba(16,185,129,0.28)' },
      accentColor: '#10b981',
    };
  }

  if (['rejete', 'rejected', 'refuse', 'refusé'].includes(normalized)) {
    return {
      label: 'Rejeté',
      icon: '✕',
      textColor: '#dc2626',
      chip: { backgroundColor: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.28)' },
      accentColor: '#ef4444',
    };
  }

  return {
    label: 'En attente',
    icon: '⏳',
    textColor: '#b45309',
    chip: { backgroundColor: 'rgba(245,158,11,0.16)', borderColor: 'rgba(245,158,11,0.30)' },
    accentColor: '#f59e0b',
  };
}

export function DossierListScreen({ navigation }: any) {
  const { numeroAgent, serverUrl } = useAgentStore();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [dossiers, setDossiers] = useState<DossierItem[]>([]);
  const [selectedDossier, setSelectedDossier] = useState<DossierItem | null>(null);

  const agentWa = useMemo(() => numeroAgent.replace(/\D/g, ''), [numeroAgent]);
  const baseUrl = useMemo(() => {
    const url = serverUrl?.replace(/\/$/, '') || '';
    return url.startsWith('http') ? url : `http://${url}`;
  }, [serverUrl]);

  const fetchDossiers = async (isRefresh = false) => {
    if (!agentWa) {
      setError('Aucun numéro agent valide disponible pour afficher les dossiers.');
      setLoading(false);
      return;
    }

    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 7000);
      const res = await fetch(`${baseUrl}/api/public/dossiers?wa_agent=${agentWa}`, {
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      if (!res.ok) {
        throw new Error(`Serveur indisponible (${res.status})`);
      }
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Erreur de chargement');
      }
      setDossiers(data.dossiers ?? []);
    } catch (err: any) {
      setError(err?.message || 'Erreur de récupération');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDossiers();
  }, [agentWa, baseUrl]);

  const renderItem = ({ item }: { item: DossierItem }) => {
    const score = typeof item.score_visage === 'number' ? item.score_visage : null;
    const matched = item.visage_match === 1;
    const statusMeta = getStatusMeta(item.statut);

    const getScoreColor = (value: number | null) => {
      if (value == null) return '#64748b';
      if (value >= 90) return '#047857';
      if (value >= 75) return '#2563eb';
      if (value >= 60) return '#d97706';
      return '#dc2626';
    };

    const scoreColor = getScoreColor(score);

    const formatDateTime = (value?: string | null) => {
      if (!value) return '—';
      const text = String(value).trim();
      if (!text) return '—';
      const cleaned = text.replace(/T/g, ' ').replace(/\s+/g, ' ').trim();

      if (cleaned.includes(' ')) {
        const [datePart, timePart] = cleaned.split(' ');
        if (timePart && timePart.includes(':')) {
          const [hour = '00', minute = '00'] = timePart.split(':');
          const hh = String(hour).padStart(2, '0');
          const mm = String(minute).padStart(2, '0');
          return `${datePart} ${hh}:${mm}`;
        }
      }

      if (cleaned.includes(':')) {
        const [hour = '00', minute = '00'] = cleaned.split(':');
        const hh = String(hour).padStart(2, '0');
        const mm = String(minute).padStart(2, '0');
        return `${hh}:${mm}`;
      }

      return cleaned;
    };

    const displayDate = formatDateTime(item.date);
    const displayTime = formatDateTime(item.heure_reception);

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => setSelectedDossier(item)}
        style={[s.card, { borderLeftColor: statusMeta.accentColor, borderLeftWidth: 4 }]}
      >
        <View style={s.cardHeader}>
          <View style={s.cardIdentity}>
            <View style={s.avatarWrap}>
              <Text style={s.avatarTxt}>{String(item.id).slice(0, 2).toUpperCase()}</Text>
            </View>
            <View style={s.cardTitleWrap}>
              <Text style={s.cardId}>Dossier {item.id}</Text>
              <Text style={s.cardSub}>{item.numero_mtn}</Text>
            </View>
          </View>
          <View style={[s.badge, statusMeta.chip]}>
            <Text style={s.badgeIcon}>{statusMeta.icon}</Text>
            <Text style={[s.badgeText, { color: statusMeta.textColor }]}>{statusMeta.label}</Text>
          </View>
        </View>

        <View style={s.metaRow}>
          <Text style={s.metaText}>{displayDate}</Text>
          <Text style={s.metaDivider}>•</Text>
          <Text style={s.metaText}>{displayTime}</Text>
        </View>

        <View style={s.bottomRow}>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Match visage</Text>
            <Text style={[s.scoreValue, { color: scoreColor }]}>{score != null ? `${score.toFixed(1)}%` : '—'}</Text>
          </View>

          <View style={s.aiBox}>
            <Text style={s.aiLabel}>Titulaire</Text>
            <Text style={s.aiValue}>{[item.nom_titulaire, item.prenom_titulaire].filter(Boolean).join(' ') || '—'}</Text>
          </View>
        </View>

        <View style={s.footerRow}>
          {item.heure_cloture ? (
            <View style={s.noteBox}>
              <Text style={s.noteLabel}>Clôturé</Text>
              <Text style={s.noteValue}>{item.heure_cloture}</Text>
            </View>
          ) : null}

          {item.raison_rejet ? (
            <View style={s.noteBox}>
              <Text style={s.noteLabel}>Motif</Text>
              <Text style={s.noteValue}>{item.raison_rejet}</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg0} />
      <AppHeader title="Mes dossiers" subtitle={`Liste des dossiers envoyés par ${agentWa || 'votre agent'}`} rightIcon="✕" onRightPress={() => navigation.goBack()} />

      {loading ? (
        <View style={s.loadingBox}>
          <ActivityIndicator color={C.yellow} size="large" />
          <Text style={s.loadingTxt}>Chargement en cours…</Text>
        </View>
      ) : error ? (
        <View style={s.messageBox}>
          <Text style={s.errorTxt}>{error}</Text>
          <TouchableOpacity style={s.refreshBtn} onPress={() => { void fetchDossiers(false); }}>
            <Text style={s.refreshTxt}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : dossiers.length === 0 ? (
        <View style={s.messageBox}>
          <Text style={s.emptyTxt}>Aucun dossier trouvé pour ce numéro.</Text>
          <TouchableOpacity style={s.refreshBtn} onPress={() => { void fetchDossiers(false); }}>
            <Text style={s.refreshTxt}>Rafraîchir</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={dossiers}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          ItemSeparatorComponent={() => <View style={s.separator} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { void fetchDossiers(true); }} tintColor={C.yellow} colors={[C.blue]} />
          }
        />
      )}

      <Modal visible={!!selectedDossier} transparent animationType="fade" onRequestClose={() => setSelectedDossier(null)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <View>
                <Text style={s.modalTitle}>Détail du dossier</Text>
                <Text style={s.modalSubtitle}>Informations du titulaire</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedDossier(null)} style={s.closeBtnModal}>
                <Text style={s.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedDossier ? (
              <View style={s.modalBody}>
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>Nom / ID</Text>
                  <Text style={s.detailValue}>{selectedDossier.id}</Text>
                </View>
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>Numéro</Text>
                  <Text style={s.detailValue}>{selectedDossier.numero_mtn}</Text>
                </View>
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>Titulaire</Text>
                  <Text style={s.detailValue}>{[selectedDossier.nom_titulaire, selectedDossier.prenom_titulaire].filter(Boolean).join(' ') || '—'}</Text>
                </View>
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>Date naissance</Text>
                  <Text style={s.detailValue}>{selectedDossier.date_naissance || '—'}</Text>
                </View>
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>Lieu naissance</Text>
                  <Text style={s.detailValue}>{selectedDossier.lieu_naissance || '—'}</Text>
                </View>
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>Adresse</Text>
                  <Text style={s.detailValue}>{selectedDossier.adresse_complete || '—'}</Text>
                </View>
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>CNI / pièce</Text>
                  <Text style={s.detailValue}>{selectedDossier.numero_cni || '—'}</Text>
                </View>
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>Sexe / nationalité / profession</Text>
                  <Text style={s.detailValue}>{[selectedDossier.sexe, selectedDossier.nationalite, selectedDossier.profession].filter(Boolean).join(' · ') || '—'}</Text>
                </View>
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>Père / mère</Text>
                  <Text style={s.detailValue}>{[selectedDossier.nom_pere, selectedDossier.nom_mere].filter(Boolean).join(' / ') || '—'}</Text>
                </View>
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>Statut</Text>
                  <Text style={s.detailValue}>{selectedDossier.statut || '—'}</Text>
                </View>
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>Date</Text>
                  <Text style={s.detailValue}>{selectedDossier.date || '—'}</Text>
                </View>
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>Heure</Text>
                  <Text style={s.detailValue}>{selectedDossier.heure_reception || '—'}</Text>
                </View>
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>Score visage</Text>
                  <Text style={s.detailValue}>{selectedDossier.score_visage != null ? `${selectedDossier.score_visage.toFixed(1)}%` : '—'}</Text>
                </View>
                {selectedDossier.visage_motif ? (
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Analyse IA</Text>
                    <Text style={s.detailValue}>{selectedDossier.visage_motif}</Text>
                  </View>
                ) : null}
                {selectedDossier.raison_rejet ? (
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Motif</Text>
                    <Text style={s.detailValue}>{selectedDossier.raison_rejet}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg0 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16,
  },
  title: { fontSize: T.xl, fontWeight: '900', color: C.ink },
  subtitle: { marginTop: 4, color: C.ink3, fontSize: T.sm },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.bgBorder,
    shadowColor: '#0F1720', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  closeTxt: { fontSize: T.base, color: C.ink2, fontWeight: '700' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  loadingTxt: { marginTop: 12, color: C.ink3, fontSize: T.sm },
  messageBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorTxt: { color: C.dangerText, fontSize: T.base, textAlign: 'center' },
  emptyTxt: { color: C.ink3, fontSize: T.base, textAlign: 'center' },
  refreshBtn: {
    marginTop: 18, paddingVertical: 14, paddingHorizontal: 22,
    borderRadius: R.lg, backgroundColor: C.yellow,
    shadowColor: C.shadowYellow, shadowOpacity: 0.24, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  refreshTxt: { color: C.blue, fontWeight: '800' },
  list: { paddingHorizontal: 8, paddingTop: 4, paddingBottom: 16 },
  separator: { height: 4 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.96)', borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)',
    borderRadius: 10, padding: 8, flexDirection: 'column', gap: 4,
    shadowColor: '#0F1720', shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardIdentity: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 4 },
  avatarWrap: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  avatarTxt: { color: C.yellow, fontWeight: '800', fontSize: 9 },
  cardTitleWrap: { flex: 1 },
  cardId: { color: C.ink, fontSize: 10, fontWeight: '800' },
  cardSub: { marginTop: 1, color: C.ink3, fontSize: 9 },
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 999, borderWidth: 1, gap: 2 },
  badgeIcon: { fontSize: 8, fontWeight: '800' },
  badgeText: { fontSize: 8, fontWeight: '800', textTransform: 'uppercase' },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
    paddingHorizontal: 2,
  },
  metaText: { color: '#64748b', fontSize: 9, fontWeight: '600' },
  metaDivider: { color: '#94a3b8', fontSize: 9 },
  bottomRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  scoreBox: {
    flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 5, paddingHorizontal: 7, borderRadius: 8,
    backgroundColor: 'rgba(15,23,42,0.03)', borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)',
  },
  scoreLabel: { color: C.ink3, fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.3 },
  scoreValue: { color: C.ink, fontSize: 11, fontWeight: '900' },
  aiBox: { flex: 1, paddingVertical: 5, paddingHorizontal: 7, borderRadius: 8, backgroundColor: 'rgba(15,23,42,0.03)', borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)' },
  aiLabel: { color: C.ink3, fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.3 },
  aiValue: { marginTop: 1, color: C.ink, fontSize: 9 },
  footerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  noteBox: { flex: 1, minWidth: 88, padding: 5, borderRadius: 7, backgroundColor: 'rgba(15,23,42,0.04)', borderWidth: 1, borderColor: 'rgba(15,23,42,0.05)' },
  noteLabel: { color: C.ink3, fontSize: 7, textTransform: 'uppercase', letterSpacing: 0.3 },
  noteValue: { marginTop: 1, color: C.ink, fontSize: 9 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.58)', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  modalTitle: { color: C.ink, fontSize: 16, fontWeight: '800' },
  modalSubtitle: { color: C.ink3, fontSize: 12, marginTop: 2 },
  closeBtnModal: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.bg2, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: C.ink, fontWeight: '800' },
  modalBody: { gap: 8 },
  detailRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(15,23,42,0.06)' },
  detailLabel: { color: C.ink3, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  detailValue: { color: C.ink, fontSize: 13, fontWeight: '700', marginTop: 2 },
});