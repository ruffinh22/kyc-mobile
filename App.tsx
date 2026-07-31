/**
 * App.tsx — Point d'entrée principal
 * Navigation stack : Login → Idle → IncomingCall → Call
 * Auto-restore de session si numero + serveur mémorisés
 */
import React, { useEffect, useRef, useState } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator, TransitionPresets } from '@react-navigation/stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar, View, ActivityIndicator, AppState, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { LoginScreen }            from './src/screens/LoginScreen';
import { IdleScreen }             from './src/screens/IdleScreen';
import { DossierListScreen }      from './src/screens/DossierListScreen';
import { CallHistoryScreen }       from './src/screens/CallHistoryScreen';
import { IncomingCallScreen }      from './src/screens/IncomingCallScreen';
import { CallScreen }              from './src/screens/CallScreen';
import { AcquisitionScreenPro }    from './src/screens/AcquisitionScreenPro';
import { FaceVerifyScreen }        from './src/screens/FaceVerifyScreen';
import { AccountScreen }           from './src/screens/AccountScreen';
import { useAgentStore, useCallStore } from './src/store/callStore';
import { notificationService } from './src/services/NotificationService';
import { signalingService } from './src/services/SignalingService';
import { ensureHttpBase } from './src/utils/serverUrl';

const Stack = createStackNavigator();

