// /pages/api/tryon.js
// VERSIÓN MEJORADA CON GEMINI 3 PRO IMAGE PREVIEW
// Basado en: https://ai.google.dev/gemini-api/docs/image-generation

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

// Modelo a usar: Gemini 3 Pro Image Preview tiene mejor análisis y "Thinking" por defecto
// Alternativa: 'gemini-2.5-flash-image' para mayor velocidad (pero menos precisión)
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3-pro-image-preview';

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
// PROMPT MEJORADO - Detección mejorada de orientación
// =======================
function buildPrompt({ productImagesCount, userOrientation, size }) {
  const orientation = ALLOWED_ORIENTATIONS.has(userOrientation) ? userOrientation : 'front';
  const sizeInstruction = SIZE_MAP[size?.toUpperCase?.()] || SIZE_MAP.M;

  return `You are an expert fashion AI that dresses people with clothing items.

TASK: Dress the user (first image) with the exact garment from the product images (remaining images).

⚠️ CRITICAL: ORIENTATION DETECTION RULES - FOLLOW EXACTLY

IMAGE ORDER (FIXED):
- Image 1: USER (person to dress) - ALWAYS
- Image 2: First product image (could be front OR back - you must determine)
- Image 3, 4, etc.: Additional product images (may include models wearing the garment)

STEP 1: Identify User vs Product Images
- Image 1 = USER (person to dress)
- Images 2+ = PRODUCT images (the garment)

STEP 2: DETERMINE IF IMAGE 2 IS FRONT OR BACK

CRITICAL LOGIC - Follow this EXACT sequence:

A) Search for MODEL photos in images 3, 4, etc.:
   - Look for images showing a PERSON/MODEL wearing the garment facing the camera (front view)
   - If you find such an image, note the design/graphics visible on the FRONT of the garment (chest area)

B) Compare designs:
   - Extract the design/graphics from Image 2 (first product image)
   - Extract the design/graphics from the model photo (if found in images 3+)
   - Compare them carefully:
     * Are they the SAME design/graphics? → Image 2 is likely the FRONT
     * Are they DIFFERENT designs/graphics? → Image 2 is the BACK

C) Decision rule:
   - IF you found a model photo (in images 3+) showing the garment from the front:
     * IF the design/graphics on the model's front ≠ design/graphics on Image 2:
       → Image 2 = BACK of the garment
       → Use the model photo to identify the correct FRONT design
     * IF the design/graphics on the model's front = design/graphics on Image 2:
       → Image 2 = FRONT of the garment
   
   - IF no model photo found in images 3+:
     * Analyze Image 2 for orientation indicators:
       - FRONT: collars, necklines, buttons, zippers, main graphics/logos, text, complex designs
       - BACK: simpler design, tags, no collar/buttons, different graphics than front
     * Use these indicators to determine if Image 2 is front or back

STEP 3: Determine Correct FRONT Design to Use
- If Image 2 is the BACK: Look for the FRONT design in model photos (images 3+) or other product images
- If Image 2 is the FRONT: Use Image 2's design
- Always use the FRONT side design to dress the user

DRESSING INSTRUCTIONS:
- Replace ONLY the user's clothing with the product garment
- Use the CORRECT FRONT side design (as determined by the comparison logic above)
- Preserve: user's face, pose, expression, background, lighting
- Match colors, patterns, logos, graphics, and text with 100% accuracy from the FRONT side
- Ensure natural neckline alignment and proper fit
- Size: ${sizeInstruction}
- Make it photorealistic with natural fabric drape

VERIFICATION BEFORE GENERATING:
✓ Compared Image 2 design with model photo design (if model photo exists)
✓ Correctly determined if Image 2 is FRONT or BACK based on design comparison
✓ Using the FRONT design (not the back) to dress the user
✓ Design/graphics match what should be on the front of the garment
✓ User's pose and orientation match the garment application

OUTPUT:
Generate a single high-quality image showing the user wearing the exact product garment (FRONT side) with perfect visual fidelity.`.trim();
}

