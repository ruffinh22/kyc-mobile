# 🚀 Quick Start - Test APK Release

## Compiler et Tester en 30 Secondes

### 1️⃣ Connectez le Téléphone via USB

```bash
# Vérifier la connexion
adb devices
# Vous devez voir: "device"
```

**Si vous voyez "unauthorized":** Acceptez la demande d'autorisation sur le téléphone.

---

### 2️⃣ Compiler et Installer (Automatique)

```bash
cd ~/kyc-mobile
./build-and-install.sh
```

**Qu'est-ce que ça fait:**
- ✓ Compile l'APK release
- ✓ Installe sur le téléphone
- ✓ Lance l'app

**Durée:** 3-5 minutes

---

### 3️⃣ Tester dans l'App

1. **Écran de connexion** → Sélectionnez un pays
2. **Numéro WhatsApp** → Entrez: `065151234` (Congo)
3. **URL Serveur** → Entrez: `https://kyc.palladium-africa.com`
4. **Cliquez** "Se connecter"

**Attendez 5 secondes** pour la connexion au serveur.

---

### 4️⃣ Voir les Logs (Dans un autre terminal)

```bash
cd ~/kyc-mobile
./watch-logs.sh
```

**Vous devriez voir:**
```
✓ Health check passed
✓ WebSocket connected
✓ Registered successfully
```

---

## Commandes Courantes

### Compiler uniquement
```bash
cd ~/kyc-mobile
npm run build:android
```

### Installer uniquement
```bash
adb install -r ~/kyc-mobile/android/app/build/outputs/apk/release/app-release.apk
```

### Réinstaller (supprime les données)
```bash
./build-and-install.sh --clear
```

### Voir les logs + compiler + installer
```bash
./build-and-install.sh --logs
```

### Afficher tous les logs (errors inclus)
```bash
./watch-logs.sh --all
```

### Supprimer l'app complètement
```bash
adb uninstall com.kycmobile
```

### Relancer l'app
```bash
adb shell am start -n com.kycmobile/.MainActivity
```

---

## Test Complet (5 étapes)

```bash
# Terminal 1: Compiler + installer
cd ~/kyc-mobile
./build-and-install.sh

# Terminal 2: Voir les logs
cd ~/kyc-mobile
./watch-logs.sh

# Puis dans l'app:
# 1. Pays: Congo (CG)
# 2. Numéro: 065151234
# 3. Serveur: https://kyc.palladium-africa.com
# 4. Cliquez: Se connecter
```

---

## Tester Plusieurs Serveurs

**Production:**
```
https://kyc.palladium-africa.com
```

**Local (exemple):**
```
http://192.168.1.100:8000
```

**Pour tester un serveur local:**
1. Effacez les données: `./build-and-install.sh --clear`
2. Entrez la nouvelle URL au redémarrage
3. Cliquez "Se connecter"

---

## Dépannage Rapide

| Problème | Solution |
|----------|----------|
| "Téléphone pas détecté" | `adb kill-server && adb start-server` |
| "APK déjà installée" | `./build-and-install.sh` (remplace) |
| "Compilation échoue" | `./gradlew clean && npm run build:android` |
| "App crash" | `./watch-logs.sh --all` (voir les erreurs) |
| "Serveur inaccessible" | Testez: `curl https://votre-url/health` |

---

## Fichiers Disponibles

- 📖 **GUIDE_TEST_APK_RELEASE.md** - Guide complet détaillé
- 🚀 **build-and-install.sh** - Script compile + installe
- 👀 **watch-logs.sh** - Affiche les logs en temps réel
- 🧪 **test-phone-validator.js** - Teste les numéros sans l'app
- 📱 **QUICK_START_MULTIPAYS.md** - Test des numéros CLI

---

## Prochaines Étapes

Après le test:
- [ ] Vérifiez que le numéro est accepté ✓
- [ ] Vérifiez que le serveur est accessible
- [ ] Vérifiez que l'app passe à l'écran "Idle"
- [ ] Testez les autres pays
