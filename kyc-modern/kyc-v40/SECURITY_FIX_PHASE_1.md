# 🛠️ KYC MTN - Plan de Correction de Sécurité

## Phase 1 : CRITIQUE (À faire AVANT déploiement public)

---

## 1️⃣ Récupération des Credentials AWS Exposées

### Étape 1.1 : Révoquer Credentials Actuels
```bash
# ⚠️ URGENT : Aller à https://console.aws.amazon.com/iam/
# 1. Naviguer vers "Users" → votre utilisateur
# 2. Cliquer "Security credentials"
# 3. Trouver les clés exposées (AKIAQ3EGT6P5NJEVO2VM)
# 4. Cliquer "Delete"
# 5. Confirmer

# Les clés actuelles sont COMPROMISES - ne pas les réutiliser !
```

### Étape 1.2 : Créer Nouvelles Clés
```bash
# Dans la console AWS :
# 1. Cliquer "Create access key"
# 2. Copier Access Key ID et Secret Access Key
# 3. Les mettre dans un fichier sécurisé (jamais en clair dans repo)
```

### Étape 1.3 : Nettoyer le Repository Git
```bash
# Supprimer .env du repo (il persiste dans l'historique !)
git rm --cached .env

# Créer .gitignore pour éviter réupload
echo ".env" >> .gitignore
git add .gitignore

# Commit de suppression
git commit -m "Remove .env with exposed AWS credentials (REVOKED)"

# ⚠️ ATTENTION : L'historique Git contient toujours les secrets !
# Utiliser BFG Repo-Cleaner pour les nettoyer :

# Installer BFG
brew install bfg  # ou apt-get install bfg

# Nettoyer les secrets de l'historique
bfg --delete-files .env --no-blob-protection

# Forcer le push
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push --force --all
git push --force --tags
```

### Étape 1.4 : Créer .env.example (sans secrets)
```bash
# À ajouter au repo pour la doc, sans valeurs réelles

cat > .env.example << 'EOF'
NODE_ENV=development
PORT=3002
HOST=0.0.0.0
DB_PATH=./data/mccb-v3.db
UPLOAD_CNI=./uploads/cni
UPLOAD_GSM=./uploads/gsm

# JWT Configuration
JWT_SECRET=<generate-64-char-hex-random-string>
JWT_REFRESH_SECRET=<generate-64-char-hex-random-string>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES=7d

# Authentication
BCRYPT_COST=12
PASSWORD_MIN_LENGTH=8
ACCOUNT_LOCK_AFTER_FAILS=5
ACCOUNT_LOCK_DURATION=900
RATE_LIMIT_LOGIN_MAX=5
RATE_LIMIT_LOGIN_WINDOW=60000

# AWS (À configurer via Secrets Manager en production)
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=<from-secrets-manager>
AWS_SECRET_ACCESS_KEY=<from-secrets-manager>
EOF

git add .env.example
git commit -m "Add .env.example template (no secrets)"
```

### Étape 1.5 : Implémenter AWS Secrets Manager

**Option A : Utiliser AWS Lambda Environment Variables (Simple)**
```bash
# Dans la console AWS Lambda (si déployé sur Lambda) :
# Environment variables → Ajouter AWS_ACCESS_KEY_ID et AWS_SECRET_ACCESS_KEY
# Lambda les chiffre automatiquement
```

**Option B : Utiliser AWS Secrets Manager (Recommandé)**

Installer SDK AWS :
```bash
npm install aws-sdk
```

