import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, StatusBar, SafeAreaView
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
}

export function DossierListScreen({ navigation }: any) {
  const { numeroAgent, serverUrl } = useAgentStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dossiers, setDossiers] = useState<DossierItem[]>([]);

  const agentWa = useMemo(() => numeroAgent.replace(/\D/g, ''), [numeroAgent]);
  const baseUrl = useMemo(() => {
    const url = serverUrl?.replace(/\/$/, '') || '';
    return url.startsWith('http') ? url : `http://${url}`;
  }, [serverUrl]);

  const fetchDossiers = async () => {
    if (!agentWa) {
      setError('Aucun numéro agent valide disponible pour afficher les dossiers.');
      setLoading(false);
      return;
    }

    setLoading(true);
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
    }
  };

  useEffect(() => {
    fetchDossiers();
  }, [agentWa, baseUrl]);

  const renderItem = ({ item }: { item: DossierItem }) => {
    const status = String(item.statut || '').toLowerCase();
    const score = typeof item.score_visage === 'number' ? item.score_visage : null;
    const matched = item.visage_match === 1;

    const statusStyle =
      status === 'accepte' || status === 'accepted' || status === 'valide' || status === 'validé'
        ? s.statusOk
        : status === 'rejete' || status === 'rejected' || status === 'refuse' || status === 'refusé'
        ? s.statusKo
        : s.statusPending;

    const statusLabel =
      status === 'accepte' || status === 'accepted' || status === 'valide' || status === 'validé'
        ? 'ACCEPTÉ'
        : status === 'rejete' || status === 'rejected' || status === 'refuse' || status === 'refusé'
        ? 'REJETÉ'
        : 'EN ATTENTE';

    return (
      <View style={s.card}>
        <View style={s.cardHeader}>
          <View style={s.avatarWrap}>
            <Text style={s.avatarTxt}>{String(item.id).slice(0,2).toUpperCase()}</Text>
          </View>
          <View style={s.cardTitleWrap}>
            <Text style={s.cardId}>{item.id}</Text>
            <Text style={s.cardSub}>{item.numero_mtn}</Text>
          </View>
          <View style={[s.badge, statusStyle]}>
            <Text style={[s.badgeText, statusStyle]}>{statusLabel}</Text>
          </View>
        </View>

        <View style={s.scoreBox}>
          <View style={s.scoreLeft}>
            <Text style={s.scoreLabel}>Similarité faciale</Text>
            <Text style={s.scoreValue}>{score != null ? `${score.toFixed(1)}%` : '—'}</Text>
          </View>
          <View style={[s.matchPill, matched ? s.matchOk : s.matchWarn]}>
            <Text style={[s.matchText, matched ? s.matchTextOk : s.matchTextWarn]}>{matched ? 'MATCH' : 'À VALIDER'}</Text>
          </View>
        </View>

        <View style={s.metaGrid}>
          <View style={s.metaCell}>
            <Text style={s.metaLabel}>Date</Text>
            <Text style={s.metaValue}>{item.date}</Text>
          </View>
          <View style={s.metaCell}>
            <Text style={s.metaLabel}>Heure</Text>
            <Text style={s.metaValue}>{item.heure_reception}</Text>
          </View>
        </View>

        {item.heure_cloture ? (
          <View style={s.noteBox}>
            <Text style={s.noteLabel}>Clôturé</Text>
            <Text style={s.noteValue}>{item.heure_cloture}</Text>
          </View>
        ) : null}

        {item.raison_rejet ? (
          <View style={s.noteBox}>
            <Text style={s.noteLabel}>Motif de rejet</Text>
            <Text style={s.noteValue}>{item.raison_rejet}</Text>
          </View>
        ) : null}

        {item.visage_motif ? (
          <View style={s.noteBox}>
            <Text style={s.noteLabel}>Analyse IA</Text>
            <Text style={s.noteValue}>{item.visage_motif}</Text>
          </View>
        ) : null}
      </View>
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
          <TouchableOpacity style={s.refreshBtn} onPress={fetchDossiers}>
            <Text style={s.refreshTxt}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : dossiers.length === 0 ? (
        <View style={s.messageBox}>
          <Text style={s.emptyTxt}>Aucun dossier trouvé pour ce numéro.</Text>
          <TouchableOpacity style={s.refreshBtn} onPress={fetchDossiers}>
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
        />
      )}
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
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { marginTop: 12, color: C.ink3 },
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
  list: { paddingHorizontal: 20, paddingBottom: 24 },
  separator: { height: 12 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.96)', borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)',
    borderRadius: R.xl, padding: 16, flexDirection: 'column', gap: 10,
    shadowColor: '#0F1720', shadowOpacity: 0.05, shadowRadius: 16, shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  avatarWrap: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarTxt: { color: C.yellow, fontWeight: '800' },
  cardTitleWrap: { flex: 1, marginRight: 12 },
  cardId: { color: C.ink, fontSize: T.sm, fontWeight: '800' },
  cardSub: { marginTop: 2, color: C.ink3, fontSize: T.xs },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontSize: T.xs, fontWeight: '800', textTransform: 'uppercase' },
  scoreBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: R.lg,
    backgroundColor: 'rgba(15,23,42,0.03)', borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)',
  },
  scoreLeft: { flex: 1 },
  scoreLabel: { color: C.ink3, fontSize: T.xs, textTransform: 'uppercase', letterSpacing: 0.6 },
  scoreValue: { marginTop: 2, color: C.ink, fontSize: T.lg, fontWeight: '900' },
  matchPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  matchOk: { backgroundColor: 'rgba(76,175,80,0.12)', borderColor: 'rgba(76,175,80,0.24)' },
  matchWarn: { backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.24)' },
  matchText: { fontSize: T.xs, fontWeight: '800' },
  matchTextOk: { color: C.success },
  matchTextWarn: { color: C.yellow },
  metaGrid: { flexDirection: 'row', gap: 10 },
  metaCell: { flex: 1, backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: R.md, padding: 10, borderWidth: 1, borderColor: 'rgba(15,23,42,0.05)' },
  metaLabel: { color: C.ink3, fontSize: T.xs, textTransform: 'uppercase', letterSpacing: 0.6 },
  metaValue: { marginTop: 2, color: C.ink, fontSize: T.sm, fontWeight: '700' },
  noteBox: { padding: 10, borderRadius: R.md, backgroundColor: 'rgba(15,23,42,0.04)', borderWidth: 1, borderColor: 'rgba(15,23,42,0.05)' },
  noteLabel: { color: C.ink3, fontSize: T.xs, textTransform: 'uppercase', letterSpacing: 0.6 },
  noteValue: { marginTop: 2, color: C.ink, fontSize: T.sm },
  statusOk: { backgroundColor: 'rgba(76,175,80,0.12)', borderColor: 'rgba(76,175,80,0.24)' },
  statusKo: { backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.24)' },
  statusPending: { backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.24)' },
});