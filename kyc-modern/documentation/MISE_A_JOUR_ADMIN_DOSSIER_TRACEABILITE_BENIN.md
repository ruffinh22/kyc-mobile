# Mise à jour KYC – Administration des attributs de dossier, traçabilité des numéros et gestion Benin / Main

## 1. Objectif

Cette mise à jour vise à améliorer la gouvernance administrative du dossier KYC et la sécurité de la gestion des numéros dans le système.

Elle introduit trois blocages fonctionnels importants :

1. La possibilité pour l’administrateur de masquer ou supprimer des attributs d’un dossier sans casser l’application.
2. Une traçabilité complète de chaque numéro déjà enregistré, avec historique de tous les enregistrements, mises à jour et réenregistrements.
3. Un contrôle supervisé du réenregistrement d’un numéro sur une autre personne, avec validation documentaire et journal d’audit.

La mise en production doit être organisée de manière claire pour respecter le besoin métier suivant :

- La branche `kyc-benin` contient le code spécifique à Benin.
- La branche `main` contient le code standard de production.
- En admin, si l’utilisateur bascule sur Benin, le système sert le profil Benin.
- Si l’utilisateur bascule sur l’autre profil, le système sert le code de la branche `main`.

Important : dans un environnement de production robuste, il faut distinguer clairement :

- la logique applicative branchée par environnement,
- et la configuration active du profil courant (Benin / autre).

Le switch en admin ne doit pas être un “checkout branch” en temps réel dans le runtime. Il doit être une sélection de profil actif ou de base de données / configuration de service, avec un build séparé par environnement.

---

## 2. Problème métier à résoudre

### 2.1 Masquage / suppression des attributs du dossier

Aujourd’hui, l’admin doit pouvoir décider quels attributs sont visibles, requis ou non pour un dossier ou un parcours spécifique.

Exemple métier :

- les informations à recueillir sur l’abonné qui veut payer son numéro,
- les détails de contact,
- les infos de paiement,
- les champs techniques ou complémentaires,
- les données non nécessaires selon certains profils.

Besoin :

- masquer un attribut sans perdre la donnée déjà enregistrée,
- supprimer proprement un champ si le besoin est dépassé,
- conserver un historique avant suppression,
- empêcher la réapparition du champ dans le flux sans consentement administratif.

### 2.2 Traçabilité des numéros déjà enregistrés

Il faut pouvoir voir pour un numéro donné :

- qui l’a enregistré,
- quand,
- sur quelle personne,
- quelles infos ont été saisies,
- quelles modifications ont été faites,
- par quel superviseur / admin,
- quelle est l’historique complet du numéro.

Le but est d’avoir une piste d’audit complète, fiable et exploitable en cas de litige ou de fraude.

### 2.3 Réenregistrement d’un numéro sur une autre personne

Le système doit permettre qu’un superviseur puisse :

- revoir les historiques d’un numéro,
- vérifier le précédent enregistrement,
- identifier le risque ou le doublon,
- autoriser ou déclencher un reenregistrement sur une autre personne,
- enregistrer l’action avec motiver et preuve d’audit.

Le concept est :

- un numéro n’est pas seulement un identifiant technique,
- c’est un objet métier avec historique et chaîne d’actions.

---

## 3. Cible fonctionnelle

### 3.1 Gestion des attributs de dossier

L’admin doit pouvoir gérer les champs de dossier via une page dédiée appelé par exemple :

- “Attributs du dossier”
- “Ciblage des informations”
- “Gestion des champs dossier”

Actions disponibles :

- afficher ou masquer un champ,
- le rendre requis ou optionnel,
- le supprimer du workflow de saisie,
- le restaurer si besoin,
- tracer chaque changement d’état et d’usage.

Règles :

- la suppression n’est pas immédiate si la donnée a déjà été captée,
- une suppression définitive doit passer par validation et backup,
- un champ masqué reste stocké en base jusqu’à confirmation de purge ou migration.

### 3.2 Traçabilité des numéros

Chaque numéro du système doit être associé à un historique structuré :

- `numero`
- `personne_id`
- `dossier_id`
- `agent_id`
- `superviseur_id`
- `source`
- `statut`
- `date_enregistrement`
- `date_maj`
- `motif`
- `champion/enregistrement initial`
- `historique complet`

Le système doit permettre :

- rechercher un numéro,
- lister tous les enregistrements associés,
- voir la chronologie complète,
- filtrer par personne, agent, date, statut, superviseur.

### 3.3 Réenregistrement supervisé

