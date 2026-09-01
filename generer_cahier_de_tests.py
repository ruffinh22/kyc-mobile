"""
Génère le « Cahier de tests KYC » réorganisé par profil utilisateur.

Entrée  : fichier Excel original (cahier de tests brut, onglet "Cas de tests"
          organisé par catégorie fonctionnelle).
Sortie  : même classeur, avec :
  - l'onglet "Cas de tests" entièrement reconstruit et regroupé par rôle
    (Agent de terrain -> Agent backoffice -> Superviseur -> Administrateur),
  - l'onglet "Environnements & rôles" mis à jour (Agent scindé en
    terrain / backoffice),
  - l'onglet "Données de test" mis à jour (compte Agent dupliqué en
    terrain / backoffice),
  - l'onglet "Tableau de bord" entièrement reconstruit : KPI + répartition
    par rôle + répartition par catégorie, 100% pilotés par formules
    (COUNTA / COUNTIF / COUNTIFS), aucune valeur codée en dur.

Usage :
    python3 generer_cahier_de_tests.py

Après génération, recalculer les formules (openpyxl n'écrit que les
formules, pas leurs valeurs mises en cache) :
    python3 recalc.py <fichier_de_sortie.xlsx>
(script "recalc.py" fourni par le skill xlsx d'Anthropic, basé sur
LibreOffice — sinon ouvrir le fichier dans Excel/LibreOffice suffit,
un recalcul automatique s'effectue à l'ouverture).
"""

import os
import shutil
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.formatting.rule import CellIsRule, DataBarRule, ColorScaleRule
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.comments import Comment

# ======================================================================
# CONFIGURATION
# ======================================================================
SRC_PATH = "Cahier_de_tests_KYC_maj__1_.xlsx"        # fichier original (entrée)
OUT_PATH = "Cahier_de_tests_KYC_par_role.xlsx"        # fichier généré (sortie)

FONT = "Arial"
NAVY = "FF1F3864"
BLUE = "FF2E5395"
GRAY_BG = "FFF2F2F2"
WHITE = "FFFFFFFF"

THIN = Side(style="thin", color="FFB7B7B7")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
TOP_THICK = Side(style="medium", color="FF404040")
BORDER_GROUP_TOP = Border(left=THIN, right=THIN, top=TOP_THICK, bottom=THIN)

ALIGN_CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
ALIGN_LEFT = Alignment(horizontal="left", vertical="top", wrap_text=True)

CT = "'Cas de tests'"  # référence à l'onglet des cas de tests, utilisée dans les formules

# ======================================================================
# DONNÉES — cas de tests regroupés par profil utilisateur
# ----------------------------------------------------------------------
# tuple : (id, categorie, fonction, priorite, objectif, preconditions,
#          etapes, resultat, commentaire)
# ======================================================================

