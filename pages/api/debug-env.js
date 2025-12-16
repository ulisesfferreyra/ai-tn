// pages/api/debug-env.js
// TEMPORAL - Borrar después de verificar

export default async function handler(req, res) {
  const envVars = {
    KV_REST_API_URL: process.env.KV_REST_API_URL ? '✅ SET' : '❌ NOT SET',
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN ? '✅ SET' : '❌ NOT SET',
    REDIS_KV_REST_API_URL: process.env.REDIS_KV_REST_API_URL ? '✅ SET' : '❌ NOT SET',
    REDIS_KV_REST_API_TOKEN: process.env.REDIS_KV_REST_API_TOKEN ? '✅ SET' : '❌ NOT SET',
    REDIS_URL: process.env.REDIS_URL ? '✅ SET' : '❌ NOT SET',
  };

  console.log('🔍 Environment Variables Check:', envVars);

  return res.status(200).json({
    message: 'Environment Variables Check',
    variables: envVars,
    timestamp: new Date().toISOString(),
  });
}

