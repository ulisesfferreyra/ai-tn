const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔧 CONFIGURACIÓN
const API_KEY = 'AIzaSyDhNf9uWTqqbikQiT4gGAzQ_hCyDz9xC8A'; // Tu API key de Google AI
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configurar multer para subir archivos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '.jpg');
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten imágenes'), false);
        }
    }
});

// 🚀 Endpoint principal para AI Try-On
app.post('/api/try-on', upload.single('userImage'), async (req, res) => {
    try {
        console.log('🤖 Procesando AI Try-On...');
        
        const { productImage, size } = req.body;
        const userImagePath = req.file?.path;
        
        if (!userImagePath) {
            return res.status(400).json({ 
                success: false, 
                error: 'No se recibió imagen del usuario' 
            });
        }
        
        console.log('📸 Imagen del usuario:', userImagePath);
        console.log('👕 Talle seleccionado:', size);
        console.log('🖼️ Imagen del producto recibida:', productImage ? 'Sí' : 'No');
        
        // Procesar imagen del usuario
        let userImageBuffer;
        try {
            userImageBuffer = await sharp(userImagePath)
                .resize(512, 512, { fit: 'cover' })
                .jpeg({ quality: 90 })
                .toBuffer();
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
                    data: userImageBuffer.toString('base64')
                }
            }
        ];
        
        // Agregar imagen del producto si está disponible
        if (productImage && productImage.startsWith('data:image')) {
            const base64Data = productImage.split(',')[1];
            parts.push({
                inlineData: {
                    mimeType: 'image/png',
                    data: base64Data
                }
            });
        }
        
        console.log('🧠 Enviando a Google AI...');
        
        // Generar imagen con IA
        const result = await model.generateContent(parts);
        const response = await result.response;
        
        if (!response) {
            throw new Error('No se recibió respuesta de la IA');
        }
        
        // Obtener imagen generada
        const imageData = response.parts()[0].inlineData;
        if (!imageData) {
            throw new Error('No se generó imagen');
        }
        
        // Guardar imagen generada
        const generatedImagePath = `uploads/generated_${Date.now()}.jpg`;
        const imageBuffer = Buffer.from(imageData.data, 'base64');
        
        await sharp(imageBuffer)
            .jpeg({ quality: 95 })
            .toFile(generatedImagePath);
        
        console.log('✅ Imagen generada exitosamente');
        
        // Respuesta exitosa
        res.json({
            success: true,
            description: '¡Genial! Hemos procesado tu foto con IA.',
            originalImage: `/uploads/${req.file.filename}`,
            generatedImage: `/${generatedImagePath}`,
            finalImage: `/${generatedImagePath}`,
            size: size,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error en AI Try-On:', error);
        
        // Fallback: composición simple
        try {
            console.log('🔄 Usando fallback...');
            
            const userImagePath = req.file?.path;
            const fallbackPath = `uploads/fallback_${Date.now()}.jpg`;
            
            await sharp(userImagePath)
                .resize(512, 512, { fit: 'cover' })
                .jpeg({ quality: 90 })
                .toFile(fallbackPath);
            
            res.json({
                success: true,
                description: 'Imagen procesada (modo fallback)',
                originalImage: `/uploads/${req.file.filename}`,
                generatedImage: `/${fallbackPath}`,
                finalImage: `/${fallbackPath}`,
                size: req.body.size,
                fallback: true,
                timestamp: new Date().toISOString()
            });
            
        } catch (fallbackError) {
            console.error('❌ Error en fallback:', fallbackError);
            res.status(500).json({ 
                success: false, 
                error: 'Error procesando imagen' 
            });
        }
    }
});

// 🏠 Página de inicio
app.get('/', (req, res) => {
    res.send(`
        <h1>🤖 AI Try-On Server</h1>
        <p>Servidor funcionando correctamente</p>
        <p>Endpoint: POST /api/try-on</p>
        <p>Para Tienda Nube: <strong>https://tu-app.herokuapp.com/api/try-on</strong></p>
    `);
});

// 🚀 Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
});
