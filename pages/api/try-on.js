// /pages/api/tryon.js

import sharp from 'sharp';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ───────────────────────────────────────────────────────────────────────────────
// Config API (20 MB para múltiples imágenes)
// ───────────────────────────────────────────────────────────────────────────────
export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────────
const IS_DEV = process.env.NODE_ENV !== 'production';
const log  = (...a) => IS_DEV && console.log('[TRY-ON]', ...a);
const warn = (...a) => console.warn('[TRY-ON]', ...a);
const err  = (...a) => console.error('[TRY-ON]', ...a);

const ALLOWED_ORIENTATIONS = new Set(['front', 'back']);
const SIZE_MAP = {
  XS: 'very tight, form-fitting',
  S: 'fitted, slightly snug, close to body',
  M: 'standard fit, comfortable, natural',
  L: 'relaxed fit, slightly loose, comfortable',
  XL: 'oversized, loose-fitting, baggy',
  XXL: 'very oversized, very loose, very baggy',
};

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

async function normalizeToJpegBuffer(base64) {
  const input = Buffer.from(base64, 'base64');
  try {
    const meta = await sharp(input).metadata();
    if (['heif', 'heic', 'webp', 'png', 'tiff'].includes(meta.format)) {
      return await sharp(input).jpeg({ quality: 90 }).toBuffer();
    }
    return input; // ya es jpeg u otro soportado
  } catch (e) {
    warn('normalizeToJpegBuffer: metadata error, devolviendo buffer original:', e.message);
    return input;
  }
}

// =======================
// PROMPT (NO TOCAR)
// =======================
function buildPrompt({ productImagesCount, productImagesText, userOrientation, size }) {
  const sizeInstruction = SIZE_MAP[size?.toUpperCase?.()] || SIZE_MAP.M;
  const orientation = ALLOWED_ORIENTATIONS.has(userOrientation) ? userOrientation : 'front';
  const orientationText = orientation === 'front' ? 'FRENTE' : 'ESPALDA';

  // Prompt simplificado como el código React que funcionaba
  // Confía en que la IA interprete naturalmente las imágenes
  return `VESTIR AL USUARIO CON LA PRENDA EXACTA DE LAS IMÁGENES DEL PRODUCTO.

IMPORTANTE: Después de mi mensaje, recibirás:
1. La foto del usuario (persona) - IMAGEN #1
   - El usuario está de ${orientationText.toLowerCase()} (${orientationText})
2. ${productImagesCount} imagen${productImagesCount !== 1 ? 'es' : ''} de la prenda de ropa del producto - IMÁGENES #2 a #${productImagesCount + 1}

TU TAREA:
- Reemplaza SOLO la ropa del usuario con la prenda de las imágenes del producto
- Mantén TODO lo demás igual: cuerpo, cara, pose, expresión, fondo, iluminación
- Usa EXACTAMENTE el diseño, colores, estampados y gráficos de las imágenes del producto
- Analiza todas las imágenes del producto para entender el diseño completo
- El usuario está de ${orientationText.toLowerCase()}, así que usa las imágenes del producto que muestran la ${orientationText.toLowerCase()} de la prenda
- Replica el tipo de calce (oversized, slim fit, regular fit) que veas en las imágenes del producto
- NO inventes prendas nuevas
- NO cambies el diseño
- NO cambies la pose del usuario
- Talle: ${size || 'M'}

RESULTADO: El usuario usando EXACTAMENTE la prenda de las imágenes del producto, nada más.`.trim();
}

