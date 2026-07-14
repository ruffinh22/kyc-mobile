#!/bin/bash
cat << 'EOF'

╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║       🖥️  TEST LOCAL COMPLET - 2 TERMINAUX, 3 COMMANDES                   ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝

┌────────────────────────────────────────────────────────────────────────────┐
│ TERMINAL 1: SERVEUR LOCAL                                                 │
└────────────────────────────────────────────────────────────────────────────┘

  $ cd ~/kyc-mobile
  $ yarn server

  ou

  $ node local-server.js

  📍 Résultat:
     ╔════════════════════════════════════════════════╗
     ║  🚀 Serveur KYC Local Démarré                  ║
     ╚════════════════════════════════════════════════╝

     ✓ Serveur prêt sur http://0.0.0.0:3000
     ✓ Appuyez sur Ctrl+C pour arrêter

┌────────────────────────────────────────────────────────────────────────────┐
│ TERMINAL 2: COMPILER ET TESTER L'APK                                     │
└────────────────────────────────────────────────────────────────────────────┘

  $ cd ~/kyc-mobile
  $ ./build-and-install.sh

  📍 Durée: 3-5 minutes
  📍 L'app s'ouvre sur le téléphone

┌────────────────────────────────────────────────────────────────────────────┐
│ DANS L'APP (TÉLÉPHONE)                                                    │
└────────────────────────────────────────────────────────────────────────────┘

  1️⃣  Écran "Sélectionnez un pays"
      → Cliquez et sélectionnez: Congo (CG)

  2️⃣  Écran "Numéro WhatsApp"
      → Entrez: 065151234

  3️⃣  Écran "URL Serveur"
      → Entrez: http://192.168.1.100:3000
      ⚠️  Remplacez 192.168.1.100 par votre IP locale
      
      Comment la trouver?
      $ ifconfig | grep "inet " | grep -v 127.0.0.1
      
      Exemple: inet 192.168.1.100 (ce chiffre)

  4️⃣  Cliquez: "Se connecter"
      → Attendez 3 secondes...
      
      ✅ Vous verrez:
         • Dans les logs du SERVEUR: ✓ Terrain enregistré: 065151234
         • L'app passe à l'écran "Idle"

┌────────────────────────────────────────────────────────────────────────────┐
│ BONUS: DÉCLENCHER UN APPEL                                                │
└────────────────────────────────────────────────────────────────────────────┘

  TERMINAL 3 (ou 2 après le test):

  $ curl http://localhost:3000/call/065151234

  📱 L'app reçoit un appel entrant!

  Voir les terrains connectés:
  $ curl http://localhost:3000/terrains

  Tester la connexion serveur:
  $ curl http://localhost:3000/health

╔════════════════════════════════════════════════════════════════════════════╗
║ STRUCTURE: 2 TERMINAUX                                                    ║
╚════════════════════════════════════════════════════════════════════════════╝

  Terminal 1 (Reste ouvert)          Terminal 2 (Travaux)
  ───────────────────────────────    ──────────────────────────
  $ yarn server                      $ ./build-and-install.sh
  (logs en temps réel)               (compile + installe APK)
                                      
                                     Puis:
                                     
                                     $ curl http://localhost/call/...
                                     $ ./watch-logs.sh

╔════════════════════════════════════════════════════════════════════════════╗
║ RÉSUMÉ DES COMMANDES                                                      ║
╚════════════════════════════════════════════════════════════════════════════╝

  Serveur:
  ────────────────────────────────────────────────────
  $ yarn server                    # Lancer le serveur local
  $ node local-server.js           # Lancer directement

  APK:
  ────────────────────────────────────────────────────
  $ ./build-and-install.sh         # Compiler + installer
  $ ./watch-logs.sh                # Voir les logs en temps réel

  Tests:
  ────────────────────────────────────────────────────
  $ curl http://localhost:3000/health          # Test serveur
  $ curl http://localhost:3000/terrains        # Voir terrains
  $ curl http://localhost:3000/call/065151234  # Déclencher appel

  Configuration:
  ────────────────────────────────────────────────────
  $ ifconfig | grep "inet "        # Trouver IP locale

╔════════════════════════════════════════════════════════════════════════════╗
║ POINT CRUCIAL: L'ADRESSE IP                                               ║
╚════════════════════════════════════════════════════════════════════════════╝

  ✅ CORRECT (depuis téléphone):
     http://192.168.1.100:3000

  ❌ INCORRECT (le téléphone ne peut pas accéder):
     http://localhost:3000        (localhost = téléphone lui-même)
     http://127.0.0.1:3000        (127.0.0.1 = téléphone lui-même)

  💡 Trouvez votre IP:
     $ ifconfig | grep "inet " | grep -v "127.0.0.1"
     
     Résultat: inet 192.168.1.100 (ou 10.0.0.X, etc.)

╔════════════════════════════════════════════════════════════════════════════╗
║ ÉTAPE PAR ÉTAPE RAPIDE (5 MIN)                                            ║
╚════════════════════════════════════════════════════════════════════════════╝

  1. Trouver IP:
     $ ifconfig | grep "inet " | grep -v 127

  2. Terminal 1 - Serveur:
     $ yarn server

  3. Terminal 2 - APK:
     $ ./build-and-install.sh

  4. Dans l'app (téléphone):
     • Pays: Congo (CG)
     • Numéro: 065151234
     • Serveur: http://[VOTRE_IP]:3000
     • Se connecter

  5. Terminal 2 - Appel (optionnel):
     $ curl http://localhost:3000/call/065151234

  ✅ VOILÀ! Test local complet 🎉

╔════════════════════════════════════════════════════════════════════════════╗
║ FICHIERS UTILES                                                           ║
╚════════════════════════════════════════════════════════════════════════════╝

  📖 QUICK_START_LOCAL.md              ← Lisez ça d'abord
  📖 GUIDE_SERVEUR_LOCAL.md            ← Guide serveur détaillé
  📖 GUIDE_TEST_APK_RELEASE.md         ← Guide APK complet
  🖥️  local-server.js                  ← Code source du serveur
  🚀 build-and-install.sh              ← Compile + installe APK

EOF
