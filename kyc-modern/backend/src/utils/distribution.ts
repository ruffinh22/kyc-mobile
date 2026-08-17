// ============================================================================
// KYC V4 - Logique de distribution AUTO des dossiers
// Adaptée de kyc-v40 pour MySQL + TypeScript
// Appelée par le worker (toutes les 2s) ET à chaque soumission de dossier
// FIFO strict, max 1 push auto par agent
// ============================================================================

import { query, exec, nowSec, getConfig } from '../db';
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
    // Deux cas bien distincts, avec des règles différentes :
    //
    // (A) JAMAIS COMMENCÉ (`traitement_demarre_le IS NULL`) : l'agent n'a
    // jamais ouvert CE dossier précis (voir GET /api/dossiers/:id qui pose
    // `traitement_demarre_le`). Ici la présence générale de l'agent (autre
    // onglet ouvert, heartbeat ping-dispo actif...) ne prouve rien sur ce
    // dossier — donc on ne la vérifie pas : dès que `assigne_le` dépasse le
    // délai d'abandon, retour direct en file. C'est le cas qu'on voulait
    // couvrir en plus de l'ancienne logique.
    //
    // (B) TRAITEMENT RÉELLEMENT DÉMARRÉ (`traitement_demarre_le IS NOT NULL`) :
    // il faut les DEUX signaux à la fois (AND, pas OR) —
    //   (1) l'attribution (ou la dernière mise à jour) date d'avant le seuil
    //   (2) ET l'agent n'a envoyé AUCUN signe de vie récent (ping-dispo)
    // AVANT (ancien bug) : les deux étaient reliés par un OR, donc la seule
    // condition (1) suffisait à déclencher la reprise — un agent qui a bel
    // et bien commencé le traitement dans les temps, dont l'onglet reste
    // ouvert et qui continue d'envoyer sa présence, se faisait quand même
    // reprendre son dossier dès que `assigne_le` dépassait le délai
    // d'abandon (2 min par défaut), simplement parce qu'un dossier complexe
    // prend plus de temps à traiter. Avec le AND, un agent actif ne perd
    // plus jamais un dossier qu'il a réellement commencé tant qu'il donne
    // signe de vie — seul un agent VRAIMENT parti (onglet fermé, réseau
    // coupé, crash) au-delà du délai déclenche la reprise.
    const orphelins = await query<{ id: string } & RowDataPacket>(
      `SELECT d.id FROM dossiers d 
       WHERE d.statut='en_cours' AND d.agent_saisie IS NOT NULL
       AND (
         (
           d.traitement_demarre_le IS NULL
           AND (
             (d.assigne_le IS NOT NULL AND d.assigne_le <= ?)
             OR (d.assigne_le IS NULL AND d.updated_at IS NOT NULL AND d.updated_at <= ?)
           )
         )
         OR
         (
           d.traitement_demarre_le IS NOT NULL
           AND (
             (d.assigne_le IS NOT NULL AND d.assigne_le <= ?)
             OR (d.assigne_le IS NULL AND d.updated_at IS NOT NULL AND d.updated_at <= ?)
           )
           AND d.agent_saisie NOT IN (
             SELECT matricule FROM presence WHERE ts >= ?
           )
         )
       )`,
      [seuilAbandon, seuilAbandon, seuilAbandon, seuilAbandon, seuilAbandon]
    );

    for (const o of orphelins) {
      await exec(
        `UPDATE dossiers 
         SET statut='en_attente', assigne_a=NULL, agent_saisie=NULL,
             assigne_le=NULL, heure_prise=NULL, traitement_demarre_le=NULL, updated_at=? 
         WHERE id=? AND statut='en_cours'`,
        [maintenant, o.id]
      );
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
             traitement_demarre_le=NULL, updated_at=? 
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