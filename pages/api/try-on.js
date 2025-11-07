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
        ORIENTATION MATCHING:
        - The person in the first image is facing FRONT (front-facing photo)
        - You MUST analyze ALL product images (${productImagesText}) to determine which ones show the FRONT view of the garment
        - Look for images where:
          * A person is facing the camera (front-facing)
          * The front of the garment is visible (front design, logos, patterns, neckline)
          * The garment is shown from the front perspective
        - Use ONLY the product images that show the FRONT view of the garment
        - Ignore product images that show the back or side views
        - Match the front view of the garment from the product images to the front-facing person in the first image`;
        } else if (userOrientation === 'back') {
            orientationInstructions = `
        ORIENTATION MATCHING:
        - The person in the first image is facing BACK (back-facing photo)
        - You MUST analyze ALL product images (${productImagesText}) to determine which ones show the BACK view of the garment
        - Look for images where:
          * A person is facing away from the camera (back-facing)
          * The back of the garment is visible (back design, patterns, text on back)
          * The garment is shown from the back perspective
        - Use ONLY the product images that show the BACK view of the garment
        - Ignore product images that show the front or side views
        - Match the back view of the garment from the product images to the back-facing person in the first image`;
        } else {
            orientationInstructions = `
        ORIENTATION MATCHING:
        - Analyze ALL product images (${productImagesText}) to determine which ones show the FRONT view and which show the BACK view
        - Look at the person's position in each product image:
          * FRONT view: Person facing camera, front of garment visible
          * BACK view: Person facing away, back of garment visible
        - Determine the orientation of the person in the first image (front or back)
        - Use the product images that match the person's orientation in the first image
        - If the person in the first image is front-facing, use front-view product images
        - If the person in the first image is back-facing, use back-view product images`;
        }
        
        const prompt = `
        You are a virtual try-on AI. Your task is to put the EXACT garment from the product images onto the person in the first image.

        CRITICAL INSTRUCTIONS:
        1. FIRST IMAGE = Person (keep face, body, pose, background IDENTICAL). Replace ONLY the clothing.
        2. PRODUCT IMAGES (${productImagesText}) = These are the EXACT garment(s) from the store. You MUST analyze ALL product images and replicate the garment EXACTLY as shown.
        
        ${orientationInstructions}
        
        IMAGE ANALYSIS:
        - Analyze ALL product images you receive to understand the complete garment
        - For each product image, determine if it shows:
          * FRONT view: Person facing camera, front of garment visible
          * BACK view: Person facing away, back of garment visible
          * SIDE view: Person in profile, side of garment visible
        - Use the product images that match the orientation of the person in the first image
        - Look at different angles, details, patterns, and features shown across all product images
        - Combine information from all matching product images to get the most accurate representation
        - If multiple product images show the same view (e.g., multiple front views), use all of them to understand the full garment details
        
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
        
        IMPORTANT: 
        - Do NOT use the clothing from the first image (person's original clothing)
        - Use ONLY the garment from the matching product images (these are the store's products that the user wants to try on)
        - Analyze ALL product images to determine their orientation (front/back/side)
        - Use ONLY the product images that match the person's orientation in the first image
        - The product images show the EXACT garment from the store that you must put on the person
        - Adjust the size according to the selected size: ${size}
        - The garment must be IDENTICAL to the one shown in the matching product images (the store's product)
        - This is the garment that the user wants to try on from the store
        
        OUTPUT: Generate a photorealistic final image showing the person wearing the exact garment from the matching product images in the specified size. No text or descriptions.
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


