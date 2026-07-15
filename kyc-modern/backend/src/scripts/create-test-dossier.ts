import 'dotenv/config';
import { initDb, createDossier } from '../db';

async function main() {
  await initDb();
  const id = 'KYC_TEST_AUTOTEST_1';
  const now = new Date();
  const date = now.toISOString().slice(0,10);
  await createDossier({
    id,
    numero_mtn: '0999999999',
    wa_agent: '0999999999',
    username_agent: 'test',
    fonction_agent: 'Agent Test',
    zone_agent: 'TestZone',
    date,
    heure_reception: '12:00',
    photo_recto: 'placeholder-recto.jpg',
    photo_verso: 'placeholder-verso.jpg',
    photo_live: 'placeholder-live.jpg',
    score_visage: null,
    visage_match: null,
    visage_verifie_le: null,
  });
  console.log('Inserted test dossier', id);
}

main().catch(e => { console.error(e); process.exit(1); });