Créer [server/utils/secrets.js](server/utils/secrets.js) :
```javascript
// server/utils/secrets.js
'use strict';

const AWS = require('aws-sdk');
const secretsManager = new AWS.SecretsManager({
  region: process.env.AWS_REGION || 'eu-west-1'
});

let cachedSecrets = null;

async function getSecrets() {
  if (cachedSecrets) return cachedSecrets;  // Cache pour performances
  
  try {
    const response = await secretsManager.getSecretValue({
      SecretId: 'kyc/aws-rekognition'  // Créer ce secret dans AWS
    }).promise();
    
    cachedSecrets = typeof response.SecretString === 'string'
      ? JSON.parse(response.SecretString)
      : Buffer.from(response.SecretBinary, 'base64').toString('ascii');
    
    // Valider les secrets récupérés
    if (!cachedSecrets.AWS_ACCESS_KEY_ID || !cachedSecrets.AWS_SECRET_ACCESS_KEY) {
      throw new Error('Secrets incomplets');
    }
    
    return cachedSecrets;
  } catch (error) {
    console.error('[SECRETS] Erreur récupération Secrets Manager:', error.message);
    throw error;
  }
}

module.exports = { getSecrets };
```

Créer le secret dans AWS :
```bash
# Dans la console AWS ou CLI :
aws secretsmanager create-secret \
  --name kyc/aws-rekognition \
  --secret-string '{"AWS_ACCESS_KEY_ID":"AKIAQ...","AWS_SECRET_ACCESS_KEY":"..."}'

# Ou via console : https://console.aws.amazon.com/secretsmanager/
```

Utiliser dans le code :
```javascript
// server/routes/face-detect.js
const { getSecrets } = require('../utils/secrets');

fastify.post('/api/face-detect', async (request, reply) => {
  try {
    const secrets = await getSecrets();
    
    const rekognition = new AWS.Rekognition({
      accessKeyId: secrets.AWS_ACCESS_KEY_ID,
      secretAccessKey: secrets.AWS_SECRET_ACCESS_KEY,
      region: 'eu-west-1'
    });
    
    // ... utiliser rekognition
  } catch (err) {
    return reply.code(500).send({ error: 'Service indisponible' });
  }
});
```

**Option C : Utiliser IAM Roles (Si déployé sur EC2/ECS)**
```javascript
// Pas besoin de credentials en clair !
// AWS SDK détecte automatiquement le role IAM

const AWS = require('aws-sdk');
// Pas de new AWS.Credentials() nécessaire

const rekognition = new AWS.Rekognition({
  region: 'eu-west-1'
  // AWS SDK utilise automatiquement les credentials du role IAM
});
```

---

## 2️⃣ Implémenter HTTPS/TLS

### Étape 2.1 : Générer Certificat SSL

**Option A : Let's Encrypt (Gratuit, Recommandé)**
```bash
# Installation Certbot
sudo apt-get update
sudo apt-get install certbot python3-certbot-certbot  # Linux
# ou
brew install certbot  # macOS

# Générer certificat pour votre domaine
sudo certbot certonly --standalone \
  -d kyc.mtn.drc \
  -d api.kyc.mtn.drc \
  --email admin@mtn.drc

# Certificats générés à :
# /etc/letsencrypt/live/kyc.mtn.drc/privkey.pem
# /etc/letsencrypt/live/kyc.mtn.drc/fullchain.pem

# Auto-renouvellement (l'exécuter mensuellement)
sudo certbot renew --quiet

# Ajouter au cron pour auto-renouvellement :
sudo crontab -e
# Ajouter : 0 3 * * * /usr/bin/certbot renew --quiet
```

**Option B : Certificat Auto-Signé (Développement uniquement)**
```bash
# Créer clé privée
openssl genrsa -out server.key 2048

# Créer CSR (Certificate Signing Request)
openssl req -new -key server.key -out server.csr \
  -subj "/C=CD/ST=Kinshasa/L=Kinshasa/O=MTN/CN=kyc.mtn.drc"

# Auto-signer (valable 365 jours)
openssl x509 -req -days 365 -in server.csr \
  -signkey server.key -out server.crt

# Résultat : server.key et server.crt
# ⚠️ À ne jamais utiliser en production !
```

### Étape 2.2 : Configurer Fastify pour HTTPS

