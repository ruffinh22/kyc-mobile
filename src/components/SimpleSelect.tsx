/**
 * SimpleSelect.tsx — KYC Mobile V4
 * ─────────────────────────────────────────────────────────────────────────────
 * Champ de sélection générique · Bottom-sheet premium alignée charte MTN
 * Utilisé pour Fonction agent / Zone agent dans le formulaire d'acquisition
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { C, R, T } from '../theme/tokens';

interface SimpleSelectProps {
  label: string;
  value: string;
  options: string[];
  onSelect: (value: string) => void;
}

export const SimpleSelect: React.FC<SimpleSelectProps> = ({
  label,
  value,
  options,
  onSelect,
}) => {
  const [showModal, setShowModal] = useState(false);

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.button}
        onPress={() => setShowModal(true)}
        activeOpacity={0.75}
      >
        <View style={styles.buttonIcon}>
          <View style={[styles.buttonDot, !!value && styles.buttonDotFilled]} />
        </View>
        <Text style={[styles.buttonText, !value && styles.buttonPlaceholder]} numberOfLines={1}>
          {value || 'Sélectionnez…'}
        </Text>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      <Modal
        visible={showModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.overlay}>
          <TouchableOpacity style={styles.overlayTap} activeOpacity={1} onPress={() => setShowModal(false)} />
          <SafeAreaView style={styles.sheet}>
            <View style={styles.handle} />

            <View style={styles.header}>
              <View>
                <Text style={styles.headerEyebrow}>SÉLECTION</Text>
                <Text style={styles.headerText}>{label}</Text>
              </View>
              <TouchableOpacity style={styles.closeButton} onPress={() => setShowModal(false)} activeOpacity={0.8}>
                <Text style={styles.closeTxt}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 24 }}>
              {options.map((option, index) => {
                const active = value === option;
                return (
                  <TouchableOpacity
                    key={index}
                    style={[styles.option, active && styles.optionSelected]}
                    onPress={() => {
                      onSelect(option);
                      setShowModal(false);
                    }}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.radio, active && styles.radioActive]}>
                      {active && <View style={styles.radioDot} />}
                    </View>
                    <Text style={[styles.optionText, active && styles.optionTextActive]}>
                      {option}
                    </Text>
                    {active && (
                      <View style={styles.checkBadge}>
                        <Text style={styles.checkTxt}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginBottom: 14 },

  // ── Trigger ──
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: C.bgBorder,
    borderRadius: R.md,
    backgroundColor: C.bg2,
  },
  buttonIcon: { width: 8, alignItems: 'center' },
  buttonDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.bgBorder },
  buttonDotFilled: { backgroundColor: C.yellow },
  buttonText: { fontSize: T.base, fontWeight: '600', color: C.ink, flex: 1 },
  buttonPlaceholder: { color: C.ink3, fontWeight: '400' },
  chevron: { fontSize: T.xl, color: C.yellow, fontWeight: '300', marginLeft: 4 },

  // ── Bottom sheet ──
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(2,6,16,0.65)' },
  overlayTap: { flex: 1 },
  sheet: {
    maxHeight: '70%',
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  headerEyebrow: { fontSize: T.xs, fontWeight: '700', color: C.yellow, letterSpacing: 1.5, marginBottom: 4 },
  headerText: { fontSize: T.lg, fontWeight: '900', color: C.ink, letterSpacing: -0.3 },
  closeButton: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.bg2, borderWidth: 1, borderColor: C.bgBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  closeTxt: { fontSize: T.base, color: C.ink2, fontWeight: '700' },

  list: { flexGrow: 0 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: C.bgBorder,
  },
  optionSelected: {},
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.bgBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { borderColor: C.yellow },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.yellow },
  optionText: { fontSize: T.base, fontWeight: '600', color: C.ink2, flex: 1 },
  optionTextActive: { color: C.ink, fontWeight: '700' },
  checkBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: C.success, alignItems: 'center', justifyContent: 'center',
  },
  checkTxt: { fontSize: T.xs, color: '#fff', fontWeight: '900' },
});