import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, T } from '../theme/tokens';

interface TabItem {
  key: string;
  label: string;
  icon: string;
}

interface BottomTabBarProps {
  tabs: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
}

// Palette premium claire/grisée.
const BAR_BG = '#ebf0f4d6';
const BAR_BORDER = 'rgba(15, 23, 42, 0.06)';
const PILL_BG = '#1c2f5a';
const LABEL_INACTIVE = '#2c487a';
const ACTIVE_COLOR = '#16233F';
const ACTIVE_ACCENT = C.yellow;

export function BottomTabBar({ tabs, activeKey, onChange }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[s.container, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <TouchableOpacity
            key={tab.key}
            style={s.tab}
            onPress={() => onChange(tab.key)}
            activeOpacity={0.75}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          >
            <View style={[s.iconWrap, active && s.iconWrapActive]}>
              <Text style={[s.icon, active && s.iconActive]}>{tab.icon}</Text>
              {active && <View style={s.activeAccent} />}
            </View>
            <Text
              style={[s.label, active && s.labelActive]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BAR_BG,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BAR_BORDER,
    paddingTop: 10,
    // Ombre premium : douce, diffuse, orientée vers le haut
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 10,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  iconWrapActive: {
    backgroundColor: PILL_BG,
  },
  icon: {
    fontSize: 22,
    opacity: 2.55,
  },
  iconActive: {
    opacity: 4,
  },
  activeAccent: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ACTIVE_ACCENT,
  },
  label: {
    marginTop: 5,
    fontSize: T.xs,
    lineHeight: T.xs + 2,
    color: LABEL_INACTIVE,
    fontWeight: '800',
    letterSpacing: 0.15,
    textAlign: 'center',
    includeFontPadding: false,
    ...Platform.select({
      android: { fontFamily: 'sans-serif-medium' },
    }),
  },
  labelActive: {
    color: ACTIVE_COLOR,
    fontWeight: '900',
    ...Platform.select({
      android: { fontFamily: 'sans-serif-medium' },
    }),
  },
});