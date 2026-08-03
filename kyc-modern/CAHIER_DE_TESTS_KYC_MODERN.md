# Cahier de tests – KYC Modern

Version : 1.0
Date : 2026-07-31
Projet : KYC
Préparé pour : validation fonctionnelle, intégration et pré-déploiement

---

## 1. Objectif du document

Ce cahier de tests a pour objectif de valider le fonctionnement du système KYC sur les composants backend, frontend, base de données, authentification, workflows dossiers, GSM, présence, planning, liveness et administration.

Il sert de référentiel pour :
- vérifier la conformité fonctionnelle,
- détecter les régressions,
- valider les correctifs,
- préparer la mise en production.

---

## 2. Périmètre couvert

### 2.1 Fonctionnalités couvertes
- Authentification et sessions utilisateur
- Gestion des dossiers
- Workflow de prise en charge / acceptation / rejet / transfert
- Vérification faciale et liveness
- Appels vidéos
- Saisie GSM / Gross Add
- Présence et suivi de connexion
- Planning et notes qualité
- Administration et configuration
- API publique et intégration web

### 2.2 Précision fonctionnelle importante
- La création de dossiers par un agent d’acquisition se fait sur l’application mobile.
- Les tests liés à la création de dossier, à la collecte de données, aux photos, aux captures et au parcours d’acquisition doivent donc être réalisés sur l’application mobile, et non sur le frontend web.
- Le frontend web est principalement utilisé pour les traitements, validations et suivis post-acquisition, selon les rôles utilisateur.

### 2.2 Hors périmètre
- Tests de charge volumétrique
- Tests de sécurité pénétration avancés
- Tests de compatibilité sur tous les navigateurs mobiles
- Validation AWS en environnement prod réelle sans données de test

---

## 3. Environnements de test

| Environnement | Objectif | URL / cible | Statut |
|---|---|---|---|
| Local développement | Validation fonctionnelle | http://localhost:5173 + backend local | À configurer |
| Base de test MySQL | Validation données et intégration | base dédiée | À configurer |
| Environnement de préprod | Validation finale avant production | À définir | À configurer |

### 3.1 Pré-requis techniques
- Node.js 18+
- npm installé
- MySQL 8+
- Backend compilable avec `npm run build`
- Frontend exécutable avec `npm run dev`
- Variables d’environnement renseignées dans le backend et le frontend
- Comptes de test disponibles : admin, superviseur, agent

---

## 4. Rôles de test

| Rôle | Description |
|---|---|
| Administrateur | Gestion des comptes, configurations, sécurité, administration |
| Superviseur | Suivi des dossiers, planning, présence, performance, validation |
| Agent | Prise en charge des dossiers, saisie GSM, présence |
| Utilisateur public | Dépôt terrain, liveness session |

---

## 5. Données de test

### 5.1 Comptes de test
- Admin : `ADM001`
- Superviseur : `SUP001`
- Agent : `AGT001`

### 5.2 Données métier
- Dossier existant à traiter
- Dossier créé depuis l’application mobile par un agent d’acquisition
- Dossier avec photo CNI disponible
- Dossier avec session liveness à créer
- Saisie GSM de test
- Données de planning et présence à importer

### 5.3 Données de validation
- Mots de passe valides et invalides
- Cas d’erreur réseau
- Cas de fichier invalide
- Cas de photo manquante

---

## 6. Critères de validation

Un test est considéré comme réussi si :
- l’action attendue est exécutée sans erreur fonctionnelle,
- l’état métier est correctement mis à jour,
- les droits d’accès sont respectés,
- les messages utilisateur sont cohérents,
- les logs et traces ne révèlent pas d’anomalie critique.

Un test est considéré comme échoué si :
- une erreur bloquante survient,
- un droit non autorisé est accordé,
- un workflow est interrompu,
- une donnée est perdue ou corrompue,
- une vulnérabilité majeure est détectée.

---

## 7. Méthodologie de test

