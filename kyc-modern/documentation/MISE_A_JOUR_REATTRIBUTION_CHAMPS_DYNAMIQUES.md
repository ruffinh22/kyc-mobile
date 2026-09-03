# Mise à jour KYC Modern — Champs dynamiques, réattribution GSM, traçabilité numéro, déploiement multi-pays

**Statut :** implémenté et compilé (`tsc --noEmit` propre, backend + frontend) — prêt pour tests d'intégration et recette.
**Date :** Septembre 2026
**Portée :** `backend/` (Fastify + MySQL) et `frontend/` (React)

---

## 1. Résumé exécutif

Cette mise à jour couvre quatre chantiers demandés :

| # | Fonctionnalité | Qui l'utilise | Statut |
|---|---|---|---|
| 1 | Réattribution d'un dossier GSM à une nouvelle personne | Agent **et** superviseur | ✅ Fait |
| 2 | Gestion admin des champs du dossier (masquer/rendre obligatoire/supprimer/créer) | Admin | ✅ Fait |
| 3 | Traçabilité complète d'un numéro (tous les enregistrements + réattributions) | Superviseur/Admin | ✅ Fait |
| 4 | Déploiement multi-pays par bascule de branche (`main` / `kyc-benin`) piloté depuis l'admin | Admin (infra) | 📋 Documenté ci-dessous — plan à 2 jours |

Les points 1 à 3 sont du **code livré**. Le point 4 est un **changement d'architecture de déploiement** : il ne se code pas dans l'application elle-même, il se met en place au niveau infra/CI-CD. La section 6 explique précisément comment le faire, avec un planning à 2 jours.

---

## 2. Fonctionnalité 1 — Réattribution GSM

### 2.1 Principe métier

Un dossier déjà enregistré (un numéro MTN donné) peut être **réattribué à une nouvelle personne** — cas typique : la ligne change de titulaire, l'ancienne pièce n'est plus valable, il faut recapturer une nouvelle pièce d'identité et ressaisir les informations du nouveau titulaire, sans perdre l'historique de l'ancien.

**Qui peut le faire :** n'importe quel agent connecté, ou un superviseur (depuis la page *Historique numéro*, voir §4). Aucune restriction de propriété du dossier — c'est un choix assumé pour ne pas bloquer le terrain, compensé par une traçabilité totale (voir §2.3).

### 2.2 Ce qui se passe techniquement

Route : `POST /api/dossiers/:id/reattribution` (multipart/form-data)

**Champs envoyés :**
- `photo_recto`, `photo_verso` (fichiers, **obligatoires**)
- `nom_titulaire`, `prenom_titulaire`, `nom_pere`, `nom_mere` (**obligatoires**)
- `date_naissance`, `lieu_naissance`, `type_piece`, `numero_cni`, `date_expiration`, `sexe`, `nationalite`, `profession`, `adresse_complete`, `autre_numero` (optionnels selon le type de pièce)
- `motif` (**obligatoire** — texte libre, ex : *"ancien titulaire a cédé la ligne"*)
- tout champ personnalisé actif créé par l'admin (voir §3) est accepté automatiquement

**Traitement serveur (`backend/src/routes/dossiers.ts`) :**
1. Le dossier existant est chargé (`db.getDossierById`).
2. **Snapshot de l'ancien titulaire** : toutes les infos identité (standards + champs custom actifs) + les anciennes photos sont figées en JSON.
3. Les nouvelles photos recto/verso (+ signature si fournie) sont écrites sur disque sous un nom horodaté distinct (`{id}_reattr{timestamp}_recto.jpg`) — **les anciennes photos ne sont jamais écrasées ni supprimées du disque**, seul le chemin en base change.
4. Le dossier est mis à jour avec les nouvelles infos identité, et :
   - `photo_live`, `score_visage`, `visage_match`, `liveness_*` sont **réinitialisés** (une nouvelle personne doit repasser la vérification faciale/liveness) ;
   - `statut` repasse à `en_attente`, `agent_saisie`/`assigne_a` sont libérés (le dossier retourne dans le circuit normal de distribution) ;
   - `reattribue=1`, `reattribue_le`, `reattribue_par`, `nb_reattributions` sont mis à jour.
