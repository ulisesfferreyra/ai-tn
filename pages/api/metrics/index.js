// pages/api/metrics/index.js
import { getMetrics, getRecentEvents } from '../../../lib/metrics';
import { AUTHORIZED_CLIENTS } from '../../../lib/clients';

function parseToken(token) {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    if (decoded.exp < Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verificar autenticación
  const authHeader = req.headers.authorization;
  const cookieToken = req.cookies?.auth_token;
  const token = authHeader?.replace('Bearer ', '') || cookieToken;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const client = parseToken(token);
  if (!client) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Verificar que el cliente existe
  if (!AUTHORIZED_CLIENTS[client.username]) {
    return res.status(403).json({ error: 'Client not authorized' });
  }

  try {
    const metrics = await getMetrics(client.domain);
    const recentEvents = await getRecentEvents(client.domain, 20);

    if (!metrics) {
      return res.json({
        success: true,
        client: {
          username: client.username,
          domain: client.domain,
          name: client.name,
        },
        metrics: {
          totalGenerations: 0,
          successRate: 0,
          errors: 0,
          avgDuration: 0,
          feedbackScore: 0,
          likes: 0,
          dislikes: 0,
          satisfactionRate: 0,
          sizeDistribution: [],
        },
        recentEvents: [],
      });
    }

    return res.json({
      success: true,
      client: {
        username: client.username,
        domain: client.domain,
        name: client.name,
      },
      metrics,
      recentEvents,
    });
  } catch (error) {
    console.error('[METRICS API] Error:', error);
    return res.status(500).json({ error: 'Error fetching metrics' });
  }
}
