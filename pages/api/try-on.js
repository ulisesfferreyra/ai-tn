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
  const orientation = ALLOWED_ORIENTATIONS.has(userOrientation) ? userOrientation : 'front';
  const sizeInstruction = SIZE_MAP[size?.toUpperCase?.()] || SIZE_MAP.M;

  return `
You are a virtual try-on model. Replace ONLY the garment; keep the person’s face, body, pose, hair, hands, and background identical.
Use ONLY the store product images to replicate the exact garment.

### Inputs
- PERSON IMAGE = first image (subject).
- PRODUCT IMAGES = ${productImagesCount} images: ${productImagesText}
- TARGET ORIENTATION = ${orientation}  (allowed: "front" or "back")
- SIZE = ${size || 'M'}  (XS, S, M, L, XL, XXL)

### Orientation definitions (must use all signals)
- FRONT: face visible; chest/sternum visible; neckline/placket/buttons visible; front logos/graphics; front pockets.
- BACK: back of neck/collar; shoulder blades/spine/back wrinkles; back logos/text; back pockets.
- SIDE or AMBIGUOUS: not acceptable for matching.

### Non-negotiable rules
1) ORIENTATION MATCH:
   - Use ONLY product images that match TARGET ORIENTATION exactly (front→front, back→back).
   - Side/angled/ambiguous images are REJECTED.
2) DO NOT GUESS:
   - If any image has <100% orientation certainty, do not use it.
3) FIDELITY:
   - Match type & details exactly (color, fabric/texture, knit/weave, collar/neckline, buttons/zippers, prints/logos, pocket count/placement, stitching, hem length, sleeve length).
4) NO LEAKS:
   - Do NOT reuse any clothing from the person image.
5) FIT:
   - Apply SIZE precisely: ${sizeInstruction}.
   - Preserve realistic drape, seams, shadows, specular highlights and occlusions.

### Procedure (internal—do not output text)
A) INDIVIDUAL ORIENTATION CHECK per product image:
   - Face visibility → if visible → FRONT; else evaluate neck/back/shoulders for BACK.
   - Torso cue: chest/placket vs spine/shoulder blades.
   - Feature cue: front buttons/placket/pullers/logos vs back labels/graphics.
   - Pocket cue: front pockets vs back pockets.
   - Classify: FRONT | BACK | SIDE | AMBIGUOUS.
B) CROSS-VALIDATION:
   - All chosen images must share the same orientation and consistent features (e.g., a front logo must not appear in a “back” image).
C) SELECTION:
   - Keep ONLY images classified with 100% certainty that match TARGET ORIENTATION.
   - If none qualify, STOP (better no swap than a wrong-side swap).
D) FINAL GATE (hard checklist):
   - Confirm: “Target=${orientation}. Selected images = {IDs}. Each = ${orientation} with consistent features. Confidence=100%.”
   - If any item fails, re-analyze or remove the offending image.

### Render requirements
- Replace garment using ONLY the selected product images.
- Match exact construction and details (placket direction, knit gauge, ribbing, quilting, seam placement, embroidery locations).
- Respect lighting and pose; maintain realistic occlusion with arms/hair.
- Output: a single photorealistic image. Do not output any text.
`.trim();
}

function safePickGeneratedImage(resp) {
  try {
    const cand = resp?.candidates?.[0];
    const parts = cand?.content?.parts || cand?.content?.[0]?.parts || [];
    for (const p of parts) {
      if (p?.inlineData?.data) return p.inlineData.data;
      if (p?.inline_data?.data) return p.inline_data.data;
    }
  } catch (e) {
    err('safePickGeneratedImage path error:', e);
  }
  try {
    if (resp?.output?.[0]?.inlineData?.data) return resp.output[0].inlineData.data;
  } catch (e) {
    err('safePickGeneratedImage alt path error:', e);
  }
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

    // Init modelo
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' });

    // Llamada
    let result, response;
    try {
      result = await model.generateContent({ contents: [{ role: 'user', parts }] });
      response = await result.response;
      if (!response) throw new Error('Sin respuesta de Gemini');
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
    if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.length < 100) {
      if (IS_DEV) log('Respuesta cruda:', JSON.stringify(response, null, 2));
      throw new Error('No se pudo extraer la imagen generada (imageData vacío o inválido)');
    }

    log('Imagen generada OK');
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


