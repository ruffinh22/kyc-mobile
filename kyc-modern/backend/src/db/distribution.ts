// ============================================================================
// KYC V4 - Logique de distribution AUTO des dossiers
// Adaptée de kyc-v40 pour MySQL + TypeScript
// Appelée par le worker (toutes les 2s) ET à chaque soumission de dossier
// FIFO strict, max 1 push auto par agent
//
// PATCH 2026-08-08 : l'attribution passe désormais par
// db/locks.ts::appelerProchainDossier(), qui pose un verrou exclusif par
// agent (table agent_dossier_lock, PK matricule) dans la même transaction
// que l'UPDATE du dossier. Avant ce patch, l'exclusion des agents occupés
// se basait sur un simple "NOT IN (SELECT ... WHERE statut='en_cours')"
// relu séparément de l'UPDATE d'attribution : un appel concurrent à
// POST /api/dossiers/appeler (pull, déclenché par le frontend) pouvait
// s'intercaler entre les deux et faire passer un agent déjà servi ici une
// seconde fois — c'est la cause du bug "2 dossiers auto au lieu de 1".
// ============================================================================

import { query, exec, nowSec, getConfig } from '../db';
import { RowDataPacket } from 'mysql2';
import { appelerProchainDossier, releaseAgentLock, reconcileAgentLocks } from '../db/locks';

interface ConfigRow {
  valeur: string;
}

export async function distribuerMaintenant(): Promise<void> {
  try {
    // Vérifier le mode de distribution
    const configs = await query<ConfigRow & RowDataPacket>("SELECT valeur FROM config WHERE cle='distribution_mode'");
    if (!configs.length || configs[0].valeur !== 'auto') return;

    const maintenant = nowSec();
    const intervalMs = parseInt((await getConfig('distribution_interval_ms')) ?? '2000', 10);
    const abandonSec = parseInt((await getConfig('distribution_abandon_sec')) ?? '120', 10);
    const limite = maintenant - Math.max(30, Math.floor(abandonSec / 2));
    const seuilAbandon = maintenant - Math.max(30, abandonSec);
    const intervalSec = Math.max(1, Math.floor(intervalMs / 1000));

    // Filet de sécurité de base : répare tout verrou désynchronisé avant de
    // calculer les agents "libres" ci-dessous (peu coûteux, tables indexées).
    await reconcileAgentLocks();

    // ---- FILET DE SÉCURITÉ ----
    // Récupérer les dossiers en_cours dont l'agent n'a pas ping depuis le délai d'abandon configuré
    const orphelins = await query<{ id: string; agent_saisie: string | null } & RowDataPacket>(
      `SELECT d.id, d.agent_saisie FROM dossiers d 
       WHERE d.statut='en_cours' AND d.agent_saisie IS NOT NULL
       AND d.agent_saisie NOT IN (
         SELECT matricule FROM presence WHERE ts >= ?
       )`,
      [seuilAbandon]
    );

    for (const o of orphelins) {
      await exec(
        `UPDATE dossiers 
         SET statut='en_attente', assigne_a=NULL, agent_saisie=NULL, 
             heure_prise=NULL, updated_at=? 
         WHERE id=? AND statut='en_cours'`,
        [maintenant, o.id]
      );
      // Le dossier n'est plus en_cours pour cet agent : on libère son verrou
      // pour qu'il redevienne immédiatement éligible à une nouvelle attribution.
      if (o.agent_saisie) await releaseAgentLock(o.agent_saisie);
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
      // appelerProchainDossier pose le verrou ET assigne le dossier dans une
      // seule transaction. Si un pull concurrent (POST /api/dossiers/appeler)
      // a entre-temps servi cet agent, le verrou existe déjà et l'attribution
      // échoue proprement (result: 'agent_occupe') au lieu de créer un
      // deuxième dossier en_cours pour lui.
      const res = await appelerProchainDossier(ag.matricule);
      if (res.result !== 'ok') continue;

      // Attribution réussie: l'agent devient occupé
      await exec("UPDATE presence SET dispo_depuis=NULL WHERE matricule=?", [ag.matricule]);

      // Notifier via SSE
      try {
        const sse = await import('../utils/sse.js');
        sse.notifier(ag.matricule, 'nouveau-dossier', { id: res.dossierId });
      } catch (e) {}
    }
  } catch (err) {
    // Silencieux : le worker réessaiera au prochain cycle
    console.error('[Distribution] Erreur:', err);
  }
}
