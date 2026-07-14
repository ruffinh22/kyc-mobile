# 📱 KYC Mobile — Guide de démarrage Android Studio

## 🚀 DÉMARRAGE RAPIDE (5 min)

```bash
# 1️⃣ Installer les dépendances Node
cd /home/lidruf/kyc-mobile
npm install

# 2️⃣ Configurer les variables Android
export ANDROID_SDK_ROOT=/home/lidruf/Android/Sdk
export PATH=$PATH:$ANDROID_SDK_ROOT/platform-tools

# 3️⃣ Compiler APK debug
cd android
./gradlew assembleDebug

# 4️⃣ Ou lancer directement sur device/émulateur
npm run android

# 5️⃣ Ou ouvrir dans Android Studio
studio ./android
```

**À compléter :**
- [ ] `google-services.json` dans `android/app/` (Firebase Console)
- [ ] `.env` ou configuration serveur WebSocket

---

## ✅ Prérequis

### 1. **Android SDK & Studio** ✅ CONFIGURÉ
```bash
# Votre SDK est déjà installé à :
export ANDROID_SDK_ROOT=/home/lidruf/Android/Sdk
export PATH=$PATH:$ANDROID_SDK_ROOT/platform-tools

# Vérifier (devrait afficher la version)
adb --version
```

**SDK Components disponibles :**
- ✅ build-tools (34.0.0+)
- ✅ platform-tools
- ✅ emulator
- ✅ platforms/android-34

**Si manquant, installer via :**
```bash
# Mettre à jour la configuration
export ANDROID_SDK_ROOT=/home/lidruf/Android/Sdk
```

### 2. **Java Development Kit (JDK)**
```bash
# Vérifier Java 17+
java -version

# Si absent, installer
sudo apt install openjdk-17-jdk-headless
```

### 3. **Node.js & npm**
```bash
node --version  # 18+
npm --version   # 9+
```

---

## 🚀 Démarrage du projet

### Étape 1 : Installer les dépendances
```bash
cd /home/lidruf/kyc-mobile
npm install
```

### Étape 2 : Vérifier la configuration Android
```bash
# Affiche les emulateurs/devices disponibles
adb devices

# Créer un émulateur (optionnel)
avdmanager create avd -n KycEmulator -k "system-images;android-34;google_apis;arm64-v8a"
```

### Étape 3 : Démarrer Android Studio
```bash
# Ouvrir le projet
cd /home/lidruf/kyc-mobile
studio ./android &
```

### Étape 4 : Dans Android Studio

1. **File → Open** → Sélectionner le dossier `android/`
2. **Gradle Sync** — Attendre la synchronisation automatique
3. **Build → Make Project** (Ctrl+F9) — Compiler le projet
4. **Run → Run app** (Shift+F10) — Lancer sur émulateur/device

---

## 🔧 Troubleshooting

### ❌ Erreur : "android/build.gradle not found"
**Solution :**
```bash
cd kyc-mobile
npm install
# Les build.gradle sont dans /android/build.gradle et /android/app/build.gradle
```

### ❌ Erreur : "Unable to resolve dependency for app@release"
**Solution :**
```bash
cd android
./gradlew clean
./gradlew build --no-daemon
```

### ❌ Erreur : "ANDROID_SDK_ROOT not set"
**Solution :**
```bash
# Ajouter dans ~/.bashrc ou ~/.zshrc
export ANDROID_SDK_ROOT=/home/lidruf/Android/Sdk
export PATH=$PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin
export PATH=$PATH:$ANDROID_SDK_ROOT/platform-tools

source ~/.bashrc  # ou ~/.zshrc
```

### ❌ Erreur : "Module 'KycCallModule' not found"
**Solution :** Vérifier que les fichiers Java existent :
```bash
ls android/app/src/main/java/com/kycmobile/
# Doit voir : KycCallModule.java, KycCallPackage.java, KycForegroundCallService.java
```

### ❌ Erreur : Firebase Initialization
1. Vérifier `google-services.json` existe dans `android/app/`
2. Regénérer sur [Firebase Console](https://console.firebase.google.com)

---

## 📦 Compilation Release

```bash
# Générer APK release
cd android
./gradlew assembleRelease

# Ou via npm
npm run build:android

# L'APK se trouve dans :
# android/app/build/outputs/apk/release/app-release.apk
```

---

## 🧪 Tests sur Device/Emulateur

```bash
# Lister les devices
adb devices

# Installer manuellement
adb install android/app/build/outputs/apk/debug/app-debug.apk

# Voir les logs
adb logcat | grep KYC
```

---

## 📋 Configuration réseau (Serveur KYC)

Dans **LoginScreen**, définir :
- **URL serveur** : `http://<IP>:3000` (ou votre serveur)
- **Numéro agent** : Par exemple `0600000000`

Le serveur KYC doit avoir :
- **WebSocket** sur `/video-signal` (port 3000)
- **Firebase Admin SDK** configuré (voir `server/routes/video-signal.js`)

---

## ✨ Premiers tests

1. Lancer deux instances mobiles (ou une mobile + un émulateur)
2. Se connecter avec différents numéros
3. Depuis une instance : envoyer un appel via WebSocket
4. L'autre instance doit afficher la notification (FCM)
5. Accepter l'appel → Vidéo WebRTC doit démarrer

---

## 📞 Structure du projet

```
kyc-mobile/
├── android/
│   ├── app/build.gradle             ← Configuration build
│   ├── app/src/main/
│   │   ├── AndroidManifest.xml      ← Permissions & services
│   │   ├── java/com/kycmobile/
│   │   │   ├── MainActivity.java
│   │   │   ├── KycCallModule.java     ← Module natif JS ↔ Java
│   │   │   ├── KycForegroundCallService.java
│   │   │   └── ...
│   │   └── res/                      ← Ressources (colors, strings, icons)
│   ├── build.gradle
│   ├── settings.gradle
│   └── gradle/
├── src/
│   ├── services/
│   │   ├── SignalingService.ts      ← WebRTC + WebSocket
│   │   └── NotificationService.ts   ← FCM + CallKeep
│   ├── screens/                      ← UI React Native
│   └── store/                        ← État global (Zustand)
├── App.tsx                           ← Point d'entrée
├── package.json
├── babel.config.js
├── metro.config.js
├── tsconfig.json
└── index.js                          ← Entry point JS
```

---

## 📞 Support

- Problème WebRTC → Vérifier la config ICE dans `SignalingService.ts`
- Problème notification → Vérifier `google-services.json` et FCM tokens
- Problème écran verrouillé → Vérifier `MainActivity.java` flags

