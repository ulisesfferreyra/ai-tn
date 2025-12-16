// lib/metrics.js
// Funciones para trackear métricas de AI Try-On usando Upstash Redis

import { Redis } from '@upstash/redis';

let redisClient = null;
let redisAvailable = false;

// Función helper para obtener cliente Redis de forma lazy
async function getRedis() {
  if (redisClient !== null) {
    return redisAvailable ? redisClient : null;
  }

  try {
    // Soporta ambos prefijos: KV_* (Vercel KV) y REDIS_KV_* (Upstash)
    const apiUrl = process.env.KV_REST_API_URL || process.env.REDIS_KV_REST_API_URL;
    const apiToken = process.env.KV_REST_API_TOKEN || process.env.REDIS_KV_REST_API_TOKEN;
    
    if (!apiUrl || !apiToken) {
      console.warn('⚠️ Redis not configured - Missing API URL or TOKEN');
      redisAvailable = false;
      return null;
    }
    
    console.log('✅ Redis credentials found, connecting...');

    // Usar @upstash/redis directamente con las credenciales
    redisClient = new Redis({
      url: apiUrl,
      token: apiToken,
    });
    
    // Test de conexión
    await redisClient.ping();
    
    redisAvailable = true;
    console.log('✅ Upstash Redis connected successfully');
    return redisClient;
  } catch (error) {
    console.warn('⚠️ Redis not available:', error.message);
    redisAvailable = false;
    redisClient = false; // Mark as attempted
    return null;
  }
}

