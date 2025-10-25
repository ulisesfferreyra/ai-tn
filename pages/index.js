export default function Home() {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>🤖 AI Try-On Server</h1>
      <p>Servidor funcionando correctamente</p>
      
      <h2>📡 Endpoints disponibles:</h2>
      <ul>
        <li><a href="/api/test">/api/test</a> - Endpoint de prueba</li>
        <li><a href="/api/try-on">/api/try-on</a> - Endpoint principal (POST)</li>
        <li><a href="/test-form.html">/test-form.html</a> - Formulario de prueba</li>
      </ul>
      
      <h2>🚀 Estado:</h2>
      <p style={{ color: 'green' }}>✅ Servidor funcionando</p>
      <p style={{ color: 'green' }}>✅ Endpoints configurados</p>
      <p style={{ color: 'green' }}>✅ Listo para Vercel</p>
    </div>
  )
}