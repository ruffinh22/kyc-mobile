/**
 * AcquisitionWebScreen.tsx
 * ──────────────────────────────────────────────────────
 * WebView pour accéder au formulaire d'acquisition web.
 * Charge {serverUrl}/acquisition, où serverUrl vient du profil agent
 * (configuré au Login / dans Compte) — jamais d'IP codée en dur ici :
 * une IP de secours fixe pointerait silencieusement vers la machine d'un
 * développeur ou un serveur périmé au lieu du serveur réellement configuré.
 */
import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';
import WebView from 'react-native-webview';
import { useAgentStore } from '../store/callStore';
import { C, T } from '../theme/tokens';

export function AcquisitionWebScreen() {
  const serverUrl = useAgentStore(s => s.serverUrl);

  if (!serverUrl) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorBox}>
          <Text style={styles.errorTxt}>
            Aucun serveur configuré. Renseigne l'URL du serveur dans Compte avant d'ouvrir le formulaire web.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const base = serverUrl.replace(/\/$/, '');
  const acquisitionUrl = `${base.startsWith('http') ? base : `http://${base}`}/acquisition`;

  return (
    <SafeAreaView style={styles.container}>
      <WebView
        source={{ uri: acquisitionUrl }}
        style={styles.webview}
        startInLoadingState={true}
        scalesPageToFit={true}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        geolocationEnabled={true}
        allowsInlineMediaPlayback={true}
        onError={(e) => console.warn('[AcquisitionWeb] WebView error:', e.nativeEvent)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  webview: {
    flex: 1,
  },
  errorBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  errorTxt: {
    color: C?.dangerText ?? '#F87171', fontSize: T?.md ?? 15, textAlign: 'center', lineHeight: 22,
  },
});