export default function App() {
  const [initialRoute, setInitialRoute] = useState<string | null>(null);
  const [isNavReady, setIsNavReady] = useState(false);
  const setAgent = useAgentStore(s => s.setAgent);
  const navigationRef = useRef<NavigationContainerRef<any>>(null);

  // ── Autorité UNIQUE de navigation d'appel ────────────────────────────────
  // Principe : l'état pilote l'écran, jamais l'inverse. Avant, la navigation
  // vers IncomingCall/Call était déclenchée depuis plusieurs endroits en
  // réaction à des events précis (push FCM, message WS, tap "Accepter",
  // action CallKeep native...). Si l'un de ces chemins était court-circuité
  // par une course (deux navigateurs concurrents, event manqué pendant que
  // le mauvais écran était monté), l'écran d'appel ne s'ouvrait tout
  // simplement jamais — même si le PeerConnection, lui, devenait actif.
  //
  // Ici : un seul effet observe callStore.status et force l'écran
  // correspondant, quel que soit l'écran actuellement affiché et quel que
  // soit le nombre d'événements réseau redondants reçus. C'est cet effet,
  // et lui seul, qui décide quand ouvrir IncomingCall ou Call.
  const callStatus  = useCallStore(s => s.status);
  const callUuid    = useCallStore(s => s.callUuid);
  const callNumero  = useCallStore(s => (s as any).numeroMtn);

  useEffect(() => {
    const nav = navigationRef.current;
    if (!nav || !nav.isReady() || !isNavReady) return;

    const currentRoute = nav.getCurrentRoute()?.name;

    switch (callStatus) {
      case 'incoming':
        // Déjà sur l'écran attendu (ou plus loin, sur Call — ne recule pas) : rien à faire.
        if (currentRoute === 'IncomingCall' || currentRoute === 'Call') return;
        console.log('[App] forçage navigation → IncomingCall', { callUuid, numeroMtn: callNumero, currentRoute });
        nav.reset({ index: 0, routes: [{ name: 'IncomingCall', params: { numeroMtn: callNumero, callUuid } }] });
        return;

      case 'connecting':
      case 'active':
        // C'est LE fix du symptôme "ça ne force plus l'écran d'appel" : dès que
        // la connexion démarre/aboutit, on force Call — peu importe qu'on soit
        // resté bloqué sur Idle, sur un IncomingCall obsolète, ou ailleurs.
        if (currentRoute === 'Call') return;
        console.log('[App] forçage navigation → Call', { callUuid, numeroMtn: callNumero, currentRoute, status: callStatus });
        nav.reset({ index: 0, routes: [{ name: 'Call', params: { numeroMtn: callNumero, callUuid } }] });
        return;

      case 'ended':
        // États terminaux : si on est encore sur un écran d'appel alors que le
        // store dit que c'est fini (raccroché), on ramène vers Idle plutôt que
        // de laisser l'utilisateur bloqué sur un écran obsolète.
        // On ne force PAS Idle depuis un autre écran (DossierList, Account...) —
        // seulement depuis IncomingCall/Call, pour ne jamais interrompre une
        // navigation sans rapport avec l'appel.
        if (currentRoute !== 'IncomingCall' && currentRoute !== 'Call') return;
        console.log('[App] forçage navigation → Idle (appel terminé)', { status: callStatus, currentRoute });
        nav.reset({ index: 0, routes: [{ name: 'Idle' }] });
        return;

      default:
        return;
    }
  }, [callStatus, callUuid, callNumero, initialRoute, isNavReady]);

  const registerFcmTokenWithBackend = async (serverUrl: string, numeroAgent: string, token: string) => {
    if (!serverUrl || !numeroAgent || !token) return;

    const apiBase = ensureHttpBase(serverUrl || '');

    try {
      const res = await fetch(`${apiBase}/api/device/register-fcm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero: numeroAgent, token }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.warn('[App] FCM registration failed', res.status, text);
      }
    } catch (err) {
      console.warn('[App] FCM registration error', err);
    }
  };

  // Pose l'état d'appel entrant + le persiste pour la restauration (native/
  // AsyncStorage). NE NAVIGUE PLUS ICI : c'est le rôle exclusif de l'effet
  // `syncNavigationToCallState` ci-dessous, qui observe callStore.status.
  // Avant, cette fonction ET IdleScreen.tsx naviguaient chacune de leur côté
  // pour le même événement "appel entrant" (l'une pour le chemin push/CallKeep,
  // l'autre pour le chemin WebSocket) — deux autorités de navigation
  // concurrentes, source des courses observées dans les logs (navigations
  // ignorées/écrasées selon l'ordre d'arrivée). Il n'y en a plus qu'une seule
  // maintenant : l'état du call store.
  const openIncomingCallRoute = async (callUuid: string, numeroMtn: string) => {
    const callState = useCallStore.getState();

    if (callState.status !== 'idle') {
      console.log('[App] appel déjà en cours de traitement, incoming-call ignoré', { callUuid, numeroMtn, status: callState.status });
      return;
    }

    console.log('[App] appel entrant pris en compte', { callUuid, numeroMtn });
    callState.setIncomingCall(numeroMtn, callUuid);
    await AsyncStorage.setItem('pending_incoming_call', JSON.stringify({ callUuid, numeroMtn }));
  };

  const restorePendingCallFromNative = async () => {
    try {
      const payload = await NativeModules.KycCallModule?.consumePendingIncomingCall?.();
      if (!payload) return false;

      const parsed = JSON.parse(payload) as { callUuid?: string; numeroMtn?: string };
      if (!parsed.callUuid || !parsed.numeroMtn) return false;

      await openIncomingCallRoute(parsed.callUuid, parsed.numeroMtn);
      return true;
    } catch (err) {
      console.warn('[App] Native pending call restore failed', err);
      return false;
    }
  };

  // ── Restauration de session ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const res = await AsyncStorage.multiGet([
        'kyc_numero', 'kyc_server', 'kyc_country', 'kyc_fonction', 'kyc_zone'
      ]);
      const num = res.find(r => r[0] === 'kyc_numero')?.[1] || '';
      const srv = res.find(r => r[0] === 'kyc_server')?.[1] || '';
      const country = res.find(r => r[0] === 'kyc_country')?.[1] || null;
      const fonction = res.find(r => r[0] === 'kyc_fonction')?.[1] || null;
      const zone = res.find(r => r[0] === 'kyc_zone')?.[1] || null;
      if (num && srv) {
        setAgent({ numeroAgent: num, serverUrl: srv, country, fonctionAgent: fonction, zoneAgent: zone });
        setInitialRoute('Idle');
      } else {
        setInitialRoute('Login');
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const handleIncomingFromAppStart = (callUuid: string, numeroMtn: string) => {
      if (cancelled) return;
      setTimeout(() => {
        void openIncomingCallRoute(callUuid, numeroMtn);
      }, 120);
    };

    const handleAcceptedFromAppStart = async (uuid: string) => {
      if (cancelled) return;
      useCallStore.getState().setConnecting();
      try {
        await signalingService.acceptCall();
        // Pas de navigation ici : dès que status passe à 'connecting'
        // (ci-dessus) puis 'active', l'effet unique en tête du composant
        // force déjà l'ouverture de Call.
      } catch {
        signalingService.refuseCall();
        useCallStore.getState().resetCall();
        navigationRef.current?.reset({ index: 0, routes: [{ name: 'Idle' }] });
      }
    };

    notificationService.init({
      onIncomingCall: handleIncomingFromAppStart,
      onCallAccepted: handleAcceptedFromAppStart,
      onCallDeclined: () => signalingService.refuseCall(),
      onCallEnded: () => {
        const status = useCallStore.getState().status;
        if (status === 'active' || status === 'connecting') {
          signalingService.hangUp();
        } else {
          signalingService.refuseCall();
        }
        navigationRef.current?.reset({ index: 0, routes: [{ name: 'Idle' }] });
      },
      onTokenRefresh: async (newToken) => {
        signalingService.updateFcmToken(newToken);
        const { numeroAgent, serverUrl } = useAgentStore.getState();
        await registerFcmTokenWithBackend(serverUrl, numeroAgent, newToken);
      },
    }).catch((err) => console.warn('[App] Notification init failed', err));

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const restorePendingCall = async () => {
      const fromNative = await restorePendingCallFromNative();
      if (fromNative) return;

      try {
        const raw = await AsyncStorage.getItem('pending_incoming_call');
        if (!raw) return;

        const parsed = JSON.parse(raw) as { callUuid?: string; numeroMtn?: string };
        if (!parsed.callUuid || !parsed.numeroMtn) return;

        const currentRoute = navigationRef.current?.getCurrentRoute()?.name;
        if (currentRoute === 'IncomingCall' || currentRoute === 'Call') return;

        useCallStore.getState().setIncomingCall(parsed.numeroMtn, parsed.callUuid);
        // Navigation gérée par l'effet unique (status === 'incoming').
      } catch (err) {
        console.warn('[App] Pending call restore failed', err);
      }
    };

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        signalingService.resumePresence();
        void restorePendingCall();
      }
    });

    void restorePendingCall();
    return () => sub.remove();
  }, []);

  if (!initialRoute) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0D1117', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#004B93" size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        <NavigationContainer ref={navigationRef} onReady={() => setIsNavReady(true)}>
          <Stack.Navigator
            initialRouteName={initialRoute}
            screenOptions={{
              headerShown: false,
              gestureEnabled: false,
              ...TransitionPresets.FadeFromBottomAndroid,
            }}
          >
            <Stack.Screen name="Login"         component={LoginScreen} />
            <Stack.Screen name="Idle"          component={IdleScreen} />
            <Stack.Screen name="DossierList"   component={DossierListScreen} />
            <Stack.Screen name="CallHistory"   component={CallHistoryScreen} />
            <Stack.Screen name="Acquisition"   component={AcquisitionScreenPro} />
            <Stack.Screen name="Account"       component={AccountScreen} />
            <Stack.Screen name="FaceVerifyScreen" component={FaceVerifyScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen
              name="IncomingCall"
              component={IncomingCallScreen}
              options={{
                presentation: 'transparentModal',
                ...TransitionPresets.ModalSlideFromBottomIOS,
              }}
            />
            <Stack.Screen name="Call" component={CallScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}