5. Une ligne est insérée dans `dossier_reattributions` (id, ancien snapshot JSON, motif, matricule de l'agent, date).
6. L'agent qui vient de saisir la réattribution tente de **reprendre automatiquement** le dossier (best-effort, via le mécanisme de verrou existant `prendreDossierSpecifique`) pour enchaîner immédiatement sur la vérification faciale — s'il est déjà occupé sur un autre dossier, le dossier reste simplement disponible dans la file normale.
7. Un log d'audit `DOSSIER_REATTRIBUE` est écrit.

### 2.3 Où c'est accessible

- **Agent** : bouton *« 🔄 Réattribuer ce dossier à une nouvelle personne »* dans l'écran de saisie GSM (`GsmSaisie`, fichier `frontend/src/pages/agent/GsmPages.tsx`).
- **Superviseur** : depuis la nouvelle page *Historique numéro* (`frontend/src/pages/sup/SupHistoriqueNumeroPage.tsx`, voir §4) — le superviseur recherche un numéro, voit tous les dossiers associés, et peut déclencher une réattribution sur n'importe lequel.

Le composant `ReattributionModal` est défini une seule fois (dans `GsmPages.tsx`) et **exporté** pour être réutilisé tel quel par la page superviseur — pas de duplication de code.

### 2.4 Fichiers modifiés/créés

```
backend/src/db/migrations/20260901_add_champs_dynamiques_reattribution.ts   (NOUVEAU)
backend/src/db/index.ts                                                     (updateDossier étendu, +insertReattribution, +getReattributions, +getDossiersByNumero)
backend/src/routes/dossiers.ts                                              (+POST /:id/reattribution, +GET /:id/reattributions, +GET /numero/:numero/historique)
frontend/src/pages/agent/GsmPages.tsx                                       (+ReattributionModal exporté, bouton dans GsmSaisie)
frontend/src/pages/sup/SupHistoriqueNumeroPage.tsx                          (NOUVEAU)
frontend/src/services/api.ts                                                (+reattribuerDossier, +getReattributions, +getHistoriqueNumero)
frontend/src/types/index.ts                                                 (+DossierReattribution, champs reattribue* sur Dossier)
```

---

## 3. Fonctionnalité 2 — Champs dynamiques du dossier (admin)

### 3.1 Principe métier

L'admin doit pouvoir décider **quelles informations sont collectées sur l'abonné** au moment de l'enregistrement — exemples cités : informations liées au paiement du numéro, ou tout autre attribut métier futur — sans dépendre d'une nouvelle mise en production à chaque fois.

Deux catégories de champs :
- **Champs standards** : les colonnes historiques du dossier (nom, prénom, CNI, date de naissance…). L'admin peut les rendre **actifs/inactifs** et **obligatoires/facultatifs**, mais **jamais les supprimer** (ce sont des colonnes structurelles utilisées par le reste de l'application — face-verify, OCR, exports CRM…).
- **Champs personnalisés** : créés librement par l'admin (texte, nombre, date, liste déroulante, case à cocher). Ceux-là peuvent être **modifiés et supprimés définitivement**.

### 3.2 Ce qui se passe techniquement — "vraie migration"

C'est le point le plus sensible de cette fonctionnalité, et il a été implémenté **exactement comme demandé** : pas de simple table de méta-données déconnectée du schéma SQL, mais une **vraie migration de schéma exécutée en temps réel**.

Module : `backend/src/db/customFields.ts`

- **Créer un champ** (`createChampCustom`) :
  1. Génère un nom de colonne SQL sûr à partir du libellé (`custom_numero_recu`, anti-collision automatique, préfixe `custom_` réservé).
  2. Exécute **réellement** `ALTER TABLE dossiers ADD COLUMN \`custom_xxx\` <type SQL>`.
  3. Insère la métadonnée (libellé affiché, type, options, obligatoire, ordre) dans la table `dossier_champs`.
- **Supprimer un champ personnalisé** (`deleteChampCustom`) :
  1. Exécute **réellement** `ALTER TABLE dossiers DROP COLUMN \`custom_xxx\``.
  2. Supprime la métadonnée.
  3. ⚠️ Cette action supprime aussi **toutes les valeurs déjà saisies** pour ce champ, sur tous les dossiers — c'est irréversible. Le front exige une confirmation explicite (`ConfirmModal`), le backend exige un flag `confirm:true` dans le corps de la requête.
