const { processTryOn } = require('../src/tryon-service');

exports.handler = async (event = {}) => {
  const meta = {
    method: event.httpMethod || event.requestContext?.http?.method || event.method || 'POST',
    headers: event.headers,
    path: event.path || event.requestContext?.http?.path,
  };

  const baseHeaders = {
    'Content-Type': 'application/json',
    // TODO: Reemplazar "*" por el origen permitido en tu API Gateway/CloudFront
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (meta.method === 'OPTIONS') {
    return { statusCode: 200, headers: baseHeaders, body: '' };
  }

  let payload = {};
  try {
    if (Object.prototype.hasOwnProperty.call(event, 'body')) {
      // Caso API Gateway / Function URL
      let bodyVal = event.body;
      if (typeof bodyVal === 'string') {
        if (event.isBase64Encoded) {
          bodyVal = Buffer.from(bodyVal, 'base64').toString('utf8');
        }
        payload = bodyVal ? JSON.parse(bodyVal) : {};
      } else if (bodyVal && typeof bodyVal === 'object') {
        // Ya viene parseado
        payload = bodyVal;
      } else {
        payload = {};
      }
    } else {
      // Caso invocación directa / RIE: el JSON va directo en event
      payload = event || {};
    }
  } catch (e) {
    return {
      statusCode: 400,
      headers: baseHeaders,
      body: JSON.stringify({ error: 'Cuerpo JSON inválido', details: e.message }),
    };
  }

  const result = await processTryOn(payload, meta);

  return {
    statusCode: result.statusCode,
    headers: { ...baseHeaders, ...(result.headers || {}) },
    body: JSON.stringify(result.body),
  };
};
