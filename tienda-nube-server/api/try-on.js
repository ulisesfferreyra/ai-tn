const multer = require('multer');
const sharp = require('sharp');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurar multer para memoria
const upload = multer({ 
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten imágenes'), false);
        }
    }
});

// Configurar Google AI
const API_KEY = 'AIzaSyDhNf9uWTqqbikQiT4gGAzQ_hCyDz9xC8A';
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' });

export default async function handler(req, res) {
    // 🔍 LOGS DE DEBUG DETALLADOS
    console.log('🚀 === AI TRY-ON ENDPOINT INICIADO ===');
    console.log('📝 Método:', req.method);
    console.log('📝 URL:', req.url);
    console.log('📝 Headers:', JSON.stringify(req.headers, null, 2));
    console.log('📝 Body keys:', Object.keys(req.body || {}));
    console.log('📝 Query:', req.query);
    console.log('📝 Body completo:', JSON.stringify(req.body, null, 2));
    
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
        
        const { productImage, size, userImage } = req.body;
        
        console.log('📝 productImage recibido:', productImage ? 'Sí' : 'No');
        console.log('📝 size recibido:', size);
        console.log('📝 userImage recibido:', userImage ? 'Sí' : 'No');
        
        if (!userImage) {
            console.log('❌ No se recibió imagen del usuario');
            return res.status(400).json({ 
                success: false, 
                error: 'No se recibió imagen del usuario' 
            });
        }
        
        console.log('📸 Imagen del usuario recibida');
        console.log('👕 Talle seleccionado:', size);
        console.log('🖼️ Imagen del producto recibida:', productImage ? 'Sí' : 'No');
        
        // Procesar imagen del usuario
        let processedUserImage;
        try {
            console.log('🔄 Procesando imagen del usuario...');
            processedUserImage = await sharp(Buffer.from(userImage, 'base64'))
                .resize(512, 512, { fit: 'cover' })
                .jpeg({ quality: 90 })
                .toBuffer();
            console.log('✅ Imagen del usuario procesada');
        } catch (error) {
            console.error('❌ Error procesando imagen del usuario:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Error procesando imagen del usuario' 
            });
        }
        
        // Preparar datos para la IA
        const parts = [
            {
                text: `Eres un experto en moda y fotografía. Tu tarea es crear una imagen realista donde el usuario esté usando la prenda de ropa mostrada.

INSTRUCCIONES ESPECÍFICAS:
1. El usuario ha seleccionado talle: ${size}
2. Ajusta el tamaño de la prenda según el talle seleccionado
3. Haz que la prenda se vea natural y bien ajustada al cuerpo del usuario
4. Mantén la pose y expresión natural del usuario
5. La prenda debe verse como si realmente la estuviera usando
6. Asegúrate de que la prenda se adapte correctamente al cuerpo
7. La imagen final debe verse profesional y realista

DESCRIBE WHAT YOU SEE: Describe la imagen generada y cómo se ve la prenda en el usuario.`
            },
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: processedUserImage.toString('base64')
                }
            }
        ];
        
        // Agregar imagen del producto si está disponible
        if (productImage && productImage.startsWith('data:image')) {
            console.log('🖼️ Agregando imagen del producto a la IA');
            const base64Data = productImage.split(',')[1];
            parts.push({
                inlineData: {
                    mimeType: 'image/png',
                    data: base64Data
                }
            });
        }
        
        console.log('🧠 Enviando a Google AI...');
        console.log('📝 Número de partes enviadas:', parts.length);
        
        // Generar imagen con IA
        const result = await model.generateContent(parts);
        const response = await result.response;
        
        if (!response) {
            console.log('❌ No se recibió respuesta de la IA');
            throw new Error('No se recibió respuesta de la IA');
        }
        
        // Obtener imagen generada
        const imageData = response.parts()[0].inlineData;
        if (!imageData) {
            console.log('❌ No se generó imagen');
            throw new Error('No se generó imagen');
        }
        
        console.log('✅ Imagen generada exitosamente');
        
        // Respuesta exitosa
        const responseData = {
            success: true,
            description: '¡Genial! Hemos procesado tu foto con IA.',
            originalImage: `data:image/jpeg;base64,${userImage}`,
            generatedImage: `data:image/jpeg;base64,${imageData.data}`,
            finalImage: `data:image/jpeg;base64,${imageData.data}`,
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