AGENT_TERRAIN = [
    ("AGT-T-01", "Authentification et sécurité", "Connexion valide (mobile)", "P0",
     "Vérifier qu'un agent de terrain peut se connecter sur l'application mobile",
     "Compte agent actif (AG001)", "Saisir identifiant et mot de passe valides sur l'application mobile",
     "Connexion réussie, token généré, accès à l'interface de terrain", "Réf. originale : AUTH-01"),
    ("AGT-T-02", "Authentification et sécurité", "Connexion invalide (mobile)", "P0",
     "Vérifier la gestion des identifiants incorrects sur mobile",
     "Compte agent existant", "Saisir un mot de passe erroné sur l'application mobile",
     "Erreur affichée, aucune session créée", "Réf. originale : AUTH-02"),
    ("AGT-T-03", "Authentification et sécurité", "Déconnexion (mobile)", "P0",
     "Vérifier la fin de session sur l'application mobile",
     "Agent terrain connecté", "Cliquer sur déconnexion",
     "Session terminée, accès refusé après déconnexion", "Réf. originale : AUTH-03"),
    ("AGT-T-04", "Authentification et sécurité", "Changement de mot de passe (mobile)", "P1",
     "Vérifier la mise à jour du mot de passe depuis l'application mobile",
     "Agent terrain connecté", "Changer le mot de passe via l'interface mobile",
     "Mot de passe modifié, nouvelle connexion possible", "Réf. originale : AUTH-04"),
    ("AGT-T-05", "Authentification et sécurité", "Session expirée / relance automatique", "P1",
     "Vérifier la reprise de session après expiration de token ou timeout réseau",
     "Agent connecté puis session expirée", "Rester inactif, réessayer une action, relancer l'application",
     "Le système redemande une authentification si nécessaire et ne casse pas la session active", "Sécurité / reconnexion mobile"),
    ("AGT-T-06", "Gestion des dossiers", "Création d'un dossier depuis l'application mobile", "P0",
     "Vérifier la création complète d'un dossier par un agent d'acquisition",
     "Application mobile installée, agent terrain connecté",
     "Se connecter sur l'app mobile, saisir les données du dossier, joindre les documents/photos, valider",
     "Dossier créé avec succès, données persistées, statut initial correct", "Réf. originale : DOS-01A"),
    ("AGT-T-07", "Gestion des dossiers", "Saisie partielle puis reprise", "P0",
     "Vérifier la reprise d'un dossier incomplet après fermeture ou perte de connexion",
     "Formulaire incomplet en cours de saisie", "Fermer l'application, revenir plus tard ou reconnecter, reprendre le dossier",
     "Les données non finales sont sauvegardées ou clairement restaurées sans perte", "Récupération mobile"),
    ("AGT-T-08", "Gestion des dossiers", "Validation des champs obligatoires", "P0",
     "Vérifier le blocage des données incomplètes ou invalides",
     "Agent terrain connecté", "Soumettre un dossier avec champs vides, numéros invalides, dates impossibles",
     "Le système affiche les erreurs attendues et empêche la soumission", "Validation métier"),
    ("AGT-T-09", "Gestion des dossiers", "Upload photo CNI / recto / verso / selfie", "P0",
     "Vérifier la prise et l'upload des captures documentaires sur mobile",
     "Dossier en cours, autorisations caméra & stockage accordées", "Prendre les photos, vérifier la qualité, charger et confirmer",
     "Toutes les photos sont enregistrées, liées au dossier, puis visibles dans le détail", "Capture / OCR"),
    ("AGT-T-10", "Gestion des dossiers", "OCR / extraction automatique depuis photo doc", "P0",
     "Vérifier la récupération des données depuis l'OCR ou la préremplissage côté mobile",
     "Photo d'identité valide présente", "Lancer l'OCR automatique depuis l'interface mobile",
     "Les champs détectés sont préremplis et les valeurs sont cohérentes ; les zones non fiables restent modifiables", "Extraction de données"),
    ("AGT-T-11", "Gestion des dossiers", "Fallback OCR indisponible / erreur réseau", "P1",
     "Vérifier le comportement si l'OCR ne répond pas ou AWSTextract est indisponible",
     "Service OCR temporairement indisponible ou réseau instable", "Actionner l'OCR et tenter ensuite la saisie manuelle",
     "L'application affiche un message explicite, permet la saisie manuelle et évite un blocage total", "Robustesse / fallback"),
    ("AGT-T-12", "Vérification faciale et liveness", "Création de session liveness (capture terrain)", "P0",
     "Vérifier la création d'une session Rekognition lors de l'acquisition",
     "Dossier créé sur mobile, configuration AWS disponible",
     "Lancer la procédure liveness depuis l'application mobile pendant l'acquisition",
     "Session créée avec sessionId valide", "Réf. originale : LIV-01"),
    ("AGT-T-13", "Vérification faciale et liveness", "Cas d'échec liveness (capture terrain)", "P1",
     "Vérifier la gestion d'un échec de capture liveness sur le terrain",
     "Session liveness en cours sur mobile", "Simuler un échec de validation pendant la capture",
     "Erreur explicitement remontée à l'agent et au système", "Réf. originale : LIV-04"),
    ("AGT-T-14", "Vérification faciale et liveness", "Liveness avec mauvaise luminosité / visage masqué / mouvement", "P1",
     "Vérifier les cas de rejet de liveness par qualité de capture",
     "Exécuter des captures avec mauvais éclairage, masque, angle incorrect, mouvement excessif",
     "Système rejette correctement et guide l'utilisateur vers une nouvelle capture", "Qualité de capture"),
    ("AGT-T-15", "GSM / Gross Add", "Création d'une saisie GSM", "P0",
     "Vérifier la création d'une nouvelle saisie GSM par l'agent terrain",
     "Agent terrain connecté", "Remplir les champs requis et valider depuis le terrain",
     "Saisie enregistrée et visible dans la liste", "Réf. originale : GSM-01"),
    ("AGT-T-16", "GSM / Gross Add", "Modification d'une saisie", "P1",
     "Vérifier la mise à jour d'une saisie existante",
     "Saisie existante créée par l'agent", "Modifier un champ et sauvegarder",
     "Mise à jour persistée", "Réf. originale : GSM-02"),
    ("AGT-T-17", "GSM / Gross Add", "Suppression d'une saisie", "P1",
     "Vérifier le retrait d'une saisie par l'agent terrain",
     "Saisie existante", "Supprimer la saisie",
     "Saisie retirée de la liste et de la base", "Réf. originale : GSM-03"),
    ("AGT-T-18", "GSM / Gross Add", "Upload de captures", "P1",
     "Vérifier l'ajout de fichiers/photos associés à une saisie",
     "Saisie en cours sur le terrain", "Ajouter une ou plusieurs captures (photos)",
     "Fichiers stockés et liés à la saisie", "Réf. originale : GSM-04"),
    ("AGT-T-19", "Présence et planning", "Heartbeat de présence (terrain)", "P0",
     "Vérifier la mise à jour du statut de présence depuis le terrain",
     "Agent terrain connecté sur mobile", "Envoyer un heartbeat depuis l'application mobile",
     "Statut mis à jour avec horodatage", "Réf. originale : PRE-01"),
    ("AGT-T-20", "Présence et planning", "Changement de statut (terrain)", "P1",
     "Vérifier la modification manuelle du statut de présence",
     "Agent terrain connecté", "Changer le statut depuis l'application mobile",
     "Nouveau statut visible dans le tableau de bord", "Réf. originale : PRE-02"),
    ("AGT-T-21", "Présence et planning", "Statut hors ligne / reconnexion mobile", "P1",
     "Vérifier qu'un agent perdu de réseau ne reste pas marqué comme actif sans raison",
     "Agent mobile connecté puis réseau coupé", "Couper puis rétablir le réseau, attendre le heartbeat/reconnect",
     "Le système ajuste le statut sans données incohérentes ni faux positifs", "Disponibilité mobile"),
    ("AGT-T-22", "Réseau / robustesse", "Coupure réseau pendant upload", "P0",
     "Vérifier la reprise d'un upload interrompu ou la gestion explicite de l'échec",
     "Fichier photo ou dossier en cours de soumission", "Couper le réseau pendant l'envoi, rétablir, relancer la soumission",
     "Le système n'envoie pas de données partielles corrompues et propose une reprise claire", "Réseau / résilience"),
    ("AGT-T-23", "Réseau / robustesse", "Timeout d'API / retour faible", "P1",
     "Vérifier le comportement sur réseau lent ou instable",
     "Mobile en 3G / 4G faible", "Lancer un OCR, un upload et une validation complète",
     "Messages de chargement sont corrects et le système ne se bloque pas", "Qualité réseau"),
    ("AGT-T-24", "Réseau / robustesse", "App en arrière-plan / reprise", "P1",
     "Vérifier la reprise de l'application après mise en pause ou fermeture",
     "Session active sur mobile", "Mettre l'application en arrière-plan, la réouvrir plus tard",
     "L'utilisateur retrouve l'état correct et le flux de travail reprend sans corruption", "UX / reprise"),
    ("AGT-T-25", "GSM / Gross Add", "Consultation des stats personnelles", "P1",
     "Vérifier les indicateurs de performance de l'agent terrain",
     "Agent terrain connecté", "Ouvrir la vue stats / tableau personnel",
     "Statistiques calculées correctement", "Réf. originale : GSM-05"),
]

