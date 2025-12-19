// /pages/api/try-on.js
// VERSIÓN MEJORADA: Análisis con OpenAI Vision + Generación con Gemini Nano Banana
// + Tracking de métricas + Ajuste visual de talle según contextura
// Basado en: 
// - https://platform.openai.com/docs/guides/images-vision
// - https://ai.google.dev/gemini-api/docs/image-generation

import sharp from 'sharp';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { trackTryOnEvent, getClientDomain } from '../../lib/metrics';

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
// Logs siempre visibles para debugging (especialmente OpenAI y Nano Banana)
const log  = (...a) => console.log('[TRY-ON]', ...a);
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

// Modelos a usar:
// - Análisis: OpenAI GPT-4 Vision para análisis de imágenes
// - Generación: Nano Banana (gemini-2.5-flash-image) para velocidad
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o'; // gpt-4o o gpt-4-turbo
const GENERATION_MODEL = 'gemini-2.5-flash-image'; // Nano Banana

// ───────────────────────────────────────────────────────────────────────────────
// NUEVO: Mapeo de contexturas a talle "natural" esperado para ajuste de fit
// ───────────────────────────────────────────────────────────────────────────────
const BUILD_TO_SIZE_MAP = {
  'very slim': 'XS',
  'slim': 'S',
  'average': 'M',
  'athletic': 'M',
  'broad': 'L',
  'plus-size': 'XL',
  'very broad': 'XXL',
};

