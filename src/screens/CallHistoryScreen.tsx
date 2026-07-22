import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, StatusBar, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { callHistoryService, type CallHistoryEntry } from '../services/CallHistoryService';
import { useAgentStore } from '../store/callStore';
import { validatePhoneNumber, getPhoneRule } from '../config/CountryPhoneRules';
import { C, R, T } from '../theme/tokens';

function formatDate(value: string) {
  try {
    const date = new Date(value);
    return date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return value;
  }
}

function statusLabel(status: CallHistoryEntry['status']) {
  switch (status) {
    case 'accepted': return 'Accepté';
    case 'declined': return 'Refusé';
    case 'missed': return 'Manqué';
    case 'ended': return 'Terminé';
    case 'outgoing': return 'Sortant';
    case 'outgoing-accepted': return 'Sortant décroché';
    case 'outgoing-rejected': return 'Sortant refusé';
    case 'outgoing-unavailable': return 'Sortant injoignable';
    case 'outgoing-cancelled': return 'Sortant annulé';
    default: return 'Reçu';
  }
}

function statusBadgeStyle(status: CallHistoryEntry['status']) {
  switch (status) {
    case 'accepted':
    case 'outgoing-accepted':
      return { backgroundColor: 'rgba(16,185,129,0.14)', borderColor: 'rgba(16,185,129,0.28)' };
    case 'declined':
    case 'outgoing-rejected':
      return { backgroundColor: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.28)' };
    case 'missed':
    case 'outgoing-unavailable':
      return { backgroundColor: 'rgba(245,158,11,0.16)', borderColor: 'rgba(245,158,11,0.30)' };
    case 'outgoing':
    case 'outgoing-cancelled':
      return { backgroundColor: 'rgba(59,130,246,0.14)', borderColor: 'rgba(59,130,246,0.28)' };
    default:
      return { backgroundColor: 'rgba(15,23,42,0.08)', borderColor: 'rgba(15,23,42,0.16)' };
  }
}

function statusTextColor(status: CallHistoryEntry['status']) {
  switch (status) {
    case 'accepted':
    case 'outgoing-accepted':
      return '#047857';
    case 'declined':
    case 'outgoing-rejected':
      return '#dc2626';
    case 'missed':
    case 'outgoing-unavailable':
      return '#b45309';
    case 'outgoing':
    case 'outgoing-cancelled':
      return '#2563eb';
    default:
      return '#334155';
  }
}

function statusIcon(status: CallHistoryEntry['status']) {
  switch (status) {
    case 'accepted':
    case 'outgoing-accepted':
      return '📞';
    case 'declined':
    case 'outgoing-rejected':
      return '❌';
    case 'missed':
    case 'outgoing-unavailable':
      return '⛔';
    case 'outgoing':
    case 'outgoing-cancelled':
      return '📤';
    default:
      return '📥';
  }
}

