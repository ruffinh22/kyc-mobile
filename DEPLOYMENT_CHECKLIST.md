# 📋 Plan Complet: Compiler → Tester → Déployer

## Flux Complet en 6 Étapes

### 1️⃣ Préparer l'Environnement

```bash
# Vérifier que vous avez tout
which adb           # Android Debug Bridge
which npm           # Node Package Manager
which java          # Java SDK

# Vérifier les versions
adb version
npm --version
```

### 2️⃣ Connecter le Téléphone

**Physiquement:**
- Branchez le téléphone via USB-C

**Sur le téléphone:**
1. **Paramètres** → **À propos du téléphone**
2. Appuyez 7 fois sur **Numéro de version**
3. **Paramètres** → **Options de développeur**
4. Activez **Débogage USB**
5. Acceptez l'autorisation

**Vérifiez:**
```bash
adb devices
# Output:
# List of attached devices
# XXXXXXXXXXXXXXXXX device
```

### 3️⃣ Compiler l'APK Release

#### Option A: Automatique (Recommandé)

```bash
cd ~/kyc-mobile
./build-and-install.sh
```

Cette commande:
- ✓ Compile l'APK
- ✓ Installe sur le téléphone
- ✓ Lance l'app
- ✓ Durée: 3-5 minutes

#### Option B: Manuel

```bash
cd ~/kyc-mobile

# Compiler
npm run build:android

# Vérifier que l'APK existe
ls -lh android/app/build/outputs/apk/release/app-release.apk
```

**L'APK se trouve à:**
```
~/kyc-mobile/android/app/build/outputs/apk/release/app-release.apk
```

### 4️⃣ Installer sur le Téléphone

#### Via Commande (Si pas déjà installé)

```bash
adb install ~/kyc-mobile/android/app/build/outputs/apk/release/app-release.apk
```

#### Vérifier l'Installation

```bash
# Voir l'app
adb shell pm list packages | grep kyc

# Lancer l'app
adb shell am start -n com.kycmobile/.MainActivity
```

### 5️⃣ Configurer et Tester

**Dans l'écran de connexion:**

1. **Sélectionnez un pays**
   - Cliquez sur le sélecteur "PAYS"
   - Choisissez: Congo, Bénin, Côte d'Ivoire, Cameroun, Guinée Bissau, ou Guinée

2. **Entrez un numéro WhatsApp**
   - Congo (CG): `065151234`
   - Bénin (BJ): `94004005`
   - Côte d'Ivoire (CI): `0758123456`
   - Cameroun (CM): `691234567`
   - Guinée Bissau (GW): `6657891`
   - Guinée (GN): `628123456`

3. **Entrez l'URL du serveur**
   - **Production:** `https://kyc.palladium-africa.com`
   - **Local:** `http://192.168.X.X:8000` (remplacer X.X)
   - **Staging:** `https://kyc-staging.palladium-africa.com`

4. **Cliquez "Se connecter"**
   - Attendez 5-10 secondes
   - Vous verrez soit ✓ (succès) soit une erreur

### 6️⃣ Vérifier les Logs

**Dans un autre terminal:**

```bash
cd ~/kyc-mobile
./watch-logs.sh
```

**Logs attendus:**
```
✓ Health check passed
✓ WebSocket connected
✓ Registered successfully
```

**En cas d'erreur:**
```bash
./watch-logs.sh --all  # Voir tous les logs, incluant les erreurs
```

---

## 📊 Tableau de Test Complet

| Pays | Code | Numéro Test | Format | État |
|------|------|------------|--------|------|
| Congo | CG | 065151234 | +242065151234 | ☐ |
| Bénin | BJ | 94004005 | +22994004005 | ☐ |
| Côte d'Ivoire | CI | 0758123456 | +2250758123456 | ☐ |
| Cameroun | CM | 691234567 | +237691234567 | ☐ |
| Guinée Bissau | GW | 6657891 | +2456657891 | ☐ |
| Guinée | GN | 628123456 | +224628123456 | ☐ |

**Pour chaque pays, testez:**
- [ ] Validation du numéro: ✓ affichée
- [ ] Connexion au serveur: Pas de timeout
- [ ] Enregistrement terrain: Message "Connecté"

---

## 🔧 Dépannage Complet

### ❌ "Téléphone pas détecté"

```bash
# Option 1: Redémarrer adb
adb kill-server
adb start-server
adb devices

# Option 2: Vérifier les périphériques USB
lsusb

# Option 3: Autorisation USB sur le téléphone
# Débranchez et rebranchez, acceptez l'autorisation
```

### ❌ "Impossible de compiler (gradle error)"

```bash
cd ~/kyc-mobile

# Nettoyer et recommencer
./gradlew clean
npm install
npm run build:android

# Ou manuellement:
cd android
./gradlew clean
./gradlew assembleRelease
```

