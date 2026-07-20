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

const Stack = createStackNavigator();

export default function App() {
  const [initialRoute, setInitialRoute] = useState<string | null>(null);
  const setAgent = useAgentStore(s => s.setAgent);
  const navigationRef = useRef<NavigationContainerRef<any>>(null);

  const registerFcmTokenWithBackend = async (serverUrl: string, numeroAgent: string, token: string) => {
    if (!serverUrl || !numeroAgent || !token) return;

    const base = serverUrl.replace(/\/$/, '');
    const apiBase = base.startsWith('http') ? base : `http://${base}`;

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

  const openIncomingCallRoute = async (callUuid: string, numeroMtn: string) => {
    useCallStore.getState().setIncomingCall(numeroMtn, callUuid);
    await AsyncStorage.setItem('pending_incoming_call', JSON.stringify({ callUuid, numeroMtn }));

    const currentRoute = navigationRef.current?.getCurrentRoute()?.name;
    if (currentRoute === 'IncomingCall' || currentRoute === 'Call') return;

    navigationRef.current?.reset({
      index: 0,
      routes: [{ name: 'IncomingCall', params: { numeroMtn, callUuid } }],
    });
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
      void openIncomingCallRoute(callUuid, numeroMtn);
    };

    const handleAcceptedFromAppStart = async (uuid: string) => {
      if (cancelled) return;
      const { numeroMtn } = useCallStore.getState();
      useCallStore.getState().setConnecting();
      try {
        await signalingService.acceptCall();
        navigationRef.current?.reset({
          index: 0,
          routes: [{ name: 'Call', params: { callUuid: uuid, numeroMtn } }],
        });
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
        signalingService.hangUp();
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
        navigationRef.current?.reset({
          index: 0,
          routes: [{ name: 'IncomingCall', params: { numeroMtn: parsed.numeroMtn, callUuid: parsed.callUuid } }],
        });
      } catch (err) {
        console.warn('[App] Pending call restore failed', err);
      }
    };

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
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
        <NavigationContainer ref={navigationRef}>
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
