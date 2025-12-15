// pages/api/feedback.js
// Endpoint para trackear feedback (likes/dislikes) y conversiones

import { trackFeedback, getClientDomain } from '../../lib/metrics';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, requestId, productImageUrl, selectedSize, pageUrl, timestamp } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Missing type field' });
    }

    // Validar tipo
    const validTypes = ['like', 'dislike', 'conversion'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }

    // Obtener dominio del cliente
    const clientDomain = getClientDomain(req);

    console.log(`📥 FEEDBACK RECIBIDO [${type}]`);
    console.log(`   - Client Domain: ${clientDomain}`);
    console.log(`   - Request ID: ${requestId || 'N/A'}`);
    console.log(`   - Product URL: ${productImageUrl || 'N/A'}`);
    console.log(`   - Size: ${selectedSize || 'N/A'}`);
    console.log(`   - Page URL: ${pageUrl || 'N/A'}`);

    // Trackear en Redis
    await trackFeedback(clientDomain, {
      type,
      requestId,
      productImageUrl,
      selectedSize,
      pageUrl,
      timestamp: timestamp || new Date().toISOString(),
    });

    console.log(`✅ FEEDBACK TRACKEADO [${type}]`);

    return res.status(200).json({
      success: true,
      message: `Feedback '${type}' tracked successfully`,
      clientDomain,
    });

  } catch (error) {
    console.error('❌ ERROR EN FEEDBACK:', error);
    return res.status(500).json({
      success: false,
      error: 'Error tracking feedback',
      details: error.message,
    });
  }
}

