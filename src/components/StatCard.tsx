import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, R, T } from '../theme/tokens';

interface StatCardProps {
  title: string;
  value: string;
  accent?: string;
  subtitle?: string;
}

export function StatCard({ title, value, accent = C.blue, subtitle }: StatCardProps) {
  return (
    <View style={s.card}>
      <View style={[s.dot, { backgroundColor: accent }]} />
      <View style={s.textWrap}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.value}>{value}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: R.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: C.bgBorder,
    shadowColor: '#0F1720',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  textWrap: { flex: 1 },
  title: { fontSize: T.xs, color: C.ink3, fontWeight: '700' },
  value: { fontSize: T.lg, color: C.ink, fontWeight: '900', marginTop: 2 },
  subtitle: { fontSize: T.xs, color: C.ink3, marginTop: 2 },
});