### 7.1 Types de tests
- Tests fonctionnels
- Tests d’intégration backend/frontend
- Tests de sécurité et permissions
- Tests de régression
- Tests de parcours utilisateur critiques

### 7.2 Priorités
- P0 : critique, bloquant pour l’exploitation
- P1 : important, impact fonctionnel fort
- P2 : secondaire, amélioration ou confort

---

## 8. Cas de tests détaillés

### 8.1 Authentification et sécurité

| ID | Fonction | Priorité | Objectif | Préconditions | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|---|---|---|
| AUTH-01 | Connexion valide | P0 | Vérifier qu’un utilisateur valide peut se connecter | Compte actif existant | Saisir identifiant et mot de passe valides | Connexion réussie, token généré, redirection vers le tableau adapté | À exécuter |
| AUTH-02 | Connexion invalide | P0 | Vérifier la gestion des identifiants incorrects | Compte existant | Saisir un mot de passe erroné | Erreur affichée, aucune session créée | À exécuter |
| AUTH-03 | Déconnexion | P0 | Vérifier la fin de session | Utilisateur connecté | Cliquer sur déconnexion | Session terminée, accès refusé après déconnexion | À exécuter |
| AUTH-04 | Changement de mot de passe | P1 | Vérifier la mise à jour du mot de passe | Utilisateur connecté | Changer le mot de passe via l’interface | Mot de passe modifié, nouvelle connexion possible | À exécuter |
| AUTH-05 | Vérification des droits | P0 | Vérifier qu’un agent ne peut pas accéder aux routes admin | Compte agent connecté | Tenter d’accéder à une page réservée admin | Accès refusé avec message approprié | À exécuter |
| AUTH-06 | Verrouillage après tentatives répétées | P1 | Vérifier le mécanisme de verrouillage | Compte standard | Répéter des connexions erronées | Compte verrouillé après seuil défini | À exécuter |

### 8.2 Gestion des dossiers

> Les tests de création de dossier et de collecte initiale doivent être réalisés sur l’application mobile utilisée par l’agent d’acquisition.

| ID | Fonction | Priorité | Objectif | Préconditions | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|---|---|---|
| DOS-01 | Liste des dossiers | P0 | Vérifier l’affichage de la file de dossiers | Utilisateur connecté avec droits | Ouvrir la liste des dossiers | Liste chargée, filtres fonctionnels | À exécuter |
| DOS-01A | Création d’un dossier depuis l’application mobile | P0 | Vérifier la création complète d’un dossier par un agent d’acquisition | Application mobile installée, agent connecté | Se connecter sur l’app mobile, saisir les données du dossier, joindre les documents/photos, valider | Dossier créé avec succès, données persistées, statut initial correct | À exécuter |
| DOS-02 | Prendre en charge un dossier | P0 | Vérifier la prise en charge par un agent | Dossier disponible | Cliquer sur “Prendre” | Statut mis à jour, dossier assigné à l’agent | À exécuter |
| DOS-03 | Accepter un dossier | P0 | Vérifier l’acceptation du dossier | Dossier pris en charge | Cliquer sur “Accepter” | Dossier passé au statut accepté | À exécuter |
| DOS-04 | Rejeter un dossier | P0 | Vérifier le rejet du dossier | Dossier pris en charge | Cliquer sur “Rejeter” | Dossier passé au statut rejeté avec motif si applicable | À exécuter |
| DOS-05 | Transférer un dossier | P1 | Vérifier la logique de transfert | Droits superviseur/admin | Sélectionner un dossier et un destinataire | Dossier transféré et visible par le bon utilisateur | À exécuter |
| DOS-06 | Vérification du détail d’un dossier | P0 | Vérifier l’ouverture de la fiche détaillée | Dossier existant | Ouvrir un dossier depuis la liste | Toutes les informations affichées correctement | À exécuter |
| DOS-07 | Accès aux photos | P1 | Vérifier l’accès sécurisé aux photos | Dossier avec photo | Ouvrir la photo via l’API | Photo affichée ou bloquée selon les droits | À exécuter |

