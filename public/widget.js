/**
 * AI Try-On Widget - Embeddable Virtual Try-On for any ecommerce
 * 
 * Usage:
 * <script 
 *   src="https://ai-tn.vercel.app/widget.js" 
 *   data-key="your-api-key"
 *   data-images=".product-gallery img">
 * </script>
 */

(function() {
  'use strict';

  // ============================================
  // CONFIGURACIÓN
  // ============================================
  const WIDGET_VERSION = '1.0.0';
  const API_URL = 'https://ai-tn.vercel.app/api/try-on';
  
  // Obtener configuración del script tag
  const scriptTag = document.currentScript || document.querySelector('script[data-key]');
  
  const CONFIG = {
    apiKey: scriptTag?.dataset?.key || 'demo',
    imageSelector: scriptTag?.dataset?.images || '.product-gallery img, .product-images img, [data-zoom-image]',
    buttonTarget: scriptTag?.dataset?.buttonTarget || null,
    buttonText: scriptTag?.dataset?.buttonText || '👕 Probador Virtual',
    buttonStyle: scriptTag?.dataset?.buttonStyle || 'dark',
    lang: scriptTag?.dataset?.lang || 'es',
    sizesSelector: scriptTag?.dataset?.sizes || null,
  };

  console.log('🎨 AI Try-On Widget v' + WIDGET_VERSION);
  console.log('📋 Config:', CONFIG);

  // ============================================
  // ESTILOS
  // ============================================
  const STYLES = `
    .aitw-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px 24px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      border: none;
      width: 100%;
      margin: 10px 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .aitw-button.dark {
      background: #1a1a1a;
      color: white;
    }
    .aitw-button.dark:hover {
      background: #333;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    .aitw-button.light {
      background: white;
      color: #1a1a1a;
      border: 2px solid #1a1a1a;
    }
    .aitw-button.light:hover {
      background: #f5f5f5;
    }

    .aitw-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.85);
      z-index: 999999;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      overflow-y: auto;
    }
    .aitw-overlay.active {
      display: flex;
    }

    .aitw-modal {
      background: #1a1a2e;
      border-radius: 16px;
      width: 100%;
      max-width: 500px;
      max-height: 90vh;
      overflow-y: auto;
      position: relative;
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .aitw-header {
      padding: 20px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .aitw-title {
      font-size: 20px;
      font-weight: 600;
      margin: 0;
    }
    .aitw-close {
      background: none;
      border: none;
      color: white;
      font-size: 28px;
      cursor: pointer;
      padding: 0;
      line-height: 1;
      opacity: 0.7;
    }
    .aitw-close:hover {
      opacity: 1;
    }

    .aitw-body {
      padding: 20px;
    }

    .aitw-step {
      display: none;
    }
    .aitw-step.active {
      display: block;
    }

    .aitw-upload-area {
      border: 2px dashed rgba(255,255,255,0.3);
      border-radius: 12px;
      padding: 40px 20px;
      text-align: center;
      cursor: pointer;
      transition: all 0.3s;
      margin-bottom: 20px;
    }
    .aitw-upload-area:hover {
      border-color: #4F46E5;
      background: rgba(79,70,229,0.1);
    }
    .aitw-upload-area.has-image {
      padding: 10px;
    }
    .aitw-upload-area img {
      max-width: 100%;
      max-height: 300px;
      border-radius: 8px;
    }
    .aitw-upload-icon {
      font-size: 48px;
      margin-bottom: 10px;
    }
    .aitw-upload-text {
      color: rgba(255,255,255,0.7);
      margin: 0;
    }

    .aitw-sizes {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .aitw-size {
      padding: 10px 20px;
      border: 2px solid rgba(255,255,255,0.3);
      border-radius: 8px;
      background: transparent;
      color: white;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.2s;
    }
    .aitw-size:hover {
      border-color: #4F46E5;
    }
    .aitw-size.selected {
      background: #4F46E5;
      border-color: #4F46E5;
    }

    .aitw-generate-btn {
      width: 100%;
      padding: 16px;
      background: #4F46E5;
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
    }
    .aitw-generate-btn:hover:not(:disabled) {
      background: #4338CA;
      transform: translateY(-1px);
    }
    .aitw-generate-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .aitw-loading {
      text-align: center;
      padding: 40px 20px;
    }
    .aitw-spinner {
      width: 50px;
      height: 50px;
      border: 4px solid rgba(255,255,255,0.2);
      border-top-color: #4F46E5;
      border-radius: 50%;
      animation: aitw-spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes aitw-spin {
      to { transform: rotate(360deg); }
    }
    .aitw-loading-text {
      color: rgba(255,255,255,0.7);
      margin: 0;
    }
    .aitw-progress {
      width: 100%;
      height: 6px;
      background: rgba(255,255,255,0.1);
      border-radius: 3px;
      margin-top: 20px;
      overflow: hidden;
    }
    .aitw-progress-bar {
      height: 100%;
      background: #4F46E5;
      border-radius: 3px;
      transition: width 0.3s;
    }

    .aitw-result {
      text-align: center;
    }
    .aitw-result-image {
      max-width: 100%;
      border-radius: 12px;
      margin-bottom: 20px;
    }
    .aitw-feedback {
      display: flex;
      justify-content: center;
      gap: 20px;
      margin-bottom: 20px;
    }
    .aitw-feedback-btn {
      padding: 12px 24px;
      border-radius: 50px;
      border: 2px solid rgba(255,255,255,0.3);
      background: transparent;
      color: white;
      font-size: 20px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .aitw-feedback-btn:hover {
      transform: scale(1.1);
    }
    .aitw-feedback-btn.like:hover, .aitw-feedback-btn.like.selected {
      border-color: #10B981;
      background: rgba(16,185,129,0.2);
    }
    .aitw-feedback-btn.dislike:hover, .aitw-feedback-btn.dislike.selected {
      border-color: #EF4444;
      background: rgba(239,68,68,0.2);
    }

    .aitw-actions {
      display: flex;
      gap: 10px;
    }
    .aitw-action-btn {
      flex: 1;
      padding: 14px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .aitw-action-btn.primary {
      background: #4F46E5;
      color: white;
      border: none;
    }
    .aitw-action-btn.secondary {
      background: transparent;
      color: white;
      border: 2px solid rgba(255,255,255,0.3);
    }

    .aitw-powered {
      text-align: center;
      padding: 15px;
      color: rgba(255,255,255,0.4);
      font-size: 12px;
      border-top: 1px solid rgba(255,255,255,0.1);
    }
  `;

  // ============================================
  // INYECTAR ESTILOS
  // ============================================
  function injectStyles() {
    const style = document.createElement('style');
    style.id = 'aitw-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  // ============================================
  // DETECTAR IMÁGENES DEL PRODUCTO
  // ============================================
  function getProductImages() {
    const images = document.querySelectorAll(CONFIG.imageSelector);
    const urls = [];
    
    images.forEach(img => {
      // Prioridad: data-zoom-image > data-src > src
      const url = img.dataset?.zoomImage || img.dataset?.src || img.src;
      if (url && !url.includes('placeholder') && !urls.includes(url)) {
        urls.push(url);
      }
    });

    console.log('📸 Product images found:', urls.length);
    return urls.slice(0, 3); // Máximo 3 imágenes
  }

  // ============================================
  // DETECTAR DÓNDE PONER EL BOTÓN
  // ============================================
  function findButtonTarget() {
    if (CONFIG.buttonTarget) {
      return document.querySelector(CONFIG.buttonTarget);
    }

    // Auto-detectar
    const selectors = [
      '.js-addtocart',
      '.add-to-cart',
      '.btn-addtocart',
      '.product-form__submit',
      '[name="add"]',
      '.single_add_to_cart_button',
      '.add_to_cart_button',
      'form[action*="cart"] button[type="submit"]',
      '.product-form button',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        console.log('🎯 Button target found:', sel);
        return el.parentElement || el;
      }
    }

    // Fallback: buscar cualquier form de producto
    const form = document.querySelector('form[action*="cart"], .product-form, .product__form');
    return form || document.body;
  }

  // ============================================
  // CREAR BOTÓN
  // ============================================
  function createButton() {
    const btn = document.createElement('button');
    btn.className = `aitw-button ${CONFIG.buttonStyle}`;
    btn.innerHTML = CONFIG.buttonText;
    btn.onclick = openModal;
    return btn;
  }

  // ============================================
  // CREAR MODAL
  // ============================================
  function createModal() {
    const modal = document.createElement('div');
    modal.className = 'aitw-overlay';
    modal.id = 'aitw-modal';
    
    modal.innerHTML = `
      <div class="aitw-modal">
        <div class="aitw-header">
          <h2 class="aitw-title">👕 Probador Virtual</h2>
          <button class="aitw-close" onclick="window.AITryOnWidget.close()">&times;</button>
        </div>
        <div class="aitw-body">
          <!-- Step 1: Upload -->
          <div class="aitw-step active" id="aitw-step-upload">
            <p style="margin-bottom:15px;opacity:0.8;">Subí una foto tuya para ver cómo te queda esta prenda</p>
            <div class="aitw-upload-area" id="aitw-upload-area">
              <div class="aitw-upload-icon">📷</div>
              <p class="aitw-upload-text">Click para subir tu foto</p>
            </div>
            <input type="file" id="aitw-file-input" accept="image/*" style="display:none">
            
            <p style="margin-bottom:10px;opacity:0.8;">Seleccioná tu talle:</p>
            <div class="aitw-sizes" id="aitw-sizes">
              <button class="aitw-size" data-size="XS">XS</button>
              <button class="aitw-size" data-size="S">S</button>
              <button class="aitw-size selected" data-size="M">M</button>
              <button class="aitw-size" data-size="L">L</button>
              <button class="aitw-size" data-size="XL">XL</button>
            </div>
            
            <button class="aitw-generate-btn" id="aitw-generate-btn" disabled>
              ✨ Generar Prueba Virtual
            </button>
          </div>

          <!-- Step 2: Loading -->
          <div class="aitw-step" id="aitw-step-loading">
            <div class="aitw-loading">
              <div class="aitw-spinner"></div>
              <p class="aitw-loading-text" id="aitw-loading-text">Analizando tu foto...</p>
              <div class="aitw-progress">
                <div class="aitw-progress-bar" id="aitw-progress-bar" style="width:0%"></div>
              </div>
            </div>
          </div>

          <!-- Step 3: Result -->
          <div class="aitw-step" id="aitw-step-result">
            <div class="aitw-result">
              <img class="aitw-result-image" id="aitw-result-image" src="" alt="Resultado">
              <div class="aitw-feedback">
                <button class="aitw-feedback-btn like" onclick="window.AITryOnWidget.feedback('like')">👍</button>
                <button class="aitw-feedback-btn dislike" onclick="window.AITryOnWidget.feedback('dislike')">👎</button>
              </div>
              <div class="aitw-actions">
                <button class="aitw-action-btn secondary" onclick="window.AITryOnWidget.retry()">🔄 Probar otra foto</button>
                <button class="aitw-action-btn primary" onclick="window.AITryOnWidget.continue()">🛒 Continuar compra</button>
              </div>
            </div>
          </div>
        </div>
        <div class="aitw-powered">
          Powered by AI Try-On
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    
    // Event listeners
    setupEventListeners();
    
    return modal;
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================
  let userImage = null;
  let selectedSize = 'M';

  function setupEventListeners() {
    const uploadArea = document.getElementById('aitw-upload-area');
    const fileInput = document.getElementById('aitw-file-input');
    const sizes = document.querySelectorAll('.aitw-size');
    const generateBtn = document.getElementById('aitw-generate-btn');

    // Upload area click
    uploadArea.onclick = () => fileInput.click();

    // File selected
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          userImage = event.target.result;
          uploadArea.innerHTML = `<img src="${userImage}" alt="Tu foto">`;
          uploadArea.classList.add('has-image');
          generateBtn.disabled = false;
        };
        reader.readAsDataURL(file);
      }
    };

    // Size selection
    sizes.forEach(btn => {
      btn.onclick = () => {
        sizes.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedSize = btn.dataset.size;
      };
    });

    // Generate button
    generateBtn.onclick = generate;

    // Close on overlay click
    document.getElementById('aitw-modal').onclick = (e) => {
      if (e.target.classList.contains('aitw-overlay')) {
        closeModal();
      }
    };
  }

  // ============================================
  // MOSTRAR/OCULTAR PASOS
  // ============================================
  function showStep(stepId) {
    document.querySelectorAll('.aitw-step').forEach(s => s.classList.remove('active'));
    document.getElementById('aitw-step-' + stepId)?.classList.add('active');
  }

  // ============================================
  // ABRIR/CERRAR MODAL
  // ============================================
  function openModal() {
    document.getElementById('aitw-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    document.getElementById('aitw-modal').classList.remove('active');
    document.body.style.overflow = '';
  }

  // ============================================
  // GENERAR IMAGEN
  // ============================================
  async function generate() {
    if (!userImage) return;

    showStep('loading');
    
    const loadingMessages = [
      'Analizando tu foto...',
      'Detectando tipo de prenda...',
      'Ajustando al talle ' + selectedSize + '...',
      'Generando imagen...',
      'Aplicando detalles finales...',
    ];

    let progress = 0;
    const progressBar = document.getElementById('aitw-progress-bar');
    const loadingText = document.getElementById('aitw-loading-text');

    const interval = setInterval(() => {
      progress += Math.random() * 15;
      if (progress > 90) progress = 90;
      progressBar.style.width = progress + '%';
      
      const msgIndex = Math.min(Math.floor(progress / 20), loadingMessages.length - 1);
      loadingText.textContent = loadingMessages[msgIndex];
    }, 800);

    try {
      // Obtener imágenes del producto
      const productImages = getProductImages();
      
      if (productImages.length === 0) {
        throw new Error('No se encontraron imágenes del producto');
      }

      // Convertir URLs a base64
      const productImagesBase64 = await Promise.all(
        productImages.map(url => imageUrlToBase64(url))
      );

      // Llamar al API
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userImage: userImage,
          productImages: productImagesBase64,
          size: selectedSize,
          apiKey: CONFIG.apiKey,
        }),
      });

      const result = await response.json();

      clearInterval(interval);
      progressBar.style.width = '100%';

      if (result.success && result.generatedImage) {
        document.getElementById('aitw-result-image').src = result.generatedImage;
        setTimeout(() => showStep('result'), 500);
      } else {
        throw new Error(result.error || 'Error generando imagen');
      }

    } catch (error) {
      clearInterval(interval);
      console.error('❌ Error:', error);
      alert('Error: ' + error.message);
      showStep('upload');
    }
  }

  // ============================================
  // CONVERTIR URL A BASE64
  // ============================================
  async function imageUrlToBase64(url) {
    try {
      // Intentar fetch directo
      const response = await fetch(url);
      const blob = await response.blob();
      
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      // Si falla CORS, usar imagen proxy o devolver URL
      console.warn('Could not convert image to base64:', url);
      return url;
    }
  }

  // ============================================
  // ACCIONES
  // ============================================
  function feedback(type) {
    console.log('📊 Feedback:', type);
    
    // Visual feedback
    const btns = document.querySelectorAll('.aitw-feedback-btn');
    btns.forEach(b => b.classList.remove('selected'));
    document.querySelector(`.aitw-feedback-btn.${type}`).classList.add('selected');

    // Enviar al servidor
    fetch('https://ai-tn.vercel.app/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: type,
        apiKey: CONFIG.apiKey,
        pageUrl: window.location.href,
        selectedSize: selectedSize,
      }),
    }).catch(console.error);
  }

  function retry() {
    userImage = null;
    document.getElementById('aitw-upload-area').innerHTML = `
      <div class="aitw-upload-icon">📷</div>
      <p class="aitw-upload-text">Click para subir tu foto</p>
    `;
    document.getElementById('aitw-upload-area').classList.remove('has-image');
    document.getElementById('aitw-generate-btn').disabled = true;
    document.getElementById('aitw-progress-bar').style.width = '0%';
    showStep('upload');
  }

  function continuePurchase() {
    closeModal();
    
    // Trackear conversión
    fetch('https://ai-tn.vercel.app/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'conversion',
        apiKey: CONFIG.apiKey,
        pageUrl: window.location.href,
        selectedSize: selectedSize,
      }),
    }).catch(console.error);

    // Intentar hacer click en add to cart
    const addToCart = document.querySelector('.js-addtocart, .add-to-cart, [name="add"], .single_add_to_cart_button');
    if (addToCart) {
      addToCart.click();
    }
  }

  // ============================================
  // INICIALIZAR
  // ============================================
  function init() {
    // Esperar a que el DOM esté listo
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setup);
    } else {
      setup();
    }
  }

  function setup() {
    console.log('🚀 AI Try-On Widget initializing...');

    // Inyectar estilos
    injectStyles();

    // Crear modal
    createModal();

    // Encontrar dónde poner el botón
    const target = findButtonTarget();
    
    // Crear e insertar botón
    const button = createButton();
    
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT') {
      target.parentElement.insertBefore(button, target);
    } else {
      target.appendChild(button);
    }

    console.log('✅ AI Try-On Widget ready!');
  }

  // ============================================
  // API PÚBLICA
  // ============================================
  window.AITryOnWidget = {
    open: openModal,
    close: closeModal,
    feedback: feedback,
    retry: retry,
    continue: continuePurchase,
    config: CONFIG,
    version: WIDGET_VERSION,
  };

  // Iniciar
  init();

})();

