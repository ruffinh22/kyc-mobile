# Processus de distribution automatique

## Objectif

Ce document décrit le fonctionnement de la distribution automatique des dossiers dans l’application KYC.

## 1. Déclenchement

La distribution automatique s’exécute lorsque :
- le mode de distribution est défini sur `auto` ;
- le worker backend tourne et exécute la logique périodiquement ;
- un événement métier demande une redistribution immédiate (par exemple après une reprise de pause ou un changement de statut).

## 2. Vérification du mode de distribution

Le backend vérifie la configuration stockée dans la table `config`.

- Si la clé `distribution_mode` n’existe pas ou n’est pas égale à `auto`, la distribution ne se fait pas.

## 3. Détection des agents disponibles

Le système consulte la table `presence` pour identifier les agents éligibles.

Un agent est considéré disponible si :
- son statut est `online` ;
- il a envoyé un signal récent (heartbeat/ping) ;
- il n’est pas déjà occupé par un dossier en cours.

## 4. Protection contre les dossiers orphelins

Si un dossier est encore marqué comme `en_cours` alors que son agent n’a plus envoyé de présence depuis un temps défini :
- le dossier est remis en `en_attente` ;
- l’agent associé est retiré de l’affectation.

Cela évite qu’un dossier reste bloqué indéfiniment.

## 5. Sélection des dossiers à distribuer

Le moteur prend les dossiers ayant le statut `en_attente`.

Les dossiers sont traités dans cet ordre :
- le plus ancien d’abord ;
- selon la logique FIFO (First In, First Out).

## 6. Attribution automatique

Quand un agent disponible est trouvé et qu’un dossier en attente existe :
- le dossier passe de `en_attente` à `en_cours` ;
- l’agent est enregistré comme `agent_saisie` ;
- l’attribution est enregistrée dans les champs d’affectation ;
- l’heure de prise est renseignée.

## 7. Notification en temps réel

Après attribution, une notification SSE est envoyée à l’agent concerné.

Cette notification permet :
- d’actualiser la file d’attente dans l’interface BO ;
- d’informer l’agent qu’un nouveau dossier lui a été attribué.

## 8. Résultat final

En pratique, le processus suit ce cycle :
1. un dossier arrive en attente ;
2. un agent disponible est détecté ;
3. le dossier le plus ancien est attribué automatiquement ;
4. l’agent voit le dossier apparaître dans sa file sans intervention manuelle.

## Fichiers principaux concernés

- [backend/src/utils/distribution.ts](../backend/src/utils/distribution.ts)
- [backend/src/index.ts](../backend/src/index.ts)
- [backend/src/routes/dossiers.ts](../backend/src/routes/dossiers.ts)
- [frontend/src/pages/agent/DossierPages.tsx](../frontend/src/pages/agent/DossierPages.tsx)
