# ⚡ Commandes Rapides - Copy/Paste Prêtes à l'Emploi

## 🚀 Démarrer Immédiatement (3 min)

```bash
# Terminal 1: Compiler + Installer
cd ~/kyc-mobile && ./build-and-install.sh

# Terminal 2: Voir les logs (pendant le test)
cd ~/kyc-mobile && ./watch-logs.sh
```

Puis **dans l'app:**
- Pays: **Congo (CG)**
- Numéro: **065151234**
- Serveur: **https://kyc.palladium-africa.com**
- Cliquez: **Se connecter**

---

## 📱 Compilation Seule

```bash
# Build release
cd ~/kyc-mobile && npm run build:android

# Ou avec gradle directement
cd ~/kyc-mobile/android && ./gradlew assembleRelease
```

**Résultat:** `~/kyc-mobile/android/app/build/outputs/apk/release/app-release.apk`

---

## 📲 Installation

```bash
# Installer
adb install ~/kyc-mobile/android/app/build/outputs/apk/release/app-release.apk

# Réinstaller (remplace)
adb install -r ~/kyc-mobile/android/app/build/outputs/apk/release/app-release.apk

# Supprimer complètement
adb uninstall com.kycmobile
```

---

## 📊 Gestion de l'App

```bash
# Lancer l'app
adb shell am start -n com.kycmobile/.MainActivity

# Arrêter l'app
adb shell am force-stop com.kycmobile

# Voir si elle est installée
adb shell pm list packages | grep kyc

# Effacer les données (redémarre l'écran login)
adb shell pm clear com.kycmobile
```

---

## 👀 Logs & Debugging

```bash
# Logs KYC seulement
./watch-logs.sh

# Tous les logs (erreurs + warnings)
./watch-logs.sh --all

# Logs bruts (complet)
adb logcat

# Effacer les logs et redémarrer
./watch-logs.sh --clear

# Chercher une erreur spécifique
adb logcat | grep "health\|WebSocket\|FATAL"
```

---

## 🌐 Tester le Serveur

```bash
# Tester une URL avant de l'utiliser dans l'app
./test-server.sh https://kyc.palladium-africa.com
./test-server.sh http://192.168.1.100:8000

# Ou manuellement avec curl
curl -I https://kyc.palladium-africa.com/health
curl http://192.168.1.100:8000/health
```

---

## 🧪 Test des Numéros (Sans App)

```bash
# Tester tous les pays
node test-phone-validator.js --all

# Tester un pays spécifique
node test-phone-validator.js --country CG
node test-phone-validator.js --country CI

# Tester un numéro précis
node test-phone-validator.js --number 065151234 CG
node test-phone-validator.js --number 0758123456 CI
```

---

## 🔧 Dépannage Rapide

```bash
# Téléphone pas reconnu
adb kill-server && adb start-server && adb devices

# Compilation échoue
cd ~/kyc-mobile/android && ./gradlew clean && ./gradlew assembleRelease

# App crash
adb logcat | grep -E "Exception|FATAL"

# Port déjà utilisé (si serveur local)
lsof -i :8000  # Voir quel processus utilise le port

# Réinstaller complètement (en partant de zéro)
adb uninstall com.kycmobile && \
cd ~/kyc-mobile && \
./gradlew clean && \
npm run build:android && \
adb install ~/kyc-mobile/android/app/build/outputs/apk/release/app-release.apk
```

---

## 📋 Numéros de Test Rapides

```bash
# Copier/coller directement dans l'app:
# Congo
065151234

# Bénin
94004005

# Côte d'Ivoire
0758123456

# Cameroun
691234567

# Guinée Bissau
6657891

# Guinée
628123456
```

---

## 🌍 URLs de Serveur Test

```
Production: https://kyc.palladium-africa.com

Local (remplacer X.X par votre IP):
http://192.168.X.X:8000

Staging: https://kyc-staging.palladium-africa.com
```

---

## 🎯 Workflow Complet (Copy/Paste)

```bash
#!/bin/bash
# Copier ce bloc entier dans le terminal

# 1. Nettoyer
cd ~/kyc-mobile
adb uninstall com.kycmobile 2>/dev/null

# 2. Compiler
npm run build:android 2>&1 | tail -5

# 3. Installer
adb install -r android/app/build/outputs/apk/release/app-release.apk

# 4. Lancer
adb shell am start -n com.kycmobile/.MainActivity

# 5. Voir les logs
echo "Logs ci-dessous (Ctrl+C pour arrêter):"
sleep 2
adb logcat | grep -E "KYC|health|WebSocket"
```

---

## 📁 Structure des Fichiers Important

```
~/kyc-mobile/
├── android/
│   ├── app/
│   │   ├── build.gradle          ← Configuration build
│   │   ├── release.keystore      ← Clé de signature
│   │   └── build/outputs/apk/
│   │       └── release/
│   │           └── app-release.apk  ← APK compilé ✓
│   └── gradlew                   ← Build tool
├── src/
│   ├── screens/LoginScreen.tsx   ← Support multi-pays ✓
│   ├── utils/
│   │   └── phoneValidator.ts     ← Validation numéros ✓
│   └── components/
│       └── CountryPicker.tsx     ← Sélecteur pays ✓
├── package.json
└── build-and-install.sh          ← Script rapide ✓
```

---

## ✅ En 3 Commandes

```bash
# 1
cd ~/kyc-mobile

# 2
npm run build:android

# 3
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

**C'est tout!** L'app est maintenant sur le téléphone.

---

## 📞 En Cas de Doute

```bash
# Guide complet
cat GUIDE_TEST_APK_RELEASE.md

# Quick start
cat QUICK_START_APK_RELEASE.md

# Checklist déploiement
cat DEPLOYMENT_CHECKLIST.md

# Multi-pays
cat MULTIPAYS_WHATSAPP.md
```
