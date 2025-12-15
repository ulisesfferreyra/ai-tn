// pages/api/feedback.js
//
import { trackFeedback, getClientDomain } from '../../lib/metrics';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { feedback, requestId } = req.body || {};

  if (!feedback || !['like', 'dislike'].includes(feedback)) {
    return res.status(400).json({ error: 'Invalid feedback. Use "like" or "dislike"' });
  }

  const clientDomain = getClientDomain(req);

  try {
    await trackFeedback(clientDomain, feedback, requestId);
    return res.json({ success: true, feedback, clientDomain });
  } catch (error) {
    console.error('[FEEDBACK] Error:', error);
    return res.status(500).json({ error: 'Error saving feedback' });
  }
}
