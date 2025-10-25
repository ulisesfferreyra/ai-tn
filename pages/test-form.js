import { useState } from 'react';

export default function TestForm() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const fileInput = document.getElementById('imageInput');
    const sizeSelect = document.getElementById('sizeSelect');
    
    if (!fileInput.files[0]) {
      alert('Selecciona una imagen');
      return;
    }
    
    setLoading(true);
    
    // Convertir imagen a base64
    const file = fileInput.files[0];
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      const userImageBase64 = e.target.result.split(',')[1];
      
      try {
        // 📸 CAPTURAR SCREENSHOT DEL PRODUCTO
        console.log('📸 Capturando screenshot del producto...');
        
        // Simular captura de producto (en producción esto vendría del DOM)
        const productImageBase64 = userImageBase64; // Por ahora usar la misma imagen
        
        console.log('✅ Screenshot capturado, enviando al servidor...');
        
        const response = await fetch('/api/try-on', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userImage: userImageBase64,
            size: sizeSelect.value,
            productImage: productImageBase64 // Screenshot del producto
          })
        });
        
        const data = await response.json();
        setResult(data);
        
      } catch (error) {
        setResult({ error: error.message });
      } finally {
        setLoading(false);
      }
    };
    
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>🧪 Test AI Try-On Endpoint</h1>
      
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '15px' }}>
          <label>Seleccionar imagen:</label><br/>
          <input 
            type="file" 
            id="imageInput" 
            accept="image/*" 
            required 
            style={{ marginTop: '5px' }}
          />
        </div>
        
        <div style={{ marginBottom: '15px' }}>
          <label>Talle:</label><br/>
          <select id="sizeSelect" style={{ marginTop: '5px', padding: '5px' }}>
            <option value="XS">XS</option>
            <option value="S">S</option>
            <option value="M">M</option>
            <option value="L">L</option>
            <option value="XL">XL</option>
          </select>
        </div>
        
        <button 
          type="submit" 
          disabled={loading}
          style={{ 
            padding: '10px 20px', 
            backgroundColor: loading ? '#ccc' : '#0070f3',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? 'Procesando...' : 'Probar AI Try-On'}
        </button>
      </form>
      
      {result && (
        <div style={{ marginTop: '20px' }}>
          <h3>Resultado:</h3>
          <pre style={{ 
            backgroundColor: '#f5f5f5', 
            padding: '10px', 
            borderRadius: '5px',
            overflow: 'auto',
            maxHeight: '300px'
          }}>
            {JSON.stringify(result, null, 2)}
          </pre>
          {result.generatedImage && (
            <div style={{ marginTop: '10px' }}>
              <h4>Imagen generada:</h4>
              <img 
                src={result.generatedImage} 
                style={{ maxWidth: '300px', border: '1px solid #ccc' }}
                alt="Imagen generada"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