Créer [server/config/https.js](server/config/https.js) :
```javascript
// server/config/https.js
'use strict';

const fs = require('fs');
const path = require('path');

function getHttpsConfig() {
  if (process.env.NODE_ENV !== 'production') {
    return undefined;  // HTTP en développement
  }
  
  // Production : charger certificat
  const certPath = process.env.SSL_CERT_PATH || '/etc/letsencrypt/live/kyc.mtn.drc/fullchain.pem';
  const keyPath = process.env.SSL_KEY_PATH || '/etc/letsencrypt/live/kyc.mtn.drc/privkey.pem';
  
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    throw new Error(`[SSL] Certificats introuvables:\n  Cert: ${certPath}\n  Key: ${keyPath}`);
  }
  
  return {
    key: fs.readFileSync(keyPath, 'utf8'),
    cert: fs.readFileSync(certPath, 'utf8')
  };
}

module.exports = { getHttpsConfig };
```

Modifier [server/index.js](server/index.js) :
```javascript
// server/index.js
const { getHttpsConfig } = require('./config/https');

const httpsConfig = getHttpsConfig();

const app = fastify({
  https: httpsConfig,
  logger: {...},
  trustProxy: true
});

// Redirection HTTP → HTTPS en production
if (process.env.NODE_ENV === 'production') {
  app.addHook('preHandler', async (request, reply) => {
    if (request.protocol !== 'https') {
      const url = `https://${request.hostname}${request.url}`;
      return reply.redirect(301, url);
    }
  });
}

app.listen({ port: process.env.PORT || 3002, host: '0.0.0.0' }, (err) => {
  if (err) throw err;
  const protocol = httpsConfig ? 'HTTPS' : 'HTTP';
  console.log(`Server running on ${protocol} on port ${process.env.PORT}`);
});
```

### Étape 2.3 : Configuration Helmet (Security Headers)

Mettre à jour [server/index.js](server/index.js) :
```javascript
await app.register(require('@fastify/helmet'), {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.tailwindcss.com', 'https://unpkg.com/alpinejs'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https://'],  // Photos depuis AWS S3
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],  // Pas d'iframes
      objectSrc: ["'none'"]
    }
  },
  hsts: {
    maxAge: 31536000,           // 1 an en secondes
    includeSubDomains: true,
    preload: true               // Pour HSTS preload list
  },
  frameguard: {
    action: 'deny'              // Clickjacking protection
  },
  noSniff: true,                // X-Content-Type-Options: nosniff
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin'
  }
});
```

**Vérifier la configuration** :
```bash
# Tester les headers HTTPS
curl -I https://kyc.mtn.drc

# Vérifier HSTS
# Doit contenir : Strict-Transport-Security: max-age=31536000

# Tester CSP
curl -I https://kyc.mtn.drc | grep Content-Security-Policy
```

---

## 3️⃣ Corriger JWT et Tokens

### Étape 3.1 : Générer Secrets Sécurisés

```bash
# Générer 2 secrets aléatoires de 64 caractères hexadécimaux

# Depuis Node.js
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Copier la sortie :
# JWT_SECRET=<output1>
# JWT_REFRESH_SECRET=<output2>

# Ajouter à votre .env (ou AWS Secrets Manager)
```

### Étape 3.2 : Implémenter Access Token + Refresh Token

Modifier [server/utils/auth.js](server/utils/auth.js) :
```javascript
// server/utils/auth.js
'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';      // ✅ Court
const JWT_REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';
const BCRYPT_COST = parseInt(process.env.BCRYPT_COST || '12', 10);

