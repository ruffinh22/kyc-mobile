/**
 * CountryPicker.tsx — KYC Mobile V4
 * ─────────────────────────────────────────────────────────────────────────────
 * Sélecteur de pays · Bottom-sheet premium alignée sur la charte MTN (tokens.ts)
 * Monogramme pays + indicatif · recherche live · accent jaune sur sélection
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  SafeAreaView,
} from 'react-native';
import { AFRICAN_COUNTRIES } from '../utils/phoneValidator';
import { C, R, T } from '../theme/tokens';

interface CountryPickerProps {
  selectedCountry: string;
  onSelect: (countryCode: string) => void;
}

export function CountryPicker({ selectedCountry, onSelect }: CountryPickerProps) {
  const [showModal, setShowModal] = useState(false);
  const [query, setQuery]         = useState('');
  const selected = AFRICAN_COUNTRIES[selectedCountry];

  const countries = useMemo(() => {
    const all = Object.values(AFRICAN_COUNTRIES);
    if (!query.trim()) return all;
    const q = query.trim().toLowerCase();
    return all.filter(c => c.name.toLowerCase().includes(q) || c.dialCode.includes(q));
  }, [query]);

  const openModal  = () => { setQuery(''); setShowModal(true); };
  const closeModal = () => setShowModal(false);

  return (
    <>
      <TouchableOpacity style={s.trigger} onPress={openModal} activeOpacity={0.75}>
        <View style={s.triggerMono}>
          <Text style={s.triggerMonoTxt}>{selected?.code?.slice(0, 2) ?? '—'}</Text>
        </View>
        <View style={s.triggerContent}>
          <Text style={s.triggerLabel}>PAYS</Text>
          {selected ? (
            <View style={s.triggerRow}>
              <Text style={s.triggerCountry} numberOfLines={1}>{selected.name}</Text>
              <Text style={s.triggerCode}>{selected.dialCode}</Text>
            </View>
          ) : (
            <Text style={s.triggerCountry}>Sélectionner…</Text>
          )}
        </View>
        <Text style={s.triggerChevron}>›</Text>
      </TouchableOpacity>

      <Modal visible={showModal} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={s.overlay}>
          <TouchableOpacity style={s.overlayTap} activeOpacity={1} onPress={closeModal} />
          <SafeAreaView style={s.sheet}>
            <View style={s.handle} />

            <View style={s.sheetHeader}>
              <View>
                <Text style={s.sheetEyebrow}>SÉLECTION</Text>
                <Text style={s.sheetTitle}>Choisir un pays</Text>
              </View>
              <TouchableOpacity style={s.closeBtn} onPress={closeModal} activeOpacity={0.8}>
                <Text style={s.closeTxt}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={s.searchWrap}>
              <Text style={s.searchIcon}>⌕</Text>
              <TextInput
                style={s.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Rechercher un pays ou indicatif"
                placeholderTextColor={C.ink3}
                autoCapitalize="none"
              />
            </View>

            <FlatList
              data={countries}
              keyExtractor={(item) => item.code}
              style={s.list}
              contentContainerStyle={{ paddingBottom: 24 }}
              ItemSeparatorComponent={() => <View style={s.sep} />}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const active = selectedCountry === item.code;
                return (
                  <TouchableOpacity
                    style={[s.item, active && s.itemActive]}
                    onPress={() => { onSelect(item.code); closeModal(); }}
                    activeOpacity={0.75}
                  >
                    <View style={[s.itemMono, active && s.itemMonoActive]}>
                      <Text style={[s.itemMonoTxt, active && s.itemMonoTxtActive]}>
                        {item.code.slice(0, 2)}
                      </Text>
                    </View>
                    <View style={s.itemInfo}>
                      <Text style={s.itemName}>{item.name}</Text>
                      <Text style={s.itemDial}>{item.dialCode}</Text>
                    </View>
                    {active && (
                      <View style={s.checkBadge}>
                        <Text style={s.checkTxt}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={s.empty}>
                  <Text style={s.emptyTxt}>Aucun pays trouvé</Text>
                </View>
              }
            />
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  // ── Trigger ──
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    width: '100%',
    paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: C.bg2,
    borderWidth: 1, borderColor: C.bgBorder,
    borderRadius: R.md,
    marginBottom: 12,
  },
  triggerMono: {
    width: 40, height: 40, borderRadius: R.sm,
    backgroundColor: C.blue,
    borderWidth: 1, borderColor: C.yellowBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  triggerMonoTxt: { fontSize: T.xs, fontWeight: '900', color: C.yellow, letterSpacing: 0.5 },
  triggerContent: { flex: 1 },
  triggerLabel: {
    fontSize: T.xs, fontWeight: '700', color: C.ink3,
    textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 2,
  },
  triggerRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  triggerCountry: { fontSize: T.base, fontWeight: '700', color: C.ink, flexShrink: 1 },
  triggerCode:    { fontSize: T.sm, fontWeight: '600', color: C.ink3 },
  triggerChevron: { fontSize: T.xl, color: C.yellow, fontWeight: '300' },

  // ── Bottom sheet ──
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(2,6,16,0.65)' },
  overlayTap: { flex: 1 },
  sheet: {
    maxHeight: '82%',
    backgroundColor: C.bg0,
    borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl,
    borderWidth: 1, borderColor: C.bgBorder, borderBottomWidth: 0,
    paddingTop: 10, paddingHorizontal: 20,
    shadowColor: C.shadowBlue, shadowOpacity: 0.4, shadowRadius: 30, shadowOffset: { width: 0, height: -8 },
    elevation: 20,
  },
  handle: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: C.bgBorder, marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    marginBottom: 16,
  },
  sheetEyebrow: { fontSize: T.xs, fontWeight: '700', color: C.yellow, letterSpacing: 1.5, marginBottom: 4 },
  sheetTitle:   { fontSize: T.lg, fontWeight: '900', color: C.ink, letterSpacing: -0.3 },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.bg2, borderWidth: 1, borderColor: C.bgBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  closeTxt: { fontSize: T.base, color: C.ink2, fontWeight: '700' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.bg2, borderWidth: 1, borderColor: C.bgBorder,
    borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 14,
  },
  searchIcon:  { fontSize: T.md, color: C.ink3 },
  searchInput: { flex: 1, fontSize: T.base, color: C.ink, padding: 0 },

  list: { flexGrow: 0 },
  sep:  { height: 1, backgroundColor: C.bgBorder },

  item: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12,
  },
  itemActive: {},
  itemMono: {
    width: 38, height: 38, borderRadius: R.sm,
    backgroundColor: C.bg2, borderWidth: 1, borderColor: C.bgBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  itemMonoActive: { backgroundColor: C.blue, borderColor: C.yellowBorder },
  itemMonoTxt:       { fontSize: T.xs, fontWeight: '800', color: C.ink2 },
  itemMonoTxtActive: { color: C.yellow },
  itemInfo: { flex: 1 },
  itemName: { fontSize: T.base, fontWeight: '700', color: C.ink },
  itemDial: { fontSize: T.xs, color: C.ink3, marginTop: 1 },
  checkBadge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: C.success, alignItems: 'center', justifyContent: 'center',
  },
  checkTxt: { fontSize: T.xs, color: '#fff', fontWeight: '900' },

  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyTxt: { fontSize: T.sm, color: C.ink3 },
});
