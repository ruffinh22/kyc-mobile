#!/bin/bash
cat << 'EOF'

╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║       🚀 KYC MOBILE - GUIDE VISUEL COMPILATION ET TEST APK RELEASE       ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────────────────┐
│  ÉTAPE 1: PRÉPARER LE TÉLÉPHONE                                         │
└─────────────────────────────────────────────────────────────────────────┘

  🔌 Connectez le téléphone via USB-C
  
  📱 Sur le téléphone:
     • Paramètres → À propos du téléphone
     • Appuyez 7x sur "Numéro de version"
     • Paramètres → Options de développeur
     • Activez "Débogage USB"
     • Acceptez l'autorisation
  
  ✓ Vérifiez:
     $ adb devices
     → Vous devez voir "XXXXXX device"

┌─────────────────────────────────────────────────────────────────────────┐
│  ÉTAPE 2: COMPILER L'APK                                                │
└─────────────────────────────────────────────────────────────────────────┘

  ⚡ Commande (30 secondes):
  
     $ cd ~/kyc-mobile
     $ ./build-and-install.sh
  
  ✓ Résultat: APK compilée et installée!
  
  📊 Durée totale: 3-5 minutes

┌─────────────────────────────────────────────────────────────────────────┐
│  ÉTAPE 3: LANCER L'APP ET TESTER                                        │
└─────────────────────────────────────────────────────────────────────────┘

  📱 L'écran de connexion s'affiche:
  
     ┌─────────────────────────────┐
     │  Sélectionnez le PAYS       │ ← Cliquez ici
     ├─────────────────────────────┤
     │  Congo (CG)                 │
     │  Bénin (BJ)                 │
     │  Côte d'Ivoire (CI)         │
     │  Cameroun (CM)              │
     │  Guinée Bissau (GW)         │
     │  Guinée (GN)                │
     └─────────────────────────────┘
  
  🔢 Entrez un numéro:
     • Congo:           065151234
     • Bénin:           94004005
     • Côte d'Ivoire:   0758123456
     • Cameroun:        691234567
     • Guinée Bissau:   6657891
     • Guinée:          628123456
  
  🔗 Entrez l'URL serveur:
     • Production:  https://kyc.palladium-africa.com
     • Local:       http://192.168.1.100:8000
     • Staging:     https://kyc-staging.palladium-africa.com
  
  ✓ Cliquez: Se connecter

┌─────────────────────────────────────────────────────────────────────────┐
│  ÉTAPE 4: VÉRIFIER LES LOGS (TERMINAL 2)                               │
└─────────────────────────────────────────────────────────────────────────┘

  👀 Dans un autre terminal:
  
     $ cd ~/kyc-mobile
     $ ./watch-logs.sh
  
  ✓ Vous devez voir:
     ✓ Health check passed
     ✓ WebSocket connected
     ✓ Registered successfully
  
  ✗ En cas d'erreur:
     $ ./watch-logs.sh --all
     → Affiche TOUS les logs pour diagnostiquer

╔═══════════════════════════════════════════════════════════════════════════╗
║  COMMANDES RAPIDES - COPY/PASTE                                          ║
╚═══════════════════════════════════════════════════════════════════════════╝

  Compiler + Installer + Lancer:
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  $ cd ~/kyc-mobile && ./build-and-install.sh

  Voir les logs:
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  $ cd ~/kyc-mobile && ./watch-logs.sh

  Tester une URL:
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  $ cd ~/kyc-mobile
  $ ./test-server.sh https://kyc.palladium-africa.com

  Tester les numéros (sans l'app):
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  $ node test-phone-validator.js --all
  $ node test-phone-validator.js --number 065151234 CG

  Supprimer l'app:
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  $ adb uninstall com.kycmobile

╔═══════════════════════════════════════════════════════════════════════════╗
║  DÉPANNAGE RAPIDE                                                        ║
╚═══════════════════════════════════════════════════════════════════════════╝

  ❌ Téléphone pas reconnu
  → $ adb kill-server && adb start-server && adb devices

  ❌ Compilation échoue
  → $ cd ~/kyc-mobile/android && ./gradlew clean && ./gradlew assembleRelease

  ❌ URL inaccessible
  → $ ./test-server.sh https://votre-url

  ❌ App crash
  → $ ./watch-logs.sh --all

  ❌ APK déjà installée
  → $ adb install -r ~/kyc-mobile/android/app/build/outputs/apk/release/app-release.apk

╔═══════════════════════════════════════════════════════════════════════════╗
║  FICHIERS DE DOCUMENTATION                                              ║
╚═══════════════════════════════════════════════════════════════════════════╝

  📖 README_TEST_APK.md                  ← LISEZ ÇA EN PREMIER
  ⚡ COMMANDES_RAPIDES.md               ← Copy/paste prêt à l'emploi
  🚀 QUICK_START_APK_RELEASE.md         ← Quick start (5 min)
  📋 GUIDE_TEST_APK_RELEASE.md          ← Guide complet détaillé
  ✅ DEPLOYMENT_CHECKLIST.md            ← Checklist avant production
  🌍 MULTIPAYS_WHATSAPP.md              ← Support multi-pays
  🚀 QUICK_START_MULTIPAYS.md           ← Quick start multi-pays

╔═══════════════════════════════════════════════════════════════════════════╗
║  FLUX COMPLET EN 3 COMMANDES                                             ║
╚═══════════════════════════════════════════════════════════════════════════╝

  1️⃣  cd ~/kyc-mobile

  2️⃣  npm run build:android

  3️⃣  adb install -r android/app/build/outputs/apk/release/app-release.apk

  → L'app est maintenant sur votre téléphone! 🎉

╔═══════════════════════════════════════════════════════════════════════════╗
║  POINTS CLÉS                                                             ║
╚═══════════════════════════════════════════════════════════════════════════╝

  ✅ APK compilée en mode RELEASE (signé avec clé)
  ✅ Support de 6 PAYS AFRICAINS
  ✅ Validation NUMÉRO adaptée par PAYS
  ✅ LIEN SERVEUR configurable dans l'app
  ✅ Stockage PERSISTANT (pas de reconnexion)
  ✅ LOGS en temps réel pour diagnostiquer
  ✅ Scripts prêts à l'emploi

EOF
