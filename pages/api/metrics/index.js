// pages/api/metrics/index.js
// Endpoint para obtener métricas del dashboard

import { getMetrics, getRecentEvents } from '../../../lib/metrics';
import { AUTHORIZED_CLIENTS } from '../../../lib/clients';

function parseToken(token) {
  if (!token) return null;
  try {
    // Remover "Bearer " si está presente
    const cleanToken = token.replace('Bearer ', '');
    const decoded = Buffer.from(cleanToken, 'base64').toString('utf-8');
    const [username, password] = decoded.split(':');
    return { username, password };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Obtener token del header Authorization
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      console.log('❌ No auth token provided');
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Parsear y validar token
    const credentials = parseToken(token);
    if (!credentials) {
      console.log('❌ Invalid token format');
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Verificar que el cliente existe
    const client = AUTHORIZED_CLIENTS[credentials.username?.toLowerCase()];
    if (!client) {
      console.log('❌ Client not found:', credentials.username);
      return res.status(401).json({ error: 'Invalid client' });
    }

    // Verificar contraseña
    if (client.password !== credentials.password) {
      console.log('❌ Invalid password for client:', credentials.username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const clientDomain = client.domain;
    console.log(`📊 Fetching metrics for client: ${credentials.username} (${clientDomain})`);

    // Obtener métricas
    const metrics = await getMetrics(clientDomain);
    
    // Obtener eventos recientes
    const recentEvents = await getRecentEvents(clientDomain, 20);

    console.log(`✅ Metrics fetched successfully for ${clientDomain}`);
    console.log(`   - isLiveData: ${metrics.isLiveData}`);
    console.log(`   - Total try-ons: ${metrics.totals?.tryons || 0}`);

    return res.status(200).json({
      success: true,
      client: {
        username: credentials.username,
        name: client.name,
        domain: clientDomain,
      },
      metrics,
      recentEvents: recentEvents.events || [],
      recentFeedback: recentEvents.feedback || [],
      isLiveData: metrics.isLiveData,
      demoMessage: metrics.demoMessage || null,
    });

  } catch (error) {
    console.error('❌ Error in /api/metrics:', error);
    return res.status(500).json({
      success: false,
      error: 'Error fetching metrics',
      details: error.message,
    });
  }
}