- **Activer/désactiver, rendre obligatoire/facultatif, renommer le libellé** (`updateChamp`) : ne touche jamais à la colonne SQL, seulement à la métadonnée — sans risque, réversible.

**Table `dossier_champs` :**

| Colonne | Rôle |
|---|---|
| `cle` | nom réel de la colonne SQL (`nom_titulaire`, `custom_numero_recu`…) |
| `label` | libellé affiché à l'agent |
| `type` | `texte` \| `nombre` \| `date` \| `liste` \| `case` |
| `options` | JSON, uniquement pour `liste` |
| `obligatoire`, `actif` | booléens |
| `standard` | `1` = colonne fixe historique, `0` = champ créé par l'admin |
| `ordre` | ordre d'affichage |

### 3.3 Propagation automatique — "on verra les champs créés / on ne verra plus les champs supprimés"

Trois points d'intégration garantissent que le changement est **immédiat**, sans redéploiement :

1. **`updateDossier()`** (`backend/src/db/index.ts`) interroge dynamiquement la liste des colonnes personnalisées actives et les ajoute à la liste des colonnes qu'il autorise à écrire — un champ créé aujourd'hui est utilisable dès maintenant, sans toucher au code appelant.
2. **Page agent terrain** (`frontend/src/pages/AcquisitionPage.tsx`) charge la liste des champs actifs au montage (`GET /api/public/champs-dossier`) et affiche automatiquement un `<input>`/`<select>`/case à cocher pour chaque champ personnalisé actif, avec validation `obligatoire` intégrée au bouton de soumission.
3. **Formulaire de réattribution** (`ReattributionModal`) fait de même via `GET /api/champs-dossier/actifs` (authentifié).

Un champ désactivé ou supprimé disparaît **immédiatement** de ces deux formulaires au prochain chargement de page — pas de cache à invalider côté client.

### 3.4 Interface admin

Nouvelle page : **Configuration → Champs du dossier** (`frontend/src/pages/admin/AdminChampsDossierPage.tsx`)

- Tableau "Champs standards" : toggle Obligatoire / toggle Actif.
- Tableau "Champs personnalisés" : idem + bouton Supprimer (avec confirmation).
- Bouton *"+ Ajouter un champ"* → modale de création (libellé, type, options si liste, obligatoire).

### 3.5 Endpoints API

| Méthode | Route | Rôle requis | Effet |
|---|---|---|---|
| GET | `/api/champs-dossier/actifs` | tout utilisateur connecté | champs actifs (formulaire réattribution) |
| GET | `/api/public/champs-dossier` | public (page terrain) | champs actifs |
| GET | `/api/admin/champs-dossier` | admin, superviseur | liste complète (avec inactifs) |
| POST | `/api/admin/champs-dossier` | **admin** | crée un champ (ALTER TABLE réel) |
| PATCH | `/api/admin/champs-dossier/:id` | **admin** | modifie libellé/actif/obligatoire/ordre |
| DELETE | `/api/admin/champs-dossier/:id` | **admin** | supprime un champ custom (DROP COLUMN réel), body `{confirm:true}` requis |

---

## 4. Fonctionnalité 3 — Traçabilité complète d'un numéro

### 4.1 Principe métier

Le superviseur doit pouvoir taper un numéro et voir **tout ce qui a été enregistré dessus depuis le début** : le ou les dossiers qui l'ont porté, et pour chacun, l'historique complet des réattributions (qui, quand, pourquoi, avec l'identité de l'ancien titulaire à chaque étape).

### 4.2 Endpoint

`GET /api/dossiers/numero/:numero/historique` (rôle `superviseur` ou `admin`)

Réponse :
```json
{
  "numero": "6XXXXXXXX",
  "nb_dossiers": 1,
  "nb_reattributions": 2,
  "historique": [
    {
      "dossier": { "...dossier actuel..." },
      "reattributions": [
        { "id": 12, "motif": "changement de titulaire", "agent_matricule": "AG042",
          "created_at": 1735689600, "ancien_snapshot": { "nom_titulaire": "…", "...": "..." } }
      ]
    }
  ]
}
```

