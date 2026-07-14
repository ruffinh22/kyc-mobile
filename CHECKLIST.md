# ✅ Checklist de démarrage KYC Mobile

## État actuel du projet

### ✅ Complété
- [x] Structure React Native configurée
- [x] Fichiers TypeScript et configuration Babel/Metro
- [x] Fichiers Gradle (build.gradle, settings.gradle)
- [x] Fichiers Java natifs (KycCallModule, KycCallPackage, KycForegroundCallService, MainActivity, MainApplication)
- [x] Ressources Android (colors, strings, icons)
- [x] AndroidManifest.xml avec toutes les permissions
- [x] local.properties avec SDK path
- [x] gradle wrapper configuré (Gradle 8.1.1)
- [x] Dépendances npm (package.json)

### ⚠️ À FAIRE MAINTENANT

**1. [ ] Installer les dépendances Node**
```bash
cd /home/lidruf/kyc-mobile
npm install
```

**2. [ ] Télécharger google-services.json**
- Aller sur : https://console.firebase.google.com
- Créer ou sélectionner le projet `kycmobile`
- Ajouter une application Android avec package name : `com.kycmobile`
- Télécharger `google-services.json`
- Placer le fichier dans : `android/app/google-services.json`

**3. [ ] Compiler une première fois**
```bash
cd /home/lidruf/kyc-mobile/android
./gradlew clean
./gradlew assembleDebug
```

**4. [ ] Vérifier la compilation**
- L'APK debug devrait être ici :
  - `/home/lidruf/kyc-mobile/android/app/build/outputs/apk/debug/app-debug.apk`

**5. [ ] Ouvrir dans Android Studio** (optionnel)
```bash
cd /home/lidruf/kyc-mobile
studio ./android &
```

### 🔧 Commandes utiles

```bash
# Lancer le serveur Metro (hot-reload)
npm start

# Compiler et lancer sur Android
npm run android

# Compiler APK release
npm run build:android

# Voir les logs
adb logcat | grep KYC

# Lister les devices/émulateurs
adb devices
```

### 🔑 Points importants

1. **Firebase** : Obligatoire pour les notifications push (FCM)
2. **google-services.json** : Doit être dans `android/app/`
3. **Serveur WebSocket** : Configurable dans l'écran de login
4. **Émulateur/Device** : Nécessaire pour tester l'application

### 📚 Documentation

- [Guide complet](ANDROID_STUDIO_SETUP.md)
- [README](README.md)
- [Structure du projet](ANDROID_STUDIO_SETUP.md#📞-structure-du-projet)

---

**Prochaine étape :** Installer npm + google-services.json, puis compiler ! 🚀