AGENT_BACKOFFICE = [
    ("AGT-B-01", "Authentification et sécurité", "Connexion valide (web)", "P0",
     "Vérifier qu'un agent backoffice peut se connecter sur le frontend web",
     "Compte agent actif (AG001)", "Saisir identifiant et mot de passe valides sur le frontend web",
     "Connexion réussie, token généré, redirection vers le tableau agent", "Réf. originale : AUTH-01"),
    ("AGT-B-02", "Authentification et sécurité", "Connexion invalide (web)", "P0",
     "Vérifier la gestion des identifiants incorrects sur le web",
     "Compte agent existant", "Saisir un mot de passe erroné sur le frontend web",
     "Erreur affichée, aucune session créée", "Réf. originale : AUTH-02"),
    ("AGT-B-03", "Authentification et sécurité", "Déconnexion (web)", "P0",
     "Vérifier la fin de session sur le frontend web",
     "Agent backoffice connecté", "Cliquer sur déconnexion",
     "Session terminée, accès refusé après déconnexion", "Réf. originale : AUTH-03"),
    ("AGT-B-04", "Authentification et sécurité", "Changement de mot de passe (web)", "P1",
     "Vérifier la mise à jour du mot de passe depuis le frontend web",
     "Agent backoffice connecté", "Changer le mot de passe via l'interface web",
     "Mot de passe modifié, nouvelle connexion possible", "Réf. originale : AUTH-04"),
    ("AGT-B-05", "Authentification et sécurité", "Vérification des droits (accès admin refusé)", "P0",
     "Vérifier qu'un agent backoffice ne peut pas accéder aux routes admin",
     "Compte agent connecté", "Tenter d'accéder à une page réservée admin",
     "Accès refusé avec message approprié", "Réf. originale : AUTH-05"),
    ("AGT-B-06", "Gestion des dossiers", "Liste des dossiers", "P0",
     "Vérifier l'affichage de la file de dossiers à traiter",
     "Agent backoffice connecté avec droits", "Ouvrir la liste des dossiers",
     "Liste chargée, filtres fonctionnels", "Réf. originale : DOS-01"),
    ("AGT-B-07", "Gestion des dossiers", "Prendre en charge un dossier", "P0",
     "Vérifier la prise en charge d'un dossier par l'agent backoffice",
     "Dossier disponible", "Cliquer sur « Prendre »",
     "Statut mis à jour, dossier assigné à l'agent", "Réf. originale : DOS-02"),
    ("AGT-B-08", "Gestion des dossiers", "Accepter un dossier", "P0",
     "Vérifier l'acceptation du dossier",
     "Dossier pris en charge", "Cliquer sur « Accepter »",
     "Dossier passé au statut accepté", "Réf. originale : DOS-03"),
    ("AGT-B-09", "Gestion des dossiers", "Rejeter un dossier", "P0",
     "Vérifier le rejet du dossier",
     "Dossier pris en charge", "Cliquer sur « Rejeter »",
     "Dossier passé au statut rejeté avec motif si applicable", "Réf. originale : DOS-04"),
    ("AGT-B-10", "Gestion des dossiers", "Vérification du détail d'un dossier", "P0",
     "Vérifier l'ouverture de la fiche détaillée depuis le backoffice",
     "Dossier existant", "Ouvrir un dossier depuis la liste",
     "Toutes les informations affichées correctement", "Réf. originale : DOS-06"),
    ("AGT-B-11", "Gestion des dossiers", "Accès aux photos", "P1",
     "Vérifier l'accès sécurisé aux photos du dossier",
     "Dossier avec photo", "Ouvrir la photo via l'API depuis le backoffice",
     "Photo affichée ou bloquée selon les droits", "Réf. originale : DOS-07"),
    ("AGT-B-12", "Gestion des dossiers", "Relecture de dossier avec données OCR", "P1",
     "Vérifier que les champs préremplis issus de l'OCR peuvent être corrigés et validés",
     "Dossier avec extraction automatique partielle", "Ouvrir le dossier et corriger les champs suspects",
     "Les changements sont enregistrés et visibles dans l'historique ou le dossier final", "Contrôle qualité dossier"),
    ("AGT-B-13", "Gestion des dossiers", "Transfert de dossier en double ou collision", "P1",
     "Vérifier la gestion d'un transfert concurrent ou d'une clé de dossier déjà attribuée",
     "Dossier déjà attribué ou en cours de traitement", "Tenter un transfert ou une seconde attribution simultanée",
     "Le système empêche la collision, garde l'attribution finale cohérente et affiche le bon message", "Concurrence / robustesse"),
    ("AGT-B-14", "Vérification faciale et liveness", "Résultat de session liveness", "P0",
     "Vérifier la récupération du résultat liveness par l'agent backoffice",
     "Session liveness créée", "Récupérer le résultat depuis l'interface web",
     "Résultat traité et enregistré en base", "Réf. originale : LIV-02"),
    ("AGT-B-15", "Vérification faciale et liveness", "Redirection web liveness", "P1",
     "Vérifier l'ouverture de la page web de vérification",
     "URL de test renseignée", "Ouvrir /liveness-check?dossierId=...",
     "Page web s'affiche et initie la procédure", "Réf. originale : LIV-03"),
    ("AGT-B-16", "Vérification faciale et liveness", "Appel vidéo interne", "P0",
     "Vérifier le flux interne d'appel vidéo entre l'agent backoffice et l'autre acteur",
     "Backend démarré, signalisation disponible",
     "Exécuter le scénario d'appel vidéo depuis l'interface backoffice, puis valider réception, connexion et fin d'appel",
     "L'appel vidéo se déroule correctement, la connexion est établie, les statuts évoluent correctement et la session se termine proprement",
     "Réf. originale : LIV-05"),
    ("AGT-B-17", "Vérification faciale et liveness", "Appel entrant / perte de connexion / reprise", "P1",
     "Vérifier la reprise d'un appel vidéo après coupure ou re-register",
     "Appel en cours, réseau instable", "Casser temporairement la WS / réseau puis reprendre l'appel",
     "L'appel se reconnecte proprement ou se termine avec un message explicite sans rester bloqué", "Signalisation / pont de voix"),
    ("AGT-B-18", "Présence et planning", "Accès à la file de disponibilité", "P1",
     "Vérifier l'affichage de disponibilité et d'activité des agents",
     "Superviseur ou agent connecté", "Ouvrir le tableau de présence et de disponibilité",
     "Les statuts sont synchronisés et cohérents", "Disponibilité / supervision"),
    ("AGT-B-19", "Administration et configuration", "Rôle / droits écran web", "P1",
     "Vérifier que chaque écran web est visible uniquement sur les profils autorisés",
     "Agent connecté puis admin connecté", "Essayer d'ouvrir une écrans de supervision/admin depuis un mauvais rôle",
     "Accès refusé sans fuite d'information", "Sécurité / permissions"),
]

SUPERVISEUR = [
    ("SUP-01", "Authentification et sécurité", "Connexion valide", "P0",
     "Vérifier qu'un superviseur peut se connecter",
     "Compte superviseur actif (SUP001)", "Saisir identifiant et mot de passe valides",
     "Connexion réussie, token généré, redirection vers le tableau superviseur", "Réf. originale : AUTH-01"),
    ("SUP-02", "Authentification et sécurité", "Déconnexion", "P0",
     "Vérifier la fin de session superviseur",
     "Superviseur connecté", "Cliquer sur déconnexion",
     "Session terminée, accès refusé après déconnexion", "Réf. originale : AUTH-03"),
    ("SUP-03", "Gestion des dossiers", "Transférer un dossier", "P1",
     "Vérifier la logique de transfert d'un dossier vers un autre agent",
     "Droits superviseur", "Sélectionner un dossier et un destinataire",
     "Dossier transféré et visible par le bon utilisateur", "Réf. originale : DOS-05"),
    ("SUP-04", "Gestion des dossiers", "Alerte superviseur / remise à zéro", "P0",
     "Vérifier que les alertes du superviseur sont réinitialisées à chaque nouvelle attribution",
     "Un dossier est attribué et une alerte supervisée existe", "Réaliser une nouvelle attribution ou un transfert de dossier",
     "Le champ alerte_superviseur_le est remis à NULL correctement et ne reste pas contaminé", "Conformité données / verrou"),
    ("SUP-05", "Présence et planning", "Résumé de présence", "P1",
     "Vérifier les compteurs de présence agrégés des agents",
     "Droits superviseur", "Ouvrir la vue de résumé de présence",
     "Données agrégées correctes", "Réf. originale : PRE-03"),
    ("SUP-06", "Présence et planning", "Consultation du planning", "P1",
     "Vérifier l'affichage du planning des agents",
     "Superviseur autorisé", "Ouvrir le planning",
     "Planning affiché et cohérent", "Réf. originale : PLA-01"),
    ("SUP-07", "Présence et planning", "Import de planning", "P1",
     "Vérifier l'import d'un fichier/JSON de planning",
     "Droits superviseur", "Importer un planning de test",
     "Données importées sans corruption", "Réf. originale : PLA-02"),
    ("SUP-08", "Présence et planning", "Consultation des notes qualité", "P1",
     "Vérifier l'accès du superviseur aux notes qualité des agents",
     "Droits superviseur", "Ouvrir la page notes qualité",
     "Notes affichées correctement", "Réf. originale : NQ-01"),
    ("SUP-09", "Gestion des dossiers", "Contrôle de la file de travail", "P1",
     "Vérifier le contrôle du backlog et la ventilation par agent",
     "Plusieurs dossiers et agents disponibles", "Afficher la file globale et filtrar par agent / statut",
     "Les volumes et répartitions sont cohérents et corrélés aux affectations", "Pilotage opérationnel"),
    ("SUP-10", "Gestion des dossiers", "Escalade / pointage / signalement", "P1",
     "Vérifier l'alerte ou la signalisation d'un incident ou d'un dossier bloqué",
     "Dossier bloqué ou non traité depuis longtemps", "Déclencher l'alerte ou visualiser un signalement",
     "Le cas est visible, traçable et exploitable pour la supervision", "Supervision / escalade"),
]