function safePickGeneratedImage(resp) {
  // Estrategia 1: Buscar en candidates[0].content.parts
  try {
    const cand = resp?.candidates?.[0];
    if (cand) {
      // Intentar diferentes estructuras de content
      const content = cand.content || cand?.content?.[0];
      if (content) {
        const parts = content.parts || content?.parts || [];
        for (const p of parts) {
          // Buscar inlineData (formato nuevo) - aumentar mínimo a 5000 caracteres
          if (p?.inlineData?.data && typeof p.inlineData.data === 'string' && p.inlineData.data.length > 5000) {
            log(`✅ Imagen encontrada en candidates[0].content.parts[].inlineData.data (${p.inlineData.data.length} chars)`);
            return p.inlineData.data;
          }
          // Buscar inline_data (formato alternativo) - aumentar mínimo a 5000 caracteres
          if (p?.inline_data?.data && typeof p.inline_data.data === 'string' && p.inline_data.data.length > 5000) {
            log(`✅ Imagen encontrada en candidates[0].content.parts[].inline_data.data (${p.inline_data.data.length} chars)`);
            return p.inline_data.data;
          }
        }
      }
    }
  } catch (e) {
    err('safePickGeneratedImage path error:', e);
  }
  
  // Estrategia 2: Buscar en output[0].inlineData
  try {
    if (resp?.output?.[0]?.inlineData?.data && typeof resp.output[0].inlineData.data === 'string' && resp.output[0].inlineData.data.length > 5000) {
      log(`✅ Imagen encontrada en output[0].inlineData.data (${resp.output[0].inlineData.data.length} chars)`);
      return resp.output[0].inlineData.data;
    }
    if (resp?.output?.[0]?.inline_data?.data && typeof resp.output[0].inline_data.data === 'string' && resp.output[0].inline_data.data.length > 5000) {
      log(`✅ Imagen encontrada en output[0].inline_data.data (${resp.output[0].inline_data.data.length} chars)`);
      return resp.output[0].inline_data.data;
    }
  } catch (e) {
    err('safePickGeneratedImage alt path error:', e);
  }
  
  // Estrategia 3: Buscar en todos los candidates
  try {
    if (resp?.candidates && Array.isArray(resp.candidates)) {
      for (let i = 0; i < resp.candidates.length; i++) {
        const cand = resp.candidates[i];
        const content = cand?.content;
        if (content) {
          const parts = content.parts || [];
          for (const p of parts) {
            if (p?.inlineData?.data && typeof p.inlineData.data === 'string' && p.inlineData.data.length > 5000) {
              log(`✅ Imagen encontrada en candidates[${i}].content.parts[].inlineData.data (${p.inlineData.data.length} chars)`);
              return p.inlineData.data;
            }
            if (p?.inline_data?.data && typeof p.inline_data.data === 'string' && p.inline_data.data.length > 5000) {
              log(`✅ Imagen encontrada en candidates[${i}].content.parts[].inline_data.data (${p.inline_data.data.length} chars)`);
              return p.inline_data.data;
            }
          }
        }
      }
    }
  } catch (e) {
    err('safePickGeneratedImage candidates loop error:', e);
  }
  
  log('⚠️ No se encontró imagen en ninguna ubicación conocida de la respuesta');
  return null;
}

function ensureCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ───────────────────────────────────────────────────────────────────────────────
// Handler
// ───────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  ensureCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const API_KEY = process.env.GOOGLE_AI_API_KEY;
  if (!API_KEY) return res.status(500).json({ success: false, error: 'Falta GOOGLE_AI_API_KEY' });

  // Logs clave (limitados en prod)
  log('INIT', { method: req.method, url: req.url });
  if (IS_DEV) {
    log('Headers:', req.headers);
    log('Body keys:', Object.keys(req.body || {}));
    const asStr = JSON.stringify(req.body || {});
    log('Body size chars:', asStr.length, '≈ MB:', (asStr.length / 1024 / 1024).toFixed(2));
  }

  try {
    const { productImage, productImages, size, userImage, userOrientation } = req.body || {};

    if (!userImage) return res.status(400).json({ success: false, error: 'No se recibió imagen del usuario' });

    // Unificar imágenes de producto
    let productImagesArray = [];
    if (Array.isArray(productImages) && productImages.length) productImagesArray = productImages;
    else if (productImage) productImagesArray = [productImage];

    const selectedOrientation = ALLOWED_ORIENTATIONS.has(userOrientation) ? userOrientation : 'front';

    // Parse/normalize user image (espera data URL)
    const parsedUser = parseDataUrl(userImage);
    if (!parsedUser) {
      return res.status(400).json({ success: false, error: 'userImage debe ser una data URL base64 (data:image/...;base64,...)' });
    }
    const processedUserImage = await normalizeToJpegBuffer(parsedUser.base64);

    // Texto de ayuda para el prompt respecto al índice relativo
    const productImagesCount = productImagesArray.length;
    const productImagesText =
      productImagesCount === 0 ? 'no product images (reject if none match)' :
      productImagesCount === 1 ? 'the second image' :
      `images 2 through ${productImagesCount + 1}`;

    // PROMPT unificado (NO TOCAR)
    const prompt = buildPrompt({
      productImagesCount,
      productImagesText,
      userOrientation: selectedOrientation,
      size,
    });

    // Partes: prompt + persona + productos
    const parts = [
      { text: prompt },
      { inlineData: { mimeType: 'image/jpeg', data: processedUserImage.toString('base64') } },
    ];

    // Validaciones finales de tus cambios (4 MB c/u, 15 MB total, formatos soportados)
    const maxImageSizeMB = 4;
    const maxTotalSizeMB = 15;
    let totalMB = processedUserImage.length / 1024 / 1024;

    for (let i = 0; i < productImagesArray.length; i++) {
      const raw = productImagesArray[i];
      try {
        if (!raw || typeof raw !== 'string') { warn(`productImages[${i}] inválida (no string)`); continue; }
        const parsed = parseDataUrl(raw);
        if (!parsed) { warn(`productImages[${i}] no es data URL válida`); continue; }

        const supported = /^(image\/)(jpeg|jpg|png|webp)$/i.test(parsed.mime);
        if (!supported) { warn(`productImages[${i}] formato no soportado: ${parsed.mime}`); continue; }

        // Calcular tamaño aprox del base64 (antes de normalizar)
        const approxMB = parsed.base64.length / 1024 / 1024;
        if (approxMB > maxImageSizeMB) { warn(`productImages[${i}] > ${maxImageSizeMB}MB (${approxMB.toFixed(2)} MB)`); continue; }

        // Normalizamos a jpeg para coherencia
        const buf = await normalizeToJpegBuffer(parsed.base64);
        totalMB += buf.length / 1024 / 1024;
        if (totalMB > maxTotalSizeMB) { warn(`Total imágenes > ${maxTotalSizeMB}MB. Se omite productImages[${i}]`); totalMB -= buf.length / 1024 / 1024; continue; }

        parts.push({ inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } });
        log(`+ producto[${i}] OK (${(buf.length/1024).toFixed(2)} KB)`);
      } catch (imgErr) {
        err(`Error procesando productImages[${i}]:`, imgErr.message);
      }
    }

    log(`Parts a enviar: ${parts.length} | total aprox MB: ${totalMB.toFixed(2)} | orientation=${selectedOrientation} | size=${size || 'M'}`);
    log(`Parts breakdown: prompt=${parts[0]?.text ? 'SÍ' : 'NO'} | userImage=${parts[1]?.inlineData ? 'SÍ' : 'NO'} | productImages=${parts.length - 2} imágenes`);

    // Init modelo
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' });

    // Llamada
    let result, response;
    try {
      log('📤 Enviando solicitud a Google AI...');
      const requestStartTime = Date.now();
      result = await model.generateContent({ contents: [{ role: 'user', parts }] });
      response = await result.response;
      const requestDuration = Date.now() - requestStartTime;
      log(`✅ Respuesta recibida de Google AI en ${requestDuration}ms`);
      
      if (!response) throw new Error('Sin respuesta de Gemini');
      
      // Log básico de la estructura de la respuesta
      log('Response structure:', {
        hasCandidates: !!response.candidates,
        candidatesCount: response.candidates?.length || 0,
        firstCandidateHasContent: !!response.candidates?.[0]?.content,
        firstCandidatePartsCount: response.candidates?.[0]?.content?.parts?.length || 0
      });
      
      // Verificar si hay bloqueos de seguridad o errores
      if (response.candidates?.[0]?.finishReason) {
        const finishReason = response.candidates[0].finishReason;
        log(`Finish reason: ${finishReason}`);
        if (finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
          warn(`⚠️ Finish reason inesperado: ${finishReason}`);
          if (finishReason === 'SAFETY') {
            throw new Error('Contenido bloqueado por filtros de seguridad de Google AI');
          }
          if (finishReason === 'RECITATION') {
            throw new Error('Contenido bloqueado por políticas de recitación de Google AI');
          }
        }
      }
      
      // Verificar si hay bloqueos de seguridad en otros lugares
      if (response.promptFeedback) {
        log('Prompt feedback:', response.promptFeedback);
        if (response.promptFeedback.blockReason) {
          warn(`⚠️ Prompt bloqueado: ${response.promptFeedback.blockReason}`);
          throw new Error(`Prompt bloqueado por Google AI: ${response.promptFeedback.blockReason}`);
        }
      }
    } catch (aiError) {
      // Clasificación de errores (tus códigos)
      const msg = aiError?.message || '';
      if (msg.includes('SAFETY')) throw new Error('Contenido bloqueado por filtros de seguridad de Google AI');
      if (msg.includes('QUOTA')) throw new Error('Límite de cuota de Google AI excedido. Intenta más tarde.');
      if (msg.toLowerCase().includes('timeout')) throw new Error('La solicitud a Google AI tardó demasiado tiempo. Intenta con menos imágenes.');
      throw aiError;
    }

    // Extraer imagen generada
    const imageBase64 = safePickGeneratedImage(response);
    const userImageBase64 = parsedUser.base64;
    
    // Validación mejorada: verificar que la imagen sea válida y diferente
    if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.length < 5000) {
      // Log detallado de la respuesta para diagnóstico
      log('⚠️ No se pudo extraer imagen de la respuesta de Google AI');
      log('Response structure:', {
        hasResponse: !!response,
        hasCandidates: !!response?.candidates,
        candidatesLength: response?.candidates?.length || 0,
        firstCandidate: response?.candidates?.[0] ? {
          hasContent: !!response.candidates[0].content,
          hasParts: !!response.candidates[0].content?.parts,
          partsLength: response.candidates[0].content?.parts?.length || 0,
          partsTypes: response.candidates[0].content?.parts?.map(p => ({
            hasInlineData: !!p?.inlineData,
            hasInline_data: !!p?.inline_data,
            hasText: !!p?.text,
            textPreview: p?.text ? p.text.substring(0, 100) : null
          })) || []
        } : null,
        hasOutput: !!response?.output,
        outputLength: response?.output?.length || 0
      });
      
      // Si hay texto en la respuesta, loguearlo (puede ser un error o explicación de la IA)
      if (response?.candidates?.[0]?.content?.parts) {
        const textParts = response.candidates[0].content.parts.filter(p => p?.text);
        if (textParts.length > 0) {
          log('⚠️ La IA retornó texto en lugar de imagen:');
          textParts.forEach((part, idx) => {
            log(`   Texto [${idx}]:`, part.text);
          });
        }
      }
      
      if (IS_DEV) {
        log('Respuesta cruda completa:', JSON.stringify(response, null, 2));
      }
      throw new Error('No se pudo extraer la imagen generada (imageData vacío o inválido). La IA puede haber retornado texto en lugar de una imagen.');
    }

    // Validación mejorada: verificar que la imagen generada sea diferente de la original
    // Comparar longitud, primeros y últimos caracteres para detectar si es la misma imagen
    const lengthDiff = Math.abs(imageBase64.length - userImageBase64.length);
    const firstCharsMatch = imageBase64.substring(0, 200) === userImageBase64.substring(0, 200);
    const lastCharsMatch = imageBase64.substring(imageBase64.length - 200) === userImageBase64.substring(userImageBase64.length - 200);
    const isSameAsOriginal = lengthDiff < 500 && firstCharsMatch && lastCharsMatch;
    
    if (isSameAsOriginal) {
      warn('⚠️ La imagen generada parece ser idéntica a la original del usuario');
      warn(`   Tamaño original: ${userImageBase64.length} caracteres`);
      warn(`   Tamaño generada: ${imageBase64.length} caracteres`);
      warn(`   Diferencia de longitud: ${lengthDiff} caracteres`);
      warn(`   Primeros 200 chars coinciden: ${firstCharsMatch}`);
      warn(`   Últimos 200 chars coinciden: ${lastCharsMatch}`);
      throw new Error('La IA retornó la imagen original del usuario en lugar de generar una nueva imagen con la prenda aplicada');
    }
    
    log('Imagen generada OK');
    log(`   Tamaño original: ${userImageBase64.length} caracteres`);
    log(`   Tamaño generada: ${imageBase64.length} caracteres`);
    log(`   Diferencia: ${Math.abs(imageBase64.length - userImageBase64.length)} caracteres`);
    
    return res.json({
      success: true,
      description: 'Imagen generada exitosamente con IA',
      generatedImage: `data:image/jpeg;base64,${imageBase64}`,
      size: size || 'M',
      orientation: selectedOrientation,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    // Diagnóstico extendido (tus campos)
    const body = req.body || {};
    const hasUser = !!body.userImage;
    const userLen = typeof body.userImage === 'string' ? body.userImage.length : 0;
    const prodCount = Array.isArray(body.productImages) ? body.productImages.length : 0;

    let errorType = 'UNKNOWN';
    let errorDescription = error.message || 'Error desconocido';
    const msg = (errorDescription || '').toUpperCase();
    
    // Log detallado del error para diagnóstico
    log('========== ERROR DETECTADO ==========');
    log('Error message:', error.message);
    log('Error stack:', error.stack);
    log('Request info:', {
      hasUserImage: hasUser,
      userImageLength: userLen,
      productImagesCount: prodCount,
      hasProductImage: !!body.productImage,
      size: body.size,
      userOrientation: body.userOrientation
    });

    if (msg.includes('GOOGLE AI')) errorType = 'GOOGLE_AI_ERROR';
    if (msg.includes('IMAGEN') || msg.includes('IMAGE')) errorType = 'IMAGE_PROCESSING_ERROR';
    if (msg.includes('TIMEOUT')) errorType = 'TIMEOUT_ERROR';
    if (msg.includes('CUOTA') || msg.includes('QUOTA')) errorType = 'QUOTA_ERROR';
    if (msg.includes('SEGURIDAD') || msg.includes('SAFETY')) errorType = 'SAFETY_ERROR';

    err('========== ERROR EN AI TRY-ON ==========');
    err('Tipo:', errorType);
    err('Mensaje:', errorDescription);
    err('Stack:', error.stack);
    err('Request info -> userImage:', hasUser, 'len:', userLen, 'productImages:', prodCount, 'productImage:', !!body.productImage, 'size:', body.size, 'userOrientation:', body.userOrientation);
    err('========================================');

    // Fallback enriquecido
    try {
      if (!hasUser) {
        return res.status(400).json({
          success: false,
          error: 'No se recibió imagen del usuario y no se pudo generar la imagen',
          errorType,
          errorDetails: errorDescription,
        });
      }
      // Respuesta de fallback con información detallada
      const fallbackResponse = {
        success: true,
        description: 'Imagen procesada (modo fallback)',
        originalImage: body.userImage,
        generatedImage: body.userImage,
        finalImage: body.userImage,
        size: body.size || 'M',
        orientation: ALLOWED_ORIENTATIONS.has(body.userOrientation) ? body.userOrientation : 'front',
        fallback: true,
        errorType,
        errorReason: errorDescription,
        timestamp: new Date().toISOString(),
        // Información adicional para diagnóstico
        diagnostic: {
          userImageReceived: hasUser,
          userImageSize: userLen,
          productImagesCount: prodCount,
          errorMessage: error.message,
          errorType: errorType
        }
      };
      
      warn('⚠️ Modo fallback activado - retornando imagen original del usuario');
      warn(`   Error: ${errorType} - ${errorDescription}`);
      warn(`   User image: ${hasUser ? 'SÍ' : 'NO'} (${userLen} chars)`);
      warn(`   Product images: ${prodCount}`);
      
      return res.json(fallbackResponse);
    } catch (fallbackErr) {
      err('Fallback error:', fallbackErr.message);
      return res.status(500).json({
        success: false,
        error: 'Error procesando imagen',
        errorType,
        errorDetails: errorDescription,
        fallbackError: fallbackErr.message,
      });
    }
  }
}
