# KYC Congo V4 — Documentation complète

Refonte professionnelle totale de la plateforme : backend **Fastify + TypeScript + MySQL**, frontend **React 18 + TypeScript + Vite**.

---

## Architecture

```
kyc-modern/
├── backend/               Serveur API Fastify TypeScript
│   ├── src/
│   │   ├── index.ts       Point d'entrée + distribution auto
│   │   ├── db/index.ts    Couche MySQL (mysql2/promise)
│   │   ├── types/         Types partagés
│   │   ├── utils/auth.ts  Bcrypt, JWT, validation
│   │   ├── middleware/    requireAuth, requireRole
│   │   ├── routes/        11 modules de routes
│   │   └── scripts/       create-admin CLI
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/              Application React SPA
│   ├── src/
│   │   ├── App.tsx        Orchestrateur + routing par rôle
│   │   ├── main.tsx
│   │   ├── styles.css     Design system complet
│   │   ├── types/         Types miroir du backend
│   │   ├── context/       AuthContext
│   │   ├── hooks/         useFetch, useHeartbeat, useDebounce
│   │   ├── services/api.ts Client API typé (toutes les routes)
│   │   ├── components/    UI + Layout + Dossiers réutilisables
│   │   └── pages/
│   │       ├── agent/     Dashboard, File, Dossiers, GSM×4, Planning, Qualité, Acquisition
│   │       ├── sup/       Dashboard, File, Historique, Présence, Perf, Distribution,
│   │       │              Heures, Flux, Compilation GSM, Notes, Planning, Reporting
│   │       └── admin/     Dashboard, Comptes, Sessions, Audit, Distribution,
│   │                      Habilitations, Référentiels, Purge, Stockage
│   └── package.json
│
└── migrations/
    └── 001-init-mysql.sql  Schéma complet + vues
```

---

## Démarrage rapide

### Prérequis
- Node.js ≥ 18
- MySQL 8.0+

### 1. Base de données

```bash
mysql -u root -p -e "CREATE DATABASE kyc_v4 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p kyc_v4 < migrations/001-init-mysql.sql
```

Créer l'utilisateur MySQL :
```sql
CREATE USER 'kyc_user'@'localhost' IDENTIFIED BY 'mot_de_passe_fort';
GRANT ALL PRIVILEGES ON kyc_v4.* TO 'kyc_user'@'localhost';
FLUSH PRIVILEGES;
```

### 2. Backend

```bash
cd backend
cp .env.example .env
# Éditer .env : DB_HOST, DB_USER, DB_PASS, DB_NAME, JWT_SECRET (≥32 chars)

npm install
npm run dev         # développement (ts-node-dev)
# ou
npm run build && npm start   # production
```

Créer le premier administrateur :
```bash
npm run create-admin -- ADM001 Dupont Jean "MotDePasse!2024"
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev         # http://localhost:5173
# ou
npm run build       # génère dist/
```

---

## Variables d'environnement backend (.env)

| Variable | Obligatoire | Description |
|---|---|---|
| `PORT` | Non | Port serveur (défaut: 3001) |
| `DB_HOST` | Oui | Hôte MySQL |
| `DB_USER` | Oui | Utilisateur MySQL |
| `DB_PASS` | Oui | Mot de passe MySQL |
| `DB_NAME` | Oui | Nom de la base |
| `JWT_SECRET` | Oui | Secret JWT (≥32 chars) |
| `JWT_EXPIRES_IN` | Non | Durée token (défaut: 8h) |
| `BCRYPT_COST` | Non | Coût bcrypt (défaut: 12) |
| `ACCOUNT_LOCK_AFTER_FAILS` | Non | Tentatives avant verrouillage (défaut: 5) |
| `ACCOUNT_LOCK_DURATION` | Non | Durée verrouillage secondes (défaut: 900) |
| `UPLOAD_CNI` | Non | Dossier photos CNI |
| `UPLOAD_GSM` | Non | Dossier captures GSM |
| `DISTRIBUTION_INTERVAL_MS` | Non | Fréquence auto-distribution (défaut: 2000) |
| `CORS_ORIGIN` | Non | Origine CORS production |
| `AWS_REGION` | Non | AWS Rekognition (reconnaissance faciale) |
| `AWS_ACCESS_KEY_ID` | Non | AWS (optionnel) |
| `AWS_SECRET_ACCESS_KEY` | Non | AWS (optionnel) |

---

## Routes API

### Auth
| Méthode | Route | Accès | Description |
|---|---|---|---|
| POST | `/api/auth/login` | Public | Connexion |
| POST | `/api/auth/logout` | Auth | Déconnexion |
| POST | `/api/auth/change-password` | Auth | Changer mot de passe |
| GET  | `/api/auth/me` | Auth | Profil courant |

### Dossiers
| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET  | `/api/dossiers` | Auth | Liste filtrée |
| GET  | `/api/dossiers/stats` | Auth | Stats du jour |
| GET  | `/api/dossiers/:id` | Auth | Détail |
| GET  | `/api/dossiers/:id/photo/:type` | Auth | Photo sécurisée |
| POST | `/api/dossiers/:id/prendre` | Agent | Prise en charge |
| POST | `/api/dossiers/:id/accepter` | Agent | Accepter |
| POST | `/api/dossiers/:id/rejeter` | Agent | Rejeter |
| POST | `/api/dossiers/:id/transferer` | Sup/Admin | Transférer |
| POST | `/api/dossiers/:id/verifier-visage` | Sup/Admin | Rekognition |
| GET  | `/api/dossiers/historique` | Sup/Admin | Historique complet |
| POST | `/api/public/dossiers` | Public | Dépôt terrain |
| GET  | `/api/public/mon-tableau` | Public | Tableau agent terrain |

