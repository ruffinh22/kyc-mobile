// ============================================================================
// Worker pour détecter et retourner les dossiers abandonnés
// Vérifie tous les 30s si un dossier en_cours n'a pas été modifié depuis 30 min
// ============================================================================

import { query, exec, nowSec } from '../db';
import { RowDataPacket } from 'mysql2';

const TIMEOUT_SECS = 30 * 60; // 30 minutes par défaut

export async function checkDossierTimeout(): Promise<void> {
  try {
    const maintenant = nowSec();
    const timeout_limit = maintenant - TIMEOUT_SECS;

    // Trouver les dossiers en_cours non modifiés depuis TIMEOUT_SECS
    const abandoned = await query<{ id: string; agent_saisie: string | null } & RowDataPacket>(
      `SELECT id, agent_saisie FROM dossiers 
       WHERE statut='en_cours' 
       AND updated_at < ?
       LIMIT 50`,
      [timeout_limit]
    );

    for (const dos of abandoned) {
      // Retourner le dossier à la queue
      await exec(
        `UPDATE dossiers 
         SET statut='en_attente', agent_saisie=NULL, assigne_a=NULL,
             assigne_le=NULL, heure_prise=NULL, updated_at=?
         WHERE id=?`,
        [maintenant, dos.id]
      );

      // Log
      if (dos.agent_saisie) {
        console.log(`[DossierTimeout] Dossier ${dos.id} retourné (timeout ${TIMEOUT_SECS}s, agent: ${dos.agent_saisie})`);
      }
    }

    if (abandoned.length > 0) {
      // Redistribuer immédiatement
      try {
        const { distribuerMaintenant } = await import('./distribution.js');
        await distribuerMaintenant();
      } catch (e) {
        console.error('[DossierTimeout] Erreur redistribution:', e);
      }
    }
  } catch (err) {
    console.error('[DossierTimeout] Erreur:', err);
  }
}

// Start worker - called from index.ts
export function startDossierTimeoutWorker(): void {
  setInterval(checkDossierTimeout, 30 * 1000); // Check every 30 seconds
  console.log('[DossierTimeout] Worker démarré (check toutes les 30s)');
}