Le superviseur doit pouvoir :

- sélectionner un numéro existant,
- vérifier l’historique,
- choisir une autre personne cible,
- saisir les nouvelles informations,
- valider une réaffectation sûre,
- laisser trace de l’ancien et du nouveau propriétaire.

Le scénario valide doit être :

- historique complet,
- validation du superviseur,
- journalisation de la décision,
- blocage si le numéro est déjà lié à un dossier actif ou sous contrôle.

---

## 4. Modèle de données recommandé

### 4.1 Table d’attributs du dossier

Créer une table de configuration des attributs applicatifs, par exemple :

```sql
CREATE TABLE dossier_fields (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(100) NOT NULL UNIQUE,
  label VARCHAR(200) NOT NULL,
  type VARCHAR(50) NOT NULL,
  obligatoire TINYINT(1) DEFAULT 0,
  visible TINYINT(1) DEFAULT 1,
  supprimable TINYINT(1) DEFAULT 0,
  ordre INT DEFAULT 0,
  categorie VARCHAR(100) DEFAULT 'general',
  created_by VARCHAR(50) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### 4.2 Table de journal des changements

```sql
CREATE TABLE dossier_field_history (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  field_code VARCHAR(100) NOT NULL,
  old_value JSON NULL,
  new_value JSON NULL,
  action VARCHAR(50) NOT NULL,
  actor VARCHAR(50) NOT NULL,
  context VARCHAR(200) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 4.3 Table de traçabilité numéro

```sql
CREATE TABLE numero_traceability (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  numero VARCHAR(30) NOT NULL,
  personne_id BIGINT NOT NULL,
  dossier_id BIGINT NOT NULL,
  agent_id VARCHAR(50) NOT NULL,
  superviseur_id VARCHAR(50) NULL,
  action_type VARCHAR(50) NOT NULL,
  source VARCHAR(100) NOT NULL,
  statut VARCHAR(50) NOT NULL,
  payload JSON NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 4.4 Table de réenregistrement

```sql
CREATE TABLE numero_reenregistrement (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  numero VARCHAR(30) NOT NULL,
  ancien_personne_id BIGINT NOT NULL,
  nouveau_personne_id BIGINT NOT NULL,
  ancien_dossier_id BIGINT NOT NULL,
  nouveau_dossier_id BIGINT NOT NULL,
  demandeur VARCHAR(50) NOT NULL,
  superviseur VARCHAR(50) NOT NULL,
  motif VARCHAR(255) NOT NULL,
  statut VARCHAR(50) DEFAULT 'en_attente',
  decision_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 4.5 Index conseillés

- index sur `numero`
- index sur `personne_id`
- index sur `dossier_id`
- index sur `created_at`
- index sur `statut`
- index sur `(numero, created_at)`

---

## 5. Règles de gestion fonctionnelles

### 5.1 Attributs masqués

Quand un admin masque un champ :

- le champ n’est plus visible dans les écrans de saisie,
- le formulaire ne le demande plus,
- les données déjà présentes restent intactes,
- l’historique est conservé,
- le champ peut être remis visible plus tard.

### 5.2 Suppression d’attribut

Quand un admin supprime un champ :

- il y a validation et confirmation pour action irréversible,
- un backup est créé,
- le champ est retiré du formulaire,
- le schéma ne l’affiche plus,
- les données historiques sont conservées dans une table d’archive ou journaux si nécessaire.

### 5.3 Réenregistrement

Un reenregistrement de numéro est autorisé seulement si :

- la demande est faite par un agent ou un superviseur autorisé,
- le numéro existe dans l’historique,
- la demande est validée par un superviseur,
- le contexte métier est cohérent,
- l’action est journalisée séquentiellement.

---

## 6. API backend recommandées

### 6.1 Attributs du dossier

- `GET /api/admin/dossier-fields`
- `POST /api/admin/dossier-fields`
- `PUT /api/admin/dossier-fields/:code`
- `DELETE /api/admin/dossier-fields/:code`
- `POST /api/admin/dossier-fields/:code/mask`
- `POST /api/admin/dossier-fields/:code/unmask`

### 6.2 Traçabilité des numéros

- `GET /api/admin/numeros/:numero/history`
- `GET /api/admin/numeros/search?numero=...`
- `GET /api/admin/numeros/:numero/registrements`

### 6.3 Réenregistrement

- `POST /api/admin/numeros/:numero/reenregistrer`
- `POST /api/admin/numeros/:numero/validate-reenregistrement`
- `GET /api/admin/reenregistrements`

### 6.4 Audit

- `GET /api/admin/audit/numero`
- `GET /api/admin/audit/field-changes`

Toutes ces routes doivent :

- vérifier les droits,
- enregistrer l’auteur de l’action,
- toujours écrire dans le journal d’audit,
- retourner un identifiant d’action et un statut.

---

## 7. Page d’administration à créer

### 7.1 Page “Attributs du dossier”

Cette page doit permettre :

- afficher les attributs existants,
- filtrer par catégorie,
- masquer / afficher,
- marquer requis / optionnel,
- supprimer / restaurer,
- visualiser l’historique,
- consulter l’audit par utilisateur.

### 7.2 Page “Traçabilité des numéros”

Cette page doit permettre :

- rechercher par numéro,
- voir l’historique complet,
- visualiser l’agent, le dossier et la personne,
- filtrer par période,
- exporter le registre en CSV ou PDF.

### 7.3 Page “Réenregistrement supervisé”

Cette page doit être accessible à l’administrateur et au superviseur.

Fonctionnement :

1. recherche du numéro,
2. chargement de l’historique complet,
3. sélection de la nouvelle personne,
4. soumission de la demande,
5. validation par superviseur,
6. mise à jour du lien vers le nouveau dossier,
7. publication dans le journal d’audit.

---

## 8. Rôle et autorisations

### 8.1 Admin

- créer / masquer / supprimer des attributs,
- gérer les profils de visibilité,
- valider les suppressions,
- gérer le profil de production actif.

### 8.2 Superviseur

- visualiser la traçabilité des numéros,
- valider les réenregistrements,
- autoriser les changements sur une autre personne,
- contrôler les opérations de mise à jour.

### 8.3 Agent

- enregistrer le numéro pour une personne,
- consulter le profil avec historique limité,
- déclencher un reenregistrement sous contrôle supervisé.

---

## 9. Stratégie de production : branche Benin / Main

### 9.1 Règle métier demandée

Le besoin de production est le suivant :

- `kyc-benin` contient le code pour Benin.
- `main` contient le code standard pour le reste.
- En admin, l’utilisateur bascule sur Benin pour servir le code/logic spécifique Benin.
- Si l’utilisateur bascule sur l’autre profil, le code de `main` est servi.

### 9.2 Bonne pratique recommandée pour la production

Le plus sûr est de ne pas faire de “switch branch” au runtime.

La meilleure architecture est la suivante :

1. une branche `kyc-benin` est déployée avec son environnement dédié,
2. la branche `main` est déployée avec son environnement dédié,
3. un profil actif est sélectionné par variable d’environnement ou par paramètre d’administration,
4. le backend charge la config correspondante (DB, service, feature flags, route, règles métier).

Schema conseillé :

- environnement `benin-prod`
- environnement `main-prod`
- variable `APP_PROFILE=benin` ou `APP_PROFILE=main`
- variable `ACTIVE_DB=primary` ou `secondary` selon le besoin

A noter : dans un système multi-instance, on peut aussi exposer un admin politique :

- `profil_active = benin`
- `profil_active = main`

Cela donne l’effet d’un switch sans faire dépendre le runtime de la branche Git.

### 9.3 Implémentation logique recommandée

Dans le backend :

- lire `APP_PROFILE` ou `ACTIVE_ENV` depuis les variables d’environnement,
- charger l’URL de service, la base concernée, les règles métier,
- stocker le profil actif dans la table `app_settings` ou `tenant_config`.

Exemple :

```env
APP_PROFILE=benin
DB_NAME=kyc_benin
DB_HOST=benin-db.internal
```

Ou pour l’autre environnement :

```env
APP_PROFILE=main
DB_NAME=kyc_main
DB_HOST=main-db.internal
```

Le switch admin ne doit servir que à choisir la configuration active, pas à migrer le code.

### 9.4 Recommandation de mise en place

- Déployer `kyc-benin` en environnement Benin distinct.
- Déployer `main` en environnement standard.
- Créer une page d’administration “Profil production” :
  - Benin
  - Main
  - Statut actif
  - Dernière bascule
  - Utilisateur qui a validé la bascule

---

## 10. Plan de mise en production sur 2 jours

### Jour 1 – Backend, base et administration

#### 10.1 Matin

- analyser les tables de dossier et le schéma de données existant,
- créer les tables de configuration d’attributs,
- créer les tables d’historique de numéros,
- créer les tables de réenregistrement,
- ajouter les index utiles.

#### 10.2 Après-midi

- créer les APIs backend pour :
  - lister les attributs,
  - masquer / afficher,
  - supprimer / restaurer,
  - consulter l’historique d’un numéro,
  - enregistrer un réenregistrement,
  - produire l’audit.

#### 10.3 Validation technique

- test d’insertion d’un numéro,
- test de suppression masquée,
- test de réenregistrement sur nouvelle personne,
- test de journal d’audit.

### Jour 2 – Frontend, profil prod et go-live

#### 10.1 Matin

- développer la page admin “Attributs du dossier”,
- développer la page “Traçabilité des numéros”,
- développer la page “Réenregistrement supervisé”,
- intégrer les filtres, historiques et validation.

#### 10.2 Après-midi

- créer le profil environnement `Benin / Main`,
- connecter la sélection admin à la configuration active,
- vérifier le comportement Benin vs Main,
- faire une passe de QA fonctionnelle,
- préparer les scripts de migration et le checklist de production.

#### 10.3 Go-live

- backup de la base,
- exécution des migrations,
- mise en production du build de `kyc-benin` sur l’environnement Benin,
- mise en production du build de `main` sur l’environnement standard,
- validation des pages admin et de la traçabilité,
- finalisation du monitoring et audit.

---

## 11. Checklist de validation avant mise en prod

### 11.1 Fonctionnel

- [ ] l’admin peut masquer un attribut de dossier,
- [ ] l’admin peut restaurer un attribut masqué,
- [ ] l’admin peut supprimer un attribut avec validation,
- [ ] les données historiques restent accessibles,
- [ ] le numéro est traceable dans son historique complet,
- [ ] le superviseur peut autoriser un réenregistrement,
- [ ] toutes les actions sont enregistrées.

### 11.2 Technique

- [ ] index créés,
- [ ] migrations validées,
- [ ] API de recherche et historique fonctionnelles,
- [ ] app protegée par rôles,
- [ ] admin secure et audit trail complet,
- [ ] profils Benin / Main correctement configurés.

### 11.3 Sécurité

- [ ] accès réservé aux rôles autorisés,
- [ ] journal des actions détaillé,
- [ ] validation avant suppression définitive,
- [ ] impossible d’écraser un historique sans trace.

---

## 12. Recommandation de gouvernance et de conformité

### 12.1 Principe majeur

Le système ne doit jamais créer un numéro sans laisser une trace complète.

Chaque enregistrement ou réenregistrement doit être considéré comme un événement métier important, et chaque événement doit être associé à :

- l’agent,
- le superviseur,
- la date,
- l’ancien dossier,
- le nouveau dossier,
- la raison,
- la décision finale.

### 12.2 Sécurité de la donnée

- ne rien supprimer sans backup,
- conserver l’historique en base,
- ne pas exposer l’historique complet aux agents sans autorisation,
- autoriser uniquement les supervisions nécessaires.

---

## 13. Résumé court de la roadmap

### Ce qui doit être livré

- une page admin dédiée aux attributs du dossier,
- une page admin dédiée à la traçabilité des numéros,
- une page rationnelle de réenregistrement supervisé,
- les tables d’audit et historique,
- le bon profil Benin / Main en production.

### Ce qui doit être vrai en production

- l’admin peut gérer les champs du dossier,
- la traçabilité est complète,
- le superviseur contrôle les réenregistrements,
- Benin et Main sont bien séparés par environnement ou profil,
- le code correspondant au profil actif est celui qui est servi.

---

## 14. Décision technique finale recommandée

Pour éviter les erreurs de production, je recommande cette architecture :

- branche `kyc-benin` = environnement Benin dédié,
- branche `main` = environnement principal/défaut,
- selection d’environnement via `APP_PROFILE` ou administration,
- chargement de la config et des règles via `app_settings`,
- journal d’audit complet pour toutes les actions sur numéro et attributs.

C’est la meilleure manière d’obtenir un système robuste, contrôlable et conforme au besoin métier.

---

## 15. Conclusion

Cette mise à jour va transformer la gestion des dossiers et des numéros en un système de gouvernance fiable, auditabilité complète et contrôle supervisé.

Le point clé est la rigueur :

- masquer au lieu de supprimer sans trace,
- conserver l’historique,
- maîtriser le réenregistrement,
- séparer clairement les profils Benin et Main,
- garantir une production propre et reproductible.

La solution proposée est réaliste, exploitable en 2 jours de mise en œuvre, et parfaitement alignée avec les besoins métiers demandés.