// ============================================
// OBTENER DOMINIO DEL CLIENTE
// ============================================
export function getClientDomain(req) {
  const origin = req.headers?.origin || '';
  const referer = req.headers?.referer || '';
  const host = req.headers?.host || '';

  let domain = '';

  if (origin) {
    try {
      domain = new URL(origin).hostname;
    } catch (e) {
      domain = origin.replace(/https?:\/\//, '').split('/')[0];
    }
  } else if (referer) {
    try {
      domain = new URL(referer).hostname;
    } catch (e) {
      domain = referer.replace(/https?:\/\//, '').split('/')[0];
    }
  } else if (host) {
    domain = host.split(':')[0];
  }

  domain = domain.replace(/^www\./, '');
  return domain || 'unknown';
}

// ============================================
// TRACKEAR EVENTO DE TRY-ON
// ============================================
export async function trackTryOnEvent(data) {
  const redis = await getRedis();
  if (!redis) {
    console.log('📊 [METRICS-LOCAL] Try-on event (Redis not available)');
    return { stored: false, reason: 'Redis not available' };
  }

  const {
    clientDomain,
    requestId,
    success,
    model,
    processingTimeMs,
    errorType,
    userOrientation,
    selectedSize,
    productImagesCount,
    timestamp,
  } = data;

  const today = new Date().toISOString().split('T')[0];
  const hour = new Date().getHours();

  try {
    // 1. Incrementar contador total
    await redis.hincrby(`metrics:${clientDomain}:totals`, 'tryons', 1);

    // 2. Incrementar éxitos o errores
    if (success) {
      await redis.hincrby(`metrics:${clientDomain}:totals`, 'successes', 1);
    } else {
      await redis.hincrby(`metrics:${clientDomain}:totals`, 'errors', 1);
      if (errorType) {
        await redis.hincrby(`metrics:${clientDomain}:errors`, errorType, 1);
      }
    }

    // 3. Trackear por día
    await redis.hincrby(`metrics:${clientDomain}:daily:${today}`, 'tryons', 1);
    if (success) {
      await redis.hincrby(`metrics:${clientDomain}:daily:${today}`, 'successes', 1);
    }

    // 4. Trackear por hora
    await redis.hincrby(`metrics:${clientDomain}:hourly:${today}`, `h${hour}`, 1);

    // 5. Trackear por talle
    if (selectedSize) {
      await redis.hincrby(`metrics:${clientDomain}:sizes`, selectedSize, 1);
    }

    // 6. Trackear tiempo de procesamiento
    if (processingTimeMs && success) {
      await redis.lpush(`metrics:${clientDomain}:processingTimes`, processingTimeMs);
      await redis.ltrim(`metrics:${clientDomain}:processingTimes`, 0, 99);
    }

    // 7. Guardar evento reciente
    const eventData = {
      requestId,
      success,
      model,
      processingTimeMs,
      errorType,
      userOrientation,
      selectedSize,
      productImagesCount,
      timestamp: timestamp || new Date().toISOString(),
    };
    await redis.lpush(`metrics:${clientDomain}:events`, JSON.stringify(eventData));
    await redis.ltrim(`metrics:${clientDomain}:events`, 0, 99);

    console.log(`📊 [METRICS] Evento trackeado para ${clientDomain}: ${success ? '✅' : '❌'}`);
    return { stored: true };
  } catch (error) {
    console.error('❌ [METRICS] Error trackeando evento:', error);
    return { stored: false, error: error.message };
  }
}

// ============================================
// TRACKEAR FEEDBACK
// ============================================
export async function trackFeedback(clientDomain, feedbackData) {
  const redis = await getRedis();
  if (!redis) {
    console.log('📊 [METRICS-LOCAL] Feedback (Redis not available)');
    return { stored: false, reason: 'Redis not available' };
  }

  const { type, requestId, productImageUrl, selectedSize, pageUrl, timestamp } = feedbackData;
  const today = new Date().toISOString().split('T')[0];

  try {
    if (type === 'like') {
      await redis.hincrby(`metrics:${clientDomain}:totals`, 'likes', 1);
      await redis.hincrby(`metrics:${clientDomain}:daily:${today}`, 'likes', 1);
    } else if (type === 'dislike') {
      await redis.hincrby(`metrics:${clientDomain}:totals`, 'dislikes', 1);
      await redis.hincrby(`metrics:${clientDomain}:daily:${today}`, 'dislikes', 1);
    } else if (type === 'conversion') {
      await redis.hincrby(`metrics:${clientDomain}:totals`, 'conversions', 1);
      await redis.hincrby(`metrics:${clientDomain}:daily:${today}`, 'conversions', 1);
    }

    const eventData = {
      type,
      requestId,
      productImageUrl,
      selectedSize,
      pageUrl,
      timestamp: timestamp || new Date().toISOString(),
    };
    await redis.lpush(`metrics:${clientDomain}:feedback`, JSON.stringify(eventData));
    await redis.ltrim(`metrics:${clientDomain}:feedback`, 0, 99);

    console.log(`📊 [METRICS] Feedback trackeado para ${clientDomain}: ${type}`);
    return { stored: true };
  } catch (error) {
    console.error('❌ [METRICS] Error trackeando feedback:', error);
    return { stored: false, error: error.message };
  }
}

// ============================================
// OBTENER MÉTRICAS
// ============================================
export async function getMetrics(clientDomain) {
  const redis = await getRedis();
  
  if (!redis) {
    console.log('📊 [METRICS] Redis not available, returning demo data');
    return getDemoMetrics(clientDomain);
  }

  try {
    const today = new Date().toISOString().split('T')[0];

    const totals = await redis.hgetall(`metrics:${clientDomain}:totals`) || {};
    const todayData = await redis.hgetall(`metrics:${clientDomain}:daily:${today}`) || {};
    const sizeDistribution = await redis.hgetall(`metrics:${clientDomain}:sizes`) || {};

    const processingTimes = await redis.lrange(`metrics:${clientDomain}:processingTimes`, 0, -1) || [];
    const avgProcessingTime = processingTimes.length > 0
      ? Math.round(processingTimes.reduce((a, b) => a + parseInt(b), 0) / processingTimes.length)
      : 0;

    const totalTryons = parseInt(totals.tryons || 0);
    const totalSuccesses = parseInt(totals.successes || 0);
    const successRate = totalTryons > 0 ? ((totalSuccesses / totalTryons) * 100).toFixed(1) : 0;

    const totalConversions = parseInt(totals.conversions || 0);
    const conversionRate = totalSuccesses > 0 ? ((totalConversions / totalSuccesses) * 100).toFixed(1) : 0;

    const totalLikes = parseInt(totals.likes || 0);
    const totalDislikes = parseInt(totals.dislikes || 0);
    const totalFeedback = totalLikes + totalDislikes;
    const satisfactionRate = totalFeedback > 0 ? ((totalLikes / totalFeedback) * 100).toFixed(1) : 0;

    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayData = await redis.hgetall(`metrics:${clientDomain}:daily:${dateStr}`) || {};
      last7Days.push({
        date: dateStr,
        tryons: parseInt(dayData.tryons || 0),
        successes: parseInt(dayData.successes || 0),
        likes: parseInt(dayData.likes || 0),
        dislikes: parseInt(dayData.dislikes || 0),
        conversions: parseInt(dayData.conversions || 0),
      });
    }

    return {
      totals: {
        tryons: totalTryons,
        successes: totalSuccesses,
        errors: parseInt(totals.errors || 0),
        likes: totalLikes,
        dislikes: totalDislikes,
        conversions: totalConversions,
      },
      rates: {
        successRate: parseFloat(successRate),
        conversionRate: parseFloat(conversionRate),
        satisfactionRate: parseFloat(satisfactionRate),
      },
      today: {
        tryons: parseInt(todayData.tryons || 0),
        successes: parseInt(todayData.successes || 0),
        likes: parseInt(todayData.likes || 0),
        dislikes: parseInt(todayData.dislikes || 0),
        conversions: parseInt(todayData.conversions || 0),
      },
      sizeDistribution,
      avgProcessingTimeMs: avgProcessingTime,
      last7Days,
      isLiveData: true,
    };
  } catch (error) {
    console.error('❌ [METRICS] Error obteniendo métricas:', error);
    return getDemoMetrics(clientDomain);
  }
}

// ============================================
// DATOS DE DEMO
// ============================================
function getDemoMetrics(clientDomain) {
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    const tryons = Math.floor(Math.random() * 20) + 5;
    const successes = Math.floor(tryons * (0.85 + Math.random() * 0.1));
    const conversions = Math.floor(successes * (0.15 + Math.random() * 0.1));
    const likes = Math.floor(successes * (0.4 + Math.random() * 0.2));
    const dislikes = Math.floor(successes * (0.05 + Math.random() * 0.05));
    
    last7Days.push({ date: dateStr, tryons, successes, likes, dislikes, conversions });
  }
  
  const totals = last7Days.reduce((acc, day) => ({
    tryons: acc.tryons + day.tryons,
    successes: acc.successes + day.successes,
    errors: acc.errors + (day.tryons - day.successes),
    likes: acc.likes + day.likes,
    dislikes: acc.dislikes + day.dislikes,
    conversions: acc.conversions + day.conversions,
  }), { tryons: 0, successes: 0, errors: 0, likes: 0, dislikes: 0, conversions: 0 });

  return {
    totals,
    rates: {
      successRate: totals.tryons > 0 ? parseFloat(((totals.successes / totals.tryons) * 100).toFixed(1)) : 0,
      conversionRate: totals.successes > 0 ? parseFloat(((totals.conversions / totals.successes) * 100).toFixed(1)) : 0,
      satisfactionRate: (totals.likes + totals.dislikes) > 0 
        ? parseFloat(((totals.likes / (totals.likes + totals.dislikes)) * 100).toFixed(1)) 
        : 0,
    },
    today: last7Days[last7Days.length - 1],
    sizeDistribution: { 'XS': 3, 'S': 17, 'M': 45, 'L': 30, 'XL': 12 },
    avgProcessingTimeMs: 9500,
    last7Days,
    isLiveData: false,
    demoMessage: '⚠️ Mostrando datos de demostración. Configura Vercel KV para ver datos reales.',
  };
}

// ============================================
// OBTENER EVENTOS RECIENTES
// ============================================
export async function getRecentEvents(clientDomain, limit = 50) {
  const redis = await getRedis();
  if (!redis) {
    return { events: [], feedback: [], isLiveData: false };
  }

  try {
    const events = await redis.lrange(`metrics:${clientDomain}:events`, 0, limit - 1) || [];
    const feedback = await redis.lrange(`metrics:${clientDomain}:feedback`, 0, limit - 1) || [];

    return {
      events: events.map(e => { try { return JSON.parse(e); } catch { return e; } }),
      feedback: feedback.map(f => { try { return JSON.parse(f); } catch { return f; } }),
      isLiveData: true,
    };
  } catch (error) {
    console.error('❌ [METRICS] Error obteniendo eventos:', error);
    return { events: [], feedback: [], error: error.message };
  }
}
