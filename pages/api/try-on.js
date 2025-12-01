// /pages/api/tryon.js
// VERSIÓN MEJORADA: Análisis con OpenAI Vision + Generación con Gemini Nano Banana
// 3 IMÁGENES FINALES: Usuario + Garment Matched + 1 Contexto
// CON ANÁLISIS DE ESTILO COMBINADO

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

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const GENERATION_MODEL = 'gemini-2.5-flash-image';

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
    return input;
  } catch (e) {
    warn('normalizeToJpegBuffer: metadata error, devolviendo buffer original:', e.message);
    return input;
  }
}

function safePickGeneratedImage(resp) {
  try {
    const cand = resp?.candidates?.[0];
    if (cand) {
      const content = cand.content || cand?.content?.[0];
      if (content) {
        const parts = content.parts || content?.parts || [];
        for (const p of parts) {
          if (p?.inlineData?.data && typeof p.inlineData.data === 'string' && p.inlineData.data.length > 100) {
            log('✅ Imagen encontrada en candidates[0].content.parts[].inlineData.data');
            return p.inlineData.data;
          }
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
// PASO 1: Análisis con OpenAI Vision - Retorna 3 índices (user, matched garment, 1 context)
// ───────────────────────────────────────────────────────────────────────────────
async function analyzeProductImages(userImageBase64, productImagesArray) {
  log('═══════════════════════════════════════════════════════════════');
  log('🔍 INICIANDO ANÁLISIS CON OPENAI VISION');
  log('═══════════════════════════════════════════════════════════════');
  log(`📸 Imágenes recibidas: 1 usuario + ${productImagesArray?.length || 0} producto`);
  
  if (!productImagesArray || productImagesArray.length === 0) {
    warn('⚠️ No se recibieron imágenes del producto para análisis');
    return { 
      useImageIndex: 0, 
      additionalContextIndex: null,
      reasoning: 'No product images provided' 
    };
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    warn('⚠️ OPENAI_API_KEY no configurada');
    return { 
      useImageIndex: 0,
      additionalContextIndex: productImagesArray.length > 1 ? 1 : null,
      reasoning: 'OpenAI API key not configured' 
    };
  }
  
  log(`✅ OPENAI_API_KEY encontrada`);
  log(`🤖 Modelo OpenAI: ${OPENAI_MODEL}`);

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PROMPT ACTUALIZADO DE OPENAI - Con estilo combinado y límite de 1 imagen adicional
  // ═══════════════════════════════════════════════════════════════════════════════
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
- Measure fit characteristics (can combine multiple attributes):
  * Sleeve length: short/regular/long/oversized
  * Body fit: tight/fitted/regular/loose/oversized/boxy/relaxed
  * Garment length: cropped/regular/long/extended
  * Overall style: Describe the combination (e.g., "oversized + boxy", "fitted + cropped", "relaxed + long", "oversized streetwear")
- CRITICAL: Capture the complete style profile, not just individual attributes
- Examples of combined styles:
  * "oversized and boxy" - loose and square-shaped
  * "fitted and cropped" - snug with shortened length
  * "relaxed streetwear" - comfortable, casual aesthetic
  * "oversized with long sleeves" - baggy with extended sleeve length
- If no model present, analyze garment structure and proportions to infer style

STEP 6: CAPTURE DESIGN DETAILS
- Describe ALL visible design elements on the selected garment view
- Include: graphics, text, logos, patterns, colors, placement
- Note unique features that must be preserved in the virtual try-on

STEP 7: SELECT ONE ADDITIONAL CONTEXT IMAGE (CRITICAL - ONLY ONE)
- From the REMAINING garment images (excluding the matched garment image), select ONLY ONE additional image
- Priority selection criteria (choose the FIRST match):
  1. An image showing a HUMAN MODEL wearing the garment (for fit reference)
  2. If no human model exists, select the image with the CLEAREST view of garment details
  3. If all images are similar quality, select the first remaining image
- CRITICAL: You MUST select exactly ONE additional image, no more, no less
- Purpose: This single additional image provides context for fit accuracy and garment details
- DO NOT select more than one additional image (Nanobanana performs best with 3 total images: user + matched garment + 1 context)

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
    "body_fit": "<tight/fitted/regular/loose/oversized/boxy/relaxed>",
    "garment_length": "<cropped/regular/long/extended>",
    "overall_style": "<combined style description, e.g., 'oversized and boxy', 'fitted and cropped', 'relaxed streetwear', 'oversized with long sleeves'>"
  },
  "design_details": {
    "description": "<detailed description of ALL design elements visible on the selected garment view>",
    "notable_features": "<unique identifiable features that must be preserved>"
  },
  "additional_context_image": {
    "index": <number - exactly ONE additional image index>,
    "reason": "<explain why this specific image was selected: does it show a human model? does it provide clear garment details?>",
    "usage": "Reference only for fit accuracy and garment details. Study human model (if present) to understand realistic drape, proportions, and fabric behavior. DO NOT use for orientation decisions."
  },
  "instruction": "<clear instruction for Nanobanana: 'Replace the garment on the user in image X (orientation) with the garment shown in image Y (orientation), maintaining the [fit_style] characteristics including the overall style of [overall_style]. Use image Z as additional reference for fit and garment details.'>",
  "reasoning": "<explain your analysis: which image is the user? what's their orientation? which garment image matches? how did you identify front/back? what is the overall style and why? why did you select this specific additional context image?>",
  "confidence": "<high/medium/low>"
}

CRITICAL RULES:
- user_image.index and garment_image.index must be different
- additional_context_image.index must be different from both user_image.index and garment_image.index
- garment_image.orientation MUST match user's pose orientation
- fit_style must accurately reflect how garment appears on any model
- overall_style must capture the complete aesthetic, not just individual measurements
- design_details must capture EVERY visible element for accurate replication
- additional_context_image must contain EXACTLY ONE index (not an array, not multiple indices)
- Output must be valid JSON only, no markdown formatting`;

  try {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: analysisPrompt },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${userImageBase64}` }
          }
        ]
      }
    ];

    // Agregar todas las imágenes del producto
    for (let i = 0; i < productImagesArray.length; i++) {
      const raw = productImagesArray[i];
      try {
        const parsed = parseDataUrl(raw);
        if (!parsed) continue;
        
        const buf = await normalizeToJpegBuffer(parsed.base64);
        messages[0].content.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` }
        });
      } catch (imgErr) {
        warn(`Error procesando imagen producto ${i}:`, imgErr.message);
      }
    }

    const totalImages = messages[0].content.length - 1;
    log(`📤 Enviando ${totalImages} imágenes a OpenAI (1 usuario + ${productImagesArray.length} producto)...`);
    
    const openaiStartTime = Date.now();
    const analysisResponse = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: messages,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 1500,
    });

    const openaiDuration = Date.now() - openaiStartTime;
    const analysisText = analysisResponse.choices[0]?.message?.content;
    
    if (!analysisText) {
      err('❌ OpenAI no retornó contenido');
      throw new Error('No response from OpenAI');
    }

    log('═══════════════════════════════════════════════════════════════');
    log('✅ ANÁLISIS COMPLETADO CON OPENAI VISION');
    log(`⏱️ Tiempo: ${openaiDuration}ms`);
    log(`📊 Tokens: ${analysisResponse.usage?.total_tokens || 'N/A'}`);
    log('═══════════════════════════════════════════════════════════════');

    // Parsear respuesta JSON
    let analysisData;
    try {
      const cleanedText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysisData = JSON.parse(cleanedText);
      
      // Validar estructura
      if (!analysisData.user_image || !analysisData.garment_image) {
        throw new Error('JSON structure invalid: missing user_image or garment_image');
      }
      
      // Convertir índices de OpenAI (basados en 1) a índices de array (basados en 0)
      const userIndex = analysisData.user_image.index;
      const garmentIndex = analysisData.garment_image.index;
      const contextIndex = analysisData.additional_context_image?.index;
      
      // Validar user_index (debe ser 1 = usuario)
      if (userIndex !== 1) {
        warn(`⚠️ user_image.index debe ser 1, recibido: ${userIndex}`);
      }
      
      // Convertir garment_index a índice de array
      let useImageIndex = 0;
      if (garmentIndex >= 2 && garmentIndex <= (productImagesArray.length + 1)) {
        useImageIndex = garmentIndex - 2;
      } else {
        warn(`⚠️ garment_image.index inválido: ${garmentIndex}, usando primera imagen`);
        useImageIndex = 0;
      }
      
      // Validar rango
      if (useImageIndex < 0 || useImageIndex >= productImagesArray.length) {
        warn(`⚠️ Índice fuera de rango: ${useImageIndex}, usando primera imagen`);
        useImageIndex = 0;
      }
      
      // Convertir context_index a índice de array
      let additionalContextIndex = null;
      if (contextIndex && contextIndex >= 2 && contextIndex <= (productImagesArray.length + 1)) {
        additionalContextIndex = contextIndex - 2;
        
        // Validar que no sea el mismo que garment_index
        if (additionalContextIndex === useImageIndex) {
          warn(`⚠️ additional_context_image.index es igual a garment_image.index, buscando alternativa`);
          // Buscar primera imagen disponible diferente
          for (let i = 0; i < productImagesArray.length; i++) {
            if (i !== useImageIndex) {
              additionalContextIndex = i;
              break;
            }
          }
        }
        
        // Validar rango
        if (additionalContextIndex < 0 || additionalContextIndex >= productImagesArray.length) {
          warn(`⚠️ Context index fuera de rango: ${additionalContextIndex}`);
          additionalContextIndex = null;
        }
      }
      
      // Si no hay additional_context_image en la respuesta o es inválido, seleccionar automáticamente
      if (additionalContextIndex === null && productImagesArray.length > 1) {
        // Seleccionar primera imagen disponible que no sea la matched
        for (let i = 0; i < productImagesArray.length; i++) {
          if (i !== useImageIndex) {
            additionalContextIndex = i;
            log(`ℹ️ additional_context_image seleccionado automáticamente: índice ${i}`);
            
            // Agregar a analysisData si no existía
            if (!analysisData.additional_context_image) {
              analysisData.additional_context_image = {
                index: i + 2, // Convertir a formato OpenAI (basado en 1, +1 por user image)
                reason: "Automatically selected as additional context",
                usage: "Reference only for fit accuracy and garment details. Study human model (if present) to understand realistic drape, proportions, and fabric behavior. DO NOT use for orientation decisions."
              };
            }
            break;
          }
        }
      }
      
      // Agregar índices convertidos para uso interno
      analysisData.useImageIndex = useImageIndex;
      analysisData.additionalContextIndex = additionalContextIndex;
      
      log(`🎯 Resultado del análisis:`);
      log(`   👤 Usuario: imagen ${userIndex}`);
      log(`   👕 Garment matched: imagen ${garmentIndex} (array índice: ${useImageIndex}) - ${analysisData.garment_image.orientation}`);
      log(`   📸 Context adicional: ${additionalContextIndex !== null ? `imagen ${contextIndex} (array índice: ${additionalContextIndex})` : 'ninguna'}`);
      log(`   📏 Fit: ${analysisData.fit_style?.sleeve_length}, ${analysisData.fit_style?.body_fit}, ${analysisData.fit_style?.garment_length}`);
      log(`   🎭 Overall style: ${analysisData.fit_style?.overall_style || 'N/A'}`);
      log(`   ✅ Confianza: ${analysisData.confidence || 'unknown'}`);

    } catch (parseErr) {
      warn('Error parseando respuesta de análisis:', parseErr);
      // Fallback con contexto automático
      let additionalContextIndex = productImagesArray.length > 1 ? 1 : null;
      analysisData = { 
        useImageIndex: 0,
        additionalContextIndex: additionalContextIndex,
        user_image: { index: 1, description: 'Unknown' },
        garment_image: { index: 2, description: 'Unknown', orientation: 'front', reason: 'Error parsing analysis' },
        fit_style: { 
          sleeve_length: 'regular', 
          body_fit: 'regular', 
          garment_length: 'regular',
          overall_style: 'standard fit'
        },
        design_details: { description: 'Unknown', notable_features: 'Unknown' },
        additional_context_image: additionalContextIndex !== null ? {
          index: additionalContextIndex + 2,
          reason: 'Fallback selection',
          usage: 'Reference for context'
        } : null,
        instruction: 'Replace garment with first product image',
        reasoning: 'Error parsing analysis',
        confidence: 'low'
      };
    }

    return analysisData;
  } catch (analysisError) {
    err('Error en análisis OpenAI:', analysisError);
    // Fallback
    let additionalContextIndex = productImagesArray.length > 1 ? 1 : null;
    return { 
      useImageIndex: 0,
      additionalContextIndex: additionalContextIndex,
      reasoning: 'Analysis failed, using first product image' 
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// PASO 2: Prompt de generación para Nano Banana (3 imágenes) - CON ESTILO COMBINADO
// ───────────────────────────────────────────────────────────────────────────────
function buildGenerationPrompt({ analysisData, size }) {
  const userImage = analysisData.user_image || { description: 'Person facing camera' };
  const garmentImage = analysisData.garment_image || { description: 'Garment view', orientation: 'front', reason: 'Selected garment' };
  const fitStyle = analysisData.fit_style || { 
    sleeve_length: 'regular', 
    body_fit: 'regular', 
    garment_length: 'regular',
    overall_style: 'standard fit'
  };
  const designDetails = analysisData.design_details || { description: 'Garment design', notable_features: 'Standard features' };
  const instruction = analysisData.instruction || 'Replace the garment on the user with the product garment';
  const confidence = analysisData.confidence || 'medium';
  const additionalContextImage = analysisData.additional_context_image;

  return `VIRTUAL TRY-ON TASK

You will receive EXACTLY THREE images that have been pre-analyzed and matched:
1. USER IMAGE: Person in specific pose (facing front or back)
2. GARMENT IMAGE: The exact garment view that matches the user's orientation
3. CONTEXT IMAGE: One additional reference image for fit and detail accuracy

PRE-ANALYSIS CONTEXT:
User Pose: ${userImage.description}
Garment View: ${garmentImage.description} (${garmentImage.orientation})
Match Reasoning: ${garmentImage.reason}

GARMENT FIT SPECIFICATIONS:
- Sleeve length: ${fitStyle.sleeve_length}
- Body fit: ${fitStyle.body_fit}
- Garment length: ${fitStyle.garment_length}
- Overall style: ${fitStyle.overall_style || 'standard fit'}

CRITICAL FIT INSTRUCTION:
The overall style "${fitStyle.overall_style || 'standard fit'}" describes the complete silhouette and aesthetic that MUST be replicated exactly. This is not just about individual measurements but the combined visual effect and vibe of the garment. Pay special attention to how these attributes work together to create the garment's distinctive look.

GARMENT DESIGN TO REPLICATE:
${designDetails.description}

Critical Features: ${designDetails.notable_features}

ADDITIONAL CONTEXT IMAGE:
You have received ONE additional reference image (image 3).
Purpose: ${additionalContextImage?.usage || 'Reference for fit and details'}
Selection Reason: ${additionalContextImage?.reason || 'Additional context'}

USAGE INSTRUCTIONS FOR THE CONTEXT IMAGE:
- PRIMARY SOURCES: Image 1 (user) + Image 2 (matched garment) for orientation and replacement
- SECONDARY SOURCE: Image 3 (context) ONLY to:
  * Refine fit accuracy by studying how garment appears on human model (if present)
  * Understand natural fabric drape, wrinkles, and movement
  * Verify design details and color accuracy from different angle
  * Enhance realism of garment-body interaction
  * Better understand the overall style aesthetic (${fitStyle.overall_style || 'standard fit'})
- CRITICAL: Image 3 is CONTEXT ONLY, NOT for orientation decisions
- Your primary sources remain: Image 1 (user) and Image 2 (matched garment)

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
  * Overall aesthetic: ${fitStyle.overall_style || 'standard fit'} - maintain this complete style profile

✓ STYLE ACCURACY:
 - The garment must embody the "${fitStyle.overall_style || 'standard fit'}" aesthetic
 - This means replicating not just measurements but the visual vibe and silhouette
 - If style is "oversized and boxy": garment should look loose AND square-shaped
 - If style is "fitted and cropped": garment should look snug AND shortened
 - If style is "relaxed streetwear": garment should have a casual, comfortable aesthetic
 - The style descriptor is THE PRIMARY REFERENCE for how the garment should look

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
 - The "${fitStyle.overall_style || 'standard fit'}" aesthetic must look natural and believable

CRITICAL GUARDRAILS:
- If user's pose changes → REFUSE
- If face becomes unrecognizable → REFUSE
- If background changes → REFUSE
- If fit specifications cannot be met → REFUSE
- If overall style aesthetic cannot be achieved → REFUSE
- If design elements are incomplete → REFUSE
- If orientation mismatch occurs → REFUSE

OUTPUT REQUIREMENT:
Generate a photorealistic image showing the user in their EXACT original pose and environment, now wearing the garment with PERFECT design replication, EXACT fit specifications, and the complete "${fitStyle.overall_style || 'standard fit'}" aesthetic. The result must be indistinguishable from a real photo of this person wearing this specific garment with this exact style.

Analysis Confidence Level: ${confidence}`.trim();
}

// ───────────────────────────────────────────────────────────────────────────────
// Handler Principal
// ───────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔵 BACKEND-TRYON-IMPROVED.JS EJECUTÁNDOSE');
  console.log('🔵 VERSIÓN CON 3 IMÁGENES + ANÁLISIS DE ESTILO COMBINADO');
  console.log('═══════════════════════════════════════════════════════════════');
  
  ensureCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const GOOGLE_API_KEY = process.env.GOOGLE_AI_API_KEY;
  if (!GOOGLE_API_KEY) return res.status(500).json({ success: false, error: 'Falta GOOGLE_AI_API_KEY' });

  const requestId = req.body?.requestId || `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  log('═══════════════════════════════════════════════════════════════');
  log(`🚀 REQUEST INICIADO [${requestId}]`);
  log('═══════════════════════════════════════════════════════════════');

  try {
    const { productImage, productImages, size, userImage } = req.body || {};
    
    log(`📥 DATOS RECIBIDOS [${requestId}]:`);
    log(`   ✅ userImage: ${userImage ? 'SÍ' : 'NO'}`);
    log(`   ✅ productImages: ${Array.isArray(productImages) ? `SÍ (${productImages.length})` : 'NO'}`);
    log(`   ✅ size: ${size || 'M'}`);

    if (!userImage) return res.status(400).json({ success: false, error: 'No userImage' });

    // Unificar imágenes de producto (máximo 3)
    let productImagesArray = [];
    if (Array.isArray(productImages) && productImages.length) {
      productImagesArray = productImages.slice(0, 3);
    } else if (productImage) {
      productImagesArray = [productImage];
    }
    
    log(`   📊 Total imágenes producto: ${productImagesArray.length}`);

    // Parse user image
    const parsedUser = parseDataUrl(userImage);
    if (!parsedUser) {
      return res.status(400).json({ success: false, error: 'userImage inválido' });
    }

    const processedUserImage = await normalizeToJpegBuffer(parsedUser.base64);

    // ═══════════════════════════════════════════════════════════════
    // PASO 1: Análisis con OpenAI
    // ═══════════════════════════════════════════════════════════════
    log('═══════════════════════════════════════════════════════════════');
    log(`🔍 PASO 1: ANÁLISIS CON OPENAI [${requestId}]`);
    log('═══════════════════════════════════════════════════════════════');
    
    const analysisResult = await analyzeProductImages(
      processedUserImage.toString('base64'),
      productImagesArray
    );
    
    const { useImageIndex, additionalContextIndex } = analysisResult;
    
    log(`✅ Análisis completado:`);
    log(`   👕 Matched garment: índice ${useImageIndex}`);
    log(`   📸 Context adicional: ${additionalContextIndex !== null ? `índice ${additionalContextIndex}` : 'ninguna'}`);

    // Validar índices
    if (useImageIndex < 0 || useImageIndex >= productImagesArray.length) {
      warn(`⚠️ useImageIndex inválido, usando 0`);
      analysisResult.useImageIndex = 0;
    }
    
    if (additionalContextIndex !== null && (additionalContextIndex < 0 || additionalContextIndex >= productImagesArray.length)) {
      warn(`⚠️ additionalContextIndex inválido, ignorando`);
      analysisResult.additionalContextIndex = null;
    }

    // ═══════════════════════════════════════════════════════════════
    // PASO 2: Preparar imágenes para Nano Banana (3 imágenes totales)
    // ═══════════════════════════════════════════════════════════════
    log('═══════════════════════════════════════════════════════════════');
    log(`🎨 PASO 2: GENERACIÓN CON NANO BANANA [${requestId}]`);
    log('═══════════════════════════════════════════════════════════════');

    const generationPrompt = buildGenerationPrompt({ 
      analysisData: analysisResult,
      size 
    });

    // Construir parts: 1. Prompt, 2. User, 3. Matched Garment, 4. Context (si existe)
    const parts = [
      { text: generationPrompt },
      { inlineData: { mimeType: 'image/jpeg', data: processedUserImage.toString('base64') } },
    ];

    // Agregar matched garment image
    try {
      const matchedImage = productImagesArray[analysisResult.useImageIndex];
      const parsed = parseDataUrl(matchedImage);
      if (!parsed) {
        return res.status(400).json({ success: false, error: 'Matched garment image inválida' });
      }

      const productBuf = await normalizeToJpegBuffer(parsed.base64);
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: productBuf.toString('base64') } });
      log(`✅ Matched garment agregada (índice ${analysisResult.useImageIndex})`);
    } catch (imgErr) {
      err(`Error procesando matched garment:`, imgErr.message);
      return res.status(500).json({ success: false, error: 'Error procesando matched garment' });
    }

    // Agregar context image si existe
    if (analysisResult.additionalContextIndex !== null) {
      try {
        const contextImage = productImagesArray[analysisResult.additionalContextIndex];
        const parsed = parseDataUrl(contextImage);
        if (parsed) {
          const contextBuf = await normalizeToJpegBuffer(parsed.base64);
          parts.push({ inlineData: { mimeType: 'image/jpeg', data: contextBuf.toString('base64') } });
          log(`✅ Context image agregada (índice ${analysisResult.additionalContextIndex})`);
        }
      } catch (contextErr) {
        warn(`⚠️ Error procesando context image, continuando sin ella:`, contextErr.message);
      }
    } else {
      log(`ℹ️ No hay context image adicional`);
    }

    const totalParts = parts.length - 1; // -1 por el prompt
    log(`📤 Enviando ${totalParts} imágenes a Nano Banana`);

    // Inicializar Gemini para generación
    const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    const generationModel = genAI.getGenerativeModel({ 
      model: GENERATION_MODEL,
      generationConfig: {
        temperature: 0.4,
        topP: 0.95,
        topK: 40,
      }
    });

    // Llamada a Nano Banana
    let result, response;
    try {
      log(`📤 Enviando solicitud a Nano Banana...`);
      const requestStartTime = Date.now();

      result = await generationModel.generateContent({ 
        contents: [{ 
          role: 'user', 
          parts: parts 
        }] 
      });

      response = await result.response;
      const requestDuration = Date.now() - requestStartTime;
      log(`✅ Respuesta recibida en ${requestDuration}ms`);

      if (!response) throw new Error('Sin respuesta de Gemini');

      // Verificar finish reason
      if (response.candidates?.[0]?.finishReason) {
        const finishReason = response.candidates[0].finishReason;
        log(`Finish reason: ${finishReason}`);
        
        if (finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
          if (finishReason === 'SAFETY') {
            throw new Error('Contenido bloqueado por filtros de seguridad');
          }
          if (finishReason === 'RECITATION') {
            throw new Error('Contenido bloqueado por políticas de recitación');
          }
        }
      }

      // Verificar prompt feedback
      if (response.promptFeedback?.blockReason) {
        throw new Error(`Prompt bloqueado: ${response.promptFeedback.blockReason}`);
      }
    } catch (aiError) {
      const msg = aiError?.message || '';
      if (msg.includes('SAFETY')) throw new Error('Contenido bloqueado por filtros de seguridad');
      if (msg.includes('QUOTA')) throw new Error('Límite de cuota excedido');
      if (msg.toLowerCase().includes('timeout')) throw new Error('Timeout en generación');
      throw aiError;
    }

    // Extraer imagen generada
    const imageBase64 = safePickGeneratedImage(response);
    
    if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.length < 100) {
      log('⚠️ No se pudo extraer imagen de la respuesta');
      
      if (response?.candidates?.[0]?.content?.parts) {
        const textParts = response.candidates[0].content.parts.filter(p => p?.text);
        if (textParts.length > 0) {
          log('⚠️ La IA retornó texto en lugar de imagen:');
          textParts.forEach((part, idx) => {
            log(`   Texto [${idx}]:`, part.text);
          });
        }
      }
      
      throw new Error('No se pudo extraer imagen generada');
    }

    log('✅ Imagen generada exitosamente');
    log('═══════════════════════════════════════════════════════════════');
    log(`✅ REQUEST COMPLETADO [${requestId}]`);
    log('═══════════════════════════════════════════════════════════════');
    
    const responseData = {
      success: true,
      description: 'Imagen generada exitosamente con IA',
      generatedImage: `data:image/jpeg;base64,${imageBase64}`,
      size: size || 'M',
      model: GENERATION_MODEL,
      requestId: requestId,
      timestamp: new Date().toISOString(),
      analysis: {
        matchedGarmentIndex: analysisResult.useImageIndex,
        contextImageIndex: analysisResult.additionalContextIndex,
        confidence: analysisResult.confidence,
        overallStyle: analysisResult.fit_style?.overall_style || 'N/A',
        totalImagesUsed: totalParts
      }
    };
    
    log('📤 Enviando respuesta al frontend');
    return res.json(responseData);

  } catch (error) {
    const errorType = error.message.includes('SAFETY') ? 'SAFETY_ERROR' :
                     error.message.includes('QUOTA') ? 'QUOTA_ERROR' :
                     error.message.includes('timeout') ? 'TIMEOUT_ERROR' : 'UNKNOWN';

    err('═══════════════════════════════════════════════════════════════');
    err(`❌ ERROR [${requestId}]`);
    err(`🔴 Tipo: ${errorType}`);
    err(`🔴 Mensaje: ${error.message}`);
    err('═══════════════════════════════════════════════════════════════');

    // Fallback
    try {
      if (!req.body?.userImage) {
        return res.status(400).json({
          success: false,
          error: error.message,
          errorType,
        });
      }

      return res.json({
        success: true,
        description: 'Imagen procesada (modo fallback)',
        generatedImage: req.body.userImage,
        size: req.body.size || 'M',
        model: 'fallback',
        requestId: requestId,
        fallback: true,
        errorReason: error.message,
        timestamp: new Date().toISOString(),
      });
    } catch (fallbackErr) {
      return res.status(500).json({
        success: false,
        error: error.message,
        errorType,
      });
    }
  }
}
