import {AppRegistry} from 'react-native';
import messaging from '@react-native-firebase/messaging';
import App from './App';
import {name as appName} from './package.json';
import { notificationService } from './src/services/NotificationService';

// ─────────────────────────────────────────────────────────────────────────────
// CRITIQUE : cet appel doit être SYNCHRONE et tout en haut du fichier, pas
// caché derrière notificationService.registerBackgroundHandlers() (qui est
// une chaîne async : permission → CallKeep → token FCM avec retries réseau).
//
// Pourquoi : quand l'app est totalement fermée (jamais ouverte depuis le
// dernier redémarrage du téléphone, ou tuée), Android ne relance pas ton app
// normalement pour un push. Il démarre un contexte JS "headless" séparé dont
// le SEUL but est d'exécuter ce bundle jusqu'à trouver un handler déjà
// enregistré. Si l'enregistrement est retardé par d'autres await (permission,
// CallKeep, fetch du token FCM…), il arrive trop tard ou pas du tout dans ce
// contexte headless → silence total, exactement le symptôme "ça ne sonne que
// si l'app est déjà ouverte".
//
// handleHeadlessMessage() est volontairement autosuffisant côté
// NotificationService : il configure CallKeep lui-même avant d'afficher
// l'appel, sans dépendre d'aucun état préparé par App.tsx (qui, dans ce
// scénario headless, ne monte jamais).
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  await notificationService.handleHeadlessMessage(remoteMessage);
});

// Pré-chauffage (permission notifications, CallKeep, token FCM) pour le cas
// normal où l'app se lance vraiment (pas headless) — inchangé, toujours utile.
notificationService.registerBackgroundHandlers().catch((err) => {
  console.warn('[Index] Background notification setup failed', err);
});

AppRegistry.registerComponent(appName, () => App);