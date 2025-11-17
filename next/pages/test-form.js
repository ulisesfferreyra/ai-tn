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
        // 📸 CAPTURAR SCREENSHOT DEL PRODUCTO REAL
        console.log('📸 Capturando screenshot del producto...');
        
        // Usar html2canvas para capturar la imagen del producto
        const html2canvas = require('html2canvas');
        const productElement = document.getElementById('product-image');
        
        if (productElement) {
          const canvas = await html2canvas(productElement, {
            backgroundColor: '#ffffff',
            scale: 1,
            logging: false
          });
          const productImageBase64 = canvas.toDataURL('image/png').split(',')[1];
          console.log('✅ Screenshot capturado del producto real');
          console.log('📏 Tamaño de userImage:', userImageBase64.length, 'caracteres');
          console.log('📏 Tamaño de productImage:', productImageBase64.length, 'caracteres');
          console.log('📏 Tamaño total estimado:', (userImageBase64.length + productImageBase64.length) / 1024 / 1024, 'MB');
          
          const response = await fetch('/api/try-on', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userImage: userImageBase64,
              size: sizeSelect.value,
              productImage: `data:image/png;base64,${productImageBase64}`
            })
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Error del servidor:', response.status, response.statusText);
            console.error('❌ Error details:', errorText);
            throw new Error(`Error del servidor: ${response.status} - ${response.statusText} - ${errorText}`);
          }

          const data = await response.json();
          setResult(data);
        } else {
          throw new Error('No se encontró la imagen del producto');
        }
        
      } catch (error) {
        console.error('Error capturando producto:', error);
        setResult({ error: error.message });
      } finally {
        setLoading(false);
      }
    };
    
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>🧪 Test AI Try-On - Simulación Tienda Nube</h1>
      
      {/* PRODUCTO SIMULADO */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr 1fr', 
        gap: '30px', 
        marginBottom: '30px',
        border: '1px solid #ddd',
        borderRadius: '10px',
        padding: '20px',
        backgroundColor: '#f9f9f9'
      }}>
        {/* Imagen del producto */}
        <div>
          <h3>🛍️ Producto: Camiseta Rayada</h3>
          <div 
            id="product-image"
            style={{
              width: '300px',
              height: '300px',
              border: '2px solid #0070f3',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#ffffff',
              backgroundImage: 'url("https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=300&h=300&fit=crop")',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              position: 'relative'
            }}
          >
            <div style={{
              position: 'absolute',
              bottom: '10px',
              left: '10px',
              backgroundColor: 'rgba(0,0,0,0.7)',
              color: 'white',
              padding: '5px 10px',
              borderRadius: '5px',
              fontSize: '12px'
            }}>
              📸 Esta imagen se capturará
            </div>
          </div>
          <p style={{ marginTop: '10px', fontSize: '14px', color: '#666' }}>
            <strong>Precio:</strong> $29.99<br/>
            <strong>Colores:</strong> Azul, Rojo, Verde<br/>
            <strong>Material:</strong> 100% Algodón
          </p>
        </div>

        {/* Formulario de prueba */}
        <div>
          <h3>👤 Prueba AI Try-On</h3>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '15px' }}>
              <label><strong>Sube tu foto:</strong></label><br/>
              <input 
                type="file" 
                id="imageInput" 
                accept="image/*" 
                required 
                style={{ 
                  marginTop: '5px',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  width: '100%'
                }}
              />
            </div>
            
            <div style={{ marginBottom: '15px' }}>
              <label><strong>Selecciona tu talle:</strong></label><br/>
              <select 
                id="sizeSelect" 
                defaultValue="M"
                style={{ 
                  marginTop: '5px', 
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  width: '100%'
                }}
              >
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
                padding: '12px 24px', 
                backgroundColor: loading ? '#ccc' : '#0070f3',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '16px',
                fontWeight: 'bold',
                width: '100%'
              }}
            >
              {loading ? '🔄 Procesando...' : '🤖 Probar con IA'}
            </button>
          </form>
        </div>
      </div>

      {/* Resultados */}
      {result && (
        <div style={{ 
          marginTop: '30px',
          border: '1px solid #ddd',
          borderRadius: '10px',
          padding: '20px',
          backgroundColor: '#f9f9f9'
        }}>
          <h3>📊 Resultado del AI Try-On:</h3>
          
          {result.error ? (
            <div style={{ color: 'red', padding: '10px', backgroundColor: '#ffe6e6', borderRadius: '5px' }}>
              <strong>❌ Error:</strong> {result.error}
            </div>
          ) : (
            <div>
              <p><strong>✅ Estado:</strong> {result.success ? 'Exitoso' : 'Falló'}</p>
              <p><strong>📝 Descripción:</strong> {result.description}</p>
              <p><strong>👕 Talle:</strong> {result.size}</p>
              
              {result.generatedImage && (
                <div style={{ marginTop: '20px' }}>
                  <h4>🖼️ Imagen generada por IA:</h4>
                  <img 
                    src={result.generatedImage} 
                    style={{ 
                      maxWidth: '400px', 
                      border: '2px solid #0070f3',
                      borderRadius: '10px',
                      boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
                    }}
                    alt="Imagen generada por IA"
                  />
                </div>
              )}
              
              {result.fallback && (
                <div style={{ 
                  marginTop: '10px', 
                  padding: '10px', 
                  backgroundColor: '#fff3cd', 
                  borderRadius: '5px',
                  border: '1px solid #ffeaa7'
                }}>
                  <strong>⚠️ Modo fallback:</strong> Se usó procesamiento local en lugar de IA
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Instrucciones */}
      <div style={{ 
        marginTop: '30px',
        padding: '20px',
        backgroundColor: '#e8f4fd',
        borderRadius: '10px',
        border: '1px solid #b3d9ff'
      }}>
        <h4>📋 Cómo funciona esta simulación:</h4>
        <ol style={{ marginLeft: '20px' }}>
          <li><strong>Producto simulado:</strong> La imagen de la camiseta se captura con html2canvas</li>
          <li><strong>Tu foto:</strong> Se sube y procesa junto con la imagen del producto</li>
          <li><strong>IA procesa:</strong> Gemini genera una imagen de ti usando la camiseta</li>
          <li><strong>Resultado:</strong> Ves la imagen final generada por IA</li>
        </ol>
        <p style={{ marginTop: '10px', fontSize: '14px', color: '#666' }}>
          <strong>💡 En Tienda Nube real:</strong> El widget capturaría automáticamente la imagen del producto que el usuario está viendo.
        </p>
      </div>
    </div>
  );
}