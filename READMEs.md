# KYC Mobile — App Android React Native
### Sonnerie native + Appel vidéo WebRTC — même écran verrouillé

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   SERVEUR KYC (Node.js/Fastify)             │
│  WebSocket /ws/video   +   Firebase Admin SDK               │
│       │                           │                         │
│  Signal WS (app ouverte)    FCM Push (app fermée/verrouillée)│
└──────────────────┬────────────────┬────────────────────────┘
                   │                │
        ┌──────────▼────────────────▼──────────┐
        │          KYC MOBILE (APK)            │
        │                                      │
        │  ┌──────────┐   ┌────────────────┐  │
        │  │ FCM       │   │  WebSocket     │  │
        │  │ (push)    │   │  Signaling     │  │
        │  └────┬──────┘   └───────┬────────┘  │
        │       │                  │           │
        │  ┌────▼──────────────────▼────────┐  │
        │  │     CallKeep (Android Telecom) │  │
        │  │  → Écran appel sur lock screen │  │
        │  └────────────────┬───────────────┘  │
        │                   │                  │
        │  ┌────────────────▼───────────────┐  │
        │  │     WebRTC (react-native-webrtc)│  │
        │  │  Vidéo + Audio peer-to-peer     │  │
        │  └────────────────────────────────┘  │
        └──────────────────────────────────────┘
```

---

## Pré-requis

| Outil           | Version min |
|-----------------|-------------|
| Node.js         | 18+         |
| React Native    | 0.73+       |
| Android SDK     | API 26+ (Android 8) |
| Java JDK        | 17+         |
| Firebase projet | Avec FCM activé |

---

## 1. Installation du projet

```bash
# Cloner / placer le dossier kyc-mobile
cd kyc-mobile
npm install

# Les modules natifs (react-native-webrtc, react-native-callkeep, etc.) sont auto-linkés
# avec React Native 0.73+. Pas besoin de 'npx react-native link'
```

---

## 2. Configuration Firebase

### 2a. Créer le projet Firebase
1. Aller sur https://console.firebase.google.com
2. Créer un projet « KYC-Congo »
3. Ajouter une app Android avec package `com.kycmobile`
4. Télécharger `google-services.json`
5. Placer `google-services.json` dans `android/app/`

### 2a-bis. Configuration Gradle (SDK Firebase)

#### Étape 1 : Ajouter le plugin Google Services au niveau racine
Dans le fichier `android/build.gradle.kts` (au niveau du projet), ajouter dans la section `plugins` :

```kotlin
plugins {
  // ...
  // Add the dependency for the Google services Gradle plugin
  id("com.google.gms.google-services") version "4.4.4" apply false
}
```

Ou en Groovy (`android/build.gradle`) :

```groovy
plugins {
  // ...
  id 'com.google.gms.google-services' version '4.4.4' apply false
}
```

#### Étape 2 : Ajouter le plugin et les SDK Firebase au module app
Dans le fichier `android/app/build.gradle.kts` (au niveau de l'application), ajouter le plugin et les SDK :

```kotlin
plugins {
  id("com.android.application")
  // Add the Google services Gradle plugin
  id("com.google.gms.google-services")
  // ...
}

dependencies {
  // Import the Firebase BoM
  implementation(platform("com.google.firebase:firebase-bom:34.14.1"))

  // Messaging (FCM) + Analytics
  implementation("com.google.firebase:firebase-messaging")
  implementation("com.google.firebase:firebase-analytics")
  
  // ...
}
```

Ou en Groovy (`android/app/build.gradle`) :

```groovy
plugins {
  id 'com.android.application'
  id 'com.google.gms.google-services'
  // ...
}

dependencies {
  // Import the Firebase BoM
  implementation platform('com.google.firebase:firebase-bom:34.14.1')

  // Messaging (FCM) + Analytics
  implementation 'com.google.firebase:firebase-messaging'
  implementation 'com.google.firebase:firebase-analytics'
  
  // ...
}
```

#### Étape 3 : Synchroniser le projet Gradle
Après avoir ajouté le plugin et les SDK, synchronisez votre projet Android :
- **Android Studio** : Cliquer sur "Sync Now"
- **Terminal** : `cd android && ./gradlew sync`

### 2b. Clé serveur FCM (pour le serveur Node.js)
1. Firebase Console → Paramètres projet → Comptes de service
2. Générer une nouvelle clé privée → télécharger `firebase-service-account.json`
3. Placer `firebase-service-account.json` à la racine du serveur KYC
4. Ajouter dans `.env` :
   ```
   FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
   ```

### 2c. Installer firebase-admin sur le serveur
```bash
cd /chemin/vers/serveur-kyc
npm install firebase-admin
```

---

## 3. Intégration du patch serveur

Copier `server-patch/video-signal-patch.js` dans le serveur KYC :
```bash
cp server-patch/video-signal-patch.js /chemin/serveur-kyc/server/routes/
```

Dans `server/routes/video-signal.js`, ajouter :
```js
const videoPatch = require('./video-signal-patch');
videoPatch.init(); // initialise Firebase Admin