### 4.3 Page superviseur

`frontend/src/pages/sup/SupHistoriqueNumeroPage.tsx`, menu **Superviseur → Historique numéro**.

- Champ de recherche par numéro.
- Une carte par dossier trouvé (normalement un seul, mais l'implémentation supporte plusieurs dossiers historiques sur le même numéro si le système en a créé plusieurs par le passé).
- Sous chaque dossier, un tableau chronologique des réattributions (date, ancien titulaire, motif, agent).
- Bouton *"🔄 Réattribuer"* directement accessible depuis cette vue, pour le superviseur.

---

## 5. Base de données — récapitulatif des changements

Migration : `backend/src/db/migrations/20260901_add_champs_dynamiques_reattribution.ts` (exécutée automatiquement au démarrage, comme toutes les migrations du projet).

**Nouvelles tables :**
- `dossier_champs` — catalogue des champs (voir §3.2)
- `dossier_reattributions` — historique d'audit des réattributions (voir §2.2)

**Nouvelles colonnes sur `dossiers` :**
- `reattribue` (bool), `reattribue_le` (timestamp), `reattribue_par` (matricule), `nb_reattributions` (compteur)

**Colonnes ajoutées dynamiquement** par les admins au fil de l'eau via `ALTER TABLE` (non prévisibles à l'avance, c'est le principe même de la fonctionnalité).

⚠️ **Point de vigilance production :** les `ALTER TABLE` sur une table `dossiers` volumineuse peuvent verrouiller la table quelques instants selon le moteur/version MySQL. Recommandation : exécuter les créations/suppressions de champs personnalisés **en heures creuses** au démarrage de la fonctionnalité, ou vérifier que le SGBD cible supporte les `ALTER TABLE` en ligne (MySQL 8+/`ALGORITHM=INSTANT` pour un simple `ADD COLUMN` nullable — c'est le cas ici, les colonnes ajoutées sont toutes `DEFAULT NULL`).

---

## 6. Déploiement multi-pays : `main` vs `kyc-benin` — plan à 2 jours

### 6.1 Le besoin, reformulé précisément

> *"En prod on veut que ce code soit mis sur la branche `kyc-benin`, et en admin si l'admin bascule sur Bénin, c'est ce code qui sera servi ; s'il bascule sur l'autre, c'est le code de la branche `main` qui sera servi."*

Techniquement, un processus Node.js en cours d'exécution est **compilé à partir d'une seule branche** — on ne peut pas faire "changer de branche" un serveur qui tourne sans le redémarrer. La bonne façon d'obtenir l'effet demandé ("l'admin bascule et ça change instantanément le comportement servi") est donc de **déployer les deux branches comme deux services distincts, en permanence actifs**, et de faire porter la bascule sur un **routeur** placé devant — pas sur le code applicatif lui-même.

### 6.2 Architecture cible

```
                         ┌─────────────────────────┐
        Utilisateurs ───▶│   Reverse proxy / Gateway │
                         │   (Nginx ou petit service │
                         │    Node "router")          │
                         └───────────┬─────────────┘
                                     │ lit la config "pays actif"
                     ┌───────────────┴────────────────┐
                     ▼                                 ▼
        ┌─────────────────────────┐       ┌─────────────────────────┐
        │  Instance "main"         │       │  Instance "kyc-benin"    │
        │  (branche main)          │       │  (branche kyc-benin)     │
        │  DB : kyc_main            │       │  DB : kyc_benin           │
        └─────────────────────────┘       └─────────────────────────┘
```

**Décisions structurantes :**

1. **Une base de données par pays, pas une base partagée.** Un dossier béninois et un dossier "autre pays" ne doivent pas se mélanger dans les mêmes tables (réglementation KYC différente par pays, champs personnalisés potentiellement différents via la fonctionnalité §3). Chaque instance backend pointe vers sa propre base (`DATABASE_URL` différent par environnement).
2. **Le routeur ne fait QUE du routage**, il ne contient aucune logique métier — pour rester simple à auditer et à faire évoluer.
3. **Le toggle admin n'agit pas sur le code, il agit sur la table de routage** (une ligne en base ou un fichier de config lu par le routeur).

### 6.3 Où stocker le choix "pays actif" ?

Le projet a déjà une table `config` (clé/valeur, voir `backend/src/db/index.ts`, `getConfig`/`setConfig`). Deux options :

- **Option A (recommandée pour démarrer vite) — table `config` de l'instance "portail".**
  Une base légère, séparée des deux bases métier, sert uniquement de plan de contrôle. Elle contient une ligne `pays_actif = 'BENIN' | 'AUTRE'`. Le routeur (Nginx via un module Lua, ou un petit service Node dédié) lit cette valeur à intervalle régulier (ou via un webhook) et redirige vers l'upstream correspondant.
- **Option B (plus robuste à terme) — bascule DNS/Load balancer.**
  Le "pays actif" pointe un enregistrement DNS ou une règle de load balancer managé (ex. AWS ALB target group, Cloudflare Load Balancer) vers l'un ou l'autre groupe d'instances. Plus lourd à mettre en place mais zéro downtime et pas de service "routeur" custom à maintenir.

Pour un délai de 2 jours, l'**Option A** est réaliste ; l'Option B est un chantier ultérieur si le trafic le justifie.

### 6.4 Planning à 2 jours

#### Jour 1 — Séparation des branches et industrialisation du build

| Étape | Détail | Durée estimée |
|---|---|---|
| 1. Créer la branche `kyc-benin` | `git checkout -b kyc-benin` à partir de `main` une fois cette mise à jour mergée. Toute spécificité béninoise future (champs personnalisés différents, textes réglementaires, logos) se développe sur cette branche. | 15 min |
| 2. Écrire les `Dockerfile` backend et frontend | Le projet n'en a pas encore. Un `Dockerfile` multi-stage classique (build TS → `node:20-alpine` en exécution) pour le backend, et un build statique servi par Nginx pour le frontend. | 2h |
| 3. Variables d'environnement par pays | `DATABASE_URL`, `UPLOAD_CNI`, clés AWS Rekognition, etc. **doivent différer** entre les deux instances. Créer `backend/.env.main` et `backend/.env.benin` (non commités), ou des secrets dans le gestionnaire choisi (AWS Secrets Manager, Vault, variables CI/CD). | 1h |
| 4. Pipeline CI (GitHub Actions ou équivalent) | Un workflow par branche (`.github/workflows/deploy-main.yml`, `.github/workflows/deploy-benin.yml`), déclenché sur push, qui : build → test (`tsc --noEmit`) → build image Docker → push registre → déploiement de l'instance correspondante. | 2h30 |
| 5. Provisionner les deux bases MySQL | `kyc_main` et `kyc_benin`, chacune avec les migrations du projet (`npm run migrate` déjà existant) exécutées indépendamment. | 1h |
| 6. Déployer les deux instances en parallèle sur l'infra cible (VM, ECS, k8s…) | Chacune sur un port/sous-domaine interne dédié (ex. `main.internal:4000`, `benin.internal:4000`), non exposées directement au public. | 1h30 |

*(Total Jour 1 ≈ 8h)*

#### Jour 2 — Routeur, bascule admin, tests, bascule en prod

| Étape | Détail | Durée estimée |
|---|---|---|
| 1. Mettre en place le routeur | Nginx avec deux blocs `upstream` (`upstream_main`, `upstream_benin`) et un `map` lisant une valeur (fichier `/etc/nginx/conf.d/pays_actif.conf` généré dynamiquement) pour choisir le `proxy_pass`. Alternative plus simple si l'équipe préfère rester 100% Node : un micro-service Express de 40 lignes qui fait un `http-proxy-middleware` conditionnel. | 2h |
| 2. Écran admin "Pays actif" | Nouvelle page dans l'app portail (ou dans l'admin d'une des deux instances, à trancher selon préférence) avec un toggle Bénin / Autre. Au clic : appel à un petit endpoint de contrôle qui (a) met à jour la valeur en base de contrôle, (b) régénère/recharge la config du routeur (`nginx -s reload` ou équivalent). | 2h |
| 3. Bascule à chaud sans perte de requêtes en vol | Vérifier que le reload Nginx (ou l'équivalent) ne coupe pas les connexions en cours (`nginx -s reload` est safe par design — les workers existants terminent leurs requêtes). Tester avec une charge simulée. | 1h |
| 4. Tests de bout en bout sur les deux instances | Un agent se connecte, enregistre un dossier, un admin bascule le toggle, un autre agent se connecte et doit atterrir sur l'autre instance/DB. Vérifier qu'aucune donnée ne fuite d'une base à l'autre. | 2h |
| 5. Plan de rollback | Documenter la procédure : remettre le toggle sur l'état précédent revient instantanément à l'ancien comportement, sans redéploiement de code — c'est tout l'intérêt de l'architecture. | 30 min |
| 6. Bascule en production + supervision | Activer, surveiller les logs des deux instances et du routeur pendant quelques heures. | 30 min |

*(Total Jour 2 ≈ 8h)*

### 6.5 Points de vigilance

- **Ne jamais faire pointer les deux branches vers la même base de données** — les schémas peuvent diverger dès qu'un admin crée un champ personnalisé différent sur une instance (fonctionnalité §3), ce qui casserait immédiatement l'autre instance si elle lit une colonne qu'elle ne connaît pas.
- **Le compte admin qui bascule le toggle doit être un rôle distinct** (ex. "admin plateforme") de l'admin fonctionnel de chaque pays — ce n'est pas la même responsabilité, et une confusion des deux ouvrirait un risque de bascule accidentelle par un admin pays.
- **Sessions utilisateurs** : un agent connecté sur l'instance "main" au moment de la bascule sera redirigé vers "kyc-benin" au prochain appel réseau — son token JWT ne sera pas valide sur l'autre instance (secrets/BD différents). C'est un comportement attendu à documenter côté support (l'utilisateur devra se reconnecter), pas un bug.
- **Coût infra** : cette architecture fait tourner deux instances backend + deux bases en permanence, même quand un seul "pays" est réellement utilisé à un instant T. C'est le prix de la bascule instantanée sans redéploiement ; si le budget est contraint, une alternative moins chère (mais avec une coupure de quelques dizaines de secondes à la bascule) est de n'avoir qu'une seule instance et de la redéployer avec l'image de l'autre branche au moment du toggle — à évaluer selon les contraintes réelles de disponibilité.

---

## 7. Checklist de recette avant mise en production

- [ ] Migration `20260901_add_champs_dynamiques_reattribution.ts` appliquée sans erreur sur une copie de la base de prod.
- [ ] Créer un champ personnalisé "liste" avec 3 options depuis l'admin → il apparaît sur la page terrain et dans le formulaire de réattribution.
- [ ] Désactiver ce champ → il disparaît des deux formulaires sans rafraîchissement de cache nécessaire.
- [ ] Supprimer ce champ → confirmation demandée, colonne SQL effectivement supprimée (`DESCRIBE dossiers`), aucune erreur applicative résiduelle.
- [ ] Réattribuer un dossier existant en tant qu'agent → nouvelles infos enregistrées, ancien titulaire visible dans l'historique, dossier repasse par la vérification faciale.
- [ ] Réattribuer le même dossier une seconde fois en tant que superviseur, depuis *Historique numéro* → `nb_reattributions = 2`, les deux anciens titulaires apparaissent dans l'ordre chronologique.
- [ ] Vérifier qu'un agent qui n'est PAS admin ne peut pas appeler les routes `/api/admin/champs-dossier/*` (403 attendu).
- [ ] `npm run build` (backend et frontend) sans erreur TypeScript.

---

## 8. Références rapides — tous les nouveaux endpoints

```
POST   /api/dossiers/:id/reattribution              agent | superviseur | admin
GET    /api/dossiers/:id/reattributions              agent (dossier concerné) | superviseur | admin
GET    /api/dossiers/numero/:numero/historique        superviseur | admin
GET    /api/champs-dossier/actifs                     tout utilisateur connecté
GET    /api/public/champs-dossier                     public (page terrain)
GET    /api/admin/champs-dossier                      superviseur | admin
POST   /api/admin/champs-dossier                       admin
PATCH  /api/admin/champs-dossier/:id                    admin
DELETE /api/admin/champs-dossier/:id                    admin
```