// ───────────────────────────────────────────────────────────────────────────────
// NUEVO: Función para calcular el ajuste visual basado en contextura vs talle
// ───────────────────────────────────────────────────────────────────────────────
function calculateFitAdjustment(userBuild, selectedSize) {
  const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const normalizedBuild = (userBuild || 'average').toLowerCase();
  
  // Determinar el talle "natural" para esta contextura
  let naturalSize = 'M';
  for (const [build, size] of Object.entries(BUILD_TO_SIZE_MAP)) {
    if (normalizedBuild.includes(build)) {
      naturalSize = size;
      break;
    }
  }
  
  const naturalIndex = sizeOrder.indexOf(naturalSize);
  const selectedIndex = sizeOrder.indexOf((selectedSize || 'M').toUpperCase());
  const difference = selectedIndex - naturalIndex;
  
  // difference < 0 = talle chico para su contextura (prenda ajustada)
  // difference > 0 = talle grande para su contextura (prenda suelta)
  
  if (difference <= -2) {
    return {
      type: 'very_tight',
      intensity: 2,
      naturalSize,
      selectedSize,
      description: `Talle ${selectedSize} MUY CHICO para contextura ${userBuild}`,
      visualInstruction: `CRITICAL FIT ADJUSTMENT: User has ${userBuild} build but chose size ${selectedSize} (their natural size would be ${naturalSize}). 
The garment MUST appear VERY TIGHT and SMALL on them:
- Fabric visibly stretched and pulling at seams
- Garment clinging tightly to body, showing body contours
- Sleeves too short, riding up on arms
- Torso section too short, may ride up
- Visible strain lines in fabric
- Limited movement appearance
- The garment should look like it's 2 sizes too small`
    };
  } else if (difference === -1) {
    return {
      type: 'tight',
      intensity: 1,
      naturalSize,
      selectedSize,
      description: `Talle ${selectedSize} algo chico para contextura ${userBuild}`,
      visualInstruction: `FIT ADJUSTMENT: User has ${userBuild} build but chose size ${selectedSize} (slightly small for them).
The garment should appear FITTED/SNUG:
- Fabric slightly stretched, form-fitting
- Garment close to body but not extremely tight
- Sleeves may be slightly short
- Shows body shape more than intended
- Minimal fabric excess
- The garment should look like it's 1 size too small`
    };
  } else if (difference === 0) {
    return {
      type: 'normal',
      intensity: 0,
      naturalSize,
      selectedSize,
      description: `Talle ${selectedSize} adecuado para contextura ${userBuild}`,
      visualInstruction: `STANDARD FIT: User's build (${userBuild}) matches the selected size (${selectedSize}).
Generate the garment with natural, intended fit:
- Fabric drapes naturally as designed
- Proper sleeve length
- Comfortable fit, not too tight or loose
- As shown on the product model`
    };
  } else if (difference === 1) {
    return {
      type: 'loose',
      intensity: 1,
      naturalSize,
      selectedSize,
      description: `Talle ${selectedSize} algo grande para contextura ${userBuild}`,
      visualInstruction: `FIT ADJUSTMENT: User has ${userBuild} build but chose size ${selectedSize} (slightly large for them).
The garment should appear RELAXED/LOOSE:
- Extra fabric visible, slight bagginess
- Sleeves may be slightly long
- Garment doesn't cling to body
- More casual, relaxed appearance
- Some fabric bunching possible
- The garment should look like it's 1 size too big`
    };
  } else {
    return {
      type: 'very_loose',
      intensity: 2,
      naturalSize,
      selectedSize,
      description: `Talle ${selectedSize} MUY GRANDE para contextura ${userBuild}`,
      visualInstruction: `CRITICAL FIT ADJUSTMENT: User has ${userBuild} build but chose size ${selectedSize} (their natural size would be ${naturalSize}).
The garment MUST appear VERY LOOSE and OVERSIZED:
- Significant excess fabric everywhere
- Sleeves too long, past wrists
- Shoulder seams dropping below shoulders
- Garment length longer than intended
- Fabric draping and bunching visibly
- Very baggy, swimming in the garment
- The garment should look like it's 2+ sizes too big`
    };
  }
}

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

  return `VIRTUAL TRY-ON TASK – DYNAMIC GARMENT APPLICATION

You will receive TWO images:
1.⁠ ⁠USER IMAGE – the person to dress
2.⁠ ⁠GARMENT IMAGE – the exact garment to apply

══════════════════════════════════════════════
USER BODY ANALYSIS
══════════════════════════════════════════════
Height: {{user_image.body_analysis.height}}
Build: {{user_image.body_analysis.build}}
Shoulder width: {{user_image.body_analysis.shoulder_width}}
Torso length: {{user_image.body_analysis.torso_length}}
Arm length: {{user_image.body_analysis.arm_length}}

══════════════════════════════════════════════
GARMENT SPECIFICATIONS (DO NOT DEVIATE)
══════════════════════════════════════════════
GARMENT TYPE: {{garment_type.category}}
SLEEVES: {{garment_type.sleeves}}
NECKLINE: {{garment_type.neckline}}
MATERIAL: {{garment_type.material_appearance}}

FIT:
•⁠  ⁠Body fit: {{fit_style.body_fit}}
•⁠  ⁠Length: {{fit_style.garment_length}}

COLORS:
•⁠  ⁠Primary: {{colors.primary}}
•⁠  ⁠Secondary: {{colors.secondary}}

DESIGN ELEMENTS:
{{design_details.description}}
Placement: {{design_details.placement}}
Notable features: {{design_details.notable_features}}

══════════════════════════════════════════════
BASE FIT REFERENCE (HOW IT FITS ON MODEL)
══════════════════════════════════════════════
Model body type: {{how_it_fits_on_model.model_body_type}}
•⁠  ⁠Sleeves end at: {{how_it_fits_on_model.sleeve_end_point}}
•⁠  ⁠Sleeve tightness: {{how_it_fits_on_model.sleeve_tightness}}
•⁠  ⁠Torso fit: {{how_it_fits_on_model.torso_fit}}
•⁠  ⁠Garment ends at: {{how_it_fits_on_model.garment_end_point}}
•⁠  ⁠Shoulder fit: {{how_it_fits_on_model.shoulder_fit}}
•⁠  ⁠Arm opening width: {{how_it_fits_on_model.arm_opening_width}}
•⁠  ⁠Fabric excess: {{how_it_fits_on_model.fabric_excess}}
•⁠  ⁠Overall silhouette: {{how_it_fits_on_model.overall_silhouette}}

This is the BASE FIT (reference size on the model).

══════════════════════════════════════════════
SELECTED SIZE & ADJUSTMENT (CRITICAL)
══════════════════════════════════════════════
USER SELECTED SIZE: ${size}

Base fit on model: {{size_adjustment_guide.base_fit}}

SIZE ADJUSTMENT FOR ${size}:
{{size_adjustment_guide.${size}_adjustment}}

⚠️ CRITICAL SIZE APPLICATION RULES:

1.⁠ ⁠COMPARE BODIES:
   - User body: {{user_image.body_analysis.build}}, {{user_image.body_analysis.height}}
   - Model body: {{how_it_fits_on_model.model_body_type}}

2.⁠ ⁠APPLY SIZE ADJUSTMENT:
   - Start with the base fit described above
   - Apply the {{size}} adjustment instructions
   - Example: If user selected XL and base is M:
     * Make sleeves longer by 2-3cm
     * Make torso looser (more fabric drape)
     * Extend garment length proportionally
     * Add more fabric excess

3.⁠ ⁠BODY PROPORTION ADJUSTMENTS:
   - If user is TALLER than model: extend garment length proportionally
   - If user is SHORTER than model: reduce garment length proportionally
   - If user is BROADER than model: add width proportionally
   - If user is SLIMMER than model: reduce width proportionally

4.⁠ ⁠SIZE-SPECIFIC RULES:
   - XS/S: Tighter fit, shorter sleeves, less fabric drape, garment closer to body
   - M: Standard fit (close to model reference)
   - L/XL/XXL: Looser fit, longer sleeves, more fabric drape, more space between garment and body

⚠️ THE SIZE PARAMETER {{size}} IS MANDATORY AND NON-NEGOTIABLE
The garment MUST look different for XS vs XL. Ignoring this parameter is a critical failure.

══════════════════════════════════════════════
MAIN INSTRUCTION (FOLLOW EXACTLY)
══════════════════════════════════════════════
{{generation_instruction}}

══════════════════════════════════════════════
MANDATORY RULES
══════════════════════════════════════════════
✓ Preserve user's face, pose, body, background and lighting  
✓ Replace ONLY the clothing  
✓ Apply the SELECTED SIZE {{size}} adjustments  
✓ DO NOT add or remove sleeves  
✓ DO NOT change garment type  
✓ Copy graphics, logos, text with 100% accuracy  
✓ Photorealistic fabric drape and shadows  
✓ Adjust fit based on user's body vs model's body  

⚠️ CRITICAL:
•⁠  ⁠Sleeveless means NO sleeves
•⁠  ⁠Short sleeves means short sleeves ONLY
•⁠  ⁠Never hallucinate features
•⁠  ⁠Size {{size}} MUST be visibly different from other sizes
•⁠  ⁠If user selected XL, garment MUST be noticeably looser than if they selected S

OUTPUT: Generate ONE photorealistic image of the user wearing the exact garment in size {{size}}, adjusted for their body type ({{user_image.body_analysis.build}}, {{user_image.body_analysis.height}}).`.trim();
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
// PASO 1: Análisis previo con OpenAI Vision para determinar qué imagen usar
// ───────────────────────────────────────────────────────────────────────────────
async function analyzeProductImages(userImageBase64, productImagesArray, userReportedSize, selectedSize, productTitle = null, productDescription = null) {
  // Logs visibles en Vercel
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔍 INICIANDO ANÁLISIS CON OPENAI VISION');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`📸 Imágenes recibidas: 1 usuario + ${productImagesArray?.length || 0} producto`);
  console.log(`📏 Tamaño imagen usuario: ${userImageBase64 ? (userImageBase64.length / 1024).toFixed(2) + ' KB' : 'N/A'}`);
  console.log(`📏 Talle regular usuario: ${userReportedSize}, Talle a probar: ${selectedSize}`);
  console.log(`📝 Producto: ${productTitle || '(sin título)'}`);
  
  log('═══════════════════════════════════════════════════════════════');
  log('🔍 INICIANDO ANÁLISIS CON OPENAI VISION');
  log('═══════════════════════════════════════════════════════════════');
  log(`📸 Imágenes recibidas: 1 usuario + ${productImagesArray?.length || 0} producto`);
  log(`📏 Tamaño imagen usuario: ${userImageBase64 ? (userImageBase64.length / 1024).toFixed(2) + ' KB' : 'N/A'}`);
  log(`📏 Talle regular usuario: ${userReportedSize}, Talle a probar: ${selectedSize}`);
  log(`📝 Producto: ${productTitle || '(sin título)'}`);
  
  if (!productImagesArray || productImagesArray.length === 0) {
    warn('⚠️ No se recibieron imágenes del producto para análisis');
    return { useImageIndex: 0, reasoning: 'No product images provided' };
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    warn('⚠️ OPENAI_API_KEY no configurada en variables de entorno');
    warn('⚠️ Usando primera imagen del producto sin análisis de OpenAI');
    return { useImageIndex: 0, reasoning: 'OpenAI API key not configured, using first product image' };
  }
  
  log(`✅ OPENAI_API_KEY encontrada (longitud: ${OPENAI_API_KEY.length} caracteres)`);
  log(`🤖 Modelo OpenAI a usar: ${OPENAI_MODEL}`);

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  
  // Construir contexto del producto si está disponible
  let productContext = '';
  if (productTitle || productDescription) {
    productContext = `
PRODUCT INFO (from e-commerce page):
• Product name: ${productTitle || 'Not provided'}
• Description: ${productDescription || 'Not provided'}
Use this information to better understand the garment type, style, and expected fit.
`;
  }

  const analysisPrompt = `You are analyzing product images to identify orientation and fit.

You will receive multiple images: ONE showing a USER and OTHERS showing a GARMENT.
${productContext}
USER CONTEXT (provided by system):
• User's typical size: ${userReportedSize || 'unknown'}

TASKS:

1. IDENTIFY USER IMAGE
   - Find the user photo
   - Analyze user build: slim / average / athletic / broad / plus-size

2. IDENTIFY TARGET GARMENT (CRITICAL)
   - Find product images showing the garment ALONE (no model wearing it)
   - This isolated garment = the product being sold = what to replace on user
   - If model wears multiple items, ONLY the isolated garment matters
   - Return: garment_type (e.g., "swimsuit", "t-shirt", "pants", "dress")
   - Return: body_position - WHERE on the body this garment goes:
     * "upper" = covers torso (t-shirts, shirts, jackets, tank tops, sweaters)
     * "lower" = covers legs (pants, shorts, skirts, swimsuits/trunks)
     * "full" = covers both (dresses, jumpsuits, rompers)

3. FIND HUMAN MODEL IN PRODUCT IMAGES (CRITICAL)
   - Scan ALL product images for a person wearing the garment
   - IF found:
     * What's visible on the model's CHEST when facing camera? → That's FRONT
     * Return that image index
     * Describe how it fits the model

4. MEASURE FIT ON MODEL (if present)
   - Sleeve length: short / regular / long / oversized
   - Torso fit: tight / fitted / regular / loose / oversized / boxy
   - Garment length: cropped / regular / long / oversized
   - Overall vibe: e.g., "streetwear oversized"

5. DETERMINE BRAND FIT TENDENCY (NEW - ANALYZE FROM PHOTOS)
   - Based on how the garment fits the model in the photos, determine:
     * slightly_small: garment appears fitted/tight on model, brand likely runs small
     * normal: garment fits as expected for its labeled style
     * slightly_large: garment appears loose/oversized on model, brand likely runs large
   - This is YOUR assessment based on visual analysis, not a system input

6. COMPARE USER VS MODEL
   - Is user broader/slimmer/similar to model?
   - How will this affect fit?

7. SIZE FIT ASSESSMENT
   - Compare user_typical_size vs selected_size: ${selectedSize || 'M'}
   - Factor in brand_fit_tendency you determined (subtle adjustment only)
   - Generate fit_assessment: how will this specific size feel on this user?
   - Generate size_recommendation: suggest better size only if clearly needed

RETURN ONLY VALID JSON (no markdown, no code blocks):
{
  "user_image_index": <number>,
  "user_build": "<slim/average/athletic/broad/plus-size>",
  "target_garment": {
    "type": "<swimsuit/t-shirt/pants/dress/shorts/jacket/etc>",
    "body_position": "<upper/lower/full>",
    "identified_from_index": <number or null>,
    "description": "<brief description of the isolated garment>"
  },
  "model_found": <true/false>,
  "front_image_index": <number or null>,
  "model_build": "<slim/average/athletic/broad or null>",
  "fit_on_model": {
    "sleeve_length": "<short/regular/long/oversized or null>",
    "torso_fit": "<tight/fitted/regular/loose/oversized/boxy or null>",
    "garment_length": "<cropped/regular/long/oversized or null>",
    "overall_vibe": "<description or null>"
  },
  "brand_fit_tendency": "<slightly_small/normal/slightly_large>",
  "user_vs_model": "<user is broader/slimmer/similar to model>",
  "fit_prediction": "<will be tighter/looser/same on user>",
  "fit_assessment": "<how selected size will feel: comfortable / slightly tight / slightly loose / too tight / too loose>",
  "size_recommendation": "<same / consider SIZE for better fit>",
  "reasoning": "<brief explanation including why you determined this brand_fit_tendency>",
  "confidence": "<high/medium/low>"
}

CRITICAL: 
• Model reference is ALWAYS priority. Describe ACTUAL fit, not assumed fit.
• If no model found: set model_found=false, all model-related fields to null, and brand_fit_tendency to "normal"
• brand_fit_tendency must be determined by YOU based on photo analysis
• target_garment.type must be identified from ISOLATED product images (garment alone, not on model)`;

  try {
    // Construir mensajes para OpenAI
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: analysisPrompt },
          // Imagen 1: Usuario
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${userImageBase64}`
            }
          }
        ]
      }
    ];

    // Agregar imágenes del producto (Images 2, 3, 4)
    for (let i = 0; i < productImagesArray.length; i++) {
      const raw = productImagesArray[i];
      try {
        const parsed = parseDataUrl(raw);
        if (!parsed) continue;
        
        const buf = await normalizeToJpegBuffer(parsed.base64);
        messages[0].content.push({
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${buf.toString('base64')}`
          }
        });
      } catch (imgErr) {
        warn(`Error procesando imagen producto ${i} para análisis:`, imgErr.message);
      }
    }

    const totalImages = messages[0].content.length - 1; // -1 porque el primero es el texto del prompt
    log(`📤 Enviando ${totalImages} imágenes a OpenAI Vision (1 usuario + ${productImagesArray.length} producto)...`);
    log(`📋 Configuración de la llamada:`);
    log(`   - Modelo: ${OPENAI_MODEL}`);
    log(`   - Temperature: 0.1`);
    log(`   - Max tokens: 1500`);
    log(`   - Response format: json_object`);
    
    const openaiStartTime = Date.now();
    log(`⏱️ Iniciando llamada a OpenAI API...`);
    
    const analysisResponse = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: messages,
      temperature: 0.1, // Muy determinístico para análisis preciso
      response_format: { type: 'json_object' }, // Forzar respuesta JSON
      max_tokens: 1500, // Aumentado para el nuevo formato JSON más detallado
    });

    const openaiDuration = Date.now() - openaiStartTime;
    const analysisText = analysisResponse.choices[0]?.message?.content;
    
    if (!analysisText) {
      err('❌ OpenAI no retornó contenido en la respuesta');
      throw new Error('No response from OpenAI');
    }

    // Logs visibles en Vercel
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ ANÁLISIS COMPLETADO CON OPENAI VISION');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`⏱️ Tiempo total de análisis: ${openaiDuration}ms (${(openaiDuration / 1000).toFixed(2)}s)`);
    console.log('📊 Tokens usados:');
    console.log(`   - Prompt tokens: ${analysisResponse.usage?.prompt_tokens || 'N/A'}`);
    console.log(`   - Completion tokens: ${analysisResponse.usage?.completion_tokens || 'N/A'}`);
    console.log(`   - Total tokens: ${analysisResponse.usage?.total_tokens || 'N/A'}`);
    console.log('📋 Respuesta completa del análisis (primeros 500 chars):');
    console.log(analysisText.substring(0, 500));
    
    log('═══════════════════════════════════════════════════════════════');
    log('✅ ANÁLISIS COMPLETADO CON OPENAI VISION');
    log('═══════════════════════════════════════════════════════════════');
    log(`⏱️ Tiempo total de análisis: ${openaiDuration}ms (${(openaiDuration / 1000).toFixed(2)}s)`);
    log('📊 Tokens usados:');
    log(`   - Prompt tokens: ${analysisResponse.usage?.prompt_tokens || 'N/A'}`);
    log(`   - Completion tokens: ${analysisResponse.usage?.completion_tokens || 'N/A'}`);
    log(`   - Total tokens: ${analysisResponse.usage?.total_tokens || 'N/A'}`);
    log('📋 Respuesta completa del análisis:');
    log(analysisText);
    log('═══════════════════════════════════════════════════════════════');

    // Parsear respuesta JSON
    let analysisData;
    try {
      // Limpiar respuesta si tiene markdown code blocks
      const cleanedText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysisData = JSON.parse(cleanedText);
      
      // NUEVO FORMATO: Detectar qué formato de JSON recibimos
      const isNewFormat = analysisData.user_image_index !== undefined;
      
      let useImageIndex = 0;
      
      if (isNewFormat) {
        // NUEVO FORMATO con brand_fit_tendency
        log(`📊 Formato detectado: NUEVO (con brand_fit_tendency)`);
        
        const userIndex = analysisData.user_image_index;
        const frontIndex = analysisData.front_image_index;
        
        // En el nuevo formato, front_image_index es directamente el índice de la imagen del producto
        // user=0, product1=1, product2=2, product3=3 (basado en 0)
        // Entonces: front_image_index 1 → array índice 0
        if (frontIndex !== null && frontIndex >= 1 && frontIndex <= productImagesArray.length) {
          useImageIndex = frontIndex - 1;
          log(`📊 front_image_index ${frontIndex} → array índice ${useImageIndex}`);
        } else if (frontIndex === null) {
          log(`⚠️ No se encontró modelo, usando primera imagen del producto`);
          useImageIndex = 0;
        } else {
          warn(`⚠️ front_image_index inválido: ${frontIndex}, usando primera imagen`);
          useImageIndex = 0;
        }
        
        // Validar rango
        if (useImageIndex < 0 || useImageIndex >= productImagesArray.length) {
          warn(`⚠️ Índice fuera de rango: ${useImageIndex}, usando primera imagen`);
          useImageIndex = 0;
        }
        
        analysisData.useImageIndex = useImageIndex;
        
        log(`🎯 Resultado del análisis (NUEVO FORMATO):`);
        log(`   👤 Usuario: imagen ${userIndex}, build: ${analysisData.user_build}`);
        log(`   👕 Garment: imagen ${frontIndex} (índice array: ${useImageIndex})`);
        log(`   🏷️ Brand fit tendency: ${analysisData.brand_fit_tendency}`);
        log(`   👥 Model found: ${analysisData.model_found}`);
        if (analysisData.model_found && analysisData.fit_on_model) {
          log(`   📏 Fit on model: ${analysisData.fit_on_model.overall_vibe || 'N/A'}`);
          log(`      - Sleeves: ${analysisData.fit_on_model.sleeve_length || 'N/A'}`);
          log(`      - Torso: ${analysisData.fit_on_model.torso_fit || 'N/A'}`);
          log(`      - Length: ${analysisData.fit_on_model.garment_length || 'N/A'}`);
        }
        log(`   🔮 Fit prediction: ${analysisData.fit_prediction || 'N/A'}`);
        log(`   📊 Fit assessment: ${analysisData.fit_assessment || 'N/A'}`);
        log(`   💡 Size recommendation: ${analysisData.size_recommendation || 'N/A'}`);
        log(`   📝 Razón: ${analysisData.reasoning || 'No reasoning provided'}`);
        log(`   ✅ Confianza: ${analysisData.confidence || 'unknown'}`);
        
      } else {
        // FORMATO ANTERIOR (legacy)
        log(`📊 Formato detectado: LEGACY (sin brand_fit_tendency)`);
        
        // Validar estructura del JSON
        if (!analysisData.user_image || !analysisData.garment_image) {
          throw new Error('JSON structure invalid: missing user_image or garment_image');
        }
        
        const userIndex = analysisData.user_image.index;
        const garmentIndex = analysisData.garment_image.index;
        const isZeroBased = userIndex === 0;
        
        if (isZeroBased) {
          if (garmentIndex >= 1 && garmentIndex <= 3) {
            useImageIndex = garmentIndex - 1;
          }
        } else {
          if (garmentIndex >= 2 && garmentIndex <= 4) {
            useImageIndex = garmentIndex - 2;
          }
        }
        
        if (useImageIndex < 0 || useImageIndex >= productImagesArray.length) {
          useImageIndex = 0;
        }
        
        analysisData.useImageIndex = useImageIndex;
        
        // Adaptar formato legacy para compatibilidad con nuevo buildGenerationPrompt
        analysisData.user_build = analysisData.user_image?.body_analysis?.build || 'average';
        analysisData.model_found = !!analysisData.how_it_fits_on_model?.overall_silhouette;
        
        log(`🎯 Resultado del análisis (LEGACY):`);
        log(`   👤 Usuario: imagen ${userIndex} - ${analysisData.user_image.description}`);
        log(`   👕 Garment: imagen ${garmentIndex} (índice array: ${useImageIndex}) - ${analysisData.garment_image.orientation}`);
        log(`   📏 Fit: ${analysisData.fit_style?.body_fit || 'N/A'} fit, ${analysisData.fit_style?.garment_length || 'N/A'} length`);
        log(`   📝 Razón: ${analysisData.reasoning || 'No reasoning provided'}`);
        log(`   ✅ Confianza: ${analysisData.confidence || 'unknown'}`);
      }

    } catch (parseErr) {
      warn('Error parseando respuesta de análisis, usando primera imagen:', parseErr);
      analysisData = { 
        useImageIndex: 0, 
        user_build: 'average',
        model_found: false,
        front_image_index: null,
        brand_fit_tendency: 'normal',
        fit_on_model: null,
        fit_prediction: null,
        fit_assessment: null,
        size_recommendation: null,
        reasoning: 'Error parsing analysis, using first product image',
        confidence: 'low'
      };
    }

    return analysisData;
  } catch (analysisError) {
    err('Error en análisis previo con OpenAI:', analysisError);
    // Fallback: usar primera imagen del producto
    return { useImageIndex: 0, reasoning: 'Analysis failed, using first product image' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// PASO 2: Prompt para generación con Nano Banana usando datos del análisis
// NUEVO FORMATO: Basado en buildNanobananaPrompt con brand_fit_tendency
// ───────────────────────────────────────────────────────────────────────────────
function buildNanobananaPrompt(analysis, selectedSize, brand_fit_tendency = 'normal', productTitle = null) {
  const { user_build, model_found, fit_on_model, fit_prediction, fit_assessment, user_reported_size, target_garment } = analysis;
  
  let fitDescription = '';
  if (model_found && fit_on_model) {
    fitDescription = ` ${fit_on_model.overall_vibe || fit_on_model.torso_fit} with ${fit_on_model.sleeve_length} sleeves, ${fit_on_model.garment_length} length`;
    
    if (fit_prediction?.includes('tighter')) {
      fitDescription += ', slightly more fitted on this user';
    } else if (fit_prediction?.includes('looser')) {
      fitDescription += ', maintaining loose relaxed drape';
    }
    
    if (brand_fit_tendency === 'slightly_small') {
      fitDescription += ', brand runs slightly small so fit appears marginally tighter';
    } else if (brand_fit_tendency === 'slightly_large') {
      fitDescription += ', brand runs slightly large so fit appears marginally looser';
    }
  } else {
    const sizeMap = {
      'XS': 'very fitted',
      'S': 'fitted',
      'M': 'regular fit',
      'L': 'relaxed loose',
      'XL': 'oversized loose',
      'XXL': 'very oversized baggy'
    };
    fitDescription = ` ${sizeMap[selectedSize] || 'regular fit'} for ${user_build} build`;
    
    if (brand_fit_tendency === 'slightly_small') {
      fitDescription += ', slightly tighter than standard';
    } else if (brand_fit_tendency === 'slightly_large') {
      fitDescription += ', slightly looser than standard';
    }
  }
  
  const sizeScale = 'XS < S < M < L < XL < XXL (smallest to largest)';
  let sizeExplicit = `SIZE: ${selectedSize} - This determines garment looseness. `;
  if (selectedSize === 'L' || selectedSize === 'XL' || selectedSize === 'XXL') {
    sizeExplicit += 'Larger size = MORE fabric, LOOSER fit, LONGER sleeves.';
  } else if (selectedSize === 'XS' || selectedSize === 'S') {
    sizeExplicit += 'Smaller size = LESS fabric, TIGHTER fit, SHORTER sleeves.';
  } else {
    sizeExplicit += 'Medium = standard fit.';
  }
  
  // Agregar nombre del producto si está disponible
  const productInfo = productTitle ? `"${productTitle}"` : 'the product garment';
  
  // Línea para identificar el target garment específico con posición del cuerpo
  let targetGarmentLine = '';
  if (target_garment?.type) {
    const bodyPos = target_garment.body_position || 'unknown';
    const bodyPosDesc = {
      'upper': 'UPPER BODY (torso area) - Do NOT modify pants/shorts/lower body',
      'lower': 'LOWER BODY (legs/waist area) - Do NOT modify shirts/tops/upper body',
      'full': 'FULL BODY (torso + legs)'
    };
    const positionInfo = bodyPosDesc[bodyPos] || target_garment.type;
    targetGarmentLine = `TARGET GARMENT: ${target_garment.type} on ${positionInfo}. ONLY replace this specific item. If user wears other clothing items in different body areas, KEEP THEM UNCHANGED.`;
  }
  
  return `Virtual try-on: Dress the user with ${productInfo}.

CRITICAL: Preserve user's exact pose, face, and background completely unchanged.

User: ${user_build} build (typically wears ${user_reported_size || 'unknown'})

${targetGarmentLine}

Garment${productTitle ? ` (${productTitle})` : ''}: Use the FRONT view of the product (pre-identified). Match all colors, graphics, text, and design details exactly.

${sizeExplicit}

Size scale: ${sizeScale}

Fit: ${fitDescription}

Apply the garment to the user maintaining exact body position, facial features, background, and lighting.
The garment should look naturally worn with realistic fabric behavior and photorealistic quality.

Do not alter pose, face, or background. Do not use back/reversed views of the garment.

STRICTLY PROHIBITED:
• Do NOT add any other person to the image
• Do NOT change the user's face, hair, or facial expression
• Do NOT change the user's pose, arm position, or body angle
• Do NOT change or replace the background
• Do NOT change the garment's color, pattern, graphics, or text
• Do NOT change the garment's style (collar type, sleeve type, neckline)
• Do NOT add accessories, logos, or elements not in the original garment
• Do NOT mirror or flip the garment design
• Do NOT change lighting or color temperature

MANDATORY:
• Output must contain ONLY the original user wearing the original garment
• User's face must be 100% identical to input
• Background must be 100% identical to input
• Garment design must be 100% identical to product image`;
}

// Función de generación de prompt (compatible con formato anterior para fallback)
function buildGenerationPrompt({ analysisData, size, fitAdjustment, productTitle = null }) {
  // Detectar si el análisis viene del nuevo formato (con brand_fit_tendency)
  const isNewFormat = analysisData.brand_fit_tendency !== undefined;
  
  if (isNewFormat) {
    // Usar nuevo formato buildNanobananaPrompt
    return buildNanobananaPrompt(
      {
        user_build: analysisData.user_build || 'average',
        model_found: analysisData.model_found || false,
        fit_on_model: analysisData.fit_on_model || null,
        fit_prediction: analysisData.fit_prediction || null,
        fit_assessment: analysisData.fit_assessment || null,
        user_reported_size: analysisData.user_reported_size || size
      },
      size,
      analysisData.brand_fit_tendency || 'normal',
      productTitle // Pasar título del producto
    );
  }
  
  // FALLBACK: Formato anterior para compatibilidad
  const userImage = analysisData.user_image || { description: 'Person facing camera' };
  const garmentImage = analysisData.garment_image || { description: 'Garment view', orientation: 'front', reason: 'Selected garment' };
  
  const garmentType = analysisData.garment_type || { 
    category: 'garment', 
    sleeves: 'unknown', 
    neckline: 'unknown',
    material_appearance: 'unknown'
  };
  
  const fitStyle = analysisData.fit_style || { body_fit: 'regular', garment_length: 'regular' };
  const colors = analysisData.colors || { primary: 'unknown', secondary: 'none' };
  const designDetails = analysisData.design_details || { description: 'Garment design', placement: 'unknown', notable_features: 'Standard features' };
  
  const howItFits = analysisData.how_it_fits_on_model || {
    sleeve_end_point: 'unknown',
    sleeve_tightness: 'unknown',
    torso_fit: 'unknown',
    garment_end_point: 'unknown',
    shoulder_fit: 'unknown',
    arm_opening_width: 'unknown',
    overall_silhouette: 'unknown'
  };
  
  const bodyAnalysis = userImage.body_analysis || { build: 'average', height: 'average' };
  const generationInstruction = analysisData.generation_instruction || analysisData.instruction || 'Replace the garment on the user with the product garment';
  const confidence = analysisData.confidence || 'medium';

  let sleeveDescription = '';
  const sleeves = garmentType.sleeves?.toLowerCase() || '';
  if (sleeves.includes('none') || sleeves.includes('sleeveless') || sleeves.includes('tank')) {
    sleeveDescription = '⚠️ THIS IS A SLEEVELESS GARMENT - NO SLEEVES AT ALL. Do NOT add any sleeves.';
  } else if (sleeves.includes('cap')) {
    sleeveDescription = 'Cap sleeves (very short, just covering shoulders)';
  } else if (sleeves.includes('short')) {
    sleeveDescription = 'Short sleeves (typical t-shirt length)';
  } else if (sleeves.includes('3/4') || sleeves.includes('three')) {
    sleeveDescription = '3/4 length sleeves (below elbow)';
  } else if (sleeves.includes('long')) {
    sleeveDescription = 'Long sleeves (full length to wrist)';
  } else {
    sleeveDescription = `Sleeves: ${garmentType.sleeves}`;
  }

  let fitOnBodyDescription = '';
  if (howItFits.overall_silhouette !== 'unknown') {
    fitOnBodyDescription = `
HOW THE GARMENT SHOULD FIT (COPY EXACTLY FROM MODEL):
- SLEEVES END AT: ${howItFits.sleeve_end_point}
- SLEEVE TIGHTNESS: ${howItFits.sleeve_tightness}
- TORSO FIT: ${howItFits.torso_fit}
- GARMENT ENDS AT: ${howItFits.garment_end_point}
- SHOULDER FIT: ${howItFits.shoulder_fit}
- ARM OPENING WIDTH: ${howItFits.arm_opening_width}
- OVERALL SILHOUETTE: ${howItFits.overall_silhouette}
`;
  }

  let fitAdjustmentSection = '';
  if (fitAdjustment && fitAdjustment.type !== 'normal') {
    fitAdjustmentSection = `
FIT ADJUSTMENT: ${fitAdjustment.visualInstruction}
`;
  }

  return `Virtual try-on: Dress the user with the product garment.

CRITICAL: Preserve user's exact pose, face, and background completely unchanged.

USER BODY: ${bodyAnalysis.build || 'average'} build, ${bodyAnalysis.height || 'average'} height
SELECTED SIZE: ${size}
${fitAdjustmentSection}
GARMENT: ${garmentType.category}
${sleeveDescription}
NECKLINE: ${garmentType.neckline}
FIT: ${fitStyle.body_fit}, ${fitStyle.garment_length}
COLORS: ${colors.primary}${colors.secondary !== 'none' ? ', ' + colors.secondary : ''}
DESIGN: ${designDetails.description}
${fitOnBodyDescription}
${generationInstruction}

Apply the garment to the user maintaining exact body position, facial features, background, and lighting.
The garment should look naturally worn with realistic fabric behavior and photorealistic quality.

Do not alter pose, face, or background.

Analysis Confidence: ${confidence}`.trim();
}

// ───────────────────────────────────────────────────────────────────────────────
// Handler
// ───────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // ========================================
  // LOGS INMEDIATOS PARA VERCEL - PRIMERA LÍNEA
  // ========================================
  console.log('[VERCEL-LOG] ===========================================');
  console.log('[VERCEL-LOG] BACKEND-TRYON-IMPROVED.JS EJECUTÁNDOSE');
  console.log('[VERCEL-LOG] TIMESTAMP:', new Date().toISOString());
  console.log('[VERCEL-LOG] METHOD:', req.method);
  console.log('[VERCEL-LOG] URL:', req.url);
  console.log('[VERCEL-LOG] ===========================================');
  
  // Logs con emojis también
  console.log('🔵 BACKEND-TRYON-IMPROVED.JS EJECUTÁNDOSE');
  console.log('🔵 VERSIÓN CON requestId Y model EN RESPUESTAS');
  console.log('🔵 TIMESTAMP:', new Date().toISOString());
  console.log('🔵 METHOD:', req.method);
  console.log('🔵 URL:', req.url);
  
  ensureCors(req, res);
  if (req.method === 'OPTIONS') {
    console.log('[VERCEL-LOG] OPTIONS request, retornando 200');
    console.log('✅ OPTIONS request, retornando 200');
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    console.log('[VERCEL-LOG] Método no permitido:', req.method);
    console.log('❌ Método no permitido:', req.method);
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const GOOGLE_API_KEY = process.env.GOOGLE_AI_API_KEY;
  if (!GOOGLE_API_KEY) {
    console.error('[VERCEL-LOG] ERROR: Falta GOOGLE_AI_API_KEY');
    console.error('❌ Falta GOOGLE_AI_API_KEY');
    return res.status(500).json({ success: false, error: 'Falta GOOGLE_AI_API_KEY' });
  }
  
  console.log('[VERCEL-LOG] GOOGLE_AI_API_KEY encontrada');

  // NUEVO: Variables para tracking de métricas
  const clientDomain = getClientDomain(req);
  const startTime = Date.now();

  // Usar requestId del frontend si viene, sino generar uno nuevo
  const requestId = req.body?.requestId || `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  console.log('[VERCEL-LOG] ===========================================');
  console.log(`[VERCEL-LOG] REQUEST INICIADO [${requestId}]`);
  console.log(`[VERCEL-LOG] Request ID Source: ${req.body?.requestId ? 'frontend' : 'backend-generated'}`);
  console.log(`[VERCEL-LOG] Client Domain: ${clientDomain}`);
  console.log('[VERCEL-LOG] ===========================================');
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`🚀 REQUEST INICIADO [${requestId}]`);
  console.log(`📋 Request ID Source: ${req.body?.requestId ? 'frontend' : 'backend-generated'}`);
  console.log(`📊 Client Domain: ${clientDomain}`);
  console.log('═══════════════════════════════════════════════════════════════');
  
  log('═══════════════════════════════════════════════════════════════');
  log(`🚀 REQUEST INICIADO [${requestId}]`);
  log('═══════════════════════════════════════════════════════════════');
  log('📋 Request Info:', { 
    method: req.method, 
    url: req.url, 
    analysisModel: OPENAI_MODEL, 
    generationModel: GENERATION_MODEL,
    requestId,
    requestIdSource: req.body?.requestId ? 'frontend' : 'backend-generated',
    clientDomain
  });
  
  if (IS_DEV) {
    log('📦 Headers:', req.headers);
    log('📦 Body keys:', Object.keys(req.body || {}));
    const asStr = JSON.stringify(req.body || {});
    log('📦 Body size:', asStr.length, 'chars ≈', (asStr.length / 1024 / 1024).toFixed(2), 'MB');
  }

  try {
    const { productImage, productImages, size, userRegularSize, userImage, userOrientation, productTitle, productDescription } = req.body || {};
    
    log(`📥 DATOS RECIBIDOS [${requestId}]:`);
    log(`   ✅ userImage: ${userImage ? 'SÍ' : 'NO'} (${userImage ? (userImage.length / 1024).toFixed(2) + ' KB' : '0 KB'})`);
    log(`   ✅ productImages: ${Array.isArray(productImages) ? `SÍ (${productImages.length} imágenes)` : 'NO'}`);
    log(`   ✅ productImage: ${productImage ? 'SÍ' : 'NO'}`);
    log(`   📝 productTitle: ${productTitle || '(no proporcionado)'}`);
    log(`   📝 productDescription: ${productDescription ? productDescription.substring(0, 50) + '...' : '(no proporcionado)'}`);
    log(`   ✅ size (a probar): ${size || 'M (default)'}`);
    log(`   ✅ userRegularSize (talle habitual): ${userRegularSize || 'unknown'}`);
    log(`   ✅ userOrientation: ${userOrientation || 'null'}`);

    if (!userImage) return res.status(400).json({ success: false, error: 'No se recibió imagen del usuario' });

    // Unificar imágenes de producto (máximo 3 según el frontend)
    let productImagesArray = [];
    if (Array.isArray(productImages) && productImages.length) {
      productImagesArray = productImages.slice(0, 3); // Limitar a 3 imágenes
      log(`   📸 productImages array: ${productImages.length} imágenes recibidas, usando primeras ${productImagesArray.length}`);
    } else if (productImage) {
      productImagesArray = [productImage];
      log(`   📸 productImage singular: 1 imagen recibida`);
    } else {
      log(`   ⚠️ No se recibieron imágenes del producto`);
    }
    
    log(`   📊 Total imágenes producto a procesar: ${productImagesArray.length}`);

    const selectedOrientation = ALLOWED_ORIENTATIONS.has(userOrientation) ? userOrientation : 'front';
    const selectedSize = (size || 'M').toUpperCase();

    // Parse/normalize user image
    const parsedUser = parseDataUrl(userImage);
    if (!parsedUser) {
      return res.status(400).json({ success: false, error: 'userImage debe ser una data URL base64 (data:image/...;base64,...)' });
    }

    const processedUserImage = await normalizeToJpegBuffer(parsedUser.base64);

    // ───────────────────────────────────────────────────────────────────────────────
    // PASO 1: Análisis previo con OpenAI Vision para determinar qué imagen usar
    // ───────────────────────────────────────────────────────────────────────────────
    console.log('[VERCEL-LOG] ===========================================');
    console.log(`[VERCEL-LOG] PASO 1: ANÁLISIS CON OPENAI VISION [${requestId}]`);
    console.log(`[VERCEL-LOG] Analizando: 1 usuario + ${productImagesArray.length} producto`);
    console.log('[VERCEL-LOG] ===========================================');
    
    log('═══════════════════════════════════════════════════════════════');
    log(`🔍 PASO 1: ANÁLISIS CON OPENAI VISION [${requestId}]`);
    log('═══════════════════════════════════════════════════════════════');
    log(`📸 Analizando: 1 imagen usuario + ${productImagesArray.length} imágenes producto`);
    log(`📋 Request ID: ${requestId}`);
    
    const analysisResult = await analyzeProductImages(
      processedUserImage.toString('base64'),
      productImagesArray,
      userRegularSize || size || 'unknown', // Talle habitual del usuario
      selectedSize, // Talle que quiere probar
      productTitle, // Título del producto
      productDescription // Descripción del producto
    );
    
    let { useImageIndex } = analysisResult;
    log(`✅ Análisis completado: Usar imagen del producto en índice ${useImageIndex}`);

    // NUEVO: Extraer contextura del usuario del análisis (compatible con ambos formatos)
    const userBuild = analysisResult.user_build || analysisResult.user_image?.body_analysis?.build || 'average';
    const brandFitTendency = analysisResult.brand_fit_tendency || 'normal';
    
    log(`👤 Contextura del usuario detectada: ${userBuild}`);
    log(`🏷️ Brand fit tendency: ${brandFitTendency}`);
    log(`📏 Talle seleccionado: ${selectedSize}`);
    
    // Log adicional del nuevo formato si está disponible
    if (analysisResult.fit_assessment) {
      log(`📊 Fit assessment: ${analysisResult.fit_assessment}`);
    }
    if (analysisResult.size_recommendation) {
      log(`💡 Size recommendation: ${analysisResult.size_recommendation}`);
    }

    // NUEVO: Calcular ajuste de fit
    const fitAdjustment = calculateFitAdjustment(userBuild, selectedSize);
    log('═══════════════════════════════════════════════════════════════');
    log('📐 AJUSTE DE FIT CALCULADO:');
    log(`   Tipo: ${fitAdjustment.type}`);
    log(`   Intensidad: ${fitAdjustment.intensity}`);
    log(`   Talle natural para ${userBuild}: ${fitAdjustment.naturalSize}`);
    log(`   Talle elegido: ${selectedSize}`);
    log(`   Descripción: ${fitAdjustment.description}`);
    log('═══════════════════════════════════════════════════════════════');

    // Seleccionar solo la imagen del producto que OpenAI determinó
    if (useImageIndex < 0 || useImageIndex >= productImagesArray.length) {
      warn(`⚠️ Índice inválido ${useImageIndex}, usando primera imagen del producto`);
      useImageIndex = 0;
    }

    const selectedProductImage = productImagesArray[useImageIndex];
    if (!selectedProductImage) {
      return res.status(400).json({ success: false, error: 'No se pudo seleccionar imagen del producto' });
    }

    log(`🎯 Imagen seleccionada: índice ${useImageIndex} de ${productImagesArray.length} imágenes disponibles`);
    log(`📋 Request ID: ${requestId}`);

    // ───────────────────────────────────────────────────────────────────────────────
    // PASO 2: Generación con Nano Banana - Solo 2 imágenes (usuario + producto seleccionado)
    // ───────────────────────────────────────────────────────────────────────────────
    log('═══════════════════════════════════════════════════════════════');
    log(`🎨 PASO 2: GENERACIÓN CON NANO BANANA [${requestId}]`);
    log('═══════════════════════════════════════════════════════════════');
    log(`📋 Request ID: ${requestId}`);

    // Agregar user_reported_size al analysisResult para el prompt de Nanobanana
    analysisResult.user_reported_size = selectedSize;
    
    // Construir prompt usando datos del análisis de OpenAI + ajuste de fit
    const generationPrompt = buildGenerationPrompt({ 
      analysisData: analysisResult,
      size: selectedSize,
      fitAdjustment,
      brandFitTendency,
      productTitle // Pasar título del producto
    });

    // Construir partes para generación - SOLO 2 IMÁGENES
    // 1. Usuario
    // 2. Producto seleccionado
    const parts = [
      { text: generationPrompt },
      { inlineData: { mimeType: 'image/jpeg', data: processedUserImage.toString('base64') } },
    ];

    // Procesar solo la imagen del producto seleccionada
    try {
      const parsed = parseDataUrl(selectedProductImage);
      if (!parsed) {
        return res.status(400).json({ success: false, error: 'Imagen del producto seleccionada no es válida' });
      }

      const supported = /^(image\/)(jpeg|jpg|png|webp)$/i.test(parsed.mime);
      if (!supported) {
        return res.status(400).json({ success: false, error: `Formato de imagen no soportado: ${parsed.mime}` });
      }

      // Normalizar a jpeg
      const productBuf = await normalizeToJpegBuffer(parsed.base64);
      const productMB = productBuf.length / 1024 / 1024;
      const userMB = processedUserImage.length / 1024 / 1024;
      const totalMB = userMB + productMB;

      if (totalMB > 15) {
        warn(`⚠️ Total imágenes > 15MB (${totalMB.toFixed(2)} MB)`);
      }

      parts.push({ inlineData: { mimeType: 'image/jpeg', data: productBuf.toString('base64') } });
      log(`✅ Imagen producto seleccionada procesada: ${(productBuf.length/1024).toFixed(2)} KB`);
    } catch (imgErr) {
      err(`Error procesando imagen del producto seleccionada:`, imgErr.message);
      return res.status(500).json({ success: false, error: 'Error procesando imagen del producto' });
    }

    log(`📤 Parts a enviar a Nano Banana: ${parts.length} imágenes (1 usuario + 1 producto)`);
    const userSizeMB = processedUserImage.length / 1024 / 1024;
    const productSizeMB = parts[2]?.inlineData?.data ? (Buffer.from(parts[2].inlineData.data, 'base64').length / 1024 / 1024) : 0;
    const totalSizeMB = userSizeMB + productSizeMB;
    log(`📊 Tamaño total: ${totalSizeMB.toFixed(2)} MB (usuario: ${userSizeMB.toFixed(2)} MB, producto: ${productSizeMB.toFixed(2)} MB)`);
    log(`📋 Request ID: ${requestId}`);

    // Inicializar Gemini AI para generación
    const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    
    // Inicializar modelo de generación: Nano Banana (gemini-2.5-flash-image)
    const generationModel = genAI.getGenerativeModel({ 
      model: GENERATION_MODEL,
      generationConfig: {
        temperature: 0.4, // Más determinístico para mejor precisión
        topP: 0.95,
        topK: 40,
      }
    });

    // Llamada a Nano Banana para generación
    let result, response;
    try {
      log(`📤 Enviando solicitud a Nano Banana (${GENERATION_MODEL}) para generación...`);
      log(`📋 Request ID: ${requestId}`);
      const requestStartTime = Date.now();

      // Formato según nueva documentación: contents con array de parts
      result = await generationModel.generateContent({ 
        contents: [{ 
          role: 'user', 
          parts: parts 
        }] 
      });

      response = await result.response;
      const requestDuration = Date.now() - requestStartTime;
      log(`✅ Respuesta recibida de Nano Banana en ${requestDuration}ms`);
      log(`📋 Request ID: ${requestId}`);

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

    const totalDuration = Date.now() - startTime;

    log('✅ Imagen generada exitosamente');
    log(`📋 Request ID: ${requestId}`);
    log('═══════════════════════════════════════════════════════════════');
    log(`✅ REQUEST COMPLETADO [${requestId}] en ${totalDuration}ms`);
    log('═══════════════════════════════════════════════════════════════');

    // NUEVO: Tracking de métricas - éxito
    try {
      await trackTryOnEvent({
        clientDomain,
        requestId,
        success: true,
        duration: totalDuration,
        size: selectedSize,
        model: GENERATION_MODEL,
      });
      log(`📊 Métrica guardada para ${clientDomain}`);
    } catch (trackErr) {
      warn('Error guardando métrica:', trackErr.message);
    }
    
    // Asegurar que requestId y model siempre estén presentes
    const responseData = {
      success: true,
      description: 'Imagen generada exitosamente con IA',
      generatedImage: `data:image/jpeg;base64,${imageBase64}`,
      size: selectedSize,
      orientation: selectedOrientation,
      model: GENERATION_MODEL || 'gemini-2.5-flash-image', // Fallback por si acaso
      requestId: requestId || `req_${Date.now()}_fallback`, // Fallback por si acaso
      timestamp: new Date().toISOString(),
      // NUEVO: Incluir info de ajuste de fit
      fitAdjustment: {
        type: fitAdjustment.type,
        description: fitAdjustment.description,
        userBuild,
        naturalSize: fitAdjustment.naturalSize,
      },
    };
    
    // Validar que los campos críticos estén presentes
    if (!responseData.requestId) {
      warn('⚠️ requestId no está definido, usando fallback');
      responseData.requestId = `req_${Date.now()}_fallback`;
    }
    if (!responseData.model) {
      warn('⚠️ model no está definido, usando fallback');
      responseData.model = GENERATION_MODEL || 'gemini-2.5-flash-image';
    }
    
    log('📤 Enviando respuesta al frontend:');
    log(`   - success: ${responseData.success}`);
    log(`   - model: ${responseData.model} (tipo: ${typeof responseData.model})`);
    log(`   - requestId: ${responseData.requestId} (tipo: ${typeof responseData.requestId})`);
    log(`   - generatedImage length: ${responseData.generatedImage.length} caracteres`);
    log(`   - size: ${responseData.size}`);
    log(`   - orientation: ${responseData.orientation}`);
    log(`   - fitAdjustment: ${responseData.fitAdjustment.type}`);
    log(`   - timestamp: ${responseData.timestamp}`);
    
    // Verificar que los campos críticos existen antes de enviar
    const keys = Object.keys(responseData);
    log(`📋 Claves en responseData: ${keys.join(', ')}`);
    log(`✅ Verificación: requestId presente: ${!!responseData.requestId}, model presente: ${!!responseData.model}`);
    
    // Log del objeto completo para debugging (sin generatedImage por tamaño)
    const debugResponse = {
      ...responseData,
      generatedImage: `[${responseData.generatedImage.length} caracteres]`
    };
    log('📋 Objeto de respuesta completo (sin generatedImage por tamaño):', JSON.stringify(debugResponse, null, 2));
    
    // Verificación final antes de enviar
    if (!responseData.requestId || !responseData.model) {
      err('❌ ERROR CRÍTICO: requestId o model faltan en la respuesta');
      err(`   requestId: ${responseData.requestId}`);
      err(`   model: ${responseData.model}`);
      err(`   requestId original: ${requestId}`);
      err(`   GENERATION_MODEL: ${GENERATION_MODEL}`);
    }
    
    return res.json(responseData);

  } catch (error) {
    const totalDuration = Date.now() - startTime;
    
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

    err('═══════════════════════════════════════════════════════════════');
    err(`❌ ERROR EN AI TRY-ON [${requestId}]`);
    err('═══════════════════════════════════════════════════════════════');
    err('📋 Request ID:', requestId);
    err('🔴 Tipo:', errorType);
    err('🔴 Mensaje:', errorDescription);
    err('🔴 Stack:', error.stack);
    err('📊 Request info:');
    err('   - userImage:', hasUser, `(${(userLen / 1024).toFixed(2)} KB)`);
    err('   - productImages:', prodCount, 'imágenes');
    err('   - productImage:', !!body.productImage ? 'SÍ' : 'NO');
    err('   - size:', body.size || 'M (default)');
    err('   - userOrientation:', body.userOrientation || 'null');
    err('═══════════════════════════════════════════════════════════════');

    // NUEVO: Tracking de métricas - error
    try {
      await trackTryOnEvent({
        clientDomain,
        requestId,
        success: false,
        duration: totalDuration,
        size: body.size || 'M',
        model: 'error',
        errorType,
      });
      log(`📊 Métrica de error guardada para ${clientDomain}`);
    } catch (trackErr) {
      warn('Error guardando métrica de error:', trackErr.message);
    }

    // Fallback enriquecido
    try {
      console.log('[VERCEL-LOG] ===========================================');
      console.log(`[VERCEL-LOG] ENTRANDO EN MODO FALLBACK [${requestId}]`);
      console.log('[VERCEL-LOG] ===========================================');
      console.log(`[VERCEL-LOG] Error Type: ${errorType}`);
      console.log(`[VERCEL-LOG] Error Description: ${errorDescription}`);
      console.log(`[VERCEL-LOG] Request ID: ${requestId}`);
      
      if (!hasUser) {
        const errorResponse = {
          success: false,
          error: 'No se recibió imagen del usuario y no se pudo generar la imagen',
          errorType,
          errorDetails: errorDescription,
          requestId: requestId,
          model: 'fallback',
        };
        console.log('[VERCEL-LOG] Enviando error 400:', JSON.stringify({ ...errorResponse, errorDetails: errorResponse.errorDetails.substring(0, 100) }));
        return res.status(400).json(errorResponse);
      }

      const fallbackResponse = {
        success: true,
        description: 'Imagen procesada (modo fallback)',
        originalImage: body.userImage,
        generatedImage: body.userImage,
        finalImage: body.userImage,
        size: body.size || 'M',
        orientation: ALLOWED_ORIENTATIONS.has(body.userOrientation) ? body.userOrientation : 'front',
        model: 'fallback',
        requestId: requestId || `req_${Date.now()}_fallback`,
        fallback: true,
        errorType,
        errorReason: errorDescription,
        timestamp: new Date().toISOString(),
      };
      
      // Validar que requestId y model estén presentes
      if (!fallbackResponse.requestId) {
        warn('⚠️ requestId no está definido en fallback, usando fallback');
        fallbackResponse.requestId = `req_${Date.now()}_fallback`;
      }
      if (!fallbackResponse.model) {
        warn('⚠️ model no está definido en fallback, usando fallback');
        fallbackResponse.model = 'fallback';
      }
      
      console.log('[VERCEL-LOG] ===========================================');
      console.log(`[VERCEL-LOG] ENVIANDO RESPUESTA FALLBACK [${requestId}]`);
      console.log('[VERCEL-LOG] ===========================================');
      console.log(`[VERCEL-LOG] success: ${fallbackResponse.success}`);
      console.log(`[VERCEL-LOG] model: ${fallbackResponse.model} (tipo: ${typeof fallbackResponse.model})`);
      console.log(`[VERCEL-LOG] requestId: ${fallbackResponse.requestId} (tipo: ${typeof fallbackResponse.requestId})`);
      console.log(`[VERCEL-LOG] fallback: ${fallbackResponse.fallback}`);
      console.log(`[VERCEL-LOG] Claves en respuesta: ${Object.keys(fallbackResponse).join(', ')}`);
      
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

