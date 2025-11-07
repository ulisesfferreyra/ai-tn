// /pages/api/tryon.js (Next.js API Route)

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
const log = (...args) => IS_DEV && console.log('[TRY-ON]', ...args);
const warn = (...args) => console.warn('[TRY-ON]', ...args);
const err = (...args) => console.error('[TRY-ON]', ...args);

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
  // Acepta "data:image/<type>;base64,<data>"
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

async function normalizeToJpegBuffer(base64, mime) {
  const input = Buffer.from(base64, 'base64');
  try {
    const meta = await sharp(input).metadata();
    // Convertimos todo a JPEG de forma consistente
    if (meta.format === 'heif' || meta.format === 'heic' || meta.format === 'webp' || meta.format === 'png' || meta.format === 'tiff') {
      return await sharp(input).jpeg({ quality: 90 }).toBuffer();
    }
    // Si ya es JPEG, devolvemos tal cual
    return input;
  } catch (e) {
    warn('normalizeToJpegBuffer: sharp metadata error, devolviendo buffer original:', e.message);
    return input; // fallback: enviar como llegó
  }
}

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
  // Intenta extraer la primera parte tipo inlineData con data base64
  // Soporta distintas versiones del SDK/estructura
  try {
    // v1-style
    const cand = resp?.candidates?.[0];
    const parts = cand?.content?.parts || cand?.content?.[0]?.parts || [];
    for (const p of parts) {
      if (p?.inlineData?.data) return p.inlineData.data;
      if (p?.inline_data?.data) return p.inline_data.data;
    }
  } catch (e) {
    err('safePickGeneratedImage v1 path error:', e);
  }
  try {
    // Algunas respuestas exponen "output" o "data"
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

  // Logs (reducidos si no es dev)
  log('INIT', { method: req.method, url: req.url });
  if (IS_DEV) {
    log('Headers:', req.headers);
    log('Body keys:', Object.keys(req.body || {}));
  }

  try {
    const { productImage, productImages, size, userImage, userOrientation } = req.body || {};

    // Validaciones básicas
    if (!userImage) return res.status(400).json({ success: false, error: 'No se recibió imagen del usuario' });
    const selectedOrientation = ALLOWED_ORIENTATIONS.has(userOrientation) ? userOrientation : 'front';

    // Unificar productImages
    let productImagesArray = [];
    if (Array.isArray(productImages) && productImages.length) productImagesArray = productImages;
    else if (productImage) productImagesArray = [productImage];

    // Parseo/normalización de imagen de usuario
    const parsedUser = parseDataUrl(userImage);
    if (!parsedUser) return res.status(400).json({ success: false, error: 'userImage debe ser data URL base64' });
    const processedUserImage = await normalizeToJpegBuffer(parsedUser.base64, parsedUser.mime);

    // Armar texto de ayuda para el prompt (posiciones relativas)
    const productImagesCount = productImagesArray.length;
    const productImagesText =
      productImagesCount === 0 ? 'no product images (reject if none match)' :
      productImagesCount === 1 ? 'the second image' :
      `images 2 through ${productImagesCount + 1}`;

    // Build prompt unificado (anti-errores)
    const prompt = buildPrompt({
      productImagesCount,
      productImagesText,
      userOrientation: selectedOrientation,
      size,
    });

    // Partes para Gemini: prompt + persona + productos
    const parts = [
      { text: prompt },
      { inlineData: { mimeType: 'image/jpeg', data: processedUserImage.toString('base64') } },
    ];

    // Agregar producto(s)
    for (let i = 0; i < productImagesArray.length; i++) {
      const parsed = parseDataUrl(productImagesArray[i]);
      if (!parsed) {
        warn(`productImages[${i}] no es data URL válida. Se omite.`);
        continue;
      }
      const buf = await normalizeToJpegBuffer(parsed.base64, parsed.mime);
      parts.push({
        inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') },
      });
    }

    // Init modelo
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' });

    log(`Enviando a Gemini. Parts=${parts.length} Orientation=${selectedOrientation} Size=${size || 'M'}`);

    // Llamada al modelo
    const result = await model.generateContent({ contents: [{ role: 'user', parts }] });
    const response = await result.response;

    if (!response) throw new Error('Sin respuesta de Gemini');

    // Extracción robusta de imagen
    const imageBase64 = safePickGeneratedImage(response);
    if (!imageBase64) {
      // Log detallado solo en dev
      if (IS_DEV) log('Respuesta cruda:', JSON.stringify(response, null, 2));
      throw new Error('No se pudo extraer la imagen generada');
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

  } catch (e) {
    err('AI Try-On error:', e.message);
    // Fallback: devolver la imagen original del usuario para no romper flujos
    try {
      const { userImage, size } = req.body || {};
      return res.json({
        success: true,
        description: 'Imagen procesada (modo fallback)',
        originalImage: userImage || null,
        generatedImage: userImage || null,
        finalImage: userImage || null,
        size: size || 'M',
        fallback: true,
        timestamp: new Date().toISOString(),
      });
    } catch (fallbackErr) {
      err('Fallback error:', fallbackErr.message);
      return res.status(500).json({ success: false, error: 'Error procesando imagen' });
    }
  }
}



