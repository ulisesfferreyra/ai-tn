// Servicio reutilizable para el flujo Try-On (sin dependencias de frameworks)
const sharp = require('sharp');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai'); // Preanálisis con Vision para elegir imagen de producto

const IS_DEV = process.env.NODE_ENV !== 'production';
const log = (...a) => IS_DEV && console.log('[TRY-ON]', ...a);
const warn = (...a) => console.warn('[TRY-ON]', ...a);
const err = (...a) => console.error('[TRY-ON]', ...a);

const ALLOWED_ORIENTATIONS = new Set(['front', 'back']);
const SIZE_MAP = {
  XS: 'very tight, form-fitting',
  S: 'fitted, slightly snug, close to body',
  M: 'standard fit, comfortable, natural',
  L: 'relaxed fit, slightly loose, comfortable',
  XL: 'oversized, loose-fitting, baggy',
  XXL: 'very oversized, very loose, very baggy',
};
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o'; // Modelo Vision para análisis previo
const GENERATION_MODEL = 'gemini-2.5-flash-image'; // Mantener explícito el modelo de generación

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
// ========================================================================
// Analisis previo con OpenAI Vision para elegir imagen y extraer metadatos de prenda
// Descomenta todo este bloque y añade dependencia openai para habilitar preanálisis.
async function analyzeProductImages(userImageBase64, productImagesArray) {
console.log('═══════════════════════════════════════════════════════════════');
console.log('🔍 INICIANDO ANÁLISIS CON OPENAI VISION');
console.log('═══════════════════════════════════════════════════════════════');
if (!productImagesArray || productImagesArray.length === 0) {
return { useImageIndex: 0, reasoning: 'No product images provided' }; // sin producto, fallback
}
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
return { useImageIndex: 0, reasoning: 'OpenAI API key not configured, using first product image' }; // sin clave, fallback
}
const openai = new OpenAI({ apiKey: OPENAI_API_KEY }); // Cliente Vision
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

   const messages = [
     {
       role: 'user',
       content: [
         { type: 'text', text: analysisPrompt },
         { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${userImageBase64}` } }, // usuario
       ],
     },
   ];
   for (let i = 0; i < productImagesArray.length; i++) {
     const raw = productImagesArray[i];
    try {
       const parsed = parseDataUrl(raw);
       if (!parsed) continue;
       const buf = await normalizeToJpegBuffer(parsed.base64); // normaliza a jpeg
       messages[0].content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` } });
     } catch (imgErr) {
       warn(`Error procesando imagen producto ${i} para análisis:`, imgErr.message);
     }
   }
   const analysisResponse = await openai.chat.completions.create({
     model: OPENAI_MODEL,
     messages,
     temperature: 0.1,
     response_format: { type: 'json_object' },
     max_tokens: 1500,
   });
   const analysisText = analysisResponse.choices[0]?.message?.content;
   if (!analysisText) {
     throw new Error('No response from OpenAI'); // sin contenido
   }
   let analysisData;
   try {
     const cleanedText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
     analysisData = JSON.parse(cleanedText); // parsea JSON
   } catch (parseErr) {
     analysisData = { useImageIndex: 0, reasoning: 'Error parsing analysis, using first product image' }; // fallback
   }
   const userIndex = analysisData.user_image?.index;
   const garmentIndex = analysisData.garment_image?.index;
   const isZeroBased = userIndex === 0;
   let useImageIndex = 0;
   if (isZeroBased) {
     if (garmentIndex >= 1) useImageIndex = garmentIndex - 1; // base 0 -> ajusta
   } else if (garmentIndex >= 2) {
     useImageIndex = garmentIndex - 2; // base 1 -> ajusta
   }
   if (useImageIndex < 0 || useImageIndex >= productImagesArray.length) useImageIndex = 0; // rango seguro
   analysisData.useImageIndex = useImageIndex; // devuelve índice elegido
   return analysisData; // incluye garment_type, design_details, generation_instruction, etc.
 }
// ========================================================================

// ========================================================================
// Prompt de generación enriquecido con datos del análisis (mangas, cuello, fit, silueta)
// Descomenta para reemplazar buildPrompt actual; requiere analysisData de analyzeProductImages.
function buildGenerationPrompt({ analysisData, size }) {
  const userImage = analysisData.user_image || { description: 'Person facing camera' };
  const garmentImage = analysisData.garment_image || { description: 'Garment view', orientation: 'front', reason: 'Selected garment' };
  const garmentType = analysisData.garment_type || { category: 'garment', sleeves: 'unknown', neckline: 'unknown', material_appearance: 'unknown' };
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
    overall_silhouette: 'unknown',
  };
  const generationInstruction = analysisData.generation_instruction || analysisData.instruction || 'Replace the garment on the user with the product garment';
  const confidence = analysisData.confidence || 'medium';
  let sleeveDescription = '';
  const sleeves = garmentType.sleeves?.toLowerCase?.() || '';
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
// ========================================================================

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
• Cross-check for confirmation:
  - Back surfaces often lack collars or have higher, straight necklines.
  - Look for shoulder seams, labels/tags inside, or hangers showing the back.

