import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, StatusBar, SafeAreaView
} from 'react-native';
import { useAgentStore } from '../store/callStore';
import { C, R, T } from '../theme/tokens';

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
    return (
      <View style={s.card}>
        <View style={s.row}>
          <Text style={s.label}>ID</Text>
          <Text style={s.value}>{item.id}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.label}>Numéro MTN</Text>
          <Text style={s.value}>{item.numero_mtn}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.label}>Statut</Text>
          <Text style={[s.value, item.statut === 'accepte' ? s.statusOk : item.statut === 'rejete' ? s.statusKo : s.statusPending]}>
            {item.statut.toUpperCase()}
          </Text>
        </View>
        <View style={s.row}>
          <Text style={s.label}>Date</Text>
          <Text style={s.value}>{item.date} {item.heure_reception}</Text>
        </View>
        {item.heure_cloture ? (
          <View style={s.row}>
            <Text style={s.label}>Clôturé</Text>
            <Text style={s.value}>{item.heure_cloture}</Text>
          </View>
        ) : null}
        {item.raison_rejet ? (
          <View style={s.row}>
            <Text style={s.label}>Motif</Text>
            <Text style={s.value}>{item.raison_rejet}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg0} />
      <View style={s.header}>
        <View>
          <Text style={s.title}>Mes dossiers</Text>
          <Text style={s.subtitle}>Liste des dossiers envoyés par {agentWa || 'votre agent'}</Text>
        </View>
        <TouchableOpacity style={s.closeBtn} onPress={() => navigation.goBack()}>
          <Text style={s.closeTxt}>✕</Text>
        </TouchableOpacity>
      </View>

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
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  label: { color: C.ink3, fontSize: T.xs, textTransform: 'uppercase', letterSpacing: 0.6 },
  value: { color: C.ink, fontSize: T.sm, flexShrink: 1, textAlign: 'right' },
  statusOk: { color: C.success },
  statusKo: { color: C.dangerText },
  statusPending: { color: C.yellow },
});