// Validation de démarrage
if (!JWT_SECRET || JWT_SECRET.length < 64) {
  console.error('[FATAL] JWT_SECRET doit faire ≥64 caractères');
  console.error('[FATAL] Générer avec: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
  process.exit(1);
}
if (!JWT_REFRESH_SECRET || JWT_REFRESH_SECRET.length < 64) {
  console.error('[FATAL] JWT_REFRESH_SECRET doit faire ≥64 caractères');
  process.exit(1);
}

// Générer JWT ID unique pour tracking
function generateJti() {
  return crypto.randomBytes(16).toString('hex');
}

// Signer access + refresh token pair
function signTokenPair(payload) {
  const jti = generateJti();
  
  const accessToken = jwt.sign({
    ...payload,
    type: 'access',
    jti: jti
  }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    algorithm: 'HS256'
  });
  
  const refreshToken = jwt.sign({
    matricule: payload.matricule,
    type: 'refresh',
    jti: jti
  }, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES,
    algorithm: 'HS256'
  });
  
  return { accessToken, refreshToken, jti };
}

// Vérifier access token
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return null;
  }
}

// Vérifier refresh token
function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return null;
  }
}

// Hash mot de passe
async function hashPassword(plain) {
  if (!plain || typeof plain !== 'string') {
    throw new Error('Mot de passe invalide');
  }
  return bcrypt.hash(plain, BCRYPT_COST);
}

// Vérifier mot de passe
async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch (err) {
    return false;
  }
}

