/**
 * AcquisitionWebScreen.tsx
 * ──────────────────────────────────────────────────────
 * WebView pour accéder au formulaire d'acquisition web
 * Simplement charger http://server:3001/acquisition
 */
import React from 'react';
import { View, StyleSheet, SafeAreaView } from 'react-native';
import WebView from 'react-native-webview';
import { useAgentStore } from '../store/callStore';

export function AcquisitionWebScreen({ navigation }: any) {
  // Récupérer l'URL du serveur depuis le store agent
  const serverUrlFromStore = useAgentStore(s => s.serverUrl);
  const serverUrl = serverUrlFromStore || 'http://10.58.134.116:3001';
  const acquisitionUrl = `${serverUrl}/acquisition`;

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
});
