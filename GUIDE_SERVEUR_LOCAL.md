# 🖥️ Test Local: Serveur KYC Autonome

## ✨ Qu'est-ce qu'on a créé?

Un **serveur local simple** que vous pouvez lancer sur votre ordinateur pour tester l'APK **sans dépendre d'un serveur distant**.

**Caractéristiques:**
- ✓ Endpoint `/health` pour vérifier la connexion
- ✓ WebSocket pour l'enregistrement du terrain
- ✓ Simulation d'appels vidéo
- ✓ Gestion des terrains et backoffices
- ✓ Logs détaillés en couleurs

---

## 🚀 Démarrer le Serveur Local

### Étape 1: Installer les dépendances

```bash
cd ~/kyc-mobile
npm install ws
```

**Qu'est-ce que c'est `ws`?** C'est la librairie pour les WebSockets. C'est tout ce dont on a besoin.

### Étape 2: Lancer le serveur

```bash
node local-server.js
```

**Résultat:**
```
╔════════════════════════════════════════════════╗
║  🚀 Serveur KYC Local Démarré                  ║
╚════════════════════════════════════════════════╝

📍 Serveur écoute sur: http://0.0.0.0:3000
📍 URL pour l'app:      http://192.168.X.X:3000
📍 WebSocket:           ws://192.168.X.X:3000

Routes disponibles:
  GET  /health              → Vérifier la connexion
  GET  /status              → État du serveur
  GET  /terrains            → Lister les terrains connectés
  POST /call/:numero        → Déclencher un appel
  WS   /                    → WebSocket pour signalisation

✓ Serveur prêt! Appuyez sur Ctrl+C pour arrêter.
```

---

## 📱 Utiliser Avec l'APK

### 1️⃣ Trouvez l'IP de votre Ordinateur

```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

**Résultat:** `192.168.1.100` (remplacez X.X par vos chiffres)

### 2️⃣ Dans l'App, Utilisez Cette URL

```
http://192.168.1.100:3000
```

**Pas de `https://`, ce serveur est en `http://` local!**

### 3️⃣ Remplissez les Autres Champs

- **Pays:** Congo (CG)
- **Numéro:** 065151234
- **Serveur:** `http://192.168.1.100:3000`
- **Cliquez:** Se connecter

### 4️⃣ Vous devez voir

- ✓ L'app se connecte
- ✓ Dans les logs du serveur: `✓ Terrain enregistré: 065151234`
- ✓ L'app passe à l'écran "Idle"

---

## 🧪 Tester les Routes du Serveur

### Vérifier que le serveur répond

```bash
# Depuis votre ordinateur
curl http://localhost:3000/health

# Résultat:
# {"status":"ok","timestamp":"2026-06-22T..."}
```

### Voir tous les terrains connectés

```bash
curl http://localhost:3000/terrains

# Résultat:
# {"terrains":[{"numero":"065151234","enLigne":true,"timestamp":"..."}]}
```

### Déclencher un appel manuellement

```bash
curl http://localhost:3000/call/065151234

# Résultat:
# {"status":"ok","message":"Appel déclenché","numeroMtn":"0700000000","callUuid":"..."}
```

**L'app recevra un appel entrant!**

---

## 📊 Configuration Complète (Deux Terminaux)

### Terminal 1: Lancer le Serveur

```bash
cd ~/kyc-mobile
node local-server.js
```

**Reste ouvert** pour voir les logs en temps réel.

### Terminal 2: Compiler et Tester l'APK

```bash
cd ~/kyc-mobile
./build-and-install.sh
```

**L'app s'ouvre → Remplissez les champs → Testez!**

### Terminal 3 (Optionnel): Déclencher des Appels

```bash
# Déclencher un appel au terrain connecté
curl http://localhost:3000/call/065151234

# Voir tous les terrains
curl http://localhost:3000/terrains

# Vérifier que le serveur répond
curl http://localhost:3000/health
```

---

## 🎯 Scénario de Test Complet

```bash
# Terminal 1: Serveur local
node local-server.js

# Terminal 2: (dans un autre terminal)
cd ~/kyc-mobile && ./build-and-install.sh

# Dans l'app:
# 1. Sélectionnez: Congo (CG)
# 2. Numéro: 065151234
# 3. Serveur: http://192.168.1.100:3000 (remplacer IP)
# 4. Cliquez: Se connecter
# 5. Attendez 2-3 secondes

# Terminal 3: (déclencher un appel)
curl http://localhost:3000/call/065151234

# → L'app recevra un appel entrant! 🎉
```

---

## 📝 Notes Importantes

### ❌ "Cannot find module 'ws'"

```bash
# Installez la dépendance
cd ~/kyc-mobile
npm install ws

# Puis relancez le serveur
node local-server.js
```

### ❌ "Connection refused"

**Vérifiez:**
1. Le serveur local est bien lancé (`node local-server.js`)
2. L'URL est correcte: `http://192.168.1.100:3000` (pas `https://`)
3. Remplacez `192.168.1.100` par votre **vraie IP locale**

**Comment la trouver?**
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
# Cherchez la ligne: inet 192.168.X.X
```

### ✅ "Terrain déjà enregistré"

Si vous relancez l'app avec le même numéro, c'est normal. Changez le numéro ou attendez 30 secondes que la session expire.

### ⚠️ Le serveur local n'a pas HTTPS

C'est normal! C'est un serveur de test. React Native accepte `http://` en développement.

---

## 🔗 Différentes URLs à Tester

| URL | Type | État |
|-----|------|------|
| `http://localhost:3000` | Local (ordi seulement) | ✗ Pas d'accès depuis téléphone |
| `http://192.168.1.100:3000` | Local (réseau) | ✓ Bon pour tester |
| `http://127.0.0.1:3000` | Localhost | ✗ Pas d'accès depuis téléphone |

**Utilisez l'IP locale (192.168.X.X) pour accéder depuis le téléphone!**

---

## 📚 Fichiers Utiles

- `local-server.js` - Le serveur local (ce fichier)
- `GUIDE_TEST_APK_RELEASE.md` - Guide complet APK
- `COMMANDES_RAPIDES.md` - Commandes rapides
- `QUICK_START_APK_RELEASE.md` - Quick start

---

## ⚡ Commandes Rapides

```bash
# Installer dépendances
npm install ws

# Lancer serveur
node local-server.js

# Tester depuis le terminal
curl http://localhost:3000/health
curl http://localhost:3000/terrains
curl http://localhost:3000/call/065151234

# Voir IP locale
ifconfig | grep "inet "

# Compiler + installer APK
./build-and-install.sh

# Voir les logs
./watch-logs.sh
```

---

## 🎉 Résultat Attendu

1. ✓ Serveur local lancé et en écoute
2. ✓ APK compilée et installée sur téléphone
3. ✓ APK se connecte au serveur local
4. ✓ Terrain enregistré (visible dans les logs du serveur)
5. ✓ Appel peut être déclenché via curl

**Tout fonctionne 100% localement, sans connexion internet!**

---

## 📞 Support Rapide

```bash
# Serveur pas en écoute?
ps aux | grep "node local-server"

# Port 3000 déjà utilisé?
lsof -i :3000
kill -9 <PID>

# Puis relancer
node local-server.js
```
