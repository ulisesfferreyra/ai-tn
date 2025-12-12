// /pages/api/tryon.js
// VERSIÓN MEJORADA: Análisis con OpenAI Vision + Generación con Gemini Nano Banana
// Basado en: 
// - https://platform.openai.com/docs/guides/images-vision
// - https://ai.google.dev/gemini-api/docs/image-generation

import sharp from 'sharp';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

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

  return `You are an expert fashion AI with advanced image analysis capabilities. Your task is to dress the user with the exact garment from product images.

TASK: Dress the user (first image) with the exact garment from the product images (remaining images).

⚠️ CRITICAL: SYSTEMATIC IMAGE ANALYSIS - FOLLOW EXACTLY

IMAGE ORDER (FIXED):
- Image 1: USER (person to dress) - ALWAYS
- Image 2: First product image (could be front OR back - you must determine)
- Image 3, 4, etc.: Additional product images (may include models wearing the garment)

═══════════════════════════════════════════════════════════════
PHASE 1: SYSTEMATIC IMAGE ANALYSIS
═══════════════════════════════════════════════════════════════

STEP 1: Identify and Catalog All Images
- Image 1 = USER (person to dress) - confirm this is a person photo
- Image 2 = First product image - analyze in detail
- Images 3+ = Additional product images - analyze each one

STEP 2: DETAILED ANALYSIS OF EACH PRODUCT IMAGE

For EACH product image (2, 3, 4, etc.), perform a systematic visual analysis:

A) Image Type Detection:
   - Does it show a PERSON/MODEL wearing the garment? (Yes/No)
   - Does it show the garment alone (flat or on mannequin)? (Yes/No)
   - What is the viewing angle? (front view / back view / side view / other)

B) Visual Element Extraction (if garment is visible):
   - Design/Graphics: Describe ALL visible graphics, logos, text, patterns
   - Colors: Note primary and secondary colors
   - Structural elements: Collar (yes/no, type), neckline (shape, depth), buttons/zippers (location), seams
   - Text/Logos: Any text visible? Where? What does it say?
   - Patterns: Stripes, prints, graphics - describe in detail
   - Tags/Labels: Visible tags? Where? (typically on back)

C) Orientation Indicators:
   - FRONT indicators: Collar visible, neckline opening, buttons/zipper in front, main graphics/logos, text facing viewer
   - BACK indicators: Tags visible, simpler design, no collar opening, different graphics than front

STEP 3: COMPARISON LOGIC - DETERMINE IF IMAGE 2 IS FRONT OR BACK

CRITICAL: Follow this EXACT sequence for comparison:

A) Search for MODEL photos in images 3, 4, etc.:
   - Systematically check each image (3, 4, etc.)
   - Look for images showing a PERSON/MODEL wearing the garment facing the camera (front view)
   - If found, extract and document:
     * The design/graphics visible on the FRONT of the garment (chest/torso area)
     * Colors, patterns, logos, text - describe in detail
     * Any unique identifying features

B) Extract design from Image 2:
   - Analyze Image 2 in detail
   - Document ALL visible design elements:
     * Graphics, logos, text, patterns
     * Colors and their arrangement
     * Any unique identifying features
   - Note structural elements (collar, buttons, etc.)

C) SYSTEMATIC COMPARISON:
   - Compare Image 2 design with model photo design (if model photo found in images 3+)
   - Compare element by element:
     * Graphics/Logos: Same or different?
     * Text: Same or different?
     * Patterns: Same or different?
     * Colors: Same or different?
     * Overall design composition: Same or different?
   
   - DECISION RULE:
     * IF model photo found AND designs are DIFFERENT:
       → Image 2 = BACK of the garment
       → The model photo shows the FRONT design
     * IF model photo found AND designs are THE SAME:
       → Image 2 = FRONT of the garment
     * IF no model photo found:
       → Use orientation indicators (collars, tags, etc.) to determine if Image 2 is front or back

STEP 4: Determine Correct FRONT Design to Use
- If Image 2 = BACK: Extract FRONT design from model photo (images 3+) or other product images
- If Image 2 = FRONT: Use Image 2's design
- Document the exact FRONT design elements you will use:
  * Graphics/Logos description
  * Colors and arrangement
  * Text (if any)
  * Patterns
  * Structural elements

═══════════════════════════════════════════════════════════════
PHASE 2: DRESSING THE USER
═══════════════════════════════════════════════════════════════

DRESSING INSTRUCTIONS:
- Replace ONLY the user's clothing with the product garment
- Use the CORRECT FRONT side design (as determined in Phase 1)
- Apply the exact design elements documented in Step 4
- Preserve: user's face, pose, expression, background, lighting
- Match colors, patterns, logos, graphics, and text with 100% accuracy from the FRONT side
- Ensure natural neckline alignment and proper fit
- Size: ${sizeInstruction}
- Make it photorealistic with natural fabric drape and realistic shadows

═══════════════════════════════════════════════════════════════
PHASE 3: VERIFICATION BEFORE GENERATING
═══════════════════════════════════════════════════════════════

Before generating, verify ALL of the following:

✓ Performed systematic analysis of all product images
✓ Identified which images show models wearing the garment
✓ Extracted and documented design from Image 2
✓ Extracted and documented design from model photo (if exists)
✓ Compared designs systematically (element by element)
✓ Correctly determined if Image 2 is FRONT or BACK based on design comparison
✓ Documented the exact FRONT design to use
✓ Using the FRONT design (not the back) to dress the user
✓ All design elements (graphics, colors, text, patterns) match the FRONT side
✓ User's pose and orientation match the garment application

OUTPUT:
Generate a single high-quality image showing the user wearing the exact product garment (FRONT side) with perfect visual fidelity, matching all documented design elements.`.trim();
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
async function analyzeProductImages(userImageBase64, productImagesArray) {
  // Logs visibles en Vercel
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔍 INICIANDO ANÁLISIS CON OPENAI VISION');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`📸 Imágenes recibidas: 1 usuario + ${productImagesArray?.length || 0} producto`);
  console.log(`📏 Tamaño imagen usuario: ${userImageBase64 ? (userImageBase64.length / 1024).toFixed(2) + ' KB' : 'N/A'}`);
  
  log('═══════════════════════════════════════════════════════════════');
  log('🔍 INICIANDO ANÁLISIS CON OPENAI VISION');
  log('═══════════════════════════════════════════════════════════════');
  log(`📸 Imágenes recibidas: 1 usuario + ${productImagesArray?.length || 0} producto`);
  log(`📏 Tamaño imagen usuario: ${userImageBase64 ? (userImageBase64.length / 1024).toFixed(2) + ' KB' : 'N/A'}`);
  
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

  const analysisPrompt = `You will receive multiple images: some showing a USER/PERSON and others showing a GARMENT (clothing product).

Your task: Create a JSON output that will be used to generate a virtual try-on image. You must DETECT and DESCRIBE everything dynamically - never assume anything about the garment type.

CRITICAL - FOLLOW THIS EXACT SEQUENCE:

STEP 1: IDENTIFY THE USER IMAGE
- Find the image showing the person who needs garment replacement
- Determine their pose orientation: are they facing camera (front) or facing away (back)?

STEP 2: IDENTIFY ALL GARMENT IMAGES
- Find all images showing the garment
- For each garment image, determine: FRONT or BACK view?

STEP 3: MATCH GARMENT ORIENTATION TO USER ORIENTATION
- User facing camera (front) → select FRONT view of garment
- User facing away (back) → select BACK view of garment

STEP 4: DYNAMICALLY DETECT GARMENT TYPE AND ALL CHARACTERISTICS
This is CRITICAL - you must detect and describe EXACTLY what you see, not assume anything:

A) GARMENT TYPE (detect exactly what it is):
   - t-shirt, tank top/sleeveless, muscle tee, crop top, long sleeve shirt, hoodie, sweatshirt, jacket, vest, polo, button-up shirt, etc.

B) SLEEVE CHARACTERISTICS (detect exactly):
   - none/sleeveless (NO sleeves at all - like tank tops, muscle tees)
   - cap sleeves (very short, just covering shoulders)
   - short sleeves (typical t-shirt length)
   - 3/4 sleeves (below elbow)
   - long sleeves (full length to wrist)
   - rolled up sleeves
   - etc.

C) NECKLINE TYPE (detect exactly):
   - crew neck (round)
   - v-neck
   - scoop neck
   - high neck/mock neck
   - hoodie with hood
   - collar (polo or button-up)
   - etc.

D) FIT AND LENGTH (detect exactly):
   - Body fit: skin-tight, fitted, regular, relaxed, loose, oversized, boxy
   - Length: cropped (above waist), regular, long/tunic, oversized

E) MATERIAL APPEARANCE (if visible):
   - Cotton, jersey, denim, leather, knit, etc.

F) COLOR(S):
   - Primary color, secondary colors, patterns

STEP 5: CAPTURE ALL DESIGN DETAILS
- Graphics, logos, text, prints, patterns
- Exact placement (center chest, left chest, full front, back, etc.)
- Any unique features (pockets, zippers, buttons, distressing, etc.)

STEP 6: ANALYZE HOW THE GARMENT FITS ON THE MODEL (CRITICAL FOR REPLICATION)
If there's a model wearing the garment in any of the product images, analyze EXACTLY how it fits:

A) SLEEVE LENGTH ON BODY (if applicable):
   - Where do sleeves end relative to arm? (shoulder, mid-bicep, elbow, mid-forearm, wrist)
   - Are they tight or loose on the arm?

B) TORSO FIT:
   - How does it fit on chest/torso? (skin-tight, fitted, slightly loose, very loose, boxy)
   - Does it show body shape or hide it?

C) GARMENT LENGTH ON BODY:
   - Where does the garment end? (above waist, at waist, below waist, at hips, mid-thigh)
   - Is it tucked in or hanging loose?

D) SHOULDER FIT:
   - Do shoulders align with model's shoulders or are they dropped/oversized?
   - For sleeveless: how wide are the arm openings?

E) OVERALL SILHOUETTE:
   - Describe the overall shape/silhouette when worn

Return ONLY valid JSON (no additional text, no markdown, no code blocks):

{
  "user_image": {
    "index": <number>,
    "description": "<detailed description of user's pose>"
  },
  "garment_image": {
    "index": <number>,
    "description": "<description of the garment view>",
    "orientation": "<front/back>",
    "reason": "<why this image matches user's orientation>"
  },
  "garment_type": {
    "category": "<exact garment type: tank top, t-shirt, hoodie, etc.>",
    "sleeves": "<none/sleeveless, cap, short, 3/4, long, etc.>",
    "neckline": "<crew neck, v-neck, hoodie, collar, etc.>",
    "material_appearance": "<cotton, jersey, knit, etc. or unknown>"
  },
  "fit_style": {
    "body_fit": "<skin-tight/fitted/regular/relaxed/loose/oversized/boxy>",
    "garment_length": "<cropped/regular/long/oversized>"
  },
  "how_it_fits_on_model": {
    "sleeve_end_point": "<shoulder/mid-bicep/elbow/mid-forearm/wrist/not applicable for sleeveless>",
    "sleeve_tightness": "<tight on arm/fitted/loose/very loose/not applicable>",
    "torso_fit": "<skin-tight/fitted/slightly loose/loose/very loose/boxy>",
    "garment_end_point": "<above waist/at waist/below waist/at hips/mid-thigh>",
    "shoulder_fit": "<aligned with shoulders/slightly dropped/dropped/oversized>",
    "arm_opening_width": "<narrow/medium/wide - for sleeveless garments>",
    "overall_silhouette": "<describe the shape when worn: fitted and body-hugging / relaxed and comfortable / oversized and boxy / etc.>"
  },
  "colors": {
    "primary": "<main color>",
    "secondary": "<other colors if any, or none>"
  },
  "design_details": {
    "description": "<ALL visible design elements: graphics, logos, text, patterns>",
    "placement": "<where designs are located: center chest, left chest, full front, etc.>",
    "notable_features": "<unique features: pockets, zippers, distressing, etc.>"
  },
  "generation_instruction": "<DETAILED instruction that includes ALL characteristics AND how it should fit. Example: 'Dress the user with a BLACK SLEEVELESS TANK TOP with NO SLEEVES, crew neckline, WIDE arm openings, relaxed boxy fit that ends at the hips. The garment should drape loosely on the torso, not fitted. Small red star logo on left chest. CRITICAL: No sleeves, wide arm openings, loose fit ending at hips - exactly as shown on the model.'>",
  "reasoning": "<your analysis process>",
  "confidence": "<high/medium/low>"
}

CRITICAL RULES:
- DETECT everything dynamically - never assume the garment type
- If it's SLEEVELESS, explicitly state "NO SLEEVES" in generation_instruction
- If it has SHORT SLEEVES, explicitly state "SHORT SLEEVES" in generation_instruction
- The generation_instruction must be detailed enough that someone could recreate the exact garment
- Output must be valid JSON only`;

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
      
      // Validar estructura del JSON
      if (!analysisData.user_image || !analysisData.garment_image) {
        throw new Error('JSON structure invalid: missing user_image or garment_image');
      }
      
      // Validar índices - OpenAI puede retornar índices basados en 0 o en 1
      // Detectamos automáticamente según el valor de user_image.index
      const userIndex = analysisData.user_image.index;
      const garmentIndex = analysisData.garment_image.index;
      
      // Detectar si OpenAI usa índices basados en 0 o en 1
      // Si user_image.index es 0, entonces usa índices basados en 0
      // Si user_image.index es 1, entonces usa índices basados en 1
      const isZeroBased = userIndex === 0;
      
      if (isZeroBased) {
        log(`📊 OpenAI usa índices basados en 0 (user_index: ${userIndex})`);
      } else if (userIndex === 1) {
        log(`📊 OpenAI usa índices basados en 1 (user_index: ${userIndex})`);
      } else {
        warn(`⚠️ user_image.index inesperado: ${userIndex}, asumiendo índices basados en 0`);
      }
      
      // Convertir garment_index a índice de array de productos
      let useImageIndex = 0;
      
      if (isZeroBased) {
        // Índices basados en 0: user=0, product1=1, product2=2, product3=3
        // garmentIndex 1 → array índice 0, garmentIndex 2 → array índice 1, etc.
        if (garmentIndex >= 1 && garmentIndex <= 3) {
          useImageIndex = garmentIndex - 1;
          log(`📊 Conversión (base 0): garmentIndex ${garmentIndex} → array índice ${useImageIndex}`);
        } else {
          warn(`⚠️ garment_image.index inválido para base 0: ${garmentIndex}, usando primera imagen`);
          useImageIndex = 0;
        }
      } else {
        // Índices basados en 1: user=1, product1=2, product2=3, product3=4
        // garmentIndex 2 → array índice 0, garmentIndex 3 → array índice 1, etc.
        if (garmentIndex >= 2 && garmentIndex <= 4) {
          useImageIndex = garmentIndex - 2;
          log(`📊 Conversión (base 1): garmentIndex ${garmentIndex} → array índice ${useImageIndex}`);
        } else {
          warn(`⚠️ garment_image.index inválido para base 1: ${garmentIndex}, usando primera imagen`);
          useImageIndex = 0;
        }
      }
      
      // Validar que el índice esté dentro del rango del array
      if (useImageIndex < 0 || useImageIndex >= productImagesArray.length) {
        warn(`⚠️ Índice fuera de rango: ${useImageIndex}, usando primera imagen`);
        useImageIndex = 0;
      }
      
      // Agregar useImageIndex para compatibilidad
      analysisData.useImageIndex = useImageIndex;
      
      log(`🎯 Resultado del análisis:`);
      log(`   👤 Usuario: imagen ${userIndex} - ${analysisData.user_image.description}`);
      log(`   👕 Garment: imagen ${garmentIndex} (índice array: ${useImageIndex}) - ${analysisData.garment_image.orientation}`);
      log(`   📏 Fit: ${analysisData.fit_style?.sleeve_length || 'N/A'} sleeves, ${analysisData.fit_style?.body_fit || 'N/A'} fit, ${analysisData.fit_style?.garment_length || 'N/A'} length`);
      log(`   🎨 Design: ${analysisData.design_details?.description?.substring(0, 100) || 'N/A'}...`);
      log(`   📝 Razón: ${analysisData.reasoning || 'No reasoning provided'}`);
      log(`   ✅ Confianza: ${analysisData.confidence || 'unknown'}`);

    } catch (parseErr) {
      warn('Error parseando respuesta de análisis, usando primera imagen:', parseErr);
      analysisData = { 
        useImageIndex: 0, 
        user_image: { index: 1, description: 'Unknown' },
        garment_image: { index: 2, description: 'Unknown', orientation: 'front', reason: 'Error parsing analysis' },
        fit_style: { sleeve_length: 'regular', body_fit: 'regular', garment_length: 'regular' },
        design_details: { description: 'Unknown', notable_features: 'Unknown' },
        instruction: 'Replace garment with first product image',
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
// ───────────────────────────────────────────────────────────────────────────────
function buildGenerationPrompt({ analysisData, size }) {
  // Extraer datos del análisis - TODO ES DINÁMICO
  const userImage = analysisData.user_image || { description: 'Person facing camera' };
  const garmentImage = analysisData.garment_image || { description: 'Garment view', orientation: 'front', reason: 'Selected garment' };
  
  // Nuevo: tipo de prenda detectado dinámicamente
  const garmentType = analysisData.garment_type || { 
    category: 'garment', 
    sleeves: 'unknown', 
    neckline: 'unknown',
    material_appearance: 'unknown'
  };
  
  const fitStyle = analysisData.fit_style || { body_fit: 'regular', garment_length: 'regular' };
  const colors = analysisData.colors || { primary: 'unknown', secondary: 'none' };
  const designDetails = analysisData.design_details || { description: 'Garment design', placement: 'unknown', notable_features: 'Standard features' };
  
  // NUEVO: Cómo le queda la prenda al modelo
  const howItFits = analysisData.how_it_fits_on_model || {
    sleeve_end_point: 'unknown',
    sleeve_tightness: 'unknown',
    torso_fit: 'unknown',
    garment_end_point: 'unknown',
    shoulder_fit: 'unknown',
    arm_opening_width: 'unknown',
    overall_silhouette: 'unknown'
  };
  
  // CRÍTICO: La instrucción completa generada por OpenAI con TODOS los detalles
  const generationInstruction = analysisData.generation_instruction || analysisData.instruction || 'Replace the garment on the user with the product garment';
  const confidence = analysisData.confidence || 'medium';

  // Construir descripción de mangas - CRÍTICO para sleeveless
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

  // Construir descripción de cómo debe quedar (basado en el modelo)
  let fitOnBodyDescription = '';
  if (howItFits.overall_silhouette !== 'unknown') {
    fitOnBodyDescription = `
═══════════════════════════════════════════════════════════════
HOW THE GARMENT SHOULD FIT (COPY EXACTLY FROM MODEL):
═══════════════════════════════════════════════════════════════

The garment MUST look EXACTLY like it does on the model in the product photos:

- SLEEVES END AT: ${howItFits.sleeve_end_point}
- SLEEVE TIGHTNESS: ${howItFits.sleeve_tightness}
- TORSO FIT: ${howItFits.torso_fit}
- GARMENT ENDS AT: ${howItFits.garment_end_point}
- SHOULDER FIT: ${howItFits.shoulder_fit}
- ARM OPENING WIDTH: ${howItFits.arm_opening_width}
- OVERALL SILHOUETTE: ${howItFits.overall_silhouette}

⚠️ CRITICAL: Replicate the EXACT same fit as shown on the model. If the garment is loose/boxy on the model, it must be loose/boxy on the user. If sleeves end at mid-bicep on the model, they must end at mid-bicep on the user.
`;
  }

  return `VIRTUAL TRY-ON TASK - DYNAMIC GARMENT DETECTION

You will receive TWO images:
1. USER IMAGE: The person to dress
2. GARMENT IMAGE: The exact garment to put on the user

═══════════════════════════════════════════════════════════════
DYNAMICALLY DETECTED GARMENT SPECIFICATIONS (DO NOT DEVIATE):
═══════════════════════════════════════════════════════════════

GARMENT TYPE: ${garmentType.category}
${sleeveDescription}
NECKLINE: ${garmentType.neckline}
MATERIAL: ${garmentType.material_appearance}

FIT:
- Body fit: ${fitStyle.body_fit}
- Length: ${fitStyle.garment_length}

COLORS:
- Primary: ${colors.primary}
- Secondary: ${colors.secondary}

DESIGN ELEMENTS:
${designDetails.description}
- Placement: ${designDetails.placement}
- Notable features: ${designDetails.notable_features}
${fitOnBodyDescription}
═══════════════════════════════════════════════════════════════
MAIN INSTRUCTION (FOLLOW EXACTLY):
═══════════════════════════════════════════════════════════════

${generationInstruction}

═══════════════════════════════════════════════════════════════
MANDATORY RULES:
═══════════════════════════════════════════════════════════════

✓ USER PRESERVATION (DO NOT CHANGE):
  - User's face, expression, features → KEEP IDENTICAL
  - User's pose and body position → KEEP IDENTICAL
  - User's arms and hands → KEEP IDENTICAL
  - Background and lighting → KEEP IDENTICAL

✓ GARMENT APPLICATION (CRITICAL):
  - Apply the EXACT garment type detected: ${garmentType.category}
  - ${sleeveDescription}
  - Use the EXACT neckline: ${garmentType.neckline}
  - Apply the EXACT fit: ${fitStyle.body_fit}, ${fitStyle.garment_length}
  - Use the EXACT colors: ${colors.primary}${colors.secondary !== 'none' ? ', ' + colors.secondary : ''}
  - MATCH the fit from the model: ${howItFits.overall_silhouette}

✓ DESIGN REPLICATION (100% ACCURATE):
  - Copy ALL graphics, logos, text EXACTLY as shown
  - Place designs in the EXACT position: ${designDetails.placement}
  - Preserve ALL notable features: ${designDetails.notable_features}

✓ REALISM:
  - Photorealistic quality
  - Natural fabric drape and shadows
  - Seamless body-garment integration

⚠️ CRITICAL WARNINGS:
- If garment is SLEEVELESS → generate with NO SLEEVES (not short sleeves, NO sleeves)
- If garment has SHORT SLEEVES → generate with SHORT SLEEVES (not long, not sleeveless)
- The garment type MUST match exactly what was detected
- DO NOT add or remove features that weren't in the original garment

OUTPUT: Generate ONE photorealistic image of the user wearing the exact garment as specified above.

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

  // Usar requestId del frontend si viene, sino generar uno nuevo
  const requestId = req.body?.requestId || `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  console.log('[VERCEL-LOG] ===========================================');
  console.log(`[VERCEL-LOG] REQUEST INICIADO [${requestId}]`);
  console.log(`[VERCEL-LOG] Request ID Source: ${req.body?.requestId ? 'frontend' : 'backend-generated'}`);
  console.log('[VERCEL-LOG] ===========================================');
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`🚀 REQUEST INICIADO [${requestId}]`);
  console.log(`📋 Request ID Source: ${req.body?.requestId ? 'frontend' : 'backend-generated'}`);
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
    requestIdSource: req.body?.requestId ? 'frontend' : 'backend-generated'
  });
  
  if (IS_DEV) {
    log('📦 Headers:', req.headers);
    log('📦 Body keys:', Object.keys(req.body || {}));
    const asStr = JSON.stringify(req.body || {});
    log('📦 Body size:', asStr.length, 'chars ≈', (asStr.length / 1024 / 1024).toFixed(2), 'MB');
  }

  try {
    const { productImage, productImages, size, userImage, userOrientation } = req.body || {};
    
    log(`📥 DATOS RECIBIDOS [${requestId}]:`);
    log(`   ✅ userImage: ${userImage ? 'SÍ' : 'NO'} (${userImage ? (userImage.length / 1024).toFixed(2) + ' KB' : '0 KB'})`);
    log(`   ✅ productImages: ${Array.isArray(productImages) ? `SÍ (${productImages.length} imágenes)` : 'NO'}`);
    log(`   ✅ productImage: ${productImage ? 'SÍ' : 'NO'}`);
    log(`   ✅ size: ${size || 'M (default)'}`);
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
      productImagesArray
    );
    
    let { useImageIndex } = analysisResult;
    log(`✅ Análisis completado: Usar imagen del producto en índice ${useImageIndex}`);

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

    // Construir prompt usando datos del análisis de OpenAI
    const generationPrompt = buildGenerationPrompt({ 
      analysisData: analysisResult,
      size 
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

    log('✅ Imagen generada exitosamente');
    log(`📋 Request ID: ${requestId}`);
    log('═══════════════════════════════════════════════════════════════');
    log(`✅ REQUEST COMPLETADO [${requestId}]`);
    log('═══════════════════════════════════════════════════════════════');
    
    // Asegurar que requestId y model siempre estén presentes
    const responseData = {
      success: true,
      description: 'Imagen generada exitosamente con IA',
      generatedImage: `data:image/jpeg;base64,${imageBase64}`,
      size: size || 'M',
      orientation: selectedOrientation,
      model: GENERATION_MODEL || 'gemini-2.5-flash-image', // Fallback por si acaso
      requestId: requestId || `req_${Date.now()}_fallback`, // Fallback por si acaso
      timestamp: new Date().toISOString(),
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

