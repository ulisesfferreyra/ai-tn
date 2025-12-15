// pages/api/auth/login.js
import { validateClient } from '../../../lib/clients';
import { serialize } from 'cookie';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const client = validateClient(username, password);

  if (!client) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Crear token simple (en producción usar JWT)
  const token = Buffer.from(JSON.stringify({
    username: client.username,
    domain: client.domain,
    name: client.name,
    exp: Date.now() + (24 * 60 * 60 * 1000), // 24 horas
  })).toString('base64');

  // Setear cookie
  res.setHeader('Set-Cookie', serialize('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24, // 24 horas
    path: '/',
  }));

  return res.json({
    success: true,
    client: {
      username: client.username,
      domain: client.domain,
      name: client.name,
    },
    token, // También devolver token para localStorage
  });
}
