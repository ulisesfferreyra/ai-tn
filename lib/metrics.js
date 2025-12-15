// lib/metrics.js
// Funciones para guardar y leer métricas en Upstash Redis

const REDIS_URL = process.env.REDIS_KV_REST_API_URL;
const REDIS_TOKEN = process.env.REDIS_KV_REST_API_TOKEN;

// Helper para hacer requests a Upstash REST API
async function redis(command, ...args) {
  const response = await fetch(`${REDIS_URL}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([command, ...args]),
  });
  
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data.result;
}

// Extraer dominio del cliente desde el header Origin o Referer
export function getClientDomain(req) {
  const origin = req.headers.origin || req.headers.referer || '';
  try {
    const url = new URL(origin);
    return url.hostname.replace('www.', '');
  } catch {
    return 'unknown';
  }
}

// Guardar evento de try-on
export async function trackTryOnEvent(data) {
  const {
    clientDomain,
    requestId,
    success,
    duration,
    size,
    model,
    errorType,
    timestamp = new Date().toISOString(),
  } = data;

  const event = {
    requestId,
    success,
    duration,
    size,
    model,
    errorType,
    timestamp,
  };

  const dayKey = timestamp.split('T')[0]; // YYYY-MM-DD
  const eventKey = `tryon:${clientDomain}:events:${dayKey}`;
  const statsKey = `tryon:${clientDomain}:stats`;

  try {
    // Guardar evento en lista (últimos 1000 eventos por día)
    await redis('LPUSH', eventKey, JSON.stringify(event));
    await redis('LTRIM', eventKey, 0, 999);
    await redis('EXPIRE', eventKey, 60 * 60 * 24 * 30); // 30 días

    // Actualizar estadísticas
    await redis('HINCRBY', statsKey, 'total_generations', 1);
    
    if (success) {
      await redis('HINCRBY', statsKey, 'successful', 1);
    } else {
      await redis('HINCRBY', statsKey, 'errors', 1);
    }

    // Actualizar tiempo promedio (usando running average)
    if (duration) {
      const currentAvg = await redis('HGET', statsKey, 'avg_duration') || 0;
      const count = await redis('HGET', statsKey, 'total_generations') || 1;
      const newAvg = ((parseFloat(currentAvg) * (count - 1)) + duration) / count;
      await redis('HSET', statsKey, 'avg_duration', newAvg.toFixed(0));
    }

    // Tracking de talles
    if (size) {
      await redis('HINCRBY', `tryon:${clientDomain}:sizes`, size, 1);
    }

    console.log(`[METRICS] Event tracked for ${clientDomain}: ${success ? 'SUCCESS' : 'ERROR'}`);
  } catch (error) {
    console.error('[METRICS] Error tracking event:', error);
  }
}

// Guardar feedback (like/dislike)
export async function trackFeedback(clientDomain, feedback, requestId) {
  const feedbackKey = `tryon:${clientDomain}:feedback`;
  
  try {
    if (feedback === 'like') {
      await redis('HINCRBY', feedbackKey, 'likes', 1);
    } else if (feedback === 'dislike') {
      await redis('HINCRBY', feedbackKey, 'dislikes', 1);
    }
    
    // Guardar feedback individual con requestId
    const feedbackEvent = {
      requestId,
      feedback,
      timestamp: new Date().toISOString(),
    };
    await redis('LPUSH', `tryon:${clientDomain}:feedback:events`, JSON.stringify(feedbackEvent));
    await redis('LTRIM', `tryon:${clientDomain}:feedback:events`, 0, 999);
    
    console.log(`[METRICS] Feedback tracked for ${clientDomain}: ${feedback}`);
  } catch (error) {
    console.error('[METRICS] Error tracking feedback:', error);
  }
}

// Obtener métricas para un cliente
export async function getMetrics(clientDomain) {
  try {
    const statsKey = `tryon:${clientDomain}:stats`;
    const sizesKey = `tryon:${clientDomain}:sizes`;
    const feedbackKey = `tryon:${clientDomain}:feedback`;

    // Obtener estadísticas generales
    const stats = await redis('HGETALL', statsKey) || {};
    const sizes = await redis('HGETALL', sizesKey) || {};
    const feedback = await redis('HGETALL', feedbackKey) || {};

    // Convertir array a objeto (Upstash devuelve array plano)
    const parseHash = (arr) => {
      if (!arr || !Array.isArray(arr)) return {};
      const obj = {};
      for (let i = 0; i < arr.length; i += 2) {
        obj[arr[i]] = arr[i + 1];
      }
      return obj;
    };

    const parsedStats = Array.isArray(stats) ? parseHash(stats) : stats;
    const parsedSizes = Array.isArray(sizes) ? parseHash(sizes) : sizes;
    const parsedFeedback = Array.isArray(feedback) ? parseHash(feedback) : feedback;

    const totalGenerations = parseInt(parsedStats.total_generations || 0);
    const successful = parseInt(parsedStats.successful || 0);
    const errors = parseInt(parsedStats.errors || 0);
    const avgDuration = parseInt(parsedStats.avg_duration || 0);
    const likes = parseInt(parsedFeedback.likes || 0);
    const dislikes = parseInt(parsedFeedback.dislikes || 0);

    return {
      totalGenerations,
      successRate: totalGenerations > 0 ? ((successful / totalGenerations) * 100).toFixed(0) : 0,
      errors,
      avgDuration,
      feedbackScore: likes - dislikes,
      likes,
      dislikes,
      satisfactionRate: (likes + dislikes) > 0 
        ? ((likes / (likes + dislikes)) * 100).toFixed(0) 
        : 0,
      sizeDistribution: Object.entries(parsedSizes).map(([size, count]) => ({
        size,
        count: parseInt(count),
      })).sort((a, b) => {
        const order = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
        return order.indexOf(a.size) - order.indexOf(b.size);
      }),
    };
  } catch (error) {
    console.error('[METRICS] Error getting metrics:', error);
    return null;
  }
}

// Obtener eventos recientes
export async function getRecentEvents(clientDomain, limit = 50) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const eventKey = `tryon:${clientDomain}:events:${today}`;
    
    const events = await redis('LRANGE', eventKey, 0, limit - 1);
    return (events || []).map(e => {
      try {
        return JSON.parse(e);
      } catch {
        return e;
      }
    });
  } catch (error) {
    console.error('[METRICS] Error getting recent events:', error);
    return [];
  }
}