### 8.3 Vérification faciale et liveness

| ID | Fonction | Priorité | Objectif | Préconditions | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|---|---|---|
| LIV-01 | Création de session liveness | P0 | Vérifier la création d’une session Rekognition | Dossier existant et config AWS disponible | Lancer la procédure liveness | Session créée avec sessionId valide | À exécuter |
| LIV-05 | Fonctionnalité interne d’appel vidéo | P0 | Vérifier le flux interne d’appel vidéo entre les acteurs concernés | Backend démarré, signalisation disponible, comptes/test de connexion disponibles | Exécuter le scénario d’appel vidéo prévu par le processus interne, depuis l’interface concernée, puis valider la réception, la connexion et la fin d’appel | L’appel vidéo se déroule correctement, la connexion est établie, les statuts d’appel évoluent correctement et la session se termine proprement | À exécuter |
| LIV-02 | Résultat de session liveness | P0 | Vérifier la récupération du résultat | Session liveness créée | Récupérer le résultat | Résultat traité et enregistré en base | À exécuter |
| LIV-03 | Redirection web liveness | P1 | Vérifier l’ouverture de la page web de vérification | URL de test renseignée | Ouvrir `/liveness-check?dossierId=...` | Page web s’affiche et initie la procédure | À exécuter |
| LIV-04 | Cas d’échec liveness | P1 | Vérifier la gestion d’un échec | Session liveness avec échec | Simuler un échec de validation | Erreur explicitement remontée au système | À exécuter |

### 8.4 GSM / Gross Add

| ID | Fonction | Priorité | Objectif | Préconditions | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|---|---|---|
| GSM-01 | Création d’une saisie GSM | P0 | Vérifier la création d’une nouvelle saisie | Agent connecté | Remplir les champs requis et valider | Saisie enregistrée et visible dans la liste | À exécuter |
| GSM-02 | Modification d’une saisie | P1 | Vérifier la mise à jour d’une saisie existante | Saisie existante | Modifier un champ et sauvegarder | Mise à jour persistée | À exécuter |
| GSM-03 | Suppression d’une saisie | P1 | Vérifier le retrait d’une saisie | Saisie existante | Supprimer la saisie | Saisie retirée de la liste et de la base | À exécuter |
| GSM-04 | Upload de captures | P1 | Vérifier l’ajout de fichiers associés à une saisie | Saisie en cours | Ajouter une ou plusieurs captures | Fichiers stockés et liés à la saisie | À exécuter |
| GSM-05 | Consultation des stats personnelles | P1 | Vérifier les indicateurs de performance | Agent connecté | Ouvrir la vue stats / tableau personnel | Statistiques calculées correctement | À exécuter |

### 8.5 Présence et planning

| ID | Fonction | Priorité | Objectif | Préconditions | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|---|---|---|
| PRE-01 | Heartbeat de présence | P0 | Vérifier la mise à jour du statut de présence | Agent connecté | Envoyer un heartbeat | Statut mis à jour avec horodatage | À exécuter |
| PRE-02 | Changement de statut | P1 | Vérifier la modification manuelle de statut | Agent connecté | Changer le statut | Nouveau statut visible dans le tableau de bord | À exécuter |
| PRE-03 | Résumé de présence | P1 | Vérifier les compteurs de présence | Droits superviseur/admin | Ouvrir la vue de résumé | Données agrégées correctes | À exécuter |
| PLA-01 | Consultation du planning | P1 | Vérifier l’affichage du planning | Utilisateur autorisé | Ouvrir le planning | Planning affiché et cohérent | À exécuter |
| PLA-02 | Import de planning | P1 | Vérifier l’import d’un fichier/JSON | Droits superviseur/admin | Importer un planning de test | Données importées sans corruption | À exécuter |
| NQ-01 | Consultation des notes qualité | P1 | Vérifier l’accès aux notes | Droits concernés | Ouvrir la page notes qualité | Notes affichées correctement | À exécuter |

