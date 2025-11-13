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
  if (typeof dataUrl !== 'string') return null;
  
  // Normalizar data URLs con prefijos duplicados (ej: data:image/jpeg;base64,data:image/jpeg;base64,...)
  let normalized = dataUrl;
  if (normalized.includes('data:image/')) {
    const matches = normalized.match(/data:image\/[^;]+;base64,/g);
    if (matches && matches.length > 1) {
      // Tiene prefijos duplicados, usar solo el último
      const lastIndex = normalized.lastIndexOf('data:image/');
      if (lastIndex > 0) {
        normalized = normalized.substring(lastIndex);
        warn('⚠️ Normalizado data URL (prefijos duplicados detectados)');
      }
    }
  }
  
  if (!normalized.startsWith('data:image/')) return null;
  const m = normalized.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
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
⚙️ MODE: DETAILED_SLOW_ANALYSIS
Before performing any image generation:
- Take time to analyze all product images thoroughly.
- Perform reasoning in multiple passes:
  1. Identify user vs product.
  2. Detect collar/neck orientation.
  3. Cross-check with all angles.
  4. Verify accuracy of front view.
Do not skip or shortcut any step. Proceed only after confirming every element.

🧠 DRESS THE USER WITH THE EXACT GARMENT FROM THE PRODUCT IMAGES

You will receive multiple images in ANY order and ANY combination:
• One image will be the USER (person to dress)
• The rest are PRODUCT images, which may include:
  • Only the garment (flat or on mannequin)
  • Only models wearing the garment
  • A mix of both

──────────────────────────────────────────────
🔍 CRITICAL ANALYSIS PROCESS — FOLLOW EXACTLY
──────────────────────────────────────────────

Step 1: Identify User vs Product Images
• The user photo shows a person in a natural or casual environment.
• The product photos show the garment (with or without models) in a studio or controlled setting.

──────────────────────────────────────────────
🧩 Step 2: PRIORITY CHECK — NECK & COLLAR DETECTION (Primary Orientation Rule)
──────────────────────────────────────────────
Immediately analyze all product images to detect if the garment includes a visible neckline or collar.

If a collar or neckline is visible:
• Treat that side as the FRONT of the garment.
• Indicators:
  - Folded collars, plackets, or button lines
  - V-neck, crew neck, polo neck, or shirt collar
  - The side where the collar opens, folds, or dips lower = FRONT

If no collar or neckline is visible (flat back surface, no cutout or buttons):
• Treat that side as the BACK of the garment.
• Cross-check for confirmation in Step 3.

💡 Neck-first rule:
"If there is a visible collar or neckline → that is the front.
 If there isn't → that side represents the back."

──────────────────────────────────────────────
👔 Step 3: Cross-Reference With Product Context
──────────────────────────────────────────────
If the collar check is inconclusive or both sides have collars (e.g., hoodies, jackets):
1. Prioritize model photos — the design on the model's chest = FRONT.
2. If no model photos exist, check:
   - Tag position → back
   - Button placket → front
   - Graphics/text/logos → front
   - Neckline depth (front is lower/wider)
   - Fabric folds or stitching direction (front drape is smoother)

──────────────────────────────────────────────
🧠 Step 4: Confirm Orientation
──────────────────────────────────────────────
After completing neck/collar and structure analysis:
• Decide which side is FRONT and which is BACK.
• Use ONLY the FRONT orientation to dress the user.

──────────────────────────────────────────────
🎨 Step 5: Dress the User
──────────────────────────────────────────────
• Replace ONLY the user's clothing with the product garment (using the identified FRONT).
• Preserve:
  - User's face, pose, and expression
  - Background and lighting
• Apply the garment with correct proportions and natural neck alignment.
• Match colors, patterns, logos, and text with 100% accuracy.
• Size: ${size}

──────────────────────────────────────────────
🚨 MANDATORY GUARDRAILS
──────────────────────────────────────────────
Before generating output, verify ALL conditions:

✓ NECK DETECTION: Collar or neckline analyzed first; orientation decided accordingly
✓ ORIENTATION: Front correctly identified and applied
✓ DESIGN ACCURACY: 100% match in colors, patterns, logos, and text
✓ NECK ALIGNMENT: Natural position around user's neck and shoulders
✓ GARMENT PRESENCE: Product garment clearly visible and proportional
✓ POSE PRESERVATION: User's posture identical to input
✓ FACE PRESERVATION: Face unchanged and recognizable
✓ BACKGROUND: Identical to input
✓ REALISM: Photorealistic lighting, natural fabric drape
✓ NO ARTIFACTS: No distortions, stretching, or glitches

If ANY guardrail fails:
→ DO NOT generate output
→ RETURN ERROR with detailed failure reason
→ NEVER produce "close enough" results

