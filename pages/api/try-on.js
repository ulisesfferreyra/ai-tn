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
const API_KEY = process.env.GOOGLE_AI_API_KEY || 'AIzaSyDhNf9uWTqqbikQiT4gGAzQ_hCyDz9xC8A';
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

ANÁLISIS DE IMÁGENES DE REFERENCIA:
 1.⁠ ⁠Vas a recibir 1 o más fotos de la prenda
 2.⁠ ⁠SI HAY SOLO 1 FOTO: úsala como referencia única
 3.⁠ ⁠SI HAY MÚLTIPLES FOTOS (2+): 
   - ANALIZA TODAS antes de generar
   - IDENTIFICA cuál muestra FRENTE y cuál REVERSO
   - COMPARA para entender:
     * Diseño frontal vs trasero
     * Estampados o gráficos en cada lado
     * Detalles específicos de cada vista
   - USA la vista correcta según orientación del usuario

ORIENTACIÓN CORRECTA:
 4.⁠ ⁠Usuario de frente → usa diseño FRONTAL de la prenda
 5.⁠ ⁠Usuario de espaldas → usa diseño TRASERO de la prenda
 6.⁠ ⁠Verifica que el diseño coincida con la orientación del cuerpo

AJUSTE Y REALISMO:
 7.⁠ ⁠Talle seleccionado: ${size}
 8.⁠ ⁠Ajusta el tamaño según talle
 9.⁠ ⁠La prenda debe verse natural y bien ajustada
10.⁠ ⁠Mantén pose y expresión del usuario
11.⁠ ⁠Resultado final: profesional y realista

VALIDACIÓN FINAL:
•⁠  ⁠¿Usaste la vista correcta de la prenda?
•⁠  ⁠¿El diseño frontal está en el frente del cuerpo?
•⁠  ⁠¿El diseño trasero está en la espalda?
•⁠  ⁠¿Coincide con las fotos de referencia?

DESCRIBE: Explica cuántas fotos recibiste, qué vista usaste (frontal/trasera) y cómo se ve la prenda en el usuario.`
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
        } else {
            console.log('⚠️ No se recibió imagen del producto, usando solo imagen del usuario');
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
