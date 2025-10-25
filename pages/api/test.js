export default function handler(req, res) {
    console.log('🧪 === TEST ENDPOINT INICIADO ===');
    console.log('📝 Método:', req.method);
    console.log('📝 URL:', req.url);
    console.log('📝 Headers:', JSON.stringify(req.headers, null, 2));
    console.log('📝 Body:', req.body);
    console.log('📝 Query:', req.query);
    
    res.status(200).json({
        success: true,
        message: 'Test endpoint funcionando',
        method: req.method,
        timestamp: new Date().toISOString(),
        headers: req.headers,
        body: req.body
    });
}