──────────────────────────────────────────────
🎯 FINAL GOAL
──────────────────────────────────────────────
The user must appear wearing the exact product garment,
with front correctly determined via neck/collar detection,
natural neckline alignment, and perfect visual fidelity.
`.trim();
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
          // Buscar inlineData (formato nuevo)
          if (p?.inlineData?.data && typeof p.inlineData.data === 'string' && p.inlineData.data.length > 100) {
            log('✅ Imagen encontrada en candidates[0].content.parts[].inlineData.data');
            return p.inlineData.data;
          }
          // Buscar inline_data (formato alternativo)
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

  // Logs clave (limitados en prod)
  log('INIT', { method: req.method, url: req.url });
  if (IS_DEV) {
    log('Headers:', req.headers);
    log('Body keys:', Object.keys(req.body || {}));
    const asStr = JSON.stringify(req.body || {});
    log('Body size chars:', asStr.length, '≈ MB:', (asStr.length / 1024 / 1024).toFixed(2));
  }

  try {
    const { action, productImage, productImages, size, userImage, userOrientation } = req.body || {};

    // Log para debugging
    log('Request body keys:', Object.keys(req.body || {}));
    log('Action recibida:', action);
    log('Has productImage:', !!productImage);
    log('Has userImage:', !!userImage);

    // Si la acción es 'categorize', solo categorizar la imagen del producto
    if (action === 'categorize') {
      log('✅ Modo categorización detectado');
      log(`📤 Request de categorización: productImage length=${productImage ? productImage.length : 0} chars`);
      log(`   Preview: ${productImage ? productImage.substring(0, 100) : 'N/A'}...`);
      
      if (!productImage) {
        return res.status(400).json({ success: false, error: 'No se recibió imagen del producto para categorizar' });
      }

      try {
        log(`🔍 Parseando productImage para categorización...`);
        const parsed = parseDataUrl(productImage);
        if (!parsed) {
          log(`❌ Error: productImage no es data URL válida después de parseDataUrl`);
          log(`   Raw preview: ${productImage.substring(0, 150)}...`);
          return res.status(400).json({ success: false, error: 'productImage debe ser una data URL base64 válida' });
        }
        
        log(`✅ Parseado exitosamente: mime=${parsed.mime}, base64 length=${parsed.base64.length}`);

        const processedImage = await normalizeToJpegBuffer(parsed.base64);
        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' });

        // Prompt para categorizar la imagen
        const categorizePrompt = `Analyze this clothing product image. Determine if it shows the FRONT (front-facing, with buttons, zipper, or main design visible) or BACK (back-facing, showing the back of the garment) of the clothing item.