### GSM / Gross Add
| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET  | `/api/gsm/referentiels` | Auth | Listes déroulantes |
| GET  | `/api/gsm/mon-tableau` | Agent | Stats personnelles |
| GET  | `/api/gsm/mes-saisies` | Agent | Saisies du jour |
| GET  | `/api/gsm/mes-historique` | Agent | Historique personnel |
| GET  | `/api/gsm/mes-perfs` | Agent | Évolution/stats |
| GET  | `/api/gsm/compilation` | Sup/Admin | Toutes les saisies |
| GET  | `/api/gsm` | Auth | Liste filtrée |
| POST | `/api/gsm/libre` | Agent | Nouvelle saisie |
| PUT  | `/api/gsm/:id` | Auth | Modifier saisie |
| DELETE | `/api/gsm/:id` | Auth | Supprimer saisie |
| POST | `/api/gsm/:id/captures` | Auth | Upload captures |
| GET  | `/api/gsm/captures/:fname` | Auth | Servir capture |

### Présence
| Méthode | Route | Accès | Description |
|---|---|---|---|
| POST | `/api/presence/heartbeat` | Auth | Maintien connexion |
| POST | `/api/presence/statut` | Auth | Changer statut |
| GET  | `/api/presence/resume` | Sup/Admin | Compteurs |
| GET  | `/api/presence/detail` | Sup/Admin | Détail par agent |

### Planning
| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET  | `/api/planning/mon` | Auth | Planning personnel |
| GET  | `/api/planning` | Sup/Admin | Planning équipe |
| POST | `/api/planning/import` | Sup/Admin | Import JSON |
| GET  | `/api/planning-managers` | Sup/Admin | Planning managers |
| POST | `/api/planning-managers` | Sup/Admin | Sauvegarder |

### Notes qualité
| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET  | `/api/notes-qualite/mes` | Agent | Mes notes |
| GET  | `/api/notes-qualite` | Sup/Admin | Notes équipe |
| POST | `/api/notes-qualite/import` | Sup/Admin | Import JSON |

### Config
| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET/PUT | `/api/config/distribution-mode` | Admin | Mode distribution |
| GET/PUT | `/api/config/seuil-alerte` | Admin | Seuil alerte |
| GET/PUT | `/api/config/referentiels-gsm` | Admin | Référentiels GSM |
| GET/PUT | `/api/config/habilitations` | Admin | Habilitations sup |
| PUT     | `/api/config/purge-code` | Admin | Code purge |

### Sup / Admin
| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/api/comptes/agents` | Sup/Admin | Liste agents |
| GET | `/api/sup/file-attente` | Sup/Admin | File complète |
| GET | `/api/sup/donnees-heures` | Sup/Admin | Stats par heure |
| GET | `/api/sup/performance` | Sup/Admin | Perf par agent |
| GET | `/api/admin/stats` | Admin | Stats globales |
| GET/POST | `/api/admin/comptes` | Admin | CRUD comptes |
| PUT | `/api/admin/comptes/:matricule` | Admin | Modifier compte |
| POST | `/api/admin/comptes/:matricule/reset-password` | Admin | Reset MDP |
| GET | `/api/admin/sessions` | Admin | Sessions actives |
| POST | `/api/admin/sessions/:jti/revoquer` | Admin | Révoquer session |
| GET | `/api/admin/audit` | Admin | Journal audit |
| GET | `/api/admin/stockage` | Admin | Stats stockage |
| POST | `/api/admin/purge/apercu` | Admin | Aperçu purge |
| POST | `/api/admin/purge/executer` | Admin | Exécuter purge |

---

## Rôles et permissions

| Fonctionnalité | Agent | Superviseur | Admin |
|---|:---:|:---:|:---:|
| File d'attente (prendre/accepter/rejeter) | ✓ | Vue | Vue |
| Transfert de dossiers | — | ✓ | ✓ |
| Saisie GSM / Gross Add | ✓ | Vue | Vue |
| Compilation GSM équipe | — | ✓ | ✓ |
| Présence / Performance | — | ✓ | ✓ |
| Planning & Notes qualité | Vue | ✓ importer | ✓ |
| Distribution auto | — | Voir | Configurer |
| Gestion comptes | — | — | ✓ |
| Journal d'audit | — | — | ✓ |
| Habilitations / Référentiels | — | — | ✓ |
| Purge données | — | — | ✓ |
| Reconnaissance faciale | — | ✓ | ✓ |

---

## Sécurité

- **JWT** : tokens signés HS256, usage unique (révocation en base), durée 8h
- **Bcrypt** : coût 12 par défaut, configurable
- **Verrouillage** : 5 tentatives → verrouillage 15 minutes (configurable)
- **Rate-limiting** : global 300 req/min, login 5 req/min
- **Helmet** : en-têtes de sécurité HTTP
- **CORS** : origine restreinte en production
- **Masquage** : numéros MTN et photos masqués côté serveur si l'agent n'est pas propriétaire du dossier
- **Audit** : toutes les actions sensibles tracées en base

---

## Migration depuis la V3

La V4 est compatible avec les données V3. Pour migrer :

1. Exporter les données de la V3 en CSV ou SQL
2. Créer la base V4 avec `001-init-mysql.sql`
3. Importer les données dans les nouvelles tables (les colonnes sont identiques ou étendues)
4. Relancer le backend V4

Les colonnes ajoutées en V4 ont des valeurs par défaut, la migration n'est pas destructive.
