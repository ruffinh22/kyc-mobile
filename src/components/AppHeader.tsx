import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, T } from '../theme/tokens';

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  leftIcon?: string;
  onLeftPress?: () => void;
  rightIcon?: string;
  onRightPress?: () => void;
}

export function AppHeader({ title, subtitle, leftIcon, onLeftPress, rightIcon, onRightPress }: AppHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[s.container, { paddingTop: insets.top + 12 }]}> 
      <View style={s.left}>
        {onLeftPress ? (
          <TouchableOpacity style={[s.actionBtn, s.leftActionBtn]} onPress={onLeftPress} activeOpacity={0.8}>
            <View style={s.iconCenter}>
              <Text style={s.actionIcon}>{leftIcon ?? '←'}</Text>
            </View>
          </TouchableOpacity>
        ) : null}

        <View style={s.logoWrap}>
          <View style={s.logoInner}>
            <Text style={s.logoText} numberOfLines={1} allowFontScaling={false}>MTN</Text>
          </View>
        </View>
        <View style={s.textWrap}>
          <Text style={s.title} numberOfLines={1} ellipsizeMode="tail" allowFontScaling={false}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={s.subtitle} numberOfLines={1} ellipsizeMode="tail" allowFontScaling={false}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {onRightPress ? (
        <TouchableOpacity style={s.actionBtn} onPress={onRightPress} activeOpacity={0.8}>
          <View style={s.iconCenter}>
            <Text style={s.actionIcon}>{rightIcon ?? '⚙️'}</Text>
          </View>
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
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: '#EEF2F7',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(15,23,42,0.07)',
  },
  left: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 },
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
    borderWidth: 2,
    borderColor: C.yellow,
    shadowColor: C.blue,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
    // Le bouton lui-même ne centre plus directement le Text : il centre
    // le wrapper iconCenter, qui à son tour centre le glyphe. Ce double
    // conteneur neutre absorbe les différences de boîte entre une flèche
    // Unicode et un emoji coloré, sans réglage au cas par cas.
    alignItems: 'center',
    justifyContent: 'center',
  },
  leftActionBtn: { marginRight: 12 },
  // Conteneur neutre, sans dimension forcée : il se dimensionne sur son
  // contenu réel et le flexbox parent le centre pixel pour pixel, peu
  // importe le glyphe utilisé.
  iconCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIcon: {
    fontSize: T.base,
    color: '#fff',
    fontWeight: '800',
    includeFontPadding: false,
    textAlign: 'center',
  },
  actionBtnPlaceholder: { width: 38, height: 38 },
});