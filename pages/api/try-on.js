// Enhanced handler with OpenAI pre-analysis + Gemini try-on

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
// STAGE 1: OpenAI Image Analysis
// ═══════════════════════════════════════════════════════════════════

async function analyzeProductImagesWithOpenAI(productImages) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  log('🔍 Stage 1: Analyzing product images with OpenAI...');
  
  const analysisPrompt = `You are an expert fashion image analyst. Analyze these garment product images and determine their orientation.

RULES:
- Image showing main graphics/logos/text/buttons/zippers/collar = FRONT
- Image with simpler design/tags/no collar = BACK  
- Image showing person wearing garment facing camera = MODEL_FRONT
- Image showing person's back = MODEL_BACK

Respond ONLY with valid JSON (no markdown):
{
  "images": [
    {
      "index": 0,
      "orientation": "front" | "back" | "model_front" | "model_back" | "side" | "unknown",
      "confidence": "high" | "medium" | "low",
      "hasGraphics": true/false,
      "hasText": true/false,
      "description": "Brief description"
    }
  ],
  "frontImageIndex": 0,
  "backImageIndex": 1,
  "reasoning": "Why you classified them this way"
}`;

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
      model: "gpt-4-turbo",
      messages,
      max_tokens: 1500,
      temperature: 0.3, // Lower for more deterministic analysis
    });

    const content = response.choices[0].message.content;
    
    // Clean markdown if present
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const analysis = JSON.parse(jsonStr);
    
    log('✅ OpenAI Analysis:', {
      imagesAnalyzed: analysis.images.length,
      frontIndex: analysis.frontImageIndex,
      backIndex: analysis.backImageIndex,
      reasoning: analysis.reasoning
    });
    
    return analysis;
    
  } catch (error) {
    warn('⚠️ OpenAI analysis failed:', error.message);
    // Fallback: assume first image is front
    return {
      images: productImages.map((_, i) => ({
        index: i,
        orientation: i === 0 ? 'front' : 'unknown',
        confidence: 'low',
        hasGraphics: false,
        hasText: false,
        description: 'Analysis failed, using defaults'
      })),
      frontImageIndex: 0,
      backImageIndex: productImages.length > 1 ? 1 : null,
      reasoning: 'Fallback due to analysis error',
      error: error.message
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// STAGE 2: Simplified Gemini Prompt (No Orientation Detection Needed)
// ═══════════════════════════════════════════════════════════════════

function buildSimplifiedPrompt({ size, frontImageIndex, analysis }) {
  const SIZE_MAP = {
    XS: 'very tight, form-fitting',
    S: 'fitted, slightly snug',
    M: 'standard fit, comfortable',
    L: 'relaxed fit, slightly loose',
    XL: 'oversized, loose-fitting',
    XXL: 'very oversized, very baggy',
  };
  
  const sizeDesc = SIZE_MAP[size?.toUpperCase?.()] || SIZE_MAP.M;
  
  return `You are an expert AI fashion try-on system.

TASK: Dress the user (Image 1) with the garment from the FRONT view product image.

IMAGES PROVIDED (PRE-ANALYZED):
- Image 1: USER to dress
- Image ${frontImageIndex + 2}: FRONT of garment (verified by pre-analysis)
${analysis.backImageIndex !== null ? `- Image ${analysis.backImageIndex + 2}: BACK of garment (reference only)` : ''}

CRITICAL INSTRUCTIONS:
✓ Use Image ${frontImageIndex + 2} as the source for the garment design
✓ This image has been verified to show the FRONT of the garment
✓ Match ALL details: colors, patterns, logos, graphics, text with 100% accuracy
✓ Preserve user's face, pose, expression, background, lighting
✓ Size: ${sizeDesc}
✓ Natural fabric drape and realistic lighting

ORIENTATION PRE-ANALYSIS RESULTS:
${JSON.stringify(analysis, null, 2)}

OUTPUT:
Generate a photorealistic image of the user wearing the garment (front view) with perfect visual fidelity.`;
}

// ═══════════════════════════════════════════════════════════════════
// Helper Functions (from original code)
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
// Main Handler - Two-Stage Pipeline
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
    // STAGE 1: OpenAI Analysis
    // ═══════════════════════════════════════════════════════════════
    
    const analysis = await analyzeProductImagesWithOpenAI(productImages.slice(0, 3));
    
    // Validate analysis results
    if (analysis.frontImageIndex === undefined || analysis.frontImageIndex === null) {
      warn('⚠️ No front image identified, using first image as fallback');
      analysis.frontImageIndex = 0;
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
    const frontImage = productImages[analysis.frontImageIndex];
    const otherImages = productImages.filter((_, i) => i !== analysis.frontImageIndex);
    const orderedProductImages = [frontImage, ...otherImages];
    
    // Process product images
    const productBuffers = [];
    for (let i = 0; i < orderedProductImages.length; i++) {
      const parsed = parseDataUrl(orderedProductImages[i]);
      if (parsed) {
        const buf = await normalizeToJpegBuffer(parsed.base64);
        productBuffers.push(buf);
      }
    }
    
    // Build simplified prompt (no orientation detection needed)
    const prompt = buildSimplifiedPrompt({
      size,
      frontImageIndex: 0, // Now front is always first after reordering
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
        frontImageIndex: analysis.frontImageIndex,
        confidence: analysis.images[analysis.frontImageIndex]?.confidence,
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


