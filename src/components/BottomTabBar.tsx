import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
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

export function BottomTabBar({ tabs, activeKey, onChange }: BottomTabBarProps) {
  return (
    <View style={s.container}>
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <TouchableOpacity key={tab.key} style={s.tab} onPress={() => onChange(tab.key)} activeOpacity={0.85}>
            <View style={[s.iconWrap, active && s.iconWrapActive]}>
              <Text style={s.icon}>{tab.icon}</Text>
            </View>
            <Text style={[s.label, active && s.labelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(15,23,42,0.06)',
    shadowColor: '#0F1720',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 8,
  },
  tab: { alignItems: 'center', minWidth: 72 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,48,135,0.08)',
  },
  iconWrapActive: { backgroundColor: C.yellow },
  icon: { fontSize: 18 },
  label: { marginTop: 4, fontSize: T.xs, color: C.ink3, fontWeight: '700' },
  labelActive: { color: C.blue },
});