──────────────────────────────────────────────
📐 Step 3: ORIENTATION DECISION (Front vs Back)
──────────────────────────────────────────────
Use collar/neckline detection as the PRIMARY rule to decide orientation.
• If collar/neckline is detected on an image, prioritize that image as FRONT.
• If no collar is present, treat images without collar as BACK.

──────────────────────────────────────────────
📚 Step 4: Multi-Angle Cross-Verification
──────────────────────────────────────────────
• Cross-check all product images to confirm orientation consistency.
• If multiple angles show collars, prioritize images with clearer view at FRONT.
• If an image contradicts, do not ignore it; resolve the conflict by:
  - Re-analyzing collar/neckline presence
  - Checking seam lines, buttons, zippers, or logos
  - If still uncertain, default to FRONT from collar indication

──────────────────────────────────────────────
🧠 Step 5: DRESS THE USER
──────────────────────────────────────────────
• Use ONLY the provided wardrobe images; do NOT invent garments.
• Extract garment appearance, material, texture, fit, and colors EXACTLY as provided.
• Align the garment realistically onto the user:
  - Respect body posture, natural folds, and gravity.
  - Keep user’s skin, hair, accessories intact.
  - Preserve background and environment realism.
  - Avoid distortions, missing limbs, or fused textures.
• Match orientation to the user’s requested viewpoint:
  - If userOrientation is front -> show front of garment.
  - If userOrientation is back -> show back of garment.
• For size/fit instruction:
  - Apply ${sizeInstruction} sizing.
  - Ensure garment fit matches this sizing on the user.

──────────────────────────────────────────────
🚫 STRICT RULES — DO NOT VIOLATE
──────────────────────────────────────────────
• Do NOT fabricate or hallucinate clothing not shown in product images.
• Do NOT change garment color, logo, or design details.
• Do NOT crop out or blur the user’s face or background.
• Do NOT generate NSFW, violent, or unsafe content.

──────────────────────────────────────────────
✅ OUTPUT REQUIREMENTS
──────────────────────────────────────────────
• Output only a single high-quality image.
• Resolution similar to input images.
• Seamless blend between garment and user.
• Realistic lighting and shadows consistent with user image.
• Preserve background and user identity.

