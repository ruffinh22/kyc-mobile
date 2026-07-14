# KYC — Guide de déploiement des correctifs

## Fichiers corrigés et où les placer

### SERVEUR (`kyc-v40/`)

| Fichier corrigé | Destination |
|---|---|
| `server/routes/video-signal.js` | `server/routes/video-signal.js` (remplace l'existant) |

**Modifications clés :**
- Fusion du patch FCM dans le fichier principal (plus besoin de `video-signal-patch.js`)
- Le register terrain accepte maintenant `fcmToken` et le stocke
- Le handler `call` envoie le push FCM automatiquement en plus du WS
- Gestion de la déconnexion terrain notifie le BO (`terrain-presence: false`)
- Gestion correcte de `webrtc { payload: { kind, sdp?, candidate? } }`

**Variable d'environnement à ajouter dans `.env` :**
```
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
```

**Dépendance à installer :**
```bash
npm install firebase-admin
```

---

### MOBILE (`kyc-mobile/`)

| Fichier corrigé | Destination |
|---|---|
| `src/services/SignalingService.ts` | `src/services/SignalingService.ts` |
| `src/services/NotificationService.ts` | `src/services/NotificationService.ts` |
| `src/store/callStore.ts` | `src/store/callStore.ts` |
| `src/screens/IdleScreen.tsx` | `src/screens/IdleScreen.tsx` |
| `src/screens/IncomingCallScreen.tsx` | `src/screens/IncomingCallScreen.tsx` |
| `src/screens/CallScreen.tsx` | `src/screens/CallScreen.tsx` |

**Nouveaux fichiers Java à créer :**

| Nouveau fichier | Destination |
|---|---|
| `KycCallModule.java` | `android/app/src/main/java/com/kycmobile/KycCallModule.java` |
| `KycCallPackage.java` | `android/app/src/main/java/com/kycmobile/KycCallPackage.java` |
| `MainApplication.java` | `android/app/src/main/java/com/kycmobile/MainApplication.java` *(remplace)* |
| `MainActivity.java` | `android/app/src/main/java/com/kycmobile/MainActivity.java` *(remplace)* |

`App.tsx` et `LoginScreen.tsx` sont **inchangés** — ne pas remplacer.

---

## Corrections principales

### SignalingService.ts
- **Protocole aligné** : envoi `{ type:'register', role:'terrain', numero, fcmToken }`  
  (le serveur attend `numero`, pas `numeroAgent`)
- **WebRTC unifié** : tout passe par `{ type:'webrtc', payload:{ kind, ... } }` — plus d'`offer`/`answer`/`ice-candidate` directs
- **Raccrochage** : le serveur envoie `hangup` (pas `raccrocher`) — corrigé
- **addStreamListener()** : CallScreen s'y abonne proprement — plus de mutation de callbacks à chaud
- Token FCM transmis au `init()` et envoyé au `register`

### NotificationService.ts
- `getFCMToken()` synchrone (le token est mis en cache mémoire)
- Refresh du token FCM géré
- `callUuid` extrait du payload FCM (envoyé par le serveur)

### IdleScreen.tsx
- Séquençage : `notificationService.init()` en premier pour récupérer le token FCM, puis `signalingService.init()` avec le token

### CallScreen.tsx
- Utilise `addStreamListener` au lieu de modifier `signalingService.callbacks` directement

### Java (KycCallModule + KycCallPackage)
- Pont natif JS ↔ `KycForegroundCallService` (pièce manquante critique)
- `MainApplication.java` déclare `KycCallPackage` dans `getPackages()`
- `MainActivity.java` configure le réveil écran pour l'appel entrant

---

## Vérification rapide

```bash
# Syntaxe serveur
node --check server/routes/video-signal.js

# Build Android
cd android && ./gradlew assembleDebug
```
