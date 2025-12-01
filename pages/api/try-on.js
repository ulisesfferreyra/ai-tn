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
  log('🔍 PASO 1: Iniciando análisis con OpenAI Vision...');
  log(`📸 Imágenes recibidas: 1 usuario + ${productImagesArray.length} producto`);
  
  if (!productImagesArray || productImagesArray.length === 0) {
    return { useImageIndex: 0, reasoning: 'No product images provided' };
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    warn('⚠️ OPENAI_API_KEY no configurada, usando primera imagen del producto');
    return { useImageIndex: 0, reasoning: 'OpenAI API key not configured, using first product image' };
  }

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const analysisPrompt = `You will receive multiple images: some showing a USER/PERSON and others showing a GARMENT (clothing product).

Your task: Create a JSON output that Nanobanana will use to generate a virtual try-on image by replacing the user's garment with the correct garment view.

CRITICAL - FOLLOW THIS EXACT SEQUENCE:

STEP 1: IDENTIFY THE USER IMAGE

- Find the image showing the person who needs garment replacement

- Determine their pose orientation: are they facing camera (front) or facing away (back)?

- Note: This tells us which garment view we need

STEP 2: IDENTIFY ALL GARMENT IMAGES

- Find all images showing the garment (may include model wearing it, flat lays, or different angles)

- For each garment image, determine: is this showing the FRONT or BACK of the garment?

STEP 3: MATCH GARMENT ORIENTATION TO USER ORIENTATION

- If user is facing camera (front pose) → select garment image showing FRONT view

- If user is facing away (back pose) → select garment image showing BACK view

- CRITICAL: The garment orientation MUST match the user's pose orientation

STEP 4: HOW TO IDENTIFY GARMENT FRONT vs BACK:

- If person wearing garment is facing camera → what's on their CHEST = FRONT

- If person wearing garment is facing away → what's on their BACK = BACK

- For flat lays: analyze garment structure, neckline, collar, tag placement

- DO NOT assume large graphics = front (they can be on back)

- DO NOT use design complexity to determine orientation

STEP 5: ANALYZE THE GARMENT FIT/STYLE

- Look at how the garment fits on ANY model in the images

- Measure fit characteristics:

  * Sleeve length: short/regular/long/oversized

  * Body fit: tight/regular/loose/oversized/boxy

  * Garment length: cropped/regular/long/oversized

- If no model present, analyze garment structure and proportions

STEP 6: CAPTURE DESIGN DETAILS

- Describe ALL visible design elements on the selected garment view

- Include: graphics, text, logos, patterns, colors, placement

- Note unique features that must be preserved in the virtual try-on

Return ONLY valid JSON (no additional text, no markdown, no code blocks):

{
  "user_image": {
    "index": <number>,
    "description": "<detailed description of user's pose: facing front/back, body position, arms position>"
  },
  "garment_image": {
    "index": <number>,
    "description": "<description of the garment view shown in this image>",
    "orientation": "<front/back>",
    "reason": "<explain why this garment image matches the user's orientation>"
  },
  "fit_style": {
    "sleeve_length": "<short/regular/long/oversized>",
    "body_fit": "<tight/regular/loose/oversized/boxy>",
    "garment_length": "<cropped/regular/long/oversized>"
  },
  "design_details": {
    "description": "<detailed description of ALL design elements visible on the selected garment view>",
    "notable_features": "<unique identifiable features that must be preserved>"
  },
  "instruction": "<clear instruction for Nanobanana: 'Replace the garment on the user in image X (orientation) with the garment shown in image Y (orientation), maintaining the [fit_style] characteristics'>",
  "reasoning": "<explain your analysis: which image is the user? what's their orientation? which garment image matches? how did you identify front/back?>",
  "confidence": "<high/medium/low>"
}

CRITICAL RULES:

- user_image.index and garment_image.index must be different

- garment_image.orientation MUST match user's pose orientation

- fit_style must accurately reflect how garment appears on any model

- design_details must capture EVERY visible element for accurate replication

- Output must be valid JSON only, no markdown formatting`;

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

    log(`📤 Enviando ${messages[0].content.length - 1} imágenes a OpenAI Vision (1 usuario + ${productImagesArray.length} producto)...`);
    const openaiStartTime = Date.now();
    
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
      throw new Error('No response from OpenAI');
    }

    log('✅ Análisis completado con OpenAI');
    log(`⏱️ Tiempo de análisis: ${openaiDuration}ms`);
    log('📋 Respuesta del análisis:', analysisText);
    log('📊 Tokens usados:', {
      prompt_tokens: analysisResponse.usage?.prompt_tokens || 'N/A',
      completion_tokens: analysisResponse.usage?.completion_tokens || 'N/A',
      total_tokens: analysisResponse.usage?.total_tokens || 'N/A'
    });

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
      
      // Validar índices (OpenAI retorna índices basados en 1, nosotros usamos basados en 0)
      // user_image.index: 1 = usuario (índice 0 en nuestro array)
      // garment_image.index: 2, 3, 4 = productos (índices 0, 1, 2 en nuestro array)
      const userIndex = analysisData.user_image.index;
      const garmentIndex = analysisData.garment_image.index;
      
      // Validar que user_index sea 1 (usuario)
      if (userIndex !== 1) {
        warn(`⚠️ user_image.index debe ser 1, recibido: ${userIndex}`);
      }
      
      // Convertir garment_index a índice de array (Image 2 = índice 0, Image 3 = índice 1, Image 4 = índice 2)
      let useImageIndex = 0;
      if (garmentIndex >= 2 && garmentIndex <= 4) {
        useImageIndex = garmentIndex - 2; // Convertir a índice de array
      } else {
        warn(`⚠️ garment_image.index inválido: ${garmentIndex}, usando primera imagen`);
        useImageIndex = 0;
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
  // Extraer datos del análisis
  const userImage = analysisData.user_image || { description: 'Person facing camera' };
  const garmentImage = analysisData.garment_image || { description: 'Garment view', orientation: 'front', reason: 'Selected garment' };
  const fitStyle = analysisData.fit_style || { sleeve_length: 'regular', body_fit: 'regular', garment_length: 'regular' };
  const designDetails = analysisData.design_details || { description: 'Garment design', notable_features: 'Standard features' };
  const instruction = analysisData.instruction || 'Replace the garment on the user with the product garment';
  const confidence = analysisData.confidence || 'medium';

  return `VIRTUAL TRY-ON TASK

You will receive TWO images that have been pre-analyzed and matched:

1. USER IMAGE: Person in specific pose (facing front or back)

2. GARMENT IMAGE: The exact garment view that matches the user's orientation

PRE-ANALYSIS CONTEXT:

User Pose: ${userImage.description}

Garment View: ${garmentImage.description} (${garmentImage.orientation})

Match Reasoning: ${garmentImage.reason}

GARMENT FIT SPECIFICATIONS:

- Sleeve length: ${fitStyle.sleeve_length}

- Body fit: ${fitStyle.body_fit}

- Garment length: ${fitStyle.garment_length}

GARMENT DESIGN TO REPLICATE:

${designDetails.description}

Critical Features: ${designDetails.notable_features}

YOUR TASK:

${instruction}

MANDATORY EXECUTION RULES:

✓ USER PRESERVATION (ZERO TOLERANCE):

 - Keep user's EXACT pose: ${userImage.description}

 - Keep user's EXACT face, expression, features (100% recognizable)

 - Keep user's EXACT arms, hands, body position (no movement)

 - Keep EXACT background, lighting, environment (unchanged)

✓ GARMENT REPLACEMENT:

 - Replace ONLY the user's existing garment with the product garment

 - Apply garment with these EXACT fit characteristics:

  * Sleeves: ${fitStyle.sleeve_length} - do not adjust

  * Body: ${fitStyle.body_fit} - do not tighten or loosen

  * Length: ${fitStyle.garment_length} - do not shorten or extend

✓ DESIGN ACCURACY:

 - Replicate EVERY design element: ${designDetails.description}

 - Preserve all notable features: ${designDetails.notable_features}

 - Match exact colors, patterns, graphics, text, placement

 - No design elements should be missing, distorted, or altered

✓ ORIENTATION CORRECTNESS:

 - User orientation: ${userImage.description}

 - Garment orientation: ${garmentImage.orientation}

 - These MUST align (front-to-front OR back-to-back)

 - Do NOT mix orientations or flip designs

✓ REALISM:

 - Photorealistic output quality

 - Natural fabric drape, wrinkles, shadows

 - Proper garment-body interaction

 - Seamless integration with user's body

CRITICAL GUARDRAILS:

- If user's pose changes → REFUSE

- If face becomes unrecognizable → REFUSE

- If background changes → REFUSE

- If fit specifications cannot be met → REFUSE

- If design elements are incomplete → REFUSE

- If orientation mismatch occurs → REFUSE

OUTPUT REQUIREMENT:

Generate a photorealistic image showing the user in their EXACT original pose and environment, now wearing the garment with PERFECT design replication and EXACT fit specifications. The result must be indistinguishable from a real photo of this person wearing this garment.

Analysis Confidence Level: ${confidence}`.trim();
}

// ───────────────────────────────────────────────────────────────────────────────
// Handler
// ───────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  ensureCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const GOOGLE_API_KEY = process.env.GOOGLE_AI_API_KEY;
  if (!GOOGLE_API_KEY) return res.status(500).json({ success: false, error: 'Falta GOOGLE_AI_API_KEY' });

  // Usar requestId del frontend si viene, sino generar uno nuevo
  const requestId = req.body?.requestId || `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
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
    
    return res.json({
      success: true,
      description: 'Imagen generada exitosamente con IA',
      generatedImage: `data:image/jpeg;base64,${imageBase64}`,
      size: size || 'M',
      orientation: selectedOrientation,
      model: GENERATION_MODEL,
      requestId: requestId, // Incluir requestId en la respuesta para debugging
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
        model: 'fallback',
        requestId: requestId,
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