ADMIN = [
    ("ADM-01", "Authentification et sécurité", "Connexion valide", "P0",
     "Vérifier qu'un administrateur peut se connecter",
     "Compte admin actif (ADM002)", "Saisir identifiant et mot de passe valides",
     "Connexion réussie, token généré, redirection vers le tableau admin", "Réf. originale : AUTH-01"),
    ("ADM-02", "Authentification et sécurité", "Verrouillage après tentatives répétées", "P1",
     "Vérifier le mécanisme de verrouillage de compte",
     "Compte standard ciblé", "Répéter des connexions erronées jusqu'au seuil",
     "Compte verrouillé après seuil défini", "Réf. originale : AUTH-06"),
    ("ADM-03", "Administration et configuration", "Création d'un compte utilisateur", "P0",
     "Vérifier la création d'un utilisateur via l'admin",
     "Admin connecté", "Créer un nouvel utilisateur (rôle, identifiant, mot de passe)",
     "Compte créé avec bon rôle et mot de passe initial", "Réf. originale : ADM-01"),
    ("ADM-04", "Administration et configuration", "Réinitialisation du mot de passe", "P1",
     "Vérifier le reset du mot de passe d'un utilisateur",
     "Utilisateur existant", "Exécuter la réinitialisation depuis l'admin",
     "Nouveau mot de passe défini et fonctionnel", "Réf. originale : ADM-02"),
    ("ADM-05", "Administration et configuration", "Bloquage / déblocage de compte", "P1",
     "Vérifier la désactivation temporaire d'un compte utilisateur",
     "Compte actif existant", "Bloquer, puis débloquer le compte depuis l'administration",
     "Le compte répond correctement à la politique de sécurité active / inactive", "Sécurité compte"),
    ("ADM-06", "Administration et configuration", "Configuration du mode de distribution", "P1",
     "Vérifier la mise à jour du mode de distribution des dossiers",
     "Admin connecté", "Modifier la configuration",
     "Nouvelle valeur sauvegardée", "Réf. originale : ADM-03"),
    ("ADM-07", "Administration et configuration", "Configuration seuil d'alerte", "P1",
     "Vérifier la sauvegarde du seuil d'alerte",
     "Admin connecté", "Modifier le seuil",
     "Seuil correctement enregistré", "Réf. originale : ADM-04"),
    ("ADM-08", "Administration et configuration", "Purge de données", "P1",
     "Vérifier la purge avec aperçu",
     "Admin connecté", "Exécuter l'aperçu puis la purge",
     "Données purgées selon les règles", "Réf. originale : ADM-05"),
    ("ADM-09", "Administration et configuration", "Audit et journal", "P1",
     "Vérifier la traçabilité des actions sensibles",
     "Admin connecté", "Consulter l'audit",
     "Événements correctement enregistrés", "Réf. originale : ADM-06"),
    ("ADM-10", "Administration et configuration", "Restauration de configuration / rollback", "P1",
     "Vérifier la récupération d'une version antérieure des paramètres applicatifs",
     "Modifs de configuration déjà faites", "Sélectionner un paramètre et restaurer une valeur précédente",
     "L'état est cohérent et traçable", "Gestion config / rollback"),
    ("ADM-11", "Intégration API et robustesse", "Validation des entrées", "P0",
     "Vérifier la validation des champs obligatoires sur l'API",
     "Appel API avec données incomplètes", "Soumettre un payload invalide",
     "Erreur métier ou validation retournée", "Réf. originale : API-01"),
    ("ADM-12", "Intégration API et robustesse", "Gestion des erreurs 404/500", "P1",
     "Vérifier la réponse correcte aux routes inexistantes ou erreurs serveur",
     "Appel à une route inexistante", "Exécuter la requête",
     "Réponse structurée avec message clair", "Réf. originale : API-02"),
    ("ADM-13", "Intégration API et robustesse", "Limitation de débit", "P1",
     "Vérifier le rate limiting de l'API",
     "Utilisateur connecté", "Répéter rapidement les requêtes",
     "Limitation appliquée si seuil dépassé", "Réf. originale : API-03"),
    ("ADM-14", "Intégration API et robustesse", "Autorisation sur route publique", "P0",
     "Vérifier le contrôle d'accès des routes publiques",
     "Sans authentification", "Appeler une route publique attendue",
     "Réponse conforme aux règles", "Réf. originale : API-04"),
    ("ADM-15", "Intégration API et robustesse", "Sécurité des fichiers / téléchargement", "P1",
     "Vérifier que les pièces jointes et documents ne sont pas exploités sans contrôle",
     "Documents et URLs de téléchargement disponibles", "Tester les téléchargements sans role ou avec role insuffisant",
     "Le système bloque tout accès non autorisé et renvoie une réponse sécurisée", "Sécurité fichiers"),
    ("ADM-16", "Intégration API et robustesse", "Cadrage complet des logs et traces", "P1",
     "Vérifier la traçabilité des opérations importantes sans divulguer de données sensibles",
     "Événements métier et erreurs", "Lancer des actions critiques et consulter les logs",
     "Les traces sont exploitables et les données sensibles sont bien masquées", "Audit / observabilité"),
]