### 8.6 Administration et configuration

| ID | Fonction | Priorité | Objectif | Préconditions | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|---|---|---|
| ADM-01 | Création d’un compte utilisateur | P0 | Vérifier la création d’un utilisateur via l’admin | Compte admin | Créer un nouvel utilisateur | Compte créé avec bon rôle et mot de passe initial | À exécuter |
| ADM-02 | Réinitialisation du mot de passe | P1 | Vérifier le reset du mot de passe | Utilisateur existant | Exécuter la réinitialisation | Nouveau mot de passe défini et fonctionnel | À exécuter |
| ADM-03 | Configuration du mode de distribution | P1 | Vérifier la mise à jour du mode de distribution | Admin connecté | Modifier la configuration | Nouvelle valeur sauvegardée | À exécuter |
| ADM-04 | Configuration seuil d’alerte | P1 | Vérifier la sauvegarde du seuil d’alerte | Admin connecté | Modifier le seuil | Seuil correctement enregistré | À exécuter |
| ADM-05 | Purge de données | P1 | Vérifier la purge avec aperçu | Admin connecté | Exécuter l’aperçu puis la purge | Données purgées selon les règles | À exécuter |
| ADM-06 | Audit et journal | P1 | Vérifier la traçabilité des actions sensibles | Admin connecté | Consulter l’audit | Événements correctement enregistrés | À exécuter |

### 8.7 Intégration API et robustesse

| ID | Fonction | Priorité | Objectif | Préconditions | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|---|---|---|
| API-01 | Validation des entrées | P0 | Vérifier la validation des champs obligatoires | Appel API avec données incomplètes | Soumettre un payload invalide | Erreur métier ou validation retournée | À exécuter |
| API-02 | Gestion des erreurs 404/500 | P1 | Vérifier la réponse correcte aux routes inexistantes ou erreurs serveur | Appel à une route inexistante | Exécuter la requête | Réponse structurée avec message clair | À exécuter |
| API-03 | Limitation de débit | P1 | Vérifier le rate limiting | Utilisateur connecté | Répéter rapidement les requêtes | Limitation appliquée si seuil dépassé | À exécuter |
| API-04 | Autorisation sur route publique | P0 | Vérifier le contrôle d’accès des routes publiques | Sans authentification | Appeler une route publique attendue | Réponse conforme aux règles | À exécuter |

---

## 9. Checklist de smoke test

Exécuter avant toute validation détaillée.

- [ ] Backend démarré sans erreur
- [ ] Frontend accessible
- [ ] Base MySQL connectée
- [ ] Authentification fonctionnelle
- [ ] Une session utilisateur active est disponible
- [ ] Un dossier de test est accessible
- [ ] Les photos de test sont présentes
- [ ] Les variables d’environnement sont correctement chargées

---

## 10. Template de rapport de bug

| Champ | Description |
|---|---|
| ID bug | BUG-XXX |
| Date | |
| Rôle / utilisateur | |
| Module | |
| Priorité | P0 / P1 / P2 |
| Résumé | |
| Étapes de reproduction | |
| Résultat observé | |
| Résultat attendu | |
| Captures / logs | |
| Statut | Ouvert / En cours / Corrigé / Rejeté |

---

## 11. Critères d’acceptation de la version

La version est acceptable si :
- tous les tests P0 passent,
- aucun bug critique n’est ouvert,
- les workflows critiques fonctionnent de bout en bout,
- les droits d’accès sont respectés,
- les données critiques sont correctement persistées,
- la procédure de déploiement ne dépend pas d’une configuration manquante.

---

## 12. Signatures de validation

| Responsable | Rôle | Date | Signature |
|---|---|---|---|
| | Testeur fonctionnel | | |
| | Développeur | | |
| | Product owner / responsable métier | | |
