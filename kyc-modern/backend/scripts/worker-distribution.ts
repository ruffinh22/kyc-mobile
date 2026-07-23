// ============================================================================
// KYC V4 - Worker de distribution automatique des dossiers
// Exécute distribuerMaintenant() toutes les 2 secondes
// Adapté de kyc-v40 pour TypeScript + MySQL
// ============================================================================

import { initDb } from '../src/db';
import { distribuerMaintenant } from '../src/utils/distribution';

const INTERVAL_MS = 2000; // 2 secondes

async function startWorker() {
  console.log('[Worker Distribution] Initialisation de la connexion DB...');
  await initDb();
  console.log('[Worker Distribution] DB connectée, démarrage du worker...');

  // Exécuter immédiatement au démarrage
  distribuerMaintenant();

  // Puis exécuter toutes les 2 secondes
  setInterval(() => {
    distribuerMaintenant();
  }, INTERVAL_MS);

  console.log('[Worker Distribution] Worker actif (intervalle: 2s)');
}

startWorker().catch(err => {
  console.error('[Worker Distribution] Erreur de démarrage:', err);
  process.exit(1);
});
