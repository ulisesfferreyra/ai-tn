// Enhanced handler with OpenAI pre-analysis + Gemini try-on
// UPDATED: Includes FIT analysis and critical guardrails

import sharp from 'sharp';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

const IS_DEV = process.env.NODE_ENV !== 'production';
const log = (...a) => IS_DEV && console.log('[TRY-ON]', ...a);
const warn = (...a) => console.warn('[TRY-ON]', ...a);
const err = (...a) => console.error('[TRY-ON]', ...a);

// ═══════════════════════════════════════════════════════════════════
// STAGE 1: OpenAI Image Analysis (UPDATED WITH FIT ANALYSIS)
// ═══════════════════════════════════════════════════════════════════

async function analyzeProductImagesWithOpenAI(productImages) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  log('🔍 Stage 1: Analyzing product images with OpenAI...');
  
  const analysisPrompt = `You will receive multiple images of a clothing product (garment).

Your task: Identify the FRONT view AND analyze the garment's FIT/STYLE.

ANALYSIS PROCESS:

1. PRIORITIZE images showing a PERSON/MODEL wearing the garment
   - The design visible on their CHEST = FRONT
   - CRITICAL: Observe HOW the garment fits on the model:
     * Sleeve length (short, regular, long, oversized)
     * Body fit (tight, regular, loose, oversized, boxy)
     * Overall length (cropped, regular, long, oversized)
   - This fit observation is THE REFERENCE, regardless of labeled size

2. If NO person in any image:
   - Analyze garment structure: neckline, collar, button/zipper position
   - Cannot determine fit style without human reference

3. Return the front image index AND fit characteristics

Return ONLY valid JSON (no additional text, no markdown):
{
  "front_image_index": <number>,
  "has_model": <true/false>,
  "fit_style": {
    "sleeve_length": "<short/regular/long/oversized>",
    "body_fit": "<tight/regular/loose/oversized/boxy>",
    "garment_length": "<cropped/regular/long/oversized>"
  },
  "reasoning": "<brief explanation>",
  "confidence": "<high/medium/low>"
}

If no model present, set has_model to false and fit_style to null.`;

  try {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: analysisPrompt },
          ...productImages.map(img => ({
            type: "image_url",
            image_url: { 
              url: img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`,
              detail: "high" 
            }
          }))
        ]
      }
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      max_tokens: 1500,
      temperature: 0.3,
    });

    const content = response.choices[0].message.content;
    
    // Clean markdown if present
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const analysis = JSON.parse(jsonStr);
    
    log('✅ OpenAI Analysis:', {
      imagesAnalyzed: productImages.length,
      frontIndex: analysis.front_image_index,
      hasModel: analysis.has_model,
      fitStyle: analysis.fit_style,
      reasoning: analysis.reasoning
    });
    
    return analysis;
    
  } catch (error) {
    warn('⚠️ OpenAI analysis failed:', error.message);
    // Fallback: assume first image is front, no model detected
    return {
      front_image_index: 0,
      has_model: false,
      fit_style: null,
      reasoning: 'Fallback due to analysis error',
      confidence: 'low',
      error: error.message
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// STAGE 2: Updated Gemini Prompt (With FIT scenarios and GUARDRAILS)
// ═══════════════════════════════════════════════════════════════════

function buildGeminiPrompt({ size, analysis }) {
  const SIZE_MAP = {
    XS: 'Very fitted, tight, form-fitting',
    S: 'Fitted, slightly snug, close to body',
    M: 'Standard fit, comfortable, natural',
    L: 'Relaxed fit, slightly loose, comfortable',
    XL: 'Oversized, loose-fitting, baggy',
    XXL: 'Very oversized, very loose, very baggy',
  };
  
  const sizeLabel = size?.toUpperCase?.() || 'M';
  const has_model = analysis.has_model;
  const fit_style = analysis.fit_style;
  
  let fitDescription = '';
  if (has_model && fit_style) {
    fitDescription = `Sleeves: ${fit_style.sleeve_length}, Body: ${fit_style.body_fit}, Length: ${fit_style.garment_length}`;
  }
  
  const fitInstructions = has_model ? `
SCENARIO A: Product has model reference
- IGNORE the size label (${sizeLabel})
- REPLICATE EXACTLY how the garment fits on the model in product images
- Match sleeve length, body fit, and overall length PRECISELY as shown on model
- If model shows oversized fit → User gets oversized fit
- If model shows cropped sleeves → User gets cropped sleeves
- The model's fit is THE ONLY reference for sizing
- Reference fit: ${fitDescription}
` : `
SCENARIO B: No model reference
- Apply standard size logic for ${sizeLabel}:
  * XS: Very fitted, tight, form-fitting
  * S: Fitted, slightly snug, close to body
  * M: Standard fit, comfortable, natural
  * L: Relaxed fit, slightly loose, comfortable
  * XL: Oversized, loose-fitting, baggy
  * XXL: Very oversized, very loose, very baggy
`;
  
  return `DRESS THE USER WITH THE EXACT GARMENT.

You will receive:
1. User's photo (person to dress)
2. One or more product garment images (FRONT view pre-identified)
${has_model ? `3. REFERENCE: Product shows model wearing garment with this fit: ${fitDescription}` : ''}

CRITICAL FIT RULES:
${fitInstructions}

YOUR TASK:
- Replace ONLY the user's clothing with this garment
- Keep EVERYTHING else ABSOLUTELY IDENTICAL: face, body, pose, expression, background, body position
- Apply garment with the correct fit (prioritizing model reference if available)
- Match colors, patterns, graphics, text, and placement with 100% accuracy

MANDATORY GUARDRAILS - CRITICAL - NO EXCEPTIONS:

✓ POSE PRESERVATION: User's body position, arms, hands, stance ABSOLUTELY IDENTICAL to input (THIS IS CRITICAL)
✓ FACE PRESERVATION: User's face COMPLETELY UNCHANGED and recognizable
✓ BACKGROUND PRESERVATION: Background IDENTICAL to input
✓ GARMENT PRESENCE: Product garment clearly visible on user
✓ FIT ACCURACY: ${has_model ? 'Garment fits user EXACTLY as it fits the model' : 'Garment fits according to size ' + sizeLabel}
✓ DESIGN ACCURACY: 100% match (colors, patterns, graphics, text)
✓ REALISM: Photorealistic, natural lighting, proper fabric drape
✓ NO ARTIFACTS: No distortions, glitches, unrealistic elements

IF ANY SINGLE GUARDRAIL FAILS:
→ DO NOT GENERATE OUTPUT
→ RETURN ERROR CODE
→ NEVER send partial or "close enough" results

RESULT: User in EXACT same pose wearing garment with EXACT fit as model (or size-appropriate if no model), zero errors.`;
}

// ═══════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  return m ? { mime: m[1], base64: m[2] } : null;
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
    warn('normalizeToJpegBuffer error:', e.message);
    return input;
  }
}

function safePickGeneratedImage(resp) {
  try {
    const cand = resp?.candidates?.[0];
    if (cand?.content?.parts) {
      for (const p of cand.content.parts) {
        if (p?.inlineData?.data && p.inlineData.data.length > 100) {
          return p.inlineData.data;
        }
      }
    }
  } catch (e) {
    err('safePickGeneratedImage error:', e);
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// Main Handler - Two-Stage Pipeline with FIT Analysis
// ═══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GOOGLE_API_KEY = process.env.GOOGLE_AI_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  
  if (!GOOGLE_API_KEY) return res.status(500).json({ error: 'Missing GOOGLE_AI_API_KEY' });
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

  try {
    const { productImages, size, userImage } = req.body || {};
    
    if (!userImage) {
      return res.status(400).json({ error: 'Missing userImage' });
    }
    
    if (!productImages || !Array.isArray(productImages) || productImages.length === 0) {
      return res.status(400).json({ error: 'Missing productImages array' });
    }

    // ═══════════════════════════════════════════════════════════════
    // STAGE 1: OpenAI Analysis (with FIT detection)
    // ═══════════════════════════════════════════════════════════════
    
    const analysis = await analyzeProductImagesWithOpenAI(productImages.slice(0, 5));
    
    // Validate analysis results
    if (analysis.front_image_index === undefined || analysis.front_image_index === null) {
      warn('⚠️ No front image identified, using first image as fallback');
      analysis.front_image_index = 0;
    }

    // ═══════════════════════════════════════════════════════════════
    // STAGE 2: Prepare Images for Gemini
    // ═══════════════════════════════════════════════════════════════
    
    log('🎨 Stage 2: Preparing images for Gemini try-on...');
    
    // Process user image
    const parsedUser = parseDataUrl(userImage);
    if (!parsedUser) {
      return res.status(400).json({ error: 'Invalid userImage format' });
    }
    const userBuffer = await normalizeToJpegBuffer(parsedUser.base64);
    
    // Reorder product images: front first, then others
    const frontImage = productImages[analysis.front_image_index];
    const otherImages = productImages.filter((_, i) => i !== analysis.front_image_index);
    const orderedProductImages = [frontImage, ...otherImages];
    
    // Process product images
    const productBuffers = [];
    for (let i = 0; i < Math.min(orderedProductImages.length, 5); i++) {
      const parsed = parseDataUrl(orderedProductImages[i]);
      if (parsed) {
        const buf = await normalizeToJpegBuffer(parsed.base64);
        productBuffers.push(buf);
      }
    }
    
    // Build prompt with FIT scenarios
    const prompt = buildGeminiPrompt({
      size,
      analysis
    });
    
    // Construct parts for Gemini
    const parts = [
      { text: prompt },
      { inlineData: { mimeType: 'image/jpeg', data: userBuffer.toString('base64') } },
      ...productBuffers.map(buf => ({
        inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') }
      }))
    ];
    
    log(`📤 Sending to Gemini: 1 user image + ${productBuffers.length} product images (front-ordered)`);
    log(`📊 FIT Analysis: has_model=${analysis.has_model}, fit=${JSON.stringify(analysis.fit_style)}`);
    
    // ═══════════════════════════════════════════════════════════════
    // STAGE 3: Gemini Try-On Generation
    // ═══════════════════════════════════════════════════════════════
    
    const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash-exp',
      generationConfig: {
        temperature: 0.4,
        topP: 0.95,
      }
    });
    
    const result = await model.generateContent({ 
      contents: [{ role: 'user', parts }] 
    });
    
    const response = await result.response;
    const imageBase64 = safePickGeneratedImage(response);
    
    if (!imageBase64) {
      throw new Error('Failed to extract generated image from Gemini response');
    }
    
    log('✅ Try-on completed successfully');
    
    return res.json({
      success: true,
      generatedImage: `data:image/jpeg;base64,${imageBase64}`,
      analysis: {
        frontImageIndex: analysis.front_image_index,
        hasModel: analysis.has_model,
        fitStyle: analysis.fit_style,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning
      },
      size: size || 'M',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    err('Error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: IS_DEV ? error.stack : undefined
    });
  }
}
