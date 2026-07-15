import fetch from 'node-fetch';
const base = 'http://127.0.0.1:3001';
(async () => {
  console.log('fetch health...');
  try {
    const h = await fetch(`${base}/api/health`);
    console.log('health', h.status);
    console.log(await h.text());
  } catch (err) {
    console.error('health err', err);
    return;
  }

  console.log('posting prepare-verify-session...');
  try {
    const res = await fetch(`${base}/api/dossiers/prepare-verify-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        numero_mtn: '0117758775',
        country: 'CD',
        recto_path: '2026-07-14/KYC1784037151632DE47B5_recto.jpg',
        verso_path: '2026-07-14/KYC1784037151632DE47B5_verso.jpg',
        wa_agent: '0150155555',
        username_agent: 'pass',
        fonction_agent: 'Agent Acquisition',
        zone_agent: 'Hinterland Nord'
      }),
    });
    console.log('status', res.status);
    const text = await res.text();
    console.log(text);
  } catch (err) {
    console.error('prepare err', err);
  }
})();