UTILISATEUR_PUBLIC = [
    ("PUB-01", "Parcours public / onboarding", "Accès au formulaire public", "P0",
     "Vérifier que le public peut ouvrir le parcours de KYC sans authentification",
     "Aucun compte utilisateur requis", "Ouvrir le formulaire public depuis le site web ou le lien fourni",
     "La page s'affiche correctement et le parcours démarre sans erreur", "Cité / onboarding public"),
    ("PUB-02", "Parcours public / onboarding", "Saisie des données personnelles", "P0",
     "Vérifier la collecte correcte des infos de base du public",
     "Formulaire public ouvert", "Saisir nom, prénom, email, téléphone, pièce d'identité, consentements",
     "Les informations sont validées, enregistrées et visibles dans le dossier associé", "Données déclaratives"),
    ("PUB-03", "Parcours public / onboarding", "Validation des champs obligatoires", "P0",
     "Vérifier le blocage des champs incomplets ou invalides pour le public",
     "Formulaire public démarré", "Soumettre avec des champs vides, dates invalides, formats incorrects",
     "Des messages contextuels clairs apparaissent et le formulaire reste bloqué", "Validation UX"),
    ("PUB-04", "Parcours public / onboarding", "Consentement et politique de confidentialité", "P0",
     "Vérifier la collecte explicite du consentement utilisateur public",
     "Utilisateur public sur le formulaire", "Accepter ou refuser les conditions, puis valider la soumission",
     "Le consentement est sauvegardé et les règles d'usage correspondent au choix effectué", "RGPD / consentement"),
    ("PUB-05", "Parcours public / onboarding", "Upload photo CNI / document", "P0",
     "Vérifier l’upload du document public côté web/mobile",
     "Parcours public en cours", "Téléverser le recto, verso et/ou document de support",
     "Le document est bien stocké, associé à la demande et visible dans le dossier", "Upload document public"),
    ("PUB-06", "Parcours public / onboarding", "OCR du document public", "P1",
     "Vérifier l'extraction automatique des informations sur le document public",
     "Document de type pièce d'identité valide", "Lancer l'OCR et contrôler les champs préremplis",
     "Les données extraites sont cohérentes et peuvent être validées ou corrigées", "Extraction / qualité donnée"),
    ("PUB-07", "Parcours public / onboarding", "Fallback OCR public / saisie manuelle", "P1",
     "Vérifier le comportement si l'OCR public ne fonctionne pas",
     "Service OCR indisponible ou document illisible", "Tenter l'OCR puis passer en saisie manuelle",
     "Le public reste en capacité de finaliser sa déclaration sans blocage", "Fallback UX"),
    ("PUB-08", "Vérification faciale et liveness", "Capture selfie / selfie liveness public", "P0",
     "Vérifier la capture de selfie et la vérification faciale pour le public",
     "Formulaire public prêt", "Lancer la capture selfie ou le liveness public",
     "La capture est réussie, enregistrée et associée au dossier", "Liveness public"),
    ("PUB-09", "Vérification faciale et liveness", "Échec liveness public / mauvaise qualité", "P1",
     "Vérifier le cas d'échec de vérification faciale pour le public",
     "Capture liveness problématique", "Tenter un selfie avec mauvais éclairage, masque, mouvement ou angle", 
     "Le système refuse la capture avec un message utile et propose une nouvelle tentative", "Qualité / rejet"),
    ("PUB-10", "Parcours public / onboarding", "Soumission finale et validation", "P0",
     "Vérifier la soumission d'une demande complète côté public",
     "Formulaire public rempli et documents joints", "Valider la demande finale",
     "Le dossier est transmis au backend, marqué en attente et visible par les agents concernés", "Soumission finale"),
    ("PUB-11", "Parcours public / onboarding", "Soumission en double / idempotence", "P1",
     "Vérifier que le public ne peut pas envoyer plusieurs fois le même dossier par erreur",
     "Même demande ou multiple clics sur soumettre", "Valider deux fois la même demande ou relancer après retour réseau",
     "Le système évite le doublon ou affiche un message de duplication détectée", "Idempotence / doublon"),
    ("PUB-12", "Parcours public / onboarding", "Réseau faible pendant soumission", "P0",
     "Vérifier le comportement du public avec connexion instable pendant la finalisation",
     "Public en cours de soumission sur réseau lent", "Couper le réseau pendant l'envoi puis réessayer",
     "La demande est sauvegardée ou bien une erreur explicite est remontée sans corruption de dossier", "Réseau public"),
    ("PUB-13", "Parcours public / onboarding", "Retour après interruption", "P1",
     "Vérifier la reprise d'un parcours public interrompu",
     "Formulaire public partiellement rempli", "Fermer la page, la réouvrir ou revenir au lien", 
     "Les données déjà saisies sont restaurées ou l'état est signalé clairement sans perte sérieuse", "Récupération public"),
    ("PUB-14", "Parcours public / onboarding", "Abandon du parcours / annulation", "P1",
     "Vérifier le comportement lors d'un abandon du parcours public",
     "Parcours public en cours", "Cliquer sur Annuler / revenir en arrière / fermer la page",
     "L'état du dossier est cohérent, aucun dossier fantôme n'est créé en arrière-plan", "Abandon / sécurité"),
    ("PUB-15", "Sécurité / confidentialité", "Contrôle d’accès route publique", "P0",
     "Vérifier que les routes publiques n'exposent pas des données sensibles",
     "Aucune session authentifiée", "Tenter d'accéder à des données internes ou à un dossier sans autorisation",
     "Réponse refusée ou vide selon les règles de sécurité", "Sécurité publique"),
    ("PUB-16", "Sécurité / confidentialité", "Données sensibles masquées", "P1",
     "Vérifier que les données sensibles sont masquées dans les écrans publics et logs",
     "Parcours public et données de test", "Vérifier les contenus affichés et journaux d'erreur",
     "Aucune donnée confidentielle n'apparaît en clair dans les messages d'erreur, logs ou interfaces publiques", "Confidentialité"),
]

ROLE_BLOCKS = [
    ("Agent de terrain (application mobile)", AGENT_TERRAIN),
    ("Agent backoffice (frontend web)", AGENT_BACKOFFICE),
    ("Superviseur", SUPERVISEUR),
    ("Administrateur", ADMIN),
    ("Utilisateur public", UTILISATEUR_PUBLIC),
]

ROLE_FILL = {
    "Agent de terrain (application mobile)": "FFD9EAD3",
    "Agent backoffice (frontend web)": "FFCFE2F3",
    "Superviseur": "FFD9D2E9",
    "Administrateur": "FFF4CCCC",
    "Utilisateur public": "FFF2CC",
}

CATEGORIES = [
    "Authentification et sécurité",
    "Gestion des dossiers",
    "Vérification faciale et liveness",
    "GSM / Gross Add",
    "Présence et planning",
    "Administration et configuration",
    "Intégration API et robustesse",
    "Parcours public / onboarding",
    "Sécurité / confidentialité",
    "Réseau / robustesse",
]

TOTAL_TESTS = sum(len(tests) for _, tests in ROLE_BLOCKS)


