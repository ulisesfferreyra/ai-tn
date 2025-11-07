const sharp = require('sharp');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurar Google AI
const API_KEY = process.env.GOOGLE_AI_API_KEY || 'AIzaSyDhNf9uWTqqbikQiT4gGAzQ_hCyDz9xC8A';
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' });

// Configurar bodyParser para este endpoint específico
// Aumentado a 20mb para soportar múltiples imágenes del producto
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
}

export default async function handler(req, res) {
    // 🔍 LOGS DE DEBUG DETALLADOS
    console.log('🚀 === AI TRY-ON ENDPOINT INICIADO ===');
    console.log('📝 Método:', req.method);
    console.log('📝 URL:', req.url);
    console.log('📝 Headers:', JSON.stringify(req.headers, null, 2));
    console.log('📝 Body keys:', Object.keys(req.body || {}));
    console.log('📝 Query:', req.query);
    console.log('📝 Body completo:', JSON.stringify(req.body, null, 2));
    
    // Verificar tamaño del body
    if (req.body) {
        const bodyString = JSON.stringify(req.body);
        console.log('📏 Tamaño del body:', bodyString.length, 'caracteres');
        console.log('📏 Tamaño del body en MB:', (bodyString.length / 1024 / 1024).toFixed(2), 'MB');
        
        // Verificar si las imágenes están presentes
        if (req.body.userImage) {
            console.log('👤 User image presente:', req.body.userImage ? 'SÍ' : 'NO');
            console.log('👤 User image tamaño:', req.body.userImage ? req.body.userImage.length : 0, 'caracteres');
        }
        if (req.body.productImage) {
            console.log('🛍️ Product image (singular) presente:', req.body.productImage ? 'SÍ' : 'NO');
            console.log('🛍️ Product image tamaño:', req.body.productImage ? req.body.productImage.length : 0, 'caracteres');
        }
        if (req.body.productImages) {
            console.log('🛍️ Product images (array) presente:', Array.isArray(req.body.productImages) ? 'SÍ' : 'NO');
            console.log('🛍️ Número de imágenes del producto:', Array.isArray(req.body.productImages) ? req.body.productImages.length : 0);
            if (Array.isArray(req.body.productImages)) {
                req.body.productImages.forEach((img, idx) => {
                    console.log(`   [${idx + 1}] Tamaño: ${img ? img.length : 0} caracteres`);
                });
            }
        }
        if (req.body.userOrientation) {
            console.log('👤 User orientation presente:', req.body.userOrientation);
        }
    }
    
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        console.log('✅ OPTIONS request - CORS preflight');
        res.status(200).end();
        return;
    }
    
    if (req.method !== 'POST') {
        console.log('❌ Método no permitido:', req.method);
        return res.status(405).json({ error: 'Método no permitido' });
    }
    
    try {
        console.log('🤖 Procesando AI Try-On...');
        
        const { productImage, productImages, size, userImage, userOrientation } = req.body;
        
        // Normalizar imágenes del producto: convertir productImage (singular) a array si es necesario
        let productImagesArray = [];
        if (productImages && Array.isArray(productImages) && productImages.length > 0) {
            productImagesArray = productImages;
            console.log('📝 productImages (array) recibido:', productImagesArray.length, 'imágenes');
        } else if (productImage) {
            // Compatibilidad con formato antiguo: convertir productImage singular a array
            productImagesArray = [productImage];
            console.log('📝 productImage (singular) recibido, convertido a array');
        }
        
        console.log('📝 Total de imágenes del producto:', productImagesArray.length);
        console.log('📝 size recibido:', size);
        console.log('📝 userImage recibido:', userImage ? 'Sí' : 'No');
        console.log('📝 userOrientation recibido:', userOrientation || 'No especificado');
        
        if (!userImage) {
            console.log('❌ No se recibió imagen del usuario');
            return res.status(400).json({ 
                success: false, 
                error: 'No se recibió imagen del usuario' 
            });
        }
        
        console.log('📸 Imagen del usuario recibida');
        console.log('👕 Talle seleccionado:', size);
        console.log('🖼️ Imágenes del producto recibidas:', productImagesArray.length);
        console.log('👤 Orientación del usuario:', userOrientation || 'No especificada');
        
        // Procesar imagen del usuario
        let processedUserImage;
        try {
            console.log('🔄 Procesando imagen del usuario...');
            const userImageBuffer = Buffer.from(userImage, 'base64');
            
            // Convertir HEIF/HEIC a JPEG si es necesario (como en tienda-nube-app)
            try {
                const userMetadata = await sharp(userImageBuffer).metadata();
                if (userMetadata.format === 'heif' || userMetadata.format === 'heic') {
                    console.log('🔄 Convirtiendo imagen HEIF a JPEG...');
                    processedUserImage = await sharp(userImageBuffer).jpeg({ quality: 90 }).toBuffer();
                } else {
                    processedUserImage = userImageBuffer;
                }
            } catch (e) {
                console.log('⚠️ Error procesando imagen de usuario:', e.message);
                processedUserImage = userImageBuffer;
            }
            
            console.log('✅ Imagen del usuario procesada');
        } catch (error) {
            console.error('❌ Error procesando imagen del usuario:', error.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Error procesando imagen del usuario' 
            });
        }
        
        // Preparar datos para la IA (usando la implementación correcta de tienda-nube-app)
        const sizeInstructions = {
            'S': 'small size that fits snugly and tightly',
            'M': 'medium size that fits comfortably and naturally', 
            'L': 'large size that is slightly loose and relaxed',
            'XL': 'extra large size that is loose fitting and baggy',
            'XXL': 'extra extra large size that is very loose and oversized'
        };

        const sizeInstruction = sizeInstructions[size] || sizeInstructions['M'];

        // Construir prompt dinámicamente según el número de imágenes del producto y orientación del usuario
        const productImagesCount = productImagesArray.length;
        const productImagesText = productImagesCount === 1 
            ? 'the second image' 
            : `images 2 through ${productImagesCount + 1}`;
        
        // Determinar instrucciones de orientación basadas en userOrientation
        let orientationInstructions = '';
        if (userOrientation === 'front') {
            orientationInstructions = `
        CRITICAL ORIENTATION ANALYSIS - STEP BY STEP PROCESS:
        
        STEP 1: DEEP ANALYSIS OF ALL PRODUCT IMAGES
        - The person in the first image is facing FRONT (front-facing photo)
        - You MUST perform a COMPREHENSIVE analysis of ALL ${productImagesCount} product images (${productImagesText}) BEFORE making any decisions
        - For EACH product image, analyze in detail:
          * PERSON POSITION: Is the person facing the camera (FRONT) or facing away (BACK)?
          * FACE VISIBILITY: Can you see the person's face? If YES = FRONT view, If NO = likely BACK view
          * BODY ORIENTATION: Is the person's chest/torso visible? If YES = FRONT view, If NO = likely BACK view
          * GARMENT FEATURES: 
            - FRONT indicators: Visible neckline, buttons (if applicable), front logos/designs, front pockets, zipper pull (if visible from front)
            - BACK indicators: Back of neck/collar, back designs/logos, back text, back pockets, zipper pull (if visible from back)
          * ARM POSITION: Are the arms visible in front of the body? If YES = likely FRONT view
        
        STEP 2: CROSS-VALIDATION
        - Compare ALL product images with each other to identify patterns
        - If multiple images show the same person position (all front or all back), they are the same orientation
        - Look for consistent features across images (same design on front vs different design on back)
        - Verify your classification by checking if the features make sense (e.g., if you see a front logo in one image, confirm it's not visible in what you classified as "back")
        
        STEP 3: FINAL SELECTION
        - Use ONLY the product images that you have CONFIRMED show the FRONT view of the garment
        - DOUBLE-CHECK: Before using an image, verify:
          * The person in that product image is facing the camera (FRONT)
          * The garment features visible match a FRONT view (neckline, front design, etc.)
          * It matches the orientation of the person in the first image (FRONT)
        - IGNORE and DO NOT USE product images that show:
          * BACK view (person facing away)
          * SIDE view (person in profile)
          * Any ambiguous or unclear orientation
        
        STEP 4: ERROR PREVENTION
        - CRITICAL: Before applying the garment, verify one last time that you are using FRONT view images
        - If you have ANY doubt about an image's orientation, DO NOT use it
        - It is better to use fewer images that you are CERTAIN are front-facing than to risk using a back-facing image
        - NEVER apply back-facing garment features to a front-facing person`;
        } else if (userOrientation === 'back') {
            orientationInstructions = `
        CRITICAL ORIENTATION ANALYSIS - STEP BY STEP PROCESS:
        
        STEP 1: DEEP ANALYSIS OF ALL PRODUCT IMAGES
        - The person in the first image is facing BACK (back-facing photo)
        - You MUST perform a COMPREHENSIVE analysis of ALL ${productImagesCount} product images (${productImagesText}) BEFORE making any decisions
        - For EACH product image, analyze in detail:
          * PERSON POSITION: Is the person facing the camera (FRONT) or facing away (BACK)?
          * FACE VISIBILITY: Can you see the person's face? If NO = likely BACK view, If YES = FRONT view
          * BODY ORIENTATION: Is the person's back/spine visible? If YES = BACK view, If NO = likely FRONT view
          * GARMENT FEATURES: 
            - BACK indicators: Back of neck/collar, back designs/logos, back text, back pockets, zipper pull (if visible from back)
            - FRONT indicators: Visible neckline from front, buttons (if applicable), front logos/designs (NOT visible in back view)
          * ARM POSITION: Are the arms visible behind the body? If YES = likely BACK view
        
        STEP 2: CROSS-VALIDATION
        - Compare ALL product images with each other to identify patterns
        - If multiple images show the same person position (all front or all back), they are the same orientation
        - Look for consistent features across images (same design on back vs different design on front)
        - Verify your classification by checking if the features make sense (e.g., if you see a back logo in one image, confirm it's not visible in what you classified as "front")
        
        STEP 3: FINAL SELECTION
        - Use ONLY the product images that you have CONFIRMED show the BACK view of the garment
        - DOUBLE-CHECK: Before using an image, verify:
          * The person in that product image is facing away from the camera (BACK)
          * The garment features visible match a BACK view (back design, back text, etc.)
          * It matches the orientation of the person in the first image (BACK)
        - IGNORE and DO NOT USE product images that show:
          * FRONT view (person facing camera)
          * SIDE view (person in profile)
          * Any ambiguous or unclear orientation
        
        STEP 4: ERROR PREVENTION
        - CRITICAL: Before applying the garment, verify one last time that you are using BACK view images
        - If you have ANY doubt about an image's orientation, DO NOT use it
        - It is better to use fewer images that you are CERTAIN are back-facing than to risk using a front-facing image
        - NEVER apply front-facing garment features to a back-facing person`;
        } else {
            orientationInstructions = `
        CRITICAL ORIENTATION ANALYSIS - STEP BY STEP PROCESS:
        
        STEP 1: DEEP ANALYSIS OF ALL PRODUCT IMAGES
        - You MUST perform a COMPREHENSIVE analysis of ALL ${productImagesCount} product images (${productImagesText}) BEFORE making any decisions
        - For EACH product image, analyze in detail:
          * PERSON POSITION: Is the person facing the camera (FRONT) or facing away (BACK)?
          * FACE VISIBILITY: Can you see the person's face? If YES = FRONT view, If NO = likely BACK view
          * BODY ORIENTATION: 
            - FRONT: Chest/torso visible, arms in front
            - BACK: Back/spine visible, arms behind
          * GARMENT FEATURES: 
            - FRONT: Visible neckline, buttons, front logos/designs, front pockets
            - BACK: Back of neck/collar, back designs/logos, back text, back pockets
        
        STEP 2: DETERMINE USER ORIENTATION
        - Analyze the first image (the person) to determine if they are facing FRONT or BACK
        - Use the same detailed analysis: face visibility, body orientation, etc.
        
        STEP 3: CROSS-VALIDATION
        - Compare ALL product images with each other
        - Verify consistency: images with same person position should have same orientation
        - Cross-reference features to confirm classifications
        
        STEP 4: MATCHING
        - Match product images to user orientation (FRONT to FRONT, BACK to BACK)
        - Use ONLY product images that match the user's orientation
        - DOUBLE-CHECK each image before using it
        
        STEP 5: ERROR PREVENTION
        - CRITICAL: Verify one last time that orientation matches
        - If ANY doubt, DO NOT use that image
        - NEVER apply wrong-side features (front to back or back to front)`;
        }
        
        const prompt = `
        You are a virtual try-on AI. Your task is to put the EXACT garment from the product images onto the person in the first image.

        CRITICAL INSTRUCTIONS:
        1. FIRST IMAGE = Person (keep face, body, pose, background IDENTICAL). Replace ONLY the clothing.
        2. PRODUCT IMAGES (${productImagesText}) = These are the EXACT garment(s) from the store. You MUST analyze ALL product images and replicate the garment EXACTLY as shown.
        
        ${orientationInstructions}
        
        DEEP IMAGE ANALYSIS PROTOCOL:
        
        PHASE 1: COMPREHENSIVE INDIVIDUAL ANALYSIS
        - You MUST analyze EACH of the ${productImagesCount} product images INDIVIDUALLY and THOROUGHLY
        - For EACH product image, perform a DETAILED examination:
          * PERSON ANALYSIS:
            - Face visibility: Can you clearly see the person's face? (YES = FRONT, NO = likely BACK)
            - Body position: Is the chest/torso visible? (YES = FRONT) OR is the back/spine visible? (YES = BACK)
            - Arm position: Are arms in front of body? (FRONT) OR behind body? (BACK)
            - Overall pose: Does the person face the camera? (FRONT) OR face away? (BACK)
          * GARMENT FEATURE ANALYSIS:
            - Neckline/collar: Visible from front? (FRONT) OR back of neck visible? (BACK)
            - Design elements: Where are logos/designs located? (Front chest = FRONT, Back = BACK)
            - Text/graphics: Can you read text normally? (FRONT) OR is it mirrored/on back? (BACK)
            - Pockets: Front pockets visible? (FRONT) OR back pockets visible? (BACK)
            - Zippers/buttons: Visible from front? (FRONT) OR from back? (BACK)
          * ORIENTATION CLASSIFICATION:
            - Based on ALL the above factors, classify as: FRONT, BACK, or SIDE
            - Be CONFIDENT in your classification - if uncertain, mark as UNCLEAR
        
        PHASE 2: CROSS-REFERENCE VALIDATION
        - Compare ALL product images with EACH OTHER
        - Look for CONSISTENCY: Images showing same person position should have same orientation
        - Identify PATTERNS: If image A shows a front logo and image B shows a different design, they are likely different sides
        - VERIFY classifications: If you classified image A as FRONT and it shows a logo, check that image B (if classified as BACK) doesn't show the same logo
        - RESOLVE conflicts: If classifications conflict, re-analyze those specific images more carefully
        
        PHASE 3: USER-PRODUCT MATCHING
        - Determine the orientation of the person in the first image (FRONT or BACK)
        - Match product images to user orientation:
          * If user is FRONT-facing → Use ONLY FRONT-facing product images
          * If user is BACK-facing → Use ONLY BACK-facing product images
        - DOUBLE-CHECK each match: Verify that the product image orientation matches the user orientation
        - REJECT any product images that don't match (even if they're high quality)
        
        PHASE 4: FINAL VERIFICATION
        - Before applying the garment, perform a FINAL check:
          * List all product images you plan to use
          * For each, confirm: "This image shows [FRONT/BACK] view, and the user is [FRONT/BACK]-facing. MATCH ✓"
          * If ANY image doesn't match, REMOVE it from your selection
        - CRITICAL RULE: It is INFINITELY better to use FEWER images that are CORRECTLY oriented than to use MORE images with WRONG orientation
        - ERROR PREVENTION: If you have even 1% doubt about an image's orientation, DO NOT use it
        
        GARMENT REQUIREMENTS:
        - Look at ALL matching product images carefully - these show the EXACT garment you must put on the person
        - Analyze the garment type: If the product images show a basic t-shirt (no collar, no buttons), make it a basic t-shirt
        - If the product images show a polo shirt (with collar and buttons), make it a polo shirt
        - If the product images show a hoodie, make it a hoodie
        - Replicate the EXACT garment from the matching product images (pattern, color, fabric, design, style, texture, details, neckline, sleeves, buttons, collar, graphics, logos, text, etc.)
        - Use information from ALL matching product images to ensure accuracy
        - Size: ${sizeInstruction}
        - Make it look like the person is actually wearing this specific garment from the store
        - Ensure realistic fit, drape, seams, shadows, and lighting
        - The garment must look naturally worn, not pasted or artificial
        
        SIZE SPECIFICATIONS:
        - XS: Very fitted, tight, form-fitting
        - S: Fitted, slightly snug, close to body
        - M: Standard fit, comfortable, natural
        - L: Relaxed fit, slightly loose, comfortable
        - XL: Oversized, loose-fitting, baggy
        - XXL: Very oversized, very loose, very baggy
        
        CRITICAL RULES - ABSOLUTE REQUIREMENTS:
        
        1. ORIENTATION MATCHING IS MANDATORY:
           - You MUST match the orientation of product images to the user's orientation
           - FRONT-facing user → ONLY use FRONT-facing product images
           - BACK-facing user → ONLY use BACK-facing product images
           - This is NON-NEGOTIABLE - there are NO exceptions
           - If you apply the wrong side (front to back or back to front), the result will be COMPLETELY WRONG
        
        2. ANALYSIS BEFORE ACTION:
           - You MUST complete ALL 4 phases of analysis BEFORE applying the garment
           - Do NOT rush - take time to analyze each image thoroughly
           - When in doubt, analyze again - better to be slow and correct than fast and wrong
        
        3. QUALITY OVER QUANTITY:
           - Using 1 correctly-oriented image is INFINITELY better than using 5 incorrectly-oriented images
           - If you're not 100% certain about an image's orientation, DO NOT use it
           - It's better to have less detail but correct orientation than perfect detail but wrong side
        
        4. FINAL CHECKPOINT:
           - Before generating the final image, ask yourself:
             * "Have I analyzed ALL product images?"
             * "Am I CERTAIN about each image's orientation?"
             * "Do ALL selected images match the user's orientation?"
             * "Is there ANY chance I'm using the wrong side?"
           - If ANY answer is "no" or "unsure", STOP and re-analyze
        
        5. GARMENT APPLICATION:
           - Do NOT use the clothing from the first image (person's original clothing)
           - Use ONLY the garment from the CORRECTLY-ORIENTED product images
           - The product images show the EXACT garment from the store
           - Adjust the size according to the selected size: ${size}
           - The garment must be IDENTICAL to the one shown in the matching product images
           - Apply the garment features to the CORRECT side (front to front, back to back)
        
        OUTPUT: Generate a photorealistic final image showing the person wearing the exact garment from the CORRECTLY-ORIENTED matching product images in the specified size. The garment must be on the CORRECT side (front if user is front-facing, back if user is back-facing). No text or descriptions.
        `;

        const parts = [
            { text: prompt },
            {
                inline_data: {
                    mime_type: 'image/jpeg',
                    data: processedUserImage.toString('base64')
                }
            }
        ];
        
        // Agregar todas las imágenes del producto si están disponibles
        if (productImagesArray.length > 0) {
            console.log(`🖼️ Agregando ${productImagesArray.length} imagen(es) del producto a la IA`);
            console.log(`👤 La IA determinará la orientación de cada imagen y usará las que coincidan con la orientación del usuario (${userOrientation || 'desconocida'})`);
            
            productImagesArray.forEach((productImg, idx) => {
                if (productImg && productImg.startsWith('data:image')) {
                    const base64Data = productImg.split(',')[1];
                    const mimeMatch = productImg.match(/^data:image\/([^;]+);/);
                    const mimeType = mimeMatch ? mimeMatch[1] : 'png';
                    
                    console.log(`   [${idx + 1}/${productImagesArray.length}] Agregando imagen (${mimeType}, ${(base64Data.length / 1024).toFixed(2)} KB)`);
                    console.log(`   [${idx + 1}/${productImagesArray.length}] La IA analizará esta imagen para determinar si es frontal o trasera`);
                    
                    parts.push({
                        inline_data: {
                            mime_type: `image/${mimeType}`,
                            data: base64Data
                        }
                    });
                } else {
                    console.warn(`   ⚠️ Imagen ${idx + 1} no es válida o no tiene formato data:image`);
                }
            });
            
            console.log(`✅ Total de ${productImagesArray.length} imagen(es) del producto agregadas`);
            console.log(`📋 La IA analizará todas las imágenes para determinar su orientación y usar las correctas`);
        } else {
            console.log('⚠️ No se recibieron imágenes del producto, usando solo imagen del usuario');
        }
        
        console.log('🧠 Enviando a Google AI...');
        console.log('📝 Número de partes enviadas:', parts.length);
        console.log('📝 Orientación del usuario para matching:', userOrientation || 'No especificada (IA determinará)');
        
        // Generar imagen con IA
        const result = await model.generateContent(parts);
        const response = await result.response;
        
        if (!response) {
            console.log('❌ No se recibió respuesta de la IA');
            throw new Error('No se recibió respuesta de la IA');
        }
        
        // Obtener imagen generada (usando la implementación correcta de tienda-nube-app)
        console.log('🔍 Response type:', typeof response);
        console.log('🔍 Response keys:', Object.keys(response));
        
        let imageData;
        try {
            // Usar la implementación correcta de tienda-nube-app
            imageData = response.candidates[0].content.parts[0].inlineData.data;
            console.log('✅ Imagen obtenida usando response.candidates[0].content.parts[0].inlineData.data');
        } catch (error) {
            console.log('❌ Error obteniendo imagen:', error);
            console.log('🔍 Response structure:', JSON.stringify(response, null, 2));
            throw new Error('Error obteniendo imagen: ' + error.message);
        }
        
        if (!imageData) {
            console.log('❌ No se generó imagen');
            throw new Error('No se generó imagen');
        }
        
        console.log('✅ Imagen generada exitosamente');
        
        // Respuesta exitosa (usando la implementación correcta de tienda-nube-app)
        const responseData = {
            success: true,
            description: 'Imagen generada exitosamente con IA',
            generatedImage: `data:image/jpeg;base64,${imageData}`,
            size: size,
            timestamp: new Date().toISOString()
        };
        
        console.log('✅ Enviando respuesta exitosa');
        res.json(responseData);
        
    } catch (error) {
        console.error('❌ Error en AI Try-On:', error);
        console.error('❌ Stack trace:', error.stack);
        
        // Fallback: devolver imagen original
        try {
            console.log('🔄 Usando fallback...');
            
            const fallbackResponse = {
                success: true,
                description: 'Imagen procesada (modo fallback)',
                originalImage: `data:image/jpeg;base64,${req.body.userImage}`,
                generatedImage: `data:image/jpeg;base64,${req.body.userImage}`,
                finalImage: `data:image/jpeg;base64,${req.body.userImage}`,
                size: req.body.size,
                fallback: true,
                timestamp: new Date().toISOString()
            };
            
            console.log('✅ Enviando respuesta fallback');
            res.json(fallbackResponse);
            
        } catch (fallbackError) {
            console.error('❌ Error en fallback:', fallbackError);
            res.status(500).json({ 
                success: false, 
                error: 'Error procesando imagen' 
            });
        }
    }
}