Respond ONLY with one word: "front" or "back". If you cannot determine, respond with "unknown".`;

        const parts = [
          { text: categorizePrompt },
          { inlineData: { mimeType: 'image/jpeg', data: processedImage.toString('base64') } },
        ];

        log('📤 Enviando solicitud de categorización a Google AI...');
        const result = await model.generateContent({ contents: [{ role: 'user', parts }] });
        const response = await result.response;
        
        if (!response || !response.candidates?.[0]?.content?.parts?.[0]?.text) {
          return res.status(500).json({ success: false, error: 'No se pudo obtener respuesta de categorización' });
        }

        const categoryText = response.candidates[0].content.parts[0].text.trim().toLowerCase();
        let orientation = 'unknown';
        
        if (categoryText.includes('front')) {
          orientation = 'front';
        } else if (categoryText.includes('back')) {
          orientation = 'back';
        }

        log(`✅ Categorización completada: ${orientation}`);

        return res.json({
          success: true,
          orientation,
          rawResponse: categoryText,
        });
      } catch (error) {
        err('Error categorizando imagen:', error);
        return res.status(500).json({
          success: false,
          error: 'Error categorizando imagen',
          details: error.message,
        });
      }
    }

    // Flujo normal: generar imagen
    if (!userImage) return res.status(400).json({ success: false, error: 'No se recibió imagen del usuario' });

    // Unificar imágenes de producto
    let productImagesArray = [];
    log(`🔍 DEBUG: Verificando imágenes de producto recibidas...`);
    log(`   - productImages es array: ${Array.isArray(productImages)}`);
    log(`   - productImages length: ${Array.isArray(productImages) ? productImages.length : 'N/A'}`);
    log(`   - productImage presente: ${!!productImage}`);
    log(`   - productImage type: ${typeof productImage}`);
    if (Array.isArray(productImages) && productImages.length) {
      productImagesArray = productImages;
      log(`✅ productImages array recibido: ${productImages.length} imágenes`);
      // Log preview de cada imagen
      productImages.forEach((img, idx) => {
        log(`   [${idx + 1}] type=${typeof img}, length=${typeof img === 'string' ? img.length : 'N/A'}, preview=${typeof img === 'string' ? img.substring(0, 50) : 'N/A'}...`);
      });
    } else if (productImage) {
      productImagesArray = [productImage];
      log(`✅ productImage singular recibido`);
      log(`   type=${typeof productImage}, length=${typeof productImage === 'string' ? productImage.length : 'N/A'}, preview=${typeof productImage === 'string' ? productImage.substring(0, 50) : 'N/A'}...`);
    } else { 
      warn('⚠️ No se recibieron imágenes de producto (ni productImages ni productImage)');
    }

    log(`📊 Total de imágenes de producto a procesar: ${productImagesArray.length}`);

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

    let processedCount = 0;
    for (let i = 0; i < productImagesArray.length; i++) {
      const raw = productImagesArray[i];
      try {
        if (!raw || typeof raw !== 'string') { 
          warn(`productImages[${i}] inválida (no string)`); 
          continue; 
        }
        
        log(`📸 Procesando productImages[${i}]: ${raw.substring(0, 50)}... (${raw.length} chars)`);
        
        const parsed = parseDataUrl(raw);
        if (!parsed) { 
          warn(`productImages[${i}] no es data URL válida después de parseDataUrl`);
          log(`   Raw preview: ${raw.substring(0, 100)}...`);
          continue; 
        }

        log(`   ✅ Parseado: mime=${parsed.mime}, base64 length=${parsed.base64.length}`);

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

        // Normalizamos a jpeg para coherencia
        const buf = await normalizeToJpegBuffer(parsed.base64);
        totalMB += buf.length / 1024 / 1024;
        if (totalMB > maxTotalSizeMB) { 
          warn(`Total imágenes > ${maxTotalSizeMB}MB. Se omite productImages[${i}]`); 
          totalMB -= buf.length / 1024 / 1024; 
          continue; 
        }

        parts.push({ inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } });
        processedCount++;
        log(`+ producto[${i}] OK (${(buf.length/1024).toFixed(2)} KB)`);
      } catch (imgErr) {
        err(`Error procesando productImages[${i}]:`, imgErr.message);
        err(`   Stack:`, imgErr.stack);
      }
    }
    
    log(`📊 Total de imágenes de producto procesadas exitosamente: ${processedCount}/${productImagesArray.length}`);
    
    // Validación crítica: si no hay imágenes del producto procesadas, entrar en fallback inmediatamente
    if (processedCount === 0) {
      if (productImagesArray.length > 0) {
        warn('⚠️ CRÍTICO: Ninguna imagen del producto se pudo procesar correctamente');
        warn(`   Se recibieron ${productImagesArray.length} imágenes pero ninguna se pudo procesar`);
        warn('   Esto causará que el sistema entre en modo fallback');
      } else {
        warn('⚠️ ADVERTENCIA: No se recibieron imágenes del producto');
        warn('   Esto causará que el sistema entre en modo fallback');
      }
      // Lanzar error para entrar en modo fallback
      throw new Error('No se pudieron procesar las imágenes del producto. Entrando en modo fallback.');
    }

    log(`Parts a enviar: ${parts.length} | total aprox MB: ${totalMB.toFixed(2)} | orientation=${selectedOrientation} | size=${size || 'M'}`);
    log(`Parts breakdown: prompt=${parts[0]?.text ? 'SÍ' : 'NO'} | userImage=${parts[1]?.inlineData ? 'SÍ' : 'NO'} | productImages=${parts.length - 2} imágenes`);
    
    // Validación adicional: asegurar que tenemos al menos el prompt y la imagen del usuario
    if (parts.length < 2) {
      err('❌ ERROR CRÍTICO: No hay suficientes parts para enviar a Google AI');
      err(`   Parts disponibles: ${parts.length} (se necesitan al menos 2: prompt + userImage)`);
      throw new Error('No hay suficientes datos para procesar la solicitud');
    }

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
      
      // Normalizar userImage para evitar prefijos duplicados
      let normalizedUserImage = body.userImage;
      if (typeof normalizedUserImage === 'string') {
        // Detectar si tiene prefijo duplicado
        const matches = normalizedUserImage.match(/data:image\/[^;]+;base64,/g);
        if (matches && matches.length > 1) {
          // Tomar desde el último "data:image/"
          const lastIndex = normalizedUserImage.lastIndexOf('data:image/');
          if (lastIndex > 0) {
            normalizedUserImage = normalizedUserImage.substring(lastIndex);
            warn('⚠️ Normalizado userImage en fallback (prefijos duplicados detectados)');
          }
        }
      }
      
      return res.json({
        success: true,
        description: 'Imagen procesada (modo fallback)',
        originalImage: normalizedUserImage,
        generatedImage: normalizedUserImage,
        finalImage: normalizedUserImage,
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
