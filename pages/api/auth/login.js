// pages/api/auth/login.js
import { validateClient } from '../../../lib/clients';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Username and password are required' 
      });
    }

    console.log(`🔐 Login attempt for: ${username}`);

    // Validar credenciales
    const result = validateClient(username, password);

    if (!result.valid) {
      console.log(`❌ Login failed for ${username}: ${result.error}`);
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid credentials' 
      });
    }

    console.log(`✅ Login successful for ${username}`);

    // Crear token simple (base64 de username:password)
    const token = Buffer.from(`${username}:${password}`).toString('base64');

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token: token, // Devolver token para guardar en localStorage
      client: result.client,
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}