// Dans le handler WebSocket 'register' terrain :
case 'register':
  if (msg.role === 'terrain') {
    videoPatch.registerTerrain(msg.numeroAgent, msg.fcmToken || null, socket, socketId);
    socket.send(JSON.stringify({ type: 'registered', ok: true }));
  }
  break;

// Dans le handler 'appeler' (back-office → appelle terrain) :
case 'appeler':
  await videoPatch.notifyTerrain(msg.numeroAgent, msg.numeroMtn, socketId);
  break;
```

Dans `SignalingService.ts`, le message `register` envoie déjà le `fcmToken` :
```ts
// Le token FCM est automatiquement inclus dans le register
// via notificationService.getFCMToken()
```

---

## 4. Ringtone

Placer un fichier `ringtone.mp3` dans :
```
android/app/src/main/res/raw/ringtone.mp3
```
(Et dans `ios/KYCMobile/ringtone.mp3` pour iOS)

---

## 5. Build APK Debug (test rapide)

```bash
# Lancer un device/émulateur Android connecté, puis :
cd kyc-mobile
npx react-native run-android
```

---

## 6. Build APK Release (distribution)

```bash
# Générer la keystore de signature (une seule fois)
keytool -genkeypair -v \
  -keystore android/app/release.keystore \
  -alias kyc-mobile \
  -keyalg RSA -keysize 2048 -validity 10000

# Configurer android/gradle.properties :
MYAPP_RELEASE_STORE_FILE=release.keystore
MYAPP_RELEASE_KEY_ALIAS=kyc-mobile
MYAPP_RELEASE_STORE_PASSWORD=VOTRE_MOT_DE_PASSE
MYAPP_RELEASE_KEY_PASSWORD=VOTRE_MOT_DE_PASSE

# Build
cd android
./gradlew assembleRelease

# APK généré :
# android/app/build/outputs/apk/release/app-release.apk
```

---

## 7. Distribution de l'APK

### Option A — Envoi direct (plus simple)
Envoyer l'APK par WhatsApp / email aux agents terrain.
Sur le téléphone : Paramètres → Sécurité → Autoriser sources inconnues → Installer.

### Option B — Google Play Internal Testing
Uploader l'APK dans la Play Console → Test interne → partager le lien.

---

## 8. Fonctionnement écran verrouillé

```
Back-office appelle un numéro MTN
          │
          ▼
Serveur KYC envoie :
  1. WebSocket « incoming-call »    (si app en foreground)
  2. FCM push HIGH_PRIORITY          (si app background/fermée)
          │
          ▼
Téléphone terrain reçoit le push FCM
          │
          ▼
firebase/messaging → setBackgroundMessageHandler()
          │
          ▼
CallKeep.displayIncomingCall()
          │
          ▼
Android Telecom API → Écran d'appel natif sur lock screen
(identique aux appels téléphoniques système)
          │
          ▼
Agent accepte → app s'ouvre → WebRTC démarre
```

---

## 9. Fichiers du projet

```
kyc-mobile/
├── App.tsx                          # Point d'entrée, navigation
├── package.json
├── src/
│   ├── screens/
│   │   ├── LoginScreen.tsx           # Saisie numéro agent
│   │   ├── IdleScreen.tsx            # Attente appel
│   │   ├── IncomingCallScreen.tsx    # Appel entrant (sonnerie)
│   │   └── CallScreen.tsx            # Appel vidéo actif
│   ├── services/
│   │   ├── SignalingService.ts       # WebSocket + WebRTC (mirrors video-call.js)
│   │   └── NotificationService.ts   # FCM + CallKeep
│   └── store/
│       └── callStore.ts              # État global Zustand
├── android/
│   └── app/src/main/
│       ├── AndroidManifest.xml       # Toutes les permissions
│       └── java/com/kycmobile/
│           └── KycForegroundCallService.java  # Service natif
└── server-patch/
    └── video-signal-patch.js         # Patch FCM pour le serveur KYC
```

---

## 10. Checklist avant livraison

- [ ] `google-services.json` placé dans `android/app/`
- [ ] `firebase-service-account.json` sur le serveur KYC
- [ ] `npm install firebase-admin` sur le serveur
- [ ] Patch `video-signal-patch.js` intégré dans `video-signal.js`
- [ ] `ringtone.mp3` dans `android/app/src/main/res/raw/`
- [ ] Keystore générée et configurée dans `gradle.properties`
- [ ] APK buildé et testé sur un vrai Android (pas émulateur pour caméra)
- [ ] Testé : appel reçu écran verrouillé ✓
- [ ] Testé : appel reçu app fermée ✓
- [ ] Testé : vidéo bidirectionnelle ✓
- [ ] Testé : toggle micro / caméra / retourner ✓