# ======================================================================
# ÉTAPE 1 — Reconstruire l'onglet "Cas de tests"
# ======================================================================
def build_cas_de_tests(wb):
    ws = wb["Cas de tests"]

    for rng in list(ws.merged_cells.ranges):
        ws.unmerge_cells(str(rng))

    for r in range(1, max(ws.max_row, 60) + 1):
        for c in range(1, max(ws.max_column, 11) + 1):
            cell = ws.cell(row=r, column=c)
            cell.value = None
            cell.fill = PatternFill(fill_type=None)

    ws.data_validations.dataValidation = []
    ws.conditional_formatting._cf_rules = {}

    widths = {"A": 12, "B": 20, "C": 24, "D": 30, "E": 9, "F": 32,
              "G": 26, "H": 32, "I": 36, "J": 15, "K": 26}
    for col, w in widths.items():
        ws.column_dimensions[col].width = w

    font_data = Font(name=FONT, size=10)
    font_data_bold = Font(name=FONT, size=10, bold=True)
    font_header = Font(name=FONT, size=10, bold=True, color=WHITE)
    font_title = Font(name=FONT, size=16, bold=True, color=WHITE)

    HEADERS = ["ID", "Rôle utilisateur", "Catégorie", "Fonction", "Priorité", "Objectif",
               "Préconditions", "Étapes", "Résultat attendu", "Statut", "Commentaires / Bug lié"]

    # Titre
    ws.merge_cells("A1:K1")
    ws.row_dimensions[1].height = 33.75
    c = ws.cell(row=1, column=1, value="8. CAS DE TESTS DÉTAILLÉS — ORGANISÉS PAR PROFIL UTILISATEUR")
    c.font = font_title
    c.fill = PatternFill(fill_type="solid", fgColor=NAVY)
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1)

    # Sous-titre
    ws.merge_cells("A2:K2")
    ws.row_dimensions[2].height = 20
    profil_count = len(ROLE_BLOCKS)
    c = ws.cell(row=2, column=1,
                value=f"Ordre de lecture : Agent de terrain (mobile) -> Agent backoffice (web) -> "
                      f"Superviseur -> Administrateur -> Utilisateur public. {TOTAL_TESTS} cas de tests au total, "
                      f"réattribués et recontextualisés selon le rôle qui exécute l'action ({profil_count} profils).")
    c.font = Font(name=FONT, size=9, italic=True, color="FF595959")
    c.fill = PatternFill(fill_type="solid", fgColor=GRAY_BG)
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1)

    # En-têtes de colonnes
    HEADER_ROW = 3
    ws.row_dimensions[HEADER_ROW].height = 31.5
    for idx, htext in enumerate(HEADERS, start=1):
        c = ws.cell(row=HEADER_ROW, column=idx, value=htext)
        c.font = font_header
        c.fill = PatternFill(fill_type="solid", fgColor=BLUE)
        c.alignment = ALIGN_CENTER
        c.border = BORDER

    row = HEADER_ROW + 1
    first_data_row = row

    for role_name, tests in ROLE_BLOCKS:
        fill_color = ROLE_FILL[role_name]
        for i, t in enumerate(tests):
            if len(t) == 8:
                tid, cat, fonction, prio, objectif, precond, etapes, resultat = t
                comment = ""
            else:
                tid, cat, fonction, prio, objectif, precond, etapes, resultat, comment = t
            values = [tid, role_name, cat, fonction, prio, objectif, precond, etapes,
                      resultat, "À exécuter", comment]
            ws.row_dimensions[row].height = 60
            for col_idx, val in enumerate(values, start=1):
                cell = ws.cell(row=row, column=col_idx, value=val)
                cell.font = font_data_bold if col_idx == 1 else font_data
                cell.border = BORDER_GROUP_TOP if i == 0 else BORDER
                if col_idx in (1, 5, 10):
                    cell.alignment = ALIGN_CENTER
                elif col_idx == 2:
                    cell.alignment = ALIGN_CENTER
                    cell.fill = PatternFill(fill_type="solid", fgColor=fill_color)
                else:
                    cell.alignment = ALIGN_LEFT
            row += 1

    last_data_row = row - 1

    ws.freeze_panes = f"A{HEADER_ROW + 1}"

    dv_prio = DataValidation(type="list", formula1='"P0,P1,P2"', allow_blank=True)
    dv_prio.add(f"E{first_data_row}:E{last_data_row}")
    ws.add_data_validation(dv_prio)

    dv_statut = DataValidation(type="list",
                                formula1='"À exécuter,Réussi,Échoué,Bloqué,Non applicable"',
                                allow_blank=True)
    dv_statut.add(f"J{first_data_row}:J{last_data_row}")
    ws.add_data_validation(dv_statut)

    rng_prio = f"E{first_data_row}:E{last_data_row}"
    ws.conditional_formatting.add(rng_prio, CellIsRule(operator="equal", formula=['"P0"'],
        fill=PatternFill(start_color="FFF8CBAD", end_color="FFF8CBAD", fill_type="solid")))
    ws.conditional_formatting.add(rng_prio, CellIsRule(operator="equal", formula=['"P1"'],
        fill=PatternFill(start_color="FFFFE699", end_color="FFFFE699", fill_type="solid")))
    ws.conditional_formatting.add(rng_prio, CellIsRule(operator="equal", formula=['"P2"'],
        fill=PatternFill(start_color="FFC6E0B4", end_color="FFC6E0B4", fill_type="solid")))

    rng_statut = f"J{first_data_row}:J{last_data_row}"
    ws.conditional_formatting.add(rng_statut, CellIsRule(operator="equal", formula=['"À exécuter"'],
        fill=PatternFill(start_color="FFD9D9D9", end_color="FFD9D9D9", fill_type="solid")))
    ws.conditional_formatting.add(rng_statut, CellIsRule(operator="equal", formula=['"Réussi"'],
        fill=PatternFill(start_color="FFC6E0B4", end_color="FFC6E0B4", fill_type="solid")))
    ws.conditional_formatting.add(rng_statut, CellIsRule(operator="equal", formula=['"Échoué"'],
        fill=PatternFill(start_color="FFF8CBAD", end_color="FFF8CBAD", fill_type="solid")))
    ws.conditional_formatting.add(rng_statut, CellIsRule(operator="equal", formula=['"Bloqué"'],
        fill=PatternFill(start_color="FFFFD966", end_color="FFFFD966", fill_type="solid")))
    ws.conditional_formatting.add(rng_statut, CellIsRule(operator="equal", formula=['"Non applicable"'],
        fill=PatternFill(start_color="FFBFBFBF", end_color="FFBFBFBF", fill_type="solid")))

    ws.sheet_view.showGridLines = False
    # vue propre : on repart du coin A1, aucune ligne cachée derrière le volet figé
    ws.sheet_view.topLeftCell = "A1"
    ws.sheet_view.selection[0].activeCell = "A1"
    ws.sheet_view.selection[0].sqref = "A1"

    return first_data_row, last_data_row


# ======================================================================
# ÉTAPE 2 — Mettre à jour "Environnements & rôles" et "Données de test"
# ======================================================================
def update_roles_and_data_sheets(wb):
    ws = wb["Environnements & rôles"]
    ws.insert_rows(22)  # fait de la place pour scinder Agent en 2 lignes

    def style_role_row(row, role, desc):
        ws.merge_cells(f"B{row}:D{row}")
        a = ws.cell(row=row, column=1, value=role)
        a.font = Font(name=FONT, size=10)
        a.border = BORDER
        b = ws.cell(row=row, column=2, value=desc)
        b.font = Font(name=FONT, size=10)
        b.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
        b.border = BORDER
        for col in (3, 4):
            ws.cell(row=row, column=col).border = BORDER
        ws.row_dimensions[row].height = 15

    style_role_row(21, "Agent de terrain",
                    "Acquisition mobile : création de dossier, capture photo/CNI, liveness, "
                    "saisie GSM, présence (compte AG001 sur application mobile)")
    style_role_row(22, "Agent backoffice",
                    "Traitement web post-acquisition : prise en charge, acceptation/rejet, "
                    "transfert, consultation dossiers, appel vidéo (compte AG001 sur frontend web)")
    style_role_row(23, "Utilisateur public", "Dépôt terrain, liveness session")

    ws["A15"] = "☐ Comptes de test disponibles : admin, superviseur, agent (terrain & backoffice)"

    ws2 = wb["Données de test"]
    ws2.insert_rows(8)  # duplique la ligne Agent (7) en 2 lignes (7 et 8)

    def style_account_row(row, role, ident, pwd):
        for col, val in zip((1, 2, 3), (role, ident, pwd)):
            c = ws2.cell(row=row, column=col, value=val)
            c.font = Font(name=FONT, size=10)
            c.border = BORDER
            c.alignment = Alignment(horizontal="left", vertical="center")

    style_account_row(7, "Agent (terrain - mobile)", "AG001", "KYCAG001#Reset")
    style_account_row(8, "Agent (backoffice - web)", "AG001", "KYCAG001#Reset")
    ws2.cell(row=8, column=2).comment = Comment(
        "Même compte AG001 utilisé dans les deux contextes (mobile et web). "
        "À adapter si des comptes distincts sont créés pour chaque usage.",
        "Cahier de tests")


