# Plan de Travail — Champs SQL dynamiques (ALTER TABLE) & Réattribution GSM

Objectif

- Permettre à l'administrateur de créer/supprimer des champs de saisie comme de vraies colonnes SQL (ALTER TABLE automatique).
- Permettre à n'importe quel agent, depuis son tableau, de réattribuer un dossier GSM en réenregistrant la nouvelle pièce d'identité et en mettant à jour le dossier.

Résumé des principes

- Les champs ajoutés deviennent des colonnes physiques dans la table `dossiers` (ou table principale concernée).
- Toute modification génère une migration idempotente `up` / `down` stockée dans `backend/migrations/`.
- Suppression = deux phases : "masquer" (immédiat) puis DROP (après période de grâce et backup) ou DROP forcé avec confirmation.
- Avant tout ALTER TABLE, effectuer un backup ciblé et journaliser l'opération.

Étapes détaillées

1) Conception du moteur de migrations
- Générer fichier migration `YYYYMMDDHHMMSS_add_field_<name>.ts` contenant `up()` et `down()`.
- Enregistrer métadonnées dans table `admin_field_changes` (name, type, nullable, default, label, hidden, created_by, ts, migration_file).
- Marquer migration comme appliquée dans la table `migrations` existante.

2) Sécurité / sauvegarde
- Avant ALTER TABLE, créer backup ciblé (ex: `CREATE TABLE backup_dossiers_<ts> AS SELECT * FROM dossiers WHERE 1=0` puis `mysqldump` des données si nécessaire).
- En cas d'échec, appliquer la migration `down` ou restaurer depuis backup.

3) Politique de suppression
- Phase 1 : `hidden = true` → champ masqué dans l'UI et API.
- Phase 2 : après période de grâce (configurable), créer migration `down` pour `DROP COLUMN` et appliquer après backup.
- Fournir option admin "Supprimer (force)" qui effectue backup automatique puis DROP.

4) Contraintes SQL & meilleurs usages
- Si ADD non-nullable : exiger valeur `default` ou refuser et conseiller étapes (ajouter nullable → backfill → set NOT NULL).
- Types autorisés : `VARCHAR(n)`, `TEXT`, `INT`, `BIGINT`, `DATE`, `DATETIME`, `BOOLEAN`, `DECIMAL`.
- Limiter `VARCHAR` à une longueur raisonnable (ex: 255) et documenter limites.

5) API Backend
- `GET /api/admin/fields` → liste champs dynamiques (incl. hidden)
- `POST /api/admin/fields` → crée champ (valide input, génère migration, apply)
- `DELETE /api/admin/fields/:name` → masque champ (hidden=true) ou programme DROP
- `POST /api/admin/fields/:name/force-drop` → force DROP (backup + apply)
- `GET /api/admin/fields/schema` → retourne schéma dynamique pour le frontend (ordre, label, type)

6) Génération et application des migrations
- Utilitaire `backend/scripts/generate_field_migration.ts` qui :
  - valide le nom et type,
  - crée le fichier migration (up/down),
  - journalise en `admin_field_changes`,
  - appelle le migrate runner pour appliquer la migration.

7) Frontend Admin (Parametres)
- Page `ParametresPage.tsx` : UI pour créer/supprimer/masquer champs.
- Formulaire : nom, label, type, longueur, nullable, default, position, visibilité.
- Historique des changements + possibilité de rollback (exécuter `down`).

8) Frontend Agent (render dynamique)
- Au chargement de `DossierPages.tsx` ou formulaire d'acquisition, appeler `GET /api/admin/fields/schema`.
- Générer le formulaire en runtime selon le schéma et sauvegarder les valeurs directement dans les colonnes réelles de `dossiers`.
- Gestion des champs masqués : ne pas afficher, mais conserver données en base jusqu'à DROP.

9) Réattribution GSM — Backend
- Endpoint `POST /api/gsm/:dossierId/reattribute` (auth: agent) payload: nouvelle identité + autres champs optionnels.
- Actions :
  - Valider/créer la nouvelle identité (table `personnes` ou `identities`).
  - Mettre à jour `dossiers` : `identity_id`, `agent_id` (ou owner), et champs fournis.
  - Écrire entrée dans `dossier_history` (old_identity, new_identity, agent_id, ts, reason).
  - Retourner dossier mis à jour + audit id.

10) Réattribution GSM — Frontend
- Ajouter bouton `Réattribuer` sur chaque ligne du tableau agent (ex: `GsmMonTableau`).
- Ouvrir modal avec formulaire (mêmes champs que création) ; soumettre → appeler endpoint.
- Après succès : rafraîchir silencieusement la liste et afficher confirmation; conserver position/scroll.

11) Autorisation et audit
- Seuls les comptes with role `admin` peuvent créer/supprimer champs.
- Tout agent peut déclencher la réattribution; toutes actions journalisées.

12) Tests & CI
- Tests unitaires pour le générateur de migration (up/down SQL attendu).
- Tests d'intégration: appliquer migration en base test puis rollback.
- Tests API: `POST /api/gsm/:id/reattribute` insert/updates et historique.

13) Runbook opérateur (déploiement)
- En staging : exécuter création de champ et suppression simulée.
- En prod :
  - Faire backup complet ou backup ciblé avant toute ALTER TABLE.
  - Exécuter migration en fenêtre maintenance si ALTER long.
  - Vérifier logs et métriques (durée ALTER TABLE). 

Commandes utiles (exemples)

```bash
# créer backup ciblé (exemple)
mysqldump -u $DB_USER -p $DB_NAME dossiers --where='1=1' > backup_dossiers_$(date +%Y%m%d%H%M%S).sql

# exécuter migration (si runner existe)
node backend/dist/migrate.js up YYYYMMDDHHMMSS_add_field_xxx

# rollback
node backend/dist/migrate.js down YYYYMMDDHHMMSS_add_field_xxx
```

Livrables

- `backend/scripts/generate_field_migration.ts`
- `backend/migrations/` (fichiers générés)
- `backend/routes/admin/fields.ts` (API)
- `backend/models/admin_field_changes.sql` (table audit)
- `frontend/src/pages/ParametresPage.tsx` (UI admin)
- `frontend/src/components/field-renderer/*` (render dynamique)
- `frontend/src/pages/gsm/GsmReattributeModal.tsx` (modal réattribution)
- `docs/ALTER_TABLE_runbook.md` (procédures et sauvegarde)

Prochaine action proposée

- Je peux commencer par implémenter et tester le générateur de migration + endpoint backend (`POST /api/admin/fields`) en staging. Voulez-vous que je commence par cela ?
