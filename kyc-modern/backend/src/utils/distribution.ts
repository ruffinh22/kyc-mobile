// ============================================================================
// KYC V4 - Logique de distribution AUTO des dossiers
// Adaptée de kyc-v40 pour MySQL + TypeScript
// Appelée par le worker (toutes les 2s) ET à chaque soumission de dossier
// FIFO strict, max 1 push auto par agent
// ============================================================================

import { query, exec, nowSec, getConfig } from '../db';
import { releaseAgentLock, reconcileAgentLocks } from '../db/locks';
import { verifierAlertesTraitementLong } from './alertes-traitement';
import { RowDataPacket } from 'mysql2';

interface ConfigRow {
  valeur: string;
}

export function shouldRequeueDossier(assignedAt: number | null, now: number, abandonSec: number): boolean {
  if (assignedAt == null) return false;
  const timeoutSec = Math.max(30, abandonSec);
  return now - assignedAt >= timeoutSec;
}

export async function distribuerMaintenant(): Promise<void> {
  try {
    // Filet de sécurité générique, indépendant du mode auto/manuel : répare
    // tout verrou (agent_dossier_lock) qui aurait pu se désynchroniser de la
    // réalité de `dossiers` par un chemin qu'on n'aurait pas couvert
    // explicitement (crash en cours de route, ancien bug déjà corrigé côté
    // /accepter, /rejeter et filet de sécurité ci-dessous, déploiement...).
    // Appelée à chaque cycle du worker (toutes les 2s), comme documenté dans
    // db/locks.ts — jusqu'ici cet appel manquait et le seul rattrapage
    // possible était un redémarrage complet du serveur.
    await reconcileAgentLocks();

    // Alerte superviseur "traitement démarré, toujours pas finalisé après
    // 5 min" : INCONDITIONNELLE elle aussi (comme reconcileAgentLocks ci-
    // dessus), placée avant le early-return du mode auto/manuel — un
    // traitement qui traîne doit remonter au superviseur que la distribution
    // automatique soit activée ou non. Voir utils/alertes-traitement.ts.
    await verifierAlertesTraitementLong();

    // Vérifier le mode de distribution
    const configs = await query<ConfigRow & RowDataPacket>("SELECT valeur FROM config WHERE cle='distribution_mode'");
    if (!configs.length || configs[0].valeur !== 'auto') return;

    const maintenant = nowSec();
    const intervalMs = parseInt((await getConfig('distribution_interval_ms')) ?? '2000', 10);
    const abandonSec = parseInt((await getConfig('distribution_abandon_sec')) ?? '120', 10);
    const limite = maintenant - Math.max(30, Math.floor(abandonSec / 2));
    const seuilAbandon = maintenant - Math.max(30, abandonSec);
    const intervalSec = Math.max(1, Math.floor(intervalMs / 1000));

    // ---- FILET DE SÉCURITÉ ----
    // Basé uniquement sur `derniere_activite_le` (colonne dédiée au dossier,
    // voir migration 20260819_add_dossier_derniere_activite_le.ts) — la
    // présence générale de l'agent (table `presence`, heartbeat ping-dispo)
    // n'intervient plus du tout ici ; elle continue de servir plus bas, mais
    // uniquement pour repérer les agents libres à qui pousser un dossier.
    //
    // AVANT : la logique distinguait "jamais ouvert" (traitement_demarre_le
    // IS NULL, basé sur assigne_le/updated_at) de "traitement démarré"
    // (assigne_le/updated_at ET présence générale, reliés par AND). Le
    // défaut de fond restait le même dans les deux branches : ni assigne_le
    // (figé à l'attribution) ni la présence générale (vraie mais globale à
    // l'agent, pas au dossier) ne mesurent une activité RÉCENTE SUR CE
    // DOSSIER PRÉCIS. Un agent avec deux onglets, ou en pause café session
    // ouverte, restait "présent" aux yeux de la branche (B) et protégeait
    // indéfiniment un dossier qu'il ne traitait plus.
    //
    // MAINTENANT : `derniere_activite_le` est rafraîchie à CHAQUE signe de
    // vie sur CE dossier (ouverture — voir GET /api/dossiers/:id —, ping
    // dédié pendant la saisie GSM, clic "Appeler terrain", cf.
    // db/dossiers.ts et GsmPages.tsx/DossierPages.tsx côté frontend) tant
    // qu'il reste en_cours. `COALESCE(derniere_activite_le, assigne_le,
    // updated_at)` retombe sur l'horodatage d'attribution tant qu'aucune
    // activité n'a encore été enregistrée (dossier attribué mais jamais
    // ouvert), puis bascule automatiquement sur la dernière activité réelle
    // dès qu'il y en a une. Un seul signal, un seul seuil : un agent actif
    // ne perd jamais un dossier qu'il traite réellement ; un agent VRAIMENT
    // parti (onglet fermé, crash, réseau coupé — plus aucune activité NI
    // aucun ping) au-delà du délai déclenche la reprise, que sa présence
    // générale soit encore valide ailleurs ou non.
    const orphelins = await query<{ id: string; agent_saisie: string } & RowDataPacket>(
      `SELECT d.id, d.agent_saisie FROM dossiers d 
       WHERE d.statut='en_cours' AND d.agent_saisie IS NOT NULL
       AND COALESCE(d.derniere_activite_le, d.assigne_le, d.updated_at) <= ?`,
      [seuilAbandon]
    );

    for (const o of orphelins) {
      const result = await exec(
        `UPDATE dossiers 
         SET statut='en_attente', assigne_a=NULL, agent_saisie=NULL,
             assigne_le=NULL, heure_prise=NULL, traitement_demarre_le=NULL,
             derniere_activite_le=NULL, updated_at=? 
         WHERE id=? AND statut='en_cours'`,
        [maintenant, o.id]
      );
      // Le dossier vient de quitter en_cours pour cet agent : il FAUT libérer
      // son verrou (agent_dossier_lock) ici, sinon la ligne reste en base avec
      // un dossier_id pointant vers un dossier redevenu en_attente. Résultat
      // sans ce releaseAgentLock : appelerProchainDossier()/prendre() pour cet
      // agent échouent en boucle sur 'agent_occupe' (INSERT bloqué par la PK
      // matricule) — l'agent reste bloqué indéfiniment, même après que son
      // dossier a été correctement remis en file, jusqu'au prochain
      // reconcileAgentLocks() (typiquement seulement au redémarrage serveur).
      // On ne libère que si l'UPDATE a effectivement eu lieu (affectedRows===1)
      // pour éviter de libérer un verrou qui viendrait d'être repris entre-temps
      // par une autre attribution concurrente sur ce même dossier.
      if (result.affectedRows === 1) {
        await releaseAgentLock(o.agent_saisie);
      }
    }
    // ---- fin filet ----

    // Poser dispo_depuis pour les agents devenus éligibles
    await exec(
      `UPDATE presence 
       SET dispo_depuis = ? 
       WHERE statut='online' AND ts >= ? AND dispo_depuis IS NULL 
       AND matricule NOT IN (
         SELECT agent_saisie FROM dossiers WHERE statut='en_cours' AND agent_saisie IS NOT NULL
       )`,
      [maintenant, limite]
    );

    // Le worker ne relance pas la distribution plus vite que l'intervalle configuré.
    if (intervalSec > 1) {
      await exec(
        `UPDATE dossiers SET updated_at=? WHERE statut='en_attente' AND updated_at < ?`,
        [maintenant, maintenant - intervalSec]
      );
    }

    // Effacer dispo_depuis pour les non éligibles
    await exec(
      `UPDATE presence 
       SET dispo_depuis = NULL 
       WHERE dispo_depuis IS NOT NULL AND (
         statut!='online' OR ts < ? OR matricule IN (
           SELECT agent_saisie FROM dossiers WHERE statut='en_cours' AND agent_saisie IS NOT NULL
         )
       )`,
      [limite]
    );

    // Agents disponibles, FIFO (triés par dispo_depuis = temps d'attente)
    const agents = await query<{ matricule: string } & RowDataPacket>(
      `SELECT matricule FROM presence 
       WHERE statut='online' AND ts >= ? AND dispo_depuis IS NOT NULL 
       AND matricule NOT IN (
         SELECT agent_saisie FROM dossiers WHERE statut='en_cours' AND agent_saisie IS NOT NULL
       )
       ORDER BY dispo_depuis ASC`,
      [limite]
    );

    for (const ag of agents) {
      // Prendre le plus ancien dossier en_attente
      const prochains = await query<{ id: string } & RowDataPacket>(
        `SELECT id FROM dossiers WHERE statut='en_attente' ORDER BY created_at ASC LIMIT 1`
      );
      if (!prochains.length) break;

      const prochain = prochains[0];
      const result = await exec(
        `UPDATE dossiers 
         SET statut='en_cours', agent_saisie=?, assigne_a=?, 
             assigne_le=?, heure_prise=DATE_FORMAT(FROM_UNIXTIME(?), '%H:%i'),
             traitement_demarre_le=NULL, derniere_activite_le=NULL, updated_at=? 
         WHERE id=? AND statut='en_attente'`,
        [ag.matricule, ag.matricule, maintenant, maintenant, maintenant, prochain.id]
      );

      if (result.affectedRows === 1) {
        // Attribution réussie: l'agent devient occupé
        await exec("UPDATE presence SET dispo_depuis=NULL WHERE matricule=?", [ag.matricule]);
        
        // Notifier via SSE
        try { 
          const sse = await import('./sse.js');
          sse.notifier(ag.matricule, 'nouveau-dossier', { id: prochain.id }); 
        } catch(e){}
      }
    }
  } catch (err) {
    // Silencieux : le worker réessaiera au prochain cycle
    console.error('[Distribution] Erreur:', err);
  }
}