### ❌ "APK déjà installée"

```bash
# Réinstaller (remplace)
adb install -r ~/kyc-mobile/android/app/build/outputs/apk/release/app-release.apk

# Ou supprimer d'abord
adb uninstall com.kycmobile
adb install ~/kyc-mobile/android/app/build/outputs/apk/release/app-release.apk
```

### ❌ "URL serveur inaccessible"

```bash
# Tester l'URL avant de l'utiliser dans l'app
./test-server.sh https://kyc.palladium-africa.com
./test-server.sh http://192.168.1.100:8000

# Ou manuellement
curl -v https://kyc.palladium-africa.com/health
```

### ❌ "Connexion au serveur timeout"

**Causes possibles:**
- Le serveur ne répond pas
- L'URL est incorrecte
- Le téléphone n'a pas de connexion internet
- Le serveur n'écoute pas sur le port

**Solutions:**
```bash
# Vérifier la connectivité du téléphone
adb shell ping google.com

# Vérifier que le serveur écoute
curl http://localhost:8000/health  # Sur l'ordi

# Voir l'IP interne de l'ordi (pour local)
ifconfig | grep "inet " | grep -v 127.0.0.1
```

### ❌ "App crash immédiatement"

```bash
# Voir les erreurs
./watch-logs.sh --all

# Cherchez "FATAL" ou "Exception"
adb logcat | grep -E "FATAL|Exception"

# Réinstaller complètement
adb uninstall com.kycmobile
adb install ~/kyc-mobile/android/app/build/outputs/apk/release/app-release.apk
```

### ❌ "Numéro invalide"

**Vérifiez:**
- [ ] Vous n'avez pas mis l'indicatif (+242, +229, etc.)
- [ ] Le nombre de chiffres est correct selon le pays
- [ ] Vous n'avez pas d'espaces ou caractères spéciaux

**Consultez le hint sous le champ d'entrée** pour la bonne longueur.

---

## 📱 Tester avec Serveur Local

**Si votre serveur est sur la même machine:**

1. **Trouvez votre IP locale:**
   ```bash
   ifconfig | grep "inet " | grep -v 127.0.0.1
   # Exemple: 192.168.1.100
   ```

2. **Assurez-vous que le serveur écoute sur 0.0.0.0 (pas juste 127.0.0.1):**
   ```bash
   # Dans kyc-v40/server.js ou app.listen():
   app.listen(8000, '0.0.0.0')
   ```

3. **Testez de votre ordi:**
   ```bash
   curl http://localhost:8000/health
   # Doit retourner: {"status":"ok"}
   ```

4. **Dans l'app, utilisez:**
   ```
   http://192.168.1.100:8000
   ```

5. **Vérifiez les logs du serveur:**
   ```bash
   cd ~/kyc-v40
   npm start
   # Vous devez voir "Listening on port 8000"
   ```

---

## 🚀 Scripts Disponibles

| Script | Utilité |
|--------|---------|
| `./build-and-install.sh` | Compile + installe + lance |
| `./watch-logs.sh` | Affiche les logs en temps réel |
| `./test-server.sh [URL]` | Teste si un serveur est accessible |
| `node test-phone-validator.js --all` | Teste les numéros sans l'app |

---

## 📚 Fichiers de Documentation

| Fichier | Contenu |
|---------|---------|
| `QUICK_START_APK_RELEASE.md` | 🚀 Quick start (5 min) |
| `GUIDE_TEST_APK_RELEASE.md` | 📖 Guide détaillé complet |
| `MULTIPAYS_WHATSAPP.md` | 🌍 Support multi-pays |
| `QUICK_START_MULTIPAYS.md` | 🚀 Quick start multi-pays |

---

## ✅ Checklist Avant Production

- [ ] APK compilée en release
- [ ] APK testée sur 3+ téléphones différents
- [ ] Tous les 6 pays testés
- [ ] Serveur production accessible
- [ ] Logs vérifiés (pas d'erreurs)
- [ ] Numéros sauvegardés correctement
- [ ] Redémarrage de l'app = pas de reconnexion (session persistée)
- [ ] Interface multi-pays fonctionnelle
- [ ] Validation numéro par pays OK
- [ ] WebSocket stable

---

## 📞 Support Rapide

```bash
# Compilation échoue?
./gradlew clean && npm run build:android

# Téléphone pas reconnu?
adb kill-server && adb start-server

# Doute sur l'URL?
./test-server.sh https://votre-url

# Logs d'erreur?
./watch-logs.sh --all

# Recommencer de zéro?
adb uninstall com.kycmobile && ./build-and-install.sh
```

---

**🎉 Une fois que tout fonctionne:** L'APK est prête pour la production!
