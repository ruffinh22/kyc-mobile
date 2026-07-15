import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { C, R, T } from '../theme/tokens';

interface IconTileProps {
  icon: string;
  label: string;
  color?: string;
  onPress?: () => void;
}

export function IconTile({ icon, label, color = C.blue, onPress }: IconTileProps) {
  return (
    <TouchableOpacity style={s.tile} onPress={onPress} activeOpacity={0.85}>
      <View style={[s.iconCircle, { backgroundColor: color }]}> 
        <Text style={s.icon}>{icon}</Text>
      </View>
      <Text style={s.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  tile: { alignItems: 'center', width: 84, marginBottom: 14 },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: '#0F1720',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  icon: { fontSize: 24 },
  label: { fontSize: T.xs, fontWeight: '700', color: C.ink2, textAlign: 'center' },
});