function safePickGeneratedImage(resp) {
  // Estrategia 1: Buscar en candidates[0].content.parts (formato estándar)
  try {
    const cand = resp?.candidates?.[0];
    if (cand) {
      const content = cand.content || cand?.content?.[0];
      if (content) {
        const parts = content.parts || content?.parts || [];
        for (const p of parts) {
          // Formato nuevo: inlineData
          if (p?.inlineData?.data && typeof p.inlineData.data === 'string' && p.inlineData.data.length > 100) {
            log('✅ Imagen encontrada en candidates[0].content.parts[].inlineData.data');
            return p.inlineData.data;
          }
          // Formato alternativo: inline_data
          if (p?.inline_data?.data && typeof p.inline_data.data === 'string' && p.inline_data.data.length > 100) {
            log('✅ Imagen encontrada en candidates[0].content.parts[].inline_data.data');
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
    if (resp?.output?.[0]?.inlineData?.data && typeof resp.output[0].inlineData.data === 'string' && resp.output[0].inlineData.data.length > 100) {
      log('✅ Imagen encontrada en output[0].inlineData.data');
      return resp.output[0].inlineData.data;
    }
    if (resp?.output?.[0]?.inline_data?.data && typeof resp.output[0].inline_data.data === 'string' && resp.output[0].inline_data.data.length > 100) {
      log('✅ Imagen encontrada en output[0].inline_data.data');
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
            if (p?.inlineData?.data && typeof p.inlineData.data === 'string' && p.inlineData.data.length > 100) {
              log(`✅ Imagen encontrada en candidates[${i}].content.parts[].inlineData.data`);
              return p.inlineData.data;
            }
            if (p?.inline_data?.data && typeof p.inline_data.data === 'string' && p.inline_data.data.length > 100) {
              log(`✅ Imagen encontrada en candidates[${i}].content.parts[].inline_data.data`);
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

  log('INIT', { method: req.method, url: req.url, model: MODEL_NAME });
  
  if (IS_DEV) {
    log('Headers:', req.headers);
    log('Body keys:', Object.keys(req.body || {}));
    const asStr = JSON.stringify(req.body || {});
    log('Body size chars:', asStr.length, '≈ MB:', (asStr.length / 1024 / 1024).toFixed(2));
  }

  try {
    const { productImage, productImages, size, userImage, userOrientation } = req.body || {};

    if (!userImage) return res.status(400).json({ success: false, error: 'No se recibió imagen del usuario' });

    // Unificar imágenes de producto (máximo 3 según el frontend)
    let productImagesArray = [];
    if (Array.isArray(productImages) && productImages.length) {
      productImagesArray = productImages.slice(0, 3); // Limitar a 3 imágenes
    } else if (productImage) {
      productImagesArray = [productImage];
    }

    const selectedOrientation = ALLOWED_ORIENTATIONS.has(userOrientation) ? userOrientation : 'front';

    // Parse/normalize user image
    const parsedUser = parseDataUrl(userImage);
    if (!parsedUser) {
      return res.status(400).json({ success: false, error: 'userImage debe ser una data URL base64 (data:image/...;base64,...)' });
    }

    const processedUserImage = await normalizeToJpegBuffer(parsedUser.base64);

    // PROMPT mejorado (más simple, el modelo hace el "Thinking" automáticamente)
    const prompt = buildPrompt({
      productImagesCount: productImagesArray.length,
      userOrientation: selectedOrientation,
      size,
    });

    // Construir partes según la nueva documentación de Gemini
    // IMPORTANTE: El orden de las imágenes es:
    // 1. Primera imagen: USER (persona a vestir)
    // 2. Siguientes imágenes: PRODUCT (pueden estar en cualquier orden, no asumir que la primera es el frente)
    // Formato: [{ text: prompt }, { inlineData: { mimeType, data } }, ...]
    const parts = [
      { text: prompt },
      { inlineData: { mimeType: 'image/jpeg', data: processedUserImage.toString('base64') } },
    ];

    // Validaciones y normalización de imágenes de producto
    const maxImageSizeMB = 4;
    const maxTotalSizeMB = 15;
    let totalMB = processedUserImage.length / 1024 / 1024;

    for (let i = 0; i < productImagesArray.length; i++) {
      const raw = productImagesArray[i];
      try {
        if (!raw || typeof raw !== 'string') { 
          warn(`productImages[${i}] inválida (no string)`); 
          continue; 
        }

        const parsed = parseDataUrl(raw);
        if (!parsed) { 
          warn(`productImages[${i}] no es data URL válida`); 
          continue; 
        }

        const supported = /^(image\/)(jpeg|jpg|png|webp)$/i.test(parsed.mime);
        if (!supported) { 
          warn(`productImages[${i}] formato no soportado: ${parsed.mime}`); 
          continue; 
        }

        // Calcular tamaño aprox del base64 (antes de normalizar)
        const approxMB = parsed.base64.length / 1024 / 1024;
        if (approxMB > maxImageSizeMB) { 
          warn(`productImages[${i}] > ${maxImageSizeMB}MB (${approxMB.toFixed(2)} MB)`); 
          continue; 
        }

        // Normalizar a jpeg para coherencia
        const buf = await normalizeToJpegBuffer(parsed.base64);
        totalMB += buf.length / 1024 / 1024;

        if (totalMB > maxTotalSizeMB) { 
          warn(`Total imágenes > ${maxTotalSizeMB}MB. Se omite productImages[${i}]`); 
          totalMB -= buf.length / 1024 / 1024; 
          continue; 
        }

        parts.push({ inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } });
        log(`+ producto[${i}] OK (${(buf.length/1024).toFixed(2)} KB)`);
      } catch (imgErr) {
        err(`Error procesando productImages[${i}]:`, imgErr.message);
      }
    }

    log(`Parts a enviar: ${parts.length} | total aprox MB: ${totalMB.toFixed(2)} | orientation=${selectedOrientation} | size=${size || 'M'}`);
    log(`Parts breakdown: prompt=${parts[0]?.text ? 'SÍ' : 'NO'} | userImage=${parts[1]?.inlineData ? 'SÍ' : 'NO'} | productImages=${parts.length - 2} imágenes`);
    log(`⚠️ IMPORTANTE: El orden de las imágenes NO indica frente/espalda. El modelo debe analizar cada imagen para determinar la orientación correcta.`);

    // Inicializar modelo según nueva documentación
    const genAI = new GoogleGenerativeAI(API_KEY);
    
    // Usar generateContent con el formato correcto según la nueva documentación
    // El modelo gemini-3-pro-image-preview tiene "Thinking" por defecto para mejor análisis
    const model = genAI.getGenerativeModel({ 
      model: MODEL_NAME,
      // Configuración opcional para mejorar la generación
      generationConfig: {
        temperature: 0.4, // Más determinístico para mejor precisión
        topP: 0.95,
        topK: 40,
      }
    });

    // Llamada según nueva documentación
    let result, response;
    try {
      log('📤 Enviando solicitud a Google AI (Gemini Image Generation)...');
      const requestStartTime = Date.now();

      // Formato según nueva documentación: contents con array de parts
      result = await model.generateContent({ 
        contents: [{ 
          role: 'user', 
          parts: parts 
        }] 
      });

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
      // Clasificación de errores
      const msg = aiError?.message || '';
      if (msg.includes('SAFETY')) throw new Error('Contenido bloqueado por filtros de seguridad de Google AI');
      if (msg.includes('QUOTA')) throw new Error('Límite de cuota de Google AI excedido. Intenta más tarde.');
      if (msg.toLowerCase().includes('timeout')) throw new Error('La solicitud a Google AI tardó demasiado tiempo. Intenta con menos imágenes.');
      throw aiError;
    }

    // Extraer imagen generada
    const imageBase64 = safePickGeneratedImage(response);
    
    if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.length < 100) {
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

      // Si hay texto en la respuesta, loguearlo
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

    log('✅ Imagen generada exitosamente');
    
    return res.json({
      success: true,
      description: 'Imagen generada exitosamente con IA',
      generatedImage: `data:image/jpeg;base64,${imageBase64}`,
      size: size || 'M',
      orientation: selectedOrientation,
      model: MODEL_NAME,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    // Diagnóstico extendido
    const body = req.body || {};
    const hasUser = !!body.userImage;
    const userLen = typeof body.userImage === 'string' ? body.userImage.length : 0;
    const prodCount = Array.isArray(body.productImages) ? body.productImages.length : 0;

    let errorType = 'UNKNOWN';
    let errorDescription = error.message || 'Error desconocido';
    const msg = (errorDescription || '').toUpperCase();

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

      return res.json({
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
      });
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

