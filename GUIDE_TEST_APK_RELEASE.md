# 🚀 Guide Complet: Tester APK Release sur Téléphone

## 1️⃣ Préparer le Téléphone

### Android 10+

Avant de compiler, connectez le téléphone et vérifiez qu'il est reconnu:

```bash
adb devices
```

**Vous devez voir:**
```
List of attached devices
XXXXXXXXXXXXXXXX device
```

Si vous voyez `unauthorized`, acceptez la demande d'autorisation sur le téléphone.

### Activer le mode développeur (si pas déjà fait)

1. Allez dans **Paramètres > À propos du téléphone**
2. Trouvez **Numéro de version**
3. Appuyez 7 fois jusqu'à voir "Mode développeur activé"
4. Allez dans **Paramètres > Options de développeur**
5. Activez **Débogage USB**

---

## 2️⃣ Compiler l'APK Release

### Commande Simple (Recommandé)

```bash
cd ~/kyc-mobile

# Compiler et générer l'APK release
npm run build:android
```

**Ou manuellement:**
```bash
cd ~/kyc-mobile/android
./gradlew assembleRelease
```

### Où se trouve l'APK compilé?

```bash
ls -lh ~/kyc-mobile/android/app/build/outputs/apk/release/
```

**Vous verrez:**
```
app-release.apk  (environ 40-80 MB)
```

---

## 3️⃣ Installer sur le Téléphone

### Option A: Via Téléphone Connecté (Recommandé)

```bash
adb install ~/kyc-mobile/android/app/build/outputs/apk/release/app-release.apk
```

**Résultat:**
```
Success
```

### Option B: Via Email/QR Code (Sans USB)

1. Copiez l'APK sur Google Drive, WeTransfer, etc.
   ```bash
   # Ou envoyer l'APK à quelqu'un
   ~/kyc-mobile/android/app/build/outputs/apk/release/app-release.apk
   ```

2. Téléchargez sur le téléphone
3. Ouvrez le fichier `.apk`
4. Acceptez l'installation

---

## 4️⃣ Lancer l'App et Tester les Liens de Serveur

### Au démarrage de l'app:

1. **Écran de connexion** s'affiche
2. **Sélectionnez un pays** (Congo, Bénin, Côte d'Ivoire, etc.)
3. **Entrez un numéro WhatsApp** (ex: 065151234 pour Congo)
4. **Entrez l'URL du serveur** - C'est ici que vous testez les liens!

### URLs de Test

**Production:**
```
https://kyc.palladium-africa.com
```

**Développement Local (si le serveur est sur votre machine):**
```
http://192.168.X.X:8000
```

**Staging:**
```
https://kyc-staging.palladium-africa.com
```

### Comment Tester Différents Serveurs?

**Avant de tester un nouveau serveur:**

1. Supprimez les données locales de l'app:
   ```bash
   adb shell pm clear com.kycmobile
   ```

2. L'app redémarre avec l'écran de connexion vierge

3. Entrez un **numéro différent** ou une **URL différente**

4. Cliquez "Se connecter" - l'app teste:
   - ✓ Accès à `https://url-serveur/health`
   - ✓ Connexion WebSocket au serveur
   - ✓ Enregistrement du terrain avec le numéro WhatsApp

---

## 5️⃣ Voir les Logs en Temps Réel

### Pendant que vous testez:

```bash
# Affiche les logs en direct
adb logcat | grep "KYC\|SignalingService\|NotificationService"
```

### Ou depuis logcat complet:

```bash
adb logcat
```

**Cherchez dans les logs:**
```
✓ "registered successfully"
✓ "WebSocket connected"
✓ "health check passed"
✗ "Connection refused"
✗ "Network error"
```

---

## 6️⃣ Tester Plusieurs Numéros et Pays

### Scénario de Test Complet

```bash
# Terminal 1: Voir les logs
adb logcat | grep "KYC"

# Terminal 2: Compiler et installer
cd ~/kyc-mobile

# Compiler
npm run build:android

# Installer
adb install -r android/app/build/outputs/apk/release/app-release.apk

# Lancer l'app
adb shell am start -n com.kycmobile/.MainActivity
```

### Test Checklist

- [ ] **Congo** (CG): 065151234
- [ ] **Bénin** (BJ): 94004005
- [ ] **Côte d'Ivoire** (CI): 0758123456
- [ ] **Cameroun** (CM): 691234567
- [ ] **Guinée Bissau** (GW): 6657891
- [ ] **Guinée** (GN): 628123456

Pour chaque pays:
- [ ] Validation du numéro affiche ✓
- [ ] URL serveur acceptée
- [ ] Appel "Se connecter" réussit
- [ ] Numéro sauvegardé (redémarrage = pas de reconnexion)

---

## 7️⃣ Dépannage Courants

### ❌ "URL serveur inaccessible"
- Vérifiez que le serveur est lancé
- Vérifiez la connectivité du téléphone (WiFi/4G)
- Si local: utilisez `http://` pas `https://`
- Si local: utilisez l'IP interne (`192.168.X.X`), pas `localhost`

### ❌ "Impossible de joindre le serveur"
- Attendez 5-10 secondes au lieu de cliquer immédiatement
- Le serveur met du temps à démarrer

### ❌ "Numéro invalide"
- Vérifiez le nombre de chiffres selon le pays
- Lisez l'hint en bas du champ
- Ne mettez pas l'indicatif (+242, +229, etc.)

### ❌ "App crash"
- Regardez les logs:
  ```bash
  adb logcat -v time | grep "FATAL\|Exception"
  ```
- Vérifiez que google-services.json est présent

### ❌ "APK déjà installée"
```bash
# Réinstaller en remplaçant
adb install -r android/app/build/outputs/apk/release/app-release.apk

# Ou supprimer d'abord
adb uninstall com.kycmobile
adb install android/app/build/outputs/apk/release/app-release.apk
```

---

## 8️⃣ Tester avec un Serveur Local

### Si votre serveur est sur votre ordinateur:

1. **Trouvez votre IP locale:**
   ```bash
   ifconfig | grep "inet "
   # Vous verrez: 192.168.X.X
   ```

2. **Lancez le serveur:**
   ```bash
   cd ~/kyc-v40
   npm start
   # Le serveur écoute sur http://0.0.0.0:8000
   ```

3. **Dans l'app:**
   - URL serveur: `http://192.168.X.X:8000`
   - Exemple: `http://192.168.1.100:8000`

4. **Vérifiez depuis l'ordi:**
   ```bash
   curl http://localhost:8000/health
   # Vous devez voir: {"status":"ok"}
   ```

---

## 9️⃣ Récompiler Rapidement (Après Modification)

Après avoir modifié du code TypeScript:

```bash
cd ~/kyc-mobile

# Recompiler
npm run build:android

# Réinstaller
adb install -r android/app/build/outputs/apk/release/app-release.apk

# Voir les logs
adb logcat | grep "KYC"
```

**Durée totale:** 2-5 minutes

---

## 🔟 Envoyer l'APK à Quelqu'un D'autre

```bash
# Copier l'APK
cp ~/kyc-mobile/android/app/build/outputs/apk/release/app-release.apk ~/app-kyc-release.apk

# Envoyer par email ou partage
# L'autre personne double-clique et installe
```

---

## Commandes Rapides Récapitulatif

```bash
# Compiler
npm run build:android

# Installer
adb install -r android/app/build/outputs/apk/release/app-release.apk

# Supprimer et réinstaller
adb uninstall com.kycmobile
adb install android/app/build/outputs/apk/release/app-release.apk

# Voir les logs
adb logcat | grep "KYC"

# Effacer les données de l'app
adb shell pm clear com.kycmobile

# Lancer l'app
adb shell am start -n com.kycmobile/.MainActivity

# Arrêter l'app
adb shell am force-stop com.kycmobile

# Voir l'APK installée
adb shell pm list packages | grep kyc
```

---

## 📱 Test Complet en 5 Étapes

```bash
# 1. Compiler
cd ~/kyc-mobile && npm run build:android

# 2. Installer
adb install -r android/app/build/outputs/apk/release/app-release.apk

# 3. Voir les logs
adb logcat | grep "KYC" &

# 4. Lancer l'app
adb shell am start -n com.kycmobile/.MainActivity

# 5. Dans l'app:
#    - Sélectionnez: Congo (CG)
#    - Numéro: 065151234
#    - Serveur: https://kyc.palladium-africa.com
#    - Cliquez: Se connecter
```

**Vous devez voir ✓ dans les logs:**
```
D/KYC: Health check passed
D/KYC: Connexion WebSocket établie
D/KYC: Enregistrement terrain réussi
```

---

## Besoin d'Aide?

- ✗ Erreur de compilation: `./gradlew clean && npm run build:android`
- ✗ Téléphone pas reconnu: `adb kill-server && adb start-server`
- ✗ Doutes sur l'URL: Testez d'abord avec `curl https://votre-url/health`