function formatDuration(seconds?: number | string | null) {
  if (seconds == null) return null;
  const numeric = typeof seconds === 'string' ? Number(seconds) : seconds;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric <= 0) return null;
  const mins = Math.floor(numeric / 60);
  const secs = numeric % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function CallHistoryScreen({ navigation }: any) {
  const [items, setItems] = useState<CallHistoryEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [dialOpen, setDialOpen] = useState(false);
  const [dialNumber, setDialNumber] = useState('');
  const [dialError, setDialError] = useState('');
  const country = useAgentStore(s => s.country) || 'CG';
  const phoneRule = getPhoneRule(country);

  useEffect(() => {
    const load = async () => {
      const history = await callHistoryService.getHistory();
      setItems(history);
    };
    void load();
  }, []);

  // Recharge la liste à chaque retour sur l'écran (après un appel sortant)
  useEffect(() => {
    const unsub = navigation.addListener?.('focus', () => {
      void callHistoryService.getHistory().then((history) => {
        setItems(history);
      });
    });
    return unsub;
  }, [navigation]);

  const filteredItems = items.filter((item) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return [
      item.numeroMtn,
      statusLabel(item.status),
      item.callUuid,
      item.updatedAt,
    ].some((value) => value?.toLowerCase().includes(query));
  });

  const handleStartCall = () => {
    const v = validatePhoneNumber(dialNumber, country);
    if (!v.valid) { setDialError(v.error || 'Numéro invalide'); return; }
    setDialOpen(false);
    setDialNumber('');
    setDialError('');
    navigation.navigate('OutgoingCall', { numeroMtn: dialNumber });
  };

  const renderItem = ({ item }: { item: CallHistoryEntry }) => (
    <View style={s.card}>
      <View style={s.headerRow}>
        <View style={s.left}>
          <Text style={s.numero}>{item.numeroMtn}</Text>
          <Text style={s.statusText}>{statusLabel(item.status)}</Text>
        </View>
        <View style={s.durationBadge}>
          <Text style={s.durationBadgeText}>{formatDuration(item.durationSec) || '00:00'}</Text>
        </View>
      </View>
      <View style={s.metaRow}>
        <Text style={s.meta}>{formatDate(item.updatedAt)}</Text>
        <Text style={s.meta}>{statusIcon(item.status)} {item.callUuid.slice(-6)}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg0} />
      <AppHeader title="Historique des appels" subtitle="Appels reçus et traitements" rightIcon="✕" onRightPress={() => navigation.goBack()} />
      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          placeholder="Rechercher numéro, statut, UUID..."
          placeholderTextColor="rgba(15,23,42,0.45)"
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
        />
      </View>
      {filteredItems.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>Aucun appel enregistré</Text>
          <Text style={s.emptyText}>Les appels reçus apparaîtront ici après leur traitement.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="automatic"
        />
      )}

      <TouchableOpacity
        style={s.fab}
        onPress={() => { setDialOpen(true); setDialError(''); }}
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel="Lancer un nouvel appel"
      >
        <Text style={s.fabIcon}>📞</Text>
        <Text style={s.fabTxt}>Nouvel appel</Text>
      </TouchableOpacity>

      <Modal visible={dialOpen} transparent animationType="fade" onRequestClose={() => setDialOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Appeler un numéro</Text>
            <Text style={s.modalSub}>
              {phoneRule ? `${phoneRule.digitCount} chiffres · Commence par ${phoneRule.validPrefixes?.join(', ')}` : 'Saisissez le numéro à joindre'}
            </Text>
            <TextInput
              style={s.modalInput}
              value={dialNumber}
              onChangeText={(v) => { setDialNumber(v.replace(/\D/g, '')); setDialError(''); }}
              placeholder={phoneRule?.placeholder || 'XXXXXXXXX'}
              placeholderTextColor={C.ink3}
              keyboardType="numeric"
              maxLength={phoneRule?.digitCount || 12}
              autoFocus
            />
            {dialError ? <Text style={s.modalError}>{dialError}</Text> : null}
            <View style={s.modalActions}>
              <TouchableOpacity style={s.modalBtnGhost} onPress={() => { setDialOpen(false); setDialNumber(''); setDialError(''); }}>
                <Text style={s.modalBtnGhostTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalBtnPrimary} onPress={handleStartCall}>
                <Text style={s.modalBtnPrimaryTxt}>Appeler</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg0 },
  list: { flexGrow: 1, paddingHorizontal: 14, paddingVertical: 10, paddingBottom: 100, gap: 10 },
  searchRow: { paddingHorizontal: 14, paddingBottom: 8 },
  searchInput: {
    backgroundColor: C.bg2,
    borderRadius: R.xl,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: T.sm,
    color: C.ink,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.14)',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingBottom: 60 },
  emptyTitle: { color: C.ink, fontSize: T.lg, fontWeight: '800' },
  emptyText: { marginTop: 6, color: C.ink3, textAlign: 'center', fontSize: T.sm },
  card: {
    backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: R['2xl'], padding: 10, borderWidth: 1, borderColor: 'rgba(15,23,42,0.05)',
    shadowColor: '#0F1720', shadowOpacity: 0.03, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 1,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  left: { flex: 1, marginRight: 8 },
  numero: { color: C.ink, fontSize: T.md, fontWeight: '800' },
  statusText: { color: C.ink3, fontSize: T.xs, marginTop: 2 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  meta: { color: C.ink3, fontSize: T.xs },
  durationBadge: {
    backgroundColor: 'rgba(15,23,42,0.08)',
    borderRadius: R.xl,
    paddingVertical: 4,
    paddingHorizontal: 10,
    minWidth: 64,
    alignItems: 'center',
  },
  durationBadgeText: { color: C.ink, fontSize: T.xs, fontWeight: '800' },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, alignSelf: 'flex-start' },
  badgeText: { fontSize: T.xs, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
  uuid: { marginTop: 8, color: C.ink3, fontSize: T.xs },

  fab: {
    position: 'absolute', right: 16, bottom: 74,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.yellow, borderRadius: R.pill,
    paddingVertical: 8, paddingHorizontal: 12,
    shadowColor: C.shadowYellow, shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  fabIcon: { fontSize: T.sm },
  fabTxt: { fontSize: T.xs, fontWeight: '800', color: C.blue },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: {
    width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: R.xl, padding: 20,
    shadowColor: '#0F1720', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 10,
  },
  modalTitle: { fontSize: T.lg, fontWeight: '800', color: C.ink },
  modalSub: { marginTop: 4, fontSize: T.xs, color: C.ink3 },
  modalInput: {
    marginTop: 16, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.bgBorder,
    borderRadius: R.md, paddingVertical: 14, paddingHorizontal: 16,
    fontSize: T['2xl'], fontWeight: '800', textAlign: 'center', letterSpacing: 4,
    color: C.ink, fontVariant: ['tabular-nums'],
  },
  modalError: { marginTop: 10, color: C.dangerText, fontWeight: '700', fontSize: T.xs },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  modalBtnGhost: {
    flex: 1, paddingVertical: 13, borderRadius: R.md, alignItems: 'center',
    borderWidth: 1, borderColor: C.bgBorder, backgroundColor: '#fff',
  },
  modalBtnGhostTxt: { color: C.ink2, fontWeight: '700' },
  modalBtnPrimary: { flex: 1, paddingVertical: 13, borderRadius: R.md, alignItems: 'center', backgroundColor: C.blue },
  modalBtnPrimaryTxt: { color: '#fff', fontWeight: '800' },
});