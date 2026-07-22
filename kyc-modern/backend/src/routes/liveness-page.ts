import fs from 'fs';
import path from 'path';
import { FastifyRequest, FastifyReply } from 'fastify';

const FRONTEND_URL = process.env.FRONTEND_URL?.trim() || '';
const FRONTEND_DIST = path.resolve(process.cwd(), '../frontend/dist');

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title><style>body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;box-sizing:border-box}main{max-width:780px;width:100%;border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:28px;background:#111827;box-shadow:0 10px 30px rgba(0,0,0,.35)}h1{margin:0 0 12px;font-size:1.6rem;color:#fff}p{line-height:1.7;color:#cbd5e1}code{background:rgba(148,163,184,.16);color:#f8fafc;padding:2px 6px;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace}</style></head><body><main><h1>${title}</h1>${message}</main></body></html>`;
}

export async function livenessPageRoutes(app: any): Promise<void> {
  app.get('/liveness-check', async (req: FastifyRequest, reply: FastifyReply) => {
    const dossierId = String((req.query as any)?.dossierId ?? '').trim();
    if (!dossierId) {
      return reply
        .code(400)
        .type('text/html')
        .send(htmlPage('Dossier manquant', '<p>Le paramètre <code>dossierId</code> est requis.</p>'));
    }

    const indexPath = path.join(FRONTEND_DIST, 'index.html');
    if (fs.existsSync(indexPath)) {
      const html = fs.readFileSync(indexPath, 'utf-8');
      return reply
        .code(200)
        .type('text/html')
        .send(html);
    }

    if (!FRONTEND_URL) {
      const host = String(req.headers?.host || 'SERVER');
      return reply
        .code(503)
        .type('text/html')
        .send(htmlPage(
          'Page Liveness indisponible',
          `<p>La page de vérification Face Liveness n'est pas disponible sur ce serveur.</p>
          <p>Pour tester localement, définis <code>FRONTEND_URL=http://10.0.2.2:5173</code> dans ton <code>.env</code> ou construis le frontend et sers le dossier de build.</p>
          <p>Ensuite ouvre&nbsp;: <code>${host}</code>/liveness-check?dossierId=${encodeURIComponent(dossierId)}</p>`,
        ));
    }

    const target = `${FRONTEND_URL.replace(/\/$/, '')}/liveness-check?dossierId=${encodeURIComponent(dossierId)}`;
    return reply
      .code(302)
      .header('Location', target)
      .send('Redirecting');
  });
}
