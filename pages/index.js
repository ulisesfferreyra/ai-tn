export default function Home() {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>🤖 AI Try-On Server</h1>
      <p>Servidor funcionando correctamente</p>
      <p>Endpoint: POST /api/try-on</p>
      <p>Test: GET /api/test</p>
      <p>Para Tienda Nube: <strong>https://ai-tn-ox24-iqfirdhfe-ulises-projects-ee3a657d.vercel.app/api/try-on</strong></p>
      
      <div style={{ marginTop: '20px', padding: '20px', backgroundColor: '#f5f5f5', borderRadius: '10px' }}>
        <h2>🚀 ¿Cómo usar?</h2>
        <ol>
          <li>Implementa el widget en tu Tienda Nube</li>
          <li>Cambia la URL del servidor en el código</li>
          <li>¡Listo! Los botones aparecerán automáticamente</li>
        </ol>
      </div>
      
      <div style={{ marginTop: '20px', padding: '20px', backgroundColor: '#e3f2fd', borderRadius: '10px' }}>
        <h2>🧪 Test Endpoints</h2>
        <p><strong>Test:</strong> <a href="/api/test">/api/test</a></p>
        <p><strong>Try-On:</strong> POST /api/try-on</p>
      </div>
    </div>
  );
}