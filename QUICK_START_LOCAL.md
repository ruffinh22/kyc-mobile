# 🚀 Test Local en 3 Étapes

## ✨ Ce Qu'on Va Faire

Tester l'APK **entièrement localement** sans serveur distant!

---

## 1️⃣ Lancer le Serveur Local

### Terminal 1 (Laissez ouvert)

```bash
cd ~/kyc-mobile
node local-server.js
```

**Vous devez voir:**
```
╔════════════════════════════════════════════════╗
║  🚀 Serveur KYC Local Démarré                  ║
╚════════════════════════════════════════════════╝

📍 Serveur écoute sur: http://0.0.0.0:3000
✓ Serveur prêt! Appuyez sur Ctrl+C pour arrêter.
```

✓ Le serveur est maintenant actif et attendant les connexions!

---

## 2️⃣ Trouver Votre IP Locale

### Terminal 2 (nouveau terminal)

```bash
ifconfig | grep "inet " | grep -v 127.0.0.1 | head -1
```

**Résultat:** Une ligne comme `inet 192.168.1.100` (remplacez X.X par vos chiffres)

### Important

- ✅ **Utilisez cette IP** pour l'app (ex: `http://192.168.1.100:3000`)
- ❌ **Ne pas utiliser** `localhost` ou `127.0.0.1` (le téléphone ne pourra pas y accéder)

---

## 3️⃣ Compiler et Tester l'APK

### Terminal 2 (même terminal)

```bash
cd ~/kyc-mobile
./build-and-install.sh
```

**L'APK se compile et s'installe** (3-5 minutes)

### Dans l'APK

Dès que l'écran de connexion apparaît:

1. **Sélectionnez:** Congo (CG)
2. **Numéro:** 065151234
3. **Serveur:** `http://192.168.1.100:3000` (remplacez l'IP)
4. **Cliquez:** Se connecter

**Attendez 3 secondes...**

✓ **Vous verrez:**
- ✓ dans les logs du serveur: `✓ Terrain enregistré: 065151234`
- ✓ dans l'app: passage à l'écran "Idle"

---

## 🧪 Tester les Appels

### Terminal 2 ou 3

```bash
# Voir tous les terrains connectés
curl http://localhost:3000/terrains

# Déclencher un appel
curl http://localhost:3000/call/065151234
```

**L'app reçoit un appel entrant!** 📱

---

## 📋 Commandes Rapides

```bash
# Lancer le serveur
node local-server.js

# Tester la connexion (depuis l'ordi)
curl http://localhost:3000/health

# Voir les terrains
curl http://localhost:3000/terrains

# Déclencher un appel
curl http://localhost:3000/call/065151234

# Compiler et tester l'APK
./build-and-install.sh

# Voir les logs de l'app
./watch-logs.sh
```

---

## 🎯 Configuration Complète (2 Terminaux)

### Terminal 1
```bash
cd ~/kyc-mobile
node local-server.js
```

**Reste ouvert = serveur actif**

### Terminal 2
```bash
cd ~/kyc-mobile

# Compiler + installer
./build-and-install.sh

# Ou voir les logs
./watch-logs.sh
```

---

## ✅ Checklist

- [ ] Serveur lancé: `node local-server.js`
- [ ] IP locale trouvée: `ifconfig | grep inet`
- [ ] APK compilée et installée
- [ ] Pays sélectionné: Congo (CG)
- [ ] Numéro entré: 065151234
- [ ] URL serveur: `http://192.168.X.X:3000`
- [ ] Clic "Se connecter"
- [ ] Logs du serveur: `✓ Terrain enregistré`
- [ ] App: écran "Idle" affiché

---

## ⚡ Notes Importantes

### ✓ Ce qui fonctionne
- Enregistrement du terrain
- WebSocket en local
- Appels vidéo simulés
- Validation des numéros multi-pays

### ⚠️ Limitation locale
- Pas de FCM (notifications Firebase)
- Pas de HTTPS (c'est HTTP local)
- Pas de persistance de données

### 🔧 Dépannage

| Problème | Solution |
|----------|----------|
| "Connection refused" | Vérifiez que `node local-server.js` tourne |
| "Cannot GET /health" | L'URL est peut-être mal tapée |
| "Port 3000 already in use" | `lsof -i :3000` et `kill -9 <PID>` |
| Téléphone ne peut pas accéder | Utilisez l'IP locale, pas `localhost` |

---

## 📚 Documentation Complète

- `GUIDE_SERVEUR_LOCAL.md` - Guide détaillé du serveur
- `GUIDE_TEST_APK_RELEASE.md` - Guide complet APK
- `COMMANDES_RAPIDES.md` - Commandes copy/paste
- `local-server.js` - Code source du serveur

---

## 🎉 Résultat

Vous avez un **serveur local complet** pour tester l'APK:
- ✅ Aucune dépendance externe
- ✅ Fonctionne 100% localement
- ✅ Support multi-pays intégré
- ✅ Logs en temps réel

**C'est prêt!** 🚀