# ======================================================================
# ÉTAPE 3 — Reconstruire le "Tableau de bord"
# ======================================================================
def build_dashboard(wb, data_first, data_last):
    ws = wb["Tableau de bord"]

    for rng in list(ws.merged_cells.ranges):
        ws.unmerge_cells(str(rng))
    for r in range(1, 60):
        for c in range(1, 12):
            cell = ws.cell(row=r, column=c)
            cell.value = None
            cell.fill = PatternFill(fill_type=None)
            cell.border = Border()
    ws.conditional_formatting._cf_rules = {}

    widths = {"A": 26, "B": 13, "C": 13, "D": 13, "E": 13, "F": 13, "G": 13, "H": 15}
    for col, w in widths.items():
        ws.column_dimensions[col].width = w

    # Titre
    ws.merge_cells("A1:H1")
    ws.row_dimensions[1].height = 34
    c = ws.cell(row=1, column=1, value="TABLEAU DE BORD — SUIVI D'EXÉCUTION")
    c.font = Font(name=FONT, size=16, bold=True, color=WHITE)
    c.fill = PatternFill(fill_type="solid", fgColor=NAVY)
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1)

    ws.merge_cells("A2:H2")
    ws.row_dimensions[2].height = 18
    c = ws.cell(row=2, column=1,
                value=f"Mise à jour automatique — {TOTAL_TESTS} cas de tests répartis sur {len(ROLE_BLOCKS)} profils "
                      f"utilisateur ({', '.join(role for role, _ in ROLE_BLOCKS)})")
    c.font = Font(name=FONT, size=9, italic=True, color="FF595959")
    c.fill = PatternFill(fill_type="solid", fgColor=GRAY_BG)
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1)

    # KPI - synthèse globale
    ws.merge_cells("A4:H4")
    ws.row_dimensions[4].height = 22
    c = ws.cell(row=4, column=1, value="SYNTHÈSE GLOBALE")
    c.font = Font(name=FONT, size=11, bold=True, color=WHITE)
    c.fill = PatternFill(fill_type="solid", fgColor=BLUE)
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1)

    kpis = [
        ("Total tests", f"=COUNTA({CT}!A{data_first}:A{data_last})", "FF1F3864"),
        ("Tests P0", f'=COUNTIF({CT}!E{data_first}:E{data_last},"P0")', "FFC00000"),
        ("Tests P1", f'=COUNTIF({CT}!E{data_first}:E{data_last},"P1")', "FFBF8F00"),
        ("Tests P2", f'=COUNTIF({CT}!E{data_first}:E{data_last},"P2")', "FF548235"),
        ("Réussis", f'=COUNTIF({CT}!J{data_first}:J{data_last},"Réussi")', "FF548235"),
        ("Échoués", f'=COUNTIF({CT}!J{data_first}:J{data_last},"Échoué")', "FFC00000"),
        ("Bloqués", f'=COUNTIF({CT}!J{data_first}:J{data_last},"Bloqué")', "FFBF8F00"),
        ("À exécuter", f'=COUNTIF({CT}!J{data_first}:J{data_last},"À exécuter")', "FF595959"),
    ]
    ws.row_dimensions[6].height = 16
    ws.row_dimensions[7].height = 30
    for i, (label, formula, color) in enumerate(kpis):
        col = i + 1
        lbl = ws.cell(row=6, column=col, value=label)
        lbl.font = Font(name=FONT, size=9, bold=True, color=WHITE)
        lbl.fill = PatternFill(fill_type="solid", fgColor=color)
        lbl.alignment = Alignment(horizontal="center", vertical="center")
        lbl.border = BORDER
        val = ws.cell(row=7, column=col, value=formula)
        val.font = Font(name=FONT, size=16, bold=True, color=color)
        val.fill = PatternFill(fill_type="solid", fgColor="FFFAFAFA")
        val.alignment = Alignment(horizontal="center", vertical="center")
        val.border = BORDER

    ws.row_dimensions[9].height = 16
    ws.row_dimensions[10].height = 26
    taux = [
        ("Taux de réussite global",
         f'=IFERROR(COUNTIF({CT}!J{data_first}:J{data_last},"Réussi")/COUNTA({CT}!A{data_first}:A{data_last}),0)'),
        ("Taux de réussite P0",
         f'=IFERROR(COUNTIFS({CT}!E{data_first}:E{data_last},"P0",{CT}!J{data_first}:J{data_last},"Réussi")'
         f'/COUNTIF({CT}!E{data_first}:E{data_last},"P0"),0)'),
        ("Non applicables", f'=COUNTIF({CT}!J{data_first}:J{data_last},"Non applicable")'),
    ]
    for i, (label, formula) in enumerate(taux):
        col = i + 1
        lbl = ws.cell(row=9, column=col, value=label)
        lbl.font = Font(name=FONT, size=9, bold=True, color=WHITE)
        lbl.fill = PatternFill(fill_type="solid", fgColor=NAVY)
        lbl.alignment = Alignment(horizontal="center", vertical="center")
        lbl.border = BORDER
        val = ws.cell(row=10, column=col, value=formula)
        val.font = Font(name=FONT, size=14, bold=True, color=NAVY)
        val.fill = PatternFill(fill_type="solid", fgColor="FFFAFAFA")
        val.alignment = Alignment(horizontal="center", vertical="center")
        val.border = BORDER
        if "Taux" in label:
            val.number_format = "0.0%"

    # Répartition par profil utilisateur
    ROW_ROLE_TITLE = 12
    ws.merge_cells(f"A{ROW_ROLE_TITLE}:H{ROW_ROLE_TITLE}")
    ws.row_dimensions[ROW_ROLE_TITLE].height = 22
    c = ws.cell(row=ROW_ROLE_TITLE, column=1, value="RÉPARTITION PAR PROFIL UTILISATEUR")
    c.font = Font(name=FONT, size=11, bold=True, color=WHITE)
    c.fill = PatternFill(fill_type="solid", fgColor=BLUE)
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1)

    ROW_ROLE_HDR = ROW_ROLE_TITLE + 1
    role_headers = ["Rôle utilisateur", "Total", "P0", "Réussis", "Échoués", "Bloqués",
                     "À exécuter", "Taux réussite"]
    for i, h in enumerate(role_headers, start=1):
        cell = ws.cell(row=ROW_ROLE_HDR, column=i, value=h)
        cell.font = Font(name=FONT, size=10, bold=True, color=WHITE)
        cell.fill = PatternFill(fill_type="solid", fgColor=BLUE)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER
    ws.row_dimensions[ROW_ROLE_HDR].height = 26

    role_names = [name for name, _ in ROLE_BLOCKS]
    role_row_start = ROW_ROLE_HDR + 1
    for i, role in enumerate(role_names):
        r = role_row_start + i
        ws.row_dimensions[r].height = 16
        vals = [
            role,
            f'=COUNTIF({CT}!B{data_first}:B{data_last},"{role}")',
            f'=COUNTIFS({CT}!B{data_first}:B{data_last},"{role}",{CT}!E{data_first}:E{data_last},"P0")',
            f'=COUNTIFS({CT}!B{data_first}:B{data_last},"{role}",{CT}!J{data_first}:J{data_last},"Réussi")',
            f'=COUNTIFS({CT}!B{data_first}:B{data_last},"{role}",{CT}!J{data_first}:J{data_last},"Échoué")',
            f'=COUNTIFS({CT}!B{data_first}:B{data_last},"{role}",{CT}!J{data_first}:J{data_last},"Bloqué")',
            f'=COUNTIFS({CT}!B{data_first}:B{data_last},"{role}",{CT}!J{data_first}:J{data_last},"À exécuter")',
        ]
        for col, v in enumerate(vals, start=1):
            cell = ws.cell(row=r, column=col, value=v)
            cell.font = Font(name=FONT, size=10)
            cell.alignment = Alignment(horizontal="left" if col == 1 else "center", vertical="center")
            cell.fill = PatternFill(fill_type="solid", fgColor="FFFAFAFA" if i % 2 == 0 else WHITE)
            cell.border = BORDER
        taux_cell = ws.cell(row=r, column=8, value=f"=IFERROR(D{r}/B{r},0)")
        taux_cell.font = Font(name=FONT, size=10, bold=True)
        taux_cell.number_format = "0.0%"
        taux_cell.alignment = Alignment(horizontal="center", vertical="center")
        taux_cell.fill = PatternFill(fill_type="solid", fgColor="FFFAFAFA" if i % 2 == 0 else WHITE)
        taux_cell.border = BORDER
    role_row_end = role_row_start + len(role_names) - 1

    ws.conditional_formatting.add(
        f"B{role_row_start}:B{role_row_end}",
        DataBarRule(start_type="num", start_value=0, end_type="max", color="FF638EC6", showValue=True)
    )
    ws.conditional_formatting.add(
        f"H{role_row_start}:H{role_row_end}",
        ColorScaleRule(start_type="num", start_value=0, start_color="FFF8696B",
                        mid_type="num", mid_value=0.5, mid_color="FFFFEB84",
                        end_type="num", end_value=1, end_color="FF63BE7B")
    )

    # Répartition par catégorie fonctionnelle
    ROW_CAT_TITLE = role_row_end + 2
    ws.merge_cells(f"A{ROW_CAT_TITLE}:H{ROW_CAT_TITLE}")
    ws.row_dimensions[ROW_CAT_TITLE].height = 22
    c = ws.cell(row=ROW_CAT_TITLE, column=1, value="RÉPARTITION PAR CATÉGORIE FONCTIONNELLE")
    c.font = Font(name=FONT, size=11, bold=True, color=WHITE)
    c.fill = PatternFill(fill_type="solid", fgColor=BLUE)
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1)

    ROW_CAT_HDR = ROW_CAT_TITLE + 1
    cat_headers = ["Catégorie", "Total", "Réussis", "Échoués", "Bloqués", "À exécuter"]
    for i, h in enumerate(cat_headers, start=1):
        cell = ws.cell(row=ROW_CAT_HDR, column=i, value=h)
        cell.font = Font(name=FONT, size=10, bold=True, color=WHITE)
        cell.fill = PatternFill(fill_type="solid", fgColor=BLUE)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER
    ws.row_dimensions[ROW_CAT_HDR].height = 20

    cat_row_start = ROW_CAT_HDR + 1
    for i, cat in enumerate(CATEGORIES):
        r = cat_row_start + i
        ws.row_dimensions[r].height = 16
        vals = [
            cat,
            f'=COUNTIF({CT}!C{data_first}:C{data_last},"{cat}")',
            f'=COUNTIFS({CT}!C{data_first}:C{data_last},"{cat}",{CT}!J{data_first}:J{data_last},"Réussi")',
            f'=COUNTIFS({CT}!C{data_first}:C{data_last},"{cat}",{CT}!J{data_first}:J{data_last},"Échoué")',
            f'=COUNTIFS({CT}!C{data_first}:C{data_last},"{cat}",{CT}!J{data_first}:J{data_last},"Bloqué")',
            f'=COUNTIFS({CT}!C{data_first}:C{data_last},"{cat}",{CT}!J{data_first}:J{data_last},"À exécuter")',
        ]
        for col, v in enumerate(vals, start=1):
            cell = ws.cell(row=r, column=col, value=v)
            cell.font = Font(name=FONT, size=10)
            cell.alignment = Alignment(horizontal="left" if col == 1 else "center", vertical="center")
            cell.fill = PatternFill(fill_type="solid", fgColor="FFFAFAFA" if i % 2 == 0 else WHITE)
            cell.border = BORDER
    cat_row_end = cat_row_start + len(CATEGORIES) - 1

    ws.conditional_formatting.add(
        f"B{cat_row_start}:B{cat_row_end}",
        DataBarRule(start_type="num", start_value=0, end_type="max", color="FF9BC2E6", showValue=True)
    )

    # Note de pied de page
    ROW_FOOT = cat_row_end + 2
    ws.merge_cells(f"A{ROW_FOOT}:H{ROW_FOOT}")
    c = ws.cell(row=ROW_FOOT, column=1,
                value="Ce tableau se met à jour automatiquement selon les statuts saisis dans l'onglet "
                      "« Cas de tests ». Toutes les valeurs ci-dessus sont calculées par formule "
                      "(COUNTA / COUNTIF / COUNTIFS) — aucune saisie manuelle requise.")
    c.font = Font(name=FONT, size=8, italic=True, color="FF7F7F7F")
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1)

    ws.sheet_view.showGridLines = False

    # NB : pas de volets figés (freeze_panes) sur ce tableau de bord.
    # Sur ce classeur, un recalcul LibreOffice (recalc.py) sauvegarde
    # parfois la position de défilement de la dernière cellule active,
    # ce qui pouvait masquer les 4-6 premières lignes derrière un volet
    # figé mal repositionné. En ne figeant aucun volet ici (le tableau
    # est court, un simple défilement suffit) et en forçant la vue sur
    # A1, ce problème d'affichage est définitivement évité.
    ws.freeze_panes = None
    ws.sheet_view.topLeftCell = "A1"
    ws.sheet_view.selection[0].activeCell = "A1"
    ws.sheet_view.selection[0].sqref = "A1"