// Validation force du mot de passe
function validatePasswordStrength(password) {
  const errors = [];
  
  if (!password || typeof password !== 'string') {
    return { valid: false, errors: ['Mot de passe obligatoire'] };
  }
  
  if (password.length < 8) {
    errors.push('Au moins 8 caractères');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Au moins une minuscule');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Au moins une majuscule');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('Au moins un chiffre');
  }
  
  if (!/[!@#$%^&*]/.test(password)) {
    errors.push('Au moins un caractère spécial (!@#$%^&*)');
  }
  
  const commonPasswords = [
    'password', 'motdepasse', 'azerty', 'qwerty', '12345678',
    'password1', 'admin', 'admin123', 'media-2017', 'media2017'
  ];
  if (commonPasswords.includes(password.toLowerCase())) {
    errors.push('Mot de passe trop commun');
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

function getExpiresAtTimestamp() {
  const unit = JWT_EXPIRES_IN.slice(-1);
  const val = parseInt(JWT_EXPIRES_IN.slice(0, -1), 10);
  let seconds = 900;  // 15 min par défaut
  if (unit === 'h') seconds = val * 3600;
  else if (unit === 'm') seconds = val * 60;
  else if (unit === 'd') seconds = val * 86400;
  else if (unit === 's') seconds = val;
  return Math.floor(Date.now() / 1000) + seconds;
}

module.exports = {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  signTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  generateJti,
  getExpiresAtTimestamp,
  BCRYPT_COST,
  JWT_EXPIRES_IN
};
```

### Étape 3.3 : Ajouter Endpoint Refresh Token

Ajouter dans [server/routes/auth.js](server/routes/auth.js) :
```javascript
// POST /api/auth/refresh-token
fastify.post('/api/auth/refresh-token', async (request, reply) => {
  const ip = request.ip || 'unknown';
  const ua = request.headers['user-agent'] || 'unknown';
  
  const { refresh_token } = request.body || {};
  
  if (!refresh_token) {
    return reply.code(401).send({ error: 'Refresh token manquant' });
  }
  
  const decoded = auth.verifyRefreshToken(refresh_token);
  if (!decoded || decoded.type !== 'refresh') {
    return reply.code(401).send({ error: 'Refresh token invalide' });
  }
  
  if (!db.isSessionValid(decoded.jti)) {
    return reply.code(401).send({ error: 'Session révoquée' });
  }
  
  // Charger le compte
  const compte = db.getCompteByMatricule(decoded.matricule);
  if (!compte || !compte.actif) {
    return reply.code(401).send({ error: 'Compte introuvable ou désactivé' });
  }
  
  // Générer nouvelles paires de tokens
  const { accessToken, refreshToken, jti } = auth.signTokenPair({
    matricule: compte.matricule,
    role: compte.role
  });
  
  // Mettre à jour la session
  db.updateSessionJti(decoded.jti, jti);
  
  db.audit(compte.matricule, 'TOKEN_REFRESHED', '', ip, ua);
  
  return reply.send({
    success: true,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: parseInt(auth.JWT_EXPIRES_IN.match(/\d+/)[0]) * 60  // En secondes
  });
});
```

---

## 4️⃣ Corriger Path Traversal dans Uploads

Modifier [server/routes/face-detect.js](server/routes/face-detect.js) lignes 56-62 :

```javascript
function resolveCNIPath(relativePath) {
  if (isBlank(relativePath)) return null;
  
  // ✅ CORRECTION : Vérifier que le chemin résolu reste dans UPLOAD_CNI
  const base = path.resolve(UPLOAD_CNI);
  const baseSep = base + path.sep;
  const full = path.resolve(base, relativePath.trim());
  
  // Vérifier que full commence par base + path separator
  // Cela empêche les attaques path traversal comme "../../etc/passwd"
  if (!full.startsWith(baseSep) && full !== base) {
    console.warn('[SECURITY] Path traversal attempt: ' + relativePath);
    return null;
  }
  
  if (!fs.existsSync(full)) return null;
  
  // Vérifier que c'est un fichier régulier (pas symlink)
  const stats = fs.statSync(full);
  if (!stats.isFile()) {
    return null;
  }
  
  return full;
}
```

**Tester la correction** :
```bash
# Tester qu'on rejette les path traversal
node -e "
const path = require('path');
const UPLOAD_CNI = '/home/lidruf/kyc-v4/uploads/cni';

function resolveCNIPath(relativePath) {
  const base = path.resolve(UPLOAD_CNI);
  const baseSep = base + path.sep;
  const full = path.resolve(base, relativePath.trim());
  
  if (!full.startsWith(baseSep) && full !== base) {
    return null;  // Rejeté
  }
  return full;
}

// Tests :
console.log('Valide:', resolveCNIPath('recto.jpg'));           // OK
console.log('Traversal:', resolveCNIPath('../../etc/passwd'));  // null (rejeté)
console.log('Traversal:', resolveCNIPath('../..'));             // null (rejeté)
console.log('Valide:', resolveCNIPath('subfolder/file.jpg'));   // OK
"
```

---

## ✅ Checklist Phase 1

```markdown
Jour 1 - Sécurité Critique :

CREDENTIALS AWS :
- [ ] Révoquer anciennes clés dans console AWS IAM
- [ ] Créer nouvelles clés
- [ ] Supprimer .env du repository Git
- [ ] Nettoyer historique Git (BFG repo-cleaner)
- [ ] Créer .env.example (sans secrets)
- [ ] Mettre .env dans .gitignore
- [ ] Implémenter AWS Secrets Manager OR IAM Roles
- [ ] Tester que les secrets ne sont plus en clair

HTTPS/TLS :
- [ ] Générer certificat SSL (Let's Encrypt ou auto-signé)
- [ ] Configurer Fastify pour HTTPS
- [ ] Ajouter redirection HTTP → HTTPS
- [ ] Configurer Helmet avec CSP, HSTS, etc.
- [ ] Tester : curl -I https://localhost:3002

JWT TOKENS :
- [ ] Générer JWT_SECRET (64 chars hex)
- [ ] Générer JWT_REFRESH_SECRET (64 chars hex)
- [ ] Réduire JWT_EXPIRES_IN à 15m
- [ ] Implémenter Access + Refresh Token pair
- [ ] Ajouter endpoint /api/auth/refresh-token
- [ ] Tester tokens expiration

PATH TRAVERSAL :
- [ ] Corriger resolveCNIPath() avec vérification startsWith
- [ ] Tester : node script ci-dessus
- [ ] Tester upload et accès fichier

VALIDATION GLOBALE :
- [ ] Aucun secret dans .env du repo
- [ ] Aucun secret dans les logs
- [ ] HTTPS fonctionnel sur 443
- [ ] Tokens courts testés
- [ ] Path traversal bloqué
```

---

Continuer avec **Phase 2** une fois Phase 1 complétée (Rate-limiting, CORS, etc.)