──────────────────────────────────────────────
🔁 FAIL-SAFE INSTRUCTIONS
──────────────────────────────────────────────
• If product images don’t match orientation, correct to requested view.
• If garment details are unclear, choose the most consistent interpretation.
• If unsure about size fit, default to ${sizeInstruction}.
• If safety filters trigger, return an explicit error instead of an image.
`;
}

function safePickGeneratedImage(resp) {
  // Estrategia 1: Obtener de los candidates
  try {
    const parts = resp?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (p?.inlineData?.data && typeof p.inlineData.data === 'string' && p.inlineData.data.length > 100) {
          log('✅ Imagen encontrada en parts[].inlineData.data');
          return p.inlineData.data;
        }
        if (p?.inline_data?.data && typeof p.inline_data.data === 'string' && p.inline_data.data.length > 100) {
          log('✅ Imagen encontrada en parts[].inline_data.data');
          return p.inline_data.data;
        }
      }
    }
  } catch (e) {
    err('safePickGeneratedImage parts loop error:', e);
  }
  
  // Estrategia 2: Output directo (fallback)
  try {
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

async function processTryOn(payload = {}, meta = {}) {
  const method = (meta.method || 'POST').toUpperCase?.() || 'POST';
  if (method !== 'POST') {
    return { statusCode: 405, body: { error: 'Método no permitido' } };
  }

  const API_KEY = process.env.GOOGLE_AI_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, body: { success: false, error: 'Falta GOOGLE_AI_API_KEY' } };
  }

  // Logs clave (limitados en prod)
  log('INIT', { method, path: meta.path || meta.url || meta.endpoint });
  if (IS_DEV) {
    log('Headers:', meta.headers);
    log('Body keys:', Object.keys(payload || {}));
    const asStr = JSON.stringify(payload || {});
    log('Body size chars:', asStr.length, '≈ MB:', (asStr.length / 1024 / 1024).toFixed(2));
  }

  try {
    const { productImage, productImages, size, userImage, userOrientation } = payload || {};
    const requestId = payload?.requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2)}`; // trazabilidad end-to-end

    if (!userImage) {
      return { statusCode: 400, body: { success: false, error: 'No se recibió imagen del usuario' } };
    }

    // Unificar imágenes de producto
    let productImagesArray = [];
    if (Array.isArray(productImages) && productImages.length) productImagesArray = productImages;
    else if (productImage) productImagesArray = [productImage];
    productImagesArray = productImagesArray.slice(0, 3); // limitar a 3 imágenes como en Next.js

    const selectedOrientation = ALLOWED_ORIENTATIONS.has(userOrientation) ? userOrientation : 'front';

    // Parse/normalize user image (espera data URL)
    const parsedUser = parseDataUrl(userImage);
    if (!parsedUser) {
      return {
        statusCode: 400,
        body: { success: false, error: 'userImage debe ser una data URL base64 (data:image/...;base64,...)' },
      };
    }
    const processedUserImage = await normalizeToJpegBuffer(parsedUser.base64);

    const analysisResult = await analyzeProductImages(processedUserImage.toString('base64'), productImagesArray); // usa Vision para elegir imagen
    let useImageIndex = analysisResult.useImageIndex ?? 0; // índice elegido por OpenAI
    if (useImageIndex < 0 || useImageIndex >= productImagesArray.length) useImageIndex = 0; // fallback seguro
    const selectedProductImage = productImagesArray[useImageIndex]; // solo una imagen para generación

    // Texto de ayuda para el prompt respecto al índice relativo
    const productImagesCount = productImagesArray.length;
    const productImagesText =
      productImagesCount === 0 ? 'no product images (reject if none match)' :
      productImagesCount === 1 ? 'the second image' :
      `images 2 through ${productImagesCount + 1}`;

    // PROMPT unificado (NO TOCAR) -> dejar comentado si usas el enriquecido
    // const prompt = buildPrompt({ productImagesCount, productImagesText, userOrientation: selectedOrientation, size });
    const prompt = buildGenerationPrompt({ analysisData: analysisResult, size }); // prompt enriquecido con datos de Vision

    // Partes: prompt + persona (producto se agrega más abajo)
    const parts = [
      { text: prompt },
      { inlineData: { mimeType: 'image/jpeg', data: processedUserImage.toString('base64') } },
    ];

    // Validaciones finales de tus cambios (4 MB c/u, 15 MB total, formatos soportados)
    const maxImageSizeMB = 4;
    const maxTotalSizeMB = 15;
    let totalMB = processedUserImage.length / 1024 / 1024;

    // Procesar solo la imagen seleccionada (no enviar todas a Gemini)
    const parsedSelected = parseDataUrl(selectedProductImage);
    if (!parsedSelected) {
      return { statusCode: 400, body: { success: false, error: 'Imagen del producto seleccionada no es válida' } };
    }
    const supportedSelected = /^(image\/)(jpeg|jpg|png|webp)$/i.test(parsedSelected.mime);
    if (!supportedSelected) {
      return { statusCode: 400, body: { success: false, error: `Formato de imagen no soportado: ${parsedSelected.mime}` } };
    }
    const approxMBSelected = parsedSelected.base64.length / 1024 / 1024;
    if (approxMBSelected > maxImageSizeMB) {
      return { statusCode: 400, body: { success: false, error: `Imagen de producto > ${maxImageSizeMB}MB` } };
    }
    const productBuf = await normalizeToJpegBuffer(parsedSelected.base64);
    totalMB += productBuf.length / 1024 / 1024;
    if (totalMB > maxTotalSizeMB) {
      return { statusCode: 400, body: { success: false, error: `Total imágenes > ${maxTotalSizeMB}MB` } };
    }
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: productBuf.toString('base64') } }); // producto elegido
    log(`+ producto seleccionado OK (${(productBuf.length/1024).toFixed(2)} KB)`);

    log(`Parts a enviar: ${parts.length} | total aprox MB: ${totalMB.toFixed(2)} | orientation=${selectedOrientation} | size=${size || 'M'}`);
    log(`Parts breakdown: prompt=${parts[0]?.text ? 'SÍ' : 'NO'} | userImage=${parts[1]?.inlineData ? 'SÍ' : 'NO'} | productImages=${parts.length - 2} imágenes`);

    // Init modelo
    const genAI = new GoogleGenerativeAI(API_KEY);
    //const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' });
    const model = genAI.getGenerativeModel({ model: GENERATION_MODEL || 'gemini-2.5-flash-image' }); // modelo explícito reutilizable

    // Llamada
    let result;
    let response;
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
    return {
      statusCode: 200,
      body: {
        success: true,
        description: 'Imagen generada exitosamente con IA',
        generatedImage: `data:image/jpeg;base64,${imageBase64}`,
        size: size || 'M',
        orientation: selectedOrientation,
        timestamp: new Date().toISOString(),
        model: GENERATION_MODEL || 'gemini-2.5-flash-image', // incluir modelo en respuesta
        requestId, // propagar requestId si se calcula arriba
      },
    };

  } catch (error) {
    // Diagnóstico extendido (tus campos)
    const body = payload || {};
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
        return {
          statusCode: 400,
          body: {
            success: false,
            error: 'No se recibió imagen del usuario y no se pudo generar la imagen',
            errorType,
            errorDetails: errorDescription,
          },
        };
      }
      return {
        statusCode: 200,
        body: {
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
          model: 'fallback', // alineado con contrato viejo
          requestId, // mantiene trazabilidad en fallback
        },
      };
    } catch (fallbackErr) {
      err('Fallback error:', fallbackErr.message);
      return {
        statusCode: 500,
        body: {
          success: false,
          error: 'Error procesando imagen',
          errorType,
          errorDetails: errorDescription,
          fallbackError: fallbackErr.message,
        },
      };
    }
  }
}

module.exports = { processTryOn };