# ======================================================================
# MAIN
# ======================================================================
def create_default_workbook():
    wb = openpyxl.Workbook()
    required = ["Informations générales", "Cas de tests", "Environnements & rôles",
                "Données de test", "Tableau de bord"]

    if wb.sheetnames:
        default = wb.active
        default.title = required[0]

    for name in required[1:]:
        wb.create_sheet(title=name)

    ws = wb["Informations générales"]
    ws["A1"] = "Cahier de tests KYC"
    ws["A1"].font = Font(name=FONT, size=18, bold=True, color=NAVY)
    ws["A3"] = "Projet"
    ws["B3"] = "KYC"
    ws["A4"] = "Version"
    ws["B4"] = "1.0"
    ws["A5"] = "Date"
    ws["B5"] = "2026-08-24"
    ws["A7"] = "Note"
    ws["B7"] = "Fichier généré automatiquement car le fichier source Excel d'entrée n'était pas présent."
    ws["B7"].alignment = Alignment(wrap_text=True)
    ws.column_dimensions['A'].width = 22
    ws.column_dimensions['B'].width = 80

    return wb


def main():
    if os.path.exists(SRC_PATH):
        shutil.copyfile(SRC_PATH, OUT_PATH)
        wb = openpyxl.load_workbook(OUT_PATH)
        print(f"Source Excel trouvée : {SRC_PATH}")
    else:
        wb = create_default_workbook()
        print(f"Source Excel introuvable : {SRC_PATH}. Un classeur vierge a été créé pour générer le cahier.")

    data_first, data_last = build_cas_de_tests(wb)
    update_roles_and_data_sheets(wb)
    build_dashboard(wb, data_first, data_last)

    # Vue générale du classeur : ouverture sur l'onglet Informations générales
    if "Informations générales" in wb.sheetnames:
        wb.active = wb.sheetnames.index("Informations générales")

    wb.save(OUT_PATH)
    print(f"Terminé : {OUT_PATH}")
    print(f"  - {TOTAL_TESTS} cas de tests, lignes {data_first} à {data_last} dans 'Cas de tests'")
    print("  - Pensez à recalculer les formules (recalc.py / ouverture Excel-LibreOffice) "
          "avant diffusion.")


if __name__ == "__main__":
    main()
