import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, T } from '../theme/tokens';

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  rightIcon?: string;
  onRightPress?: () => void;
}

export function AppHeader({ title, subtitle, rightIcon, onRightPress }: AppHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[s.container, { paddingTop: insets.top + 12 }]}> 
      <View style={s.left}>
        <View style={s.logoWrap}>
          <View style={s.logoInner}>
            <Text style={s.logoText}>MTN</Text>
          </View>
        </View>
        <View style={s.textWrap}>
          <Text style={s.title}>{title}</Text>
          {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        </View>
      </View>

      {onRightPress ? (
        <TouchableOpacity style={s.actionBtn} onPress={onRightPress} activeOpacity={0.8}>
          <Text style={s.actionIcon}>{rightIcon ?? '⚙️'}</Text>
        </TouchableOpacity>
      ) : (
        <View style={s.actionBtnPlaceholder} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
  },
  left: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  logoWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.blue,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.yellow,
    shadowColor: C.blue,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  logoInner: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: C.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: C.blue, fontWeight: '900', fontSize: 11 },
  textWrap: { marginLeft: 12, flex: 1 },
  title: { fontSize: T.md, fontWeight: '800', color: C.ink },
  subtitle: { marginTop: 2, fontSize: T.xs, color: C.ink3 },
  actionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.blue,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.yellow,
    shadowColor: C.blue,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  actionIcon: { fontSize: T.base, color: '#fff', fontWeight: '800' },
  actionBtnPlaceholder: { width: 38, height: 38 },
});
