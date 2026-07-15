/**
 * App.tsx — Point d'entrée principal
 * Navigation stack : Login → Idle → IncomingCall → Call
 * Auto-restore de session si numero + serveur mémorisés
 */
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator, TransitionPresets } from '@react-navigation/stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar, View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { LoginScreen }            from './src/screens/LoginScreen';
import { IdleScreen }             from './src/screens/IdleScreen';
import { DossierListScreen }      from './src/screens/DossierListScreen';
import { IncomingCallScreen }      from './src/screens/IncomingCallScreen';
import { CallScreen }              from './src/screens/CallScreen';
import { AcquisitionScreenPro }    from './src/screens/AcquisitionScreenPro';
import { FaceVerifyScreen }        from './src/screens/FaceVerifyScreen';
import { useAgentStore }           from './src/store/callStore';

const Stack = createStackNavigator();

export default function App() {
  const [initialRoute, setInitialRoute] = useState<string | null>(null);
  const setAgent = useAgentStore(s => s.setAgent);

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
        <NavigationContainer>
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
            <Stack.Screen name="Acquisition"   component={AcquisitionScreenPro} />
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
