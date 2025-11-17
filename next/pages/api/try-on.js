// /pages/api/tryon.js
import { processTryOn } from '../../../aws/src/tryon-service.js';

// Config API (20 MB para múltiples imágenes)
export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

function ensureCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Handler del endpoint Next.js (delgado, delega en el servicio)
export default async function handler(req, res) {
  ensureCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const payload = req.body || {};
  const meta = {
    method: req.method,
    headers: req.headers,
    url: req.url,
    path: req.url,
  };

  const result = await processTryOn(payload, meta);
  return res.status(result.statusCode).set(result.headers || {}).json(result.body);
}
