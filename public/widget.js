/**
 * AI Try-On Widget v2.0 - FULL VERSION
 * Embeddable Virtual Try-On con todas las features
 * 
 * Integración en 7 líneas:
 * <script 
 *   src="https://ai-tn.vercel.app/widget.js"
 *   data-key="tu-api-key"
 *   data-images=".js-product-slide-img">
 * </script>
 */
(function() {
  'use strict';
  
  // Evitar doble inicialización
  if(document.getElementById('ai-widget')) return;

  // ============================================
  // CONFIGURACIÓN desde data attributes
  // ============================================
  var scriptTag = document.currentScript || document.querySelector('script[data-key]');
  
  var CONFIG = {
    apiKey: scriptTag?.dataset?.key || 'demo',
    imageSelector: scriptTag?.dataset?.images || '.js-product-slide-img, .product-slider-image, .product-image img',
    buttonTarget: scriptTag?.dataset?.buttonTarget || null,
    buttonText: scriptTag?.dataset?.buttonText || 'Probador Virtual',
    apiUrl: 'https://ai-tn.vercel.app/api/try-on',
    // Estado interno
    selectedSize: 'M',
    productImageUrl: null,
    allProductImageUrls: [],
    currentProductId: null,
    userImageOrientation: 'unknown'
  };

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🎨 AI Try-On Widget v2.0 FULL VERSION');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📋 Config:', CONFIG);

  var userImage = null;
  var userImageDataUrl = null;
  var progressInterval = null;

  // ============================================
  // FUNCIÓN DE COMPRESIÓN DE IMÁGENES
  // ============================================
  async function compressImage(dataUrl, maxWidth, quality) {
    maxWidth = maxWidth || 1024;
    quality = quality || 0.75;
    
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        try {
          var width = img.width;
          var height = img.height;
          
          if(width > maxWidth) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
          }
          
          // También limitar altura
          var maxHeight = 1024;
          if(height > maxHeight) {
            width = Math.round(width * (maxHeight / height));
            height = maxHeight;
          }
          
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          
          var ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          
          // Fondo blanco para manejar transparencia (PNG/WebP con alpha)
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          
          // SIEMPRE JPEG para compatibilidad con OpenAI Vision
          var compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
          
          var originalSizeKB = (dataUrl.length / 1024).toFixed(2);
          var compressedSizeKB = (compressedDataUrl.length / 1024).toFixed(2);
          var reduction = (100 - (compressedDataUrl.length / dataUrl.length * 100)).toFixed(1);
          
          console.log('📦 Imagen comprimida a JPEG: ' + originalSizeKB + 'KB → ' + compressedSizeKB + 'KB (-' + reduction + '%)');
          console.log('   Dimensiones: ' + img.width + 'x' + img.height + ' → ' + width + 'x' + height);
          
          resolve(compressedDataUrl);
        } catch(error) {
          console.error('❌ Error comprimiendo imagen:', error);
          resolve(dataUrl);
        }
      };
      img.onerror = function() {
        console.error('❌ Error cargando imagen para comprimir');
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }

  // Comprimir múltiples imágenes en paralelo
  async function compressImages(dataUrls, maxWidth, quality) {
    console.log('📦 Comprimiendo ' + dataUrls.length + ' imágenes...');
    var compressed = await Promise.all(
      dataUrls.map(function(url) { return compressImage(url, maxWidth, quality); })
    );
    return compressed;
  }

  // ============================================
  // ANÁLISIS DE IMAGEN - DETECCIÓN DE PERSONA Y ORIENTACIÓN
  // ============================================
  async function analyzeImageForPersonAndOrientation(canvas) {
    if(!canvas) return { hasPerson: false, orientation: 'unknown', score: 0 };
    
    try {
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var data = imageData.data;
      
      var skinTonePixels = 0;
      var upperRegionSkinTone = 0;
      var centerRegionSkinTone = 0;
      var faceLikeRegion = 0;
      var bodyStructure = 0;
      
      var centerX = Math.floor(canvas.width / 2);
      var centerY = Math.floor(canvas.height / 2);
      var regionSize = Math.min(canvas.width, canvas.height) * 0.3;
      
      // Región superior (cabeza/cara)
      var upperRegionY = Math.floor(canvas.height * 0.15);
      var upperRegionHeight = Math.floor(canvas.height * 0.25);
      var upperRegionWidth = Math.floor(canvas.width * 0.4);
      var upperRegionStartX = Math.floor((canvas.width - upperRegionWidth) / 2);
      
      // Región del torso
      var torsoRegionY = Math.floor(canvas.height * 0.3);
      var torsoRegionHeight = Math.floor(canvas.height * 0.3);
      var torsoRegionWidth = Math.floor(canvas.width * 0.5);
      var torsoRegionStartX = Math.floor((canvas.width - torsoRegionWidth) / 2);
      
      // Analizar región superior (cara)
      var upperRegionSamples = 0;
      for(var y = upperRegionY; y < upperRegionY + upperRegionHeight; y += 3) {
        for(var x = upperRegionStartX; x < upperRegionStartX + upperRegionWidth; x += 3) {
          if(x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
            var idx = (y * canvas.width + x) * 4;
            var r = data[idx];
            var g = data[idx + 1];
            var b = data[idx + 2];
            
            if(r > 95 && r < 240 && g > 40 && g < 210 && b > 20 && b < 200) {
              if(r > g && g > b && (r - b) > 15) {
                upperRegionSkinTone++;
                var distFromCenter = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - (upperRegionY + upperRegionHeight/2), 2));
                var maxDist = Math.min(upperRegionWidth, upperRegionHeight) / 2;
                if(distFromCenter < maxDist * 0.6) {
                  faceLikeRegion++;
                }
              }
            }
            upperRegionSamples++;
          }
        }
      }
      
      // Analizar región del torso
      var torsoRegionSamples = 0;
      for(var ty = torsoRegionY; ty < torsoRegionY + torsoRegionHeight; ty += 4) {
        for(var tx = torsoRegionStartX; tx < torsoRegionStartX + torsoRegionWidth; tx += 4) {
          if(tx >= 0 && tx < canvas.width && ty >= 0 && ty < canvas.height) {
            var tidx = (ty * canvas.width + tx) * 4;
            var tr = data[tidx];
            var tg = data[tidx + 1];
            var tb = data[tidx + 2];
            
            if(tr > 95 && tr < 240 && tg > 40 && tg < 210 && tb > 20 && tb < 200) {
              if(tr > tg && tg > tb && (tr - tb) > 15) {
                centerRegionSkinTone++;
              }
            }
            
            var brightness = (tr + tg + tb) / 3;
            if(brightness > 80 && brightness < 220) {
              bodyStructure++;
            }
            torsoRegionSamples++;
          }
        }
      }
      
      // Analizar región central general
      for(var cy = centerY - regionSize; cy < centerY + regionSize; cy += 5) {
        for(var cx = centerX - regionSize; cx < centerX + regionSize; cx += 5) {
          if(cx >= 0 && cx < canvas.width && cy >= 0 && cy < canvas.height) {
            var cidx = (cy * canvas.width + cx) * 4;
            var cr = data[cidx];
            var cg = data[cidx + 1];
            var cb = data[cidx + 2];
            
            if(cr > 95 && cr < 240 && cg > 40 && cg < 210 && cb > 20 && cb < 200) {
              if(cr > cg && cg > cb && (cr - cb) > 15) {
                skinTonePixels++;
              }
            }
          }
        }
      }
      
      // Calcular scores
      var skinToneScore = skinTonePixels / (regionSize * regionSize / 25);
      var upperSkinToneRatio = upperRegionSamples > 0 ? upperRegionSkinTone / upperRegionSamples : 0;
      var torsoSkinToneRatio = torsoRegionSamples > 0 ? centerRegionSkinTone / torsoRegionSamples : 0;
      var faceLikeRatio = upperRegionSamples > 0 ? faceLikeRegion / upperRegionSamples : 0;
      var bodyStructureRatio = torsoRegionSamples > 0 ? bodyStructure / torsoRegionSamples : 0;
      
      var hasPerson = skinToneScore > 0.1 || upperSkinToneRatio > 0.05 || torsoSkinToneRatio > 0.05;
      
      var orientation = 'unknown';
      var frontScore = (upperSkinToneRatio * 0.4) + (faceLikeRatio * 0.4) + (torsoSkinToneRatio * 0.2);
      var backScore = ((1 - upperSkinToneRatio) * 0.3) + (bodyStructureRatio * 0.4) + ((1 - faceLikeRatio) * 0.3);
      
      console.log('📊 Scores de análisis:');
      console.log('   - Front score: ' + frontScore.toFixed(3));
      console.log('   - Back score: ' + backScore.toFixed(3));
      
      if(hasPerson) {
        orientation = backScore > frontScore ? 'back' : 'front';
      } else {
        if(bodyStructureRatio > 0.4 && upperSkinToneRatio < 0.1) {
          orientation = 'back';
        } else if(upperSkinToneRatio > 0.1 || faceLikeRatio > 0.05) {
          orientation = 'front';
        } else {
          orientation = backScore > frontScore ? 'back' : 'front';
        }
      }
      
      var score = 0;
      if(hasPerson) {
        score += 100;
        if(orientation === 'front') score += 50;
        else if(orientation === 'back') score += 25;
      }
      score += skinToneScore * 10;
      score += upperSkinToneRatio * 100;
      score += faceLikeRatio * 150;
      
      console.log('🔍 Análisis de imagen:');
      console.log('   - Tiene persona: ' + hasPerson);
      console.log('   - Orientación: ' + orientation);
      console.log('   - Score: ' + score.toFixed(2));
      
      return { hasPerson: hasPerson, orientation: orientation, score: score };
    } catch(error) {
      console.warn('⚠️ Error analizando imagen:', error.message);
      return { hasPerson: false, orientation: 'unknown', score: 0 };
    }
  }

  // ============================================
  // OBTENER IMÁGENES DEL PRODUCTO (MÚLTIPLES ESTRATEGIAS)
  // ============================================
  // Extraer la mejor URL de srcset (la más grande)
  function getBestUrlFromSrcset(srcset) {
    if (!srcset) return null;
    
    // srcset formato: "url1 480w, url2 640w, url3 1024w"
    var entries = srcset.split(',').map(function(entry) {
      var parts = entry.trim().split(/\s+/);
      var url = parts[0];
      var width = parseInt(parts[1]) || 0;
      return { url: url, width: width };
    });
    
    // Ordenar por ancho descendente y tomar la más grande
    entries.sort(function(a, b) { return b.width - a.width; });
    
    var bestUrl = entries[0]?.url;
    if (bestUrl && !bestUrl.startsWith('http')) {
      bestUrl = 'https:' + bestUrl; // Agregar protocolo si falta
    }
    
    return bestUrl;
  }

  function getProductImages() {
    console.log('🔍 Buscando imágenes del producto...');
    var urls = [];
    
    // Estrategia 1: Selector configurado
    var elements = document.querySelectorAll(CONFIG.imageSelector);
    console.log('   Estrategia 1 (' + CONFIG.imageSelector + '): ' + elements.length + ' elementos');
    
    elements.forEach(function(el) {
      var url = null;
      
      // CASO ESPECIAL: Si es un <a> tag (ej: fancybox), usar href
      if (el.tagName === 'A') {
        url = el.href;
        if (url) console.log('      🔗 Usando href (link):', url.substring(0, 60) + '...');
      } 
      // Si es un <img> tag
      else if (el.tagName === 'IMG') {
        // PRIORIDAD: srcset > data-srcset > data-zoom > data-src > src
        // Esto evita los placeholders GIF
        
        // 1. Intentar srcset (imágenes lazy-loaded de Tiendanube)
        if (el.srcset) {
          url = getBestUrlFromSrcset(el.srcset);
          if (url) console.log('      📷 Usando srcset:', url.substring(0, 60) + '...');
        }
        
        // 2. Intentar data-srcset
        if (!url && el.dataset?.srcset) {
          url = getBestUrlFromSrcset(el.dataset.srcset);
          if (url) console.log('      📷 Usando data-srcset:', url.substring(0, 60) + '...');
        }
        
        // 3. Otros atributos comunes
        if (!url) {
          url = el.dataset?.zoom || el.dataset?.zoomImage || el.dataset?.src;
          if (url) console.log('      📷 Usando dataset:', url.substring(0, 60) + '...');
        }
        
        // 4. Último recurso: src (puede ser placeholder)
        if (!url && el.src && !el.src.startsWith('data:')) {
          url = el.src;
          console.log('      📷 Usando src:', url.substring(0, 60) + '...');
        }
      }
      // Cualquier otro elemento, buscar atributos comunes
      else {
        url = el.dataset?.src || el.dataset?.zoom || el.getAttribute('href');
        if (url) console.log('      📷 Usando atributo genérico:', url.substring(0, 60) + '...');
      }
      
      // Agregar protocolo si falta
      if (url && !url.startsWith('http') && !url.startsWith('data:')) {
        url = 'https:' + url;
      }
      
      // Validar URL
      if(url && urls.indexOf(url) === -1 && 
         !url.includes('logo') && !url.includes('icon') && !url.includes('banner') &&
         !url.includes('placeholder') && !url.startsWith('data:')) {
        // Para <a> tags no podemos verificar offsetWidth, así que solo verificamos para <img>
        if (el.tagName !== 'IMG' || el.offsetWidth > 100) {
          urls.push(url);
        }
      }
    });
    
    // Estrategia 2: Selectores comunes de e-commerce
    if(urls.length === 0) {
      console.log('   Estrategia 2: Selectores comunes...');
      var commonSelectors = [
        '.swiper-slide-active img',
        '.product-slide img',
        '[data-image-position="0"] img',
        '.product-gallery img',
        '.woocommerce-product-gallery img',
        '.product__media img'
      ];
      
      for(var i = 0; i < commonSelectors.length; i++) {
        var found = document.querySelectorAll(commonSelectors[i]);
        found.forEach(function(img) {
          // Usar srcset primero
          var url = getBestUrlFromSrcset(img.srcset) || 
                    getBestUrlFromSrcset(img.dataset?.srcset) ||
                    img.dataset?.zoom || img.dataset?.src;
          
          // Evitar src si es placeholder
          if (!url && img.src && !img.src.startsWith('data:')) {
            url = img.src;
          }
          
          if (url && !url.startsWith('http') && !url.startsWith('data:')) {
            url = 'https:' + url;
          }
          
          if(url && urls.indexOf(url) === -1 && !url.includes('logo') && !url.startsWith('data:') && img.offsetWidth > 100) {
            urls.push(url);
          }
        });
        if(urls.length > 0) break;
      }
    }
    
    // Estrategia 3: Buscar la imagen más grande
    if(urls.length === 0) {
      console.log('   Estrategia 3: Imagen más grande...');
      var allImages = document.querySelectorAll('img');
      var maxSize = 0;
      var bestImg = null;
      
      allImages.forEach(function(img) {
        // Obtener URL real (no placeholder)
        var imgUrl = getBestUrlFromSrcset(img.srcset) || 
                     getBestUrlFromSrcset(img.dataset?.srcset) ||
                     (img.src && !img.src.startsWith('data:') ? img.src : null);
        
        if(imgUrl && !imgUrl.includes('logo') && !imgUrl.includes('icon') &&
           !imgUrl.includes('banner') && !imgUrl.includes('avatar')) {
          var size = img.offsetWidth * img.offsetHeight;
          if(size > maxSize && size > 40000) { // Mínimo 200x200
            maxSize = size;
            bestImg = img;
          }
        }
      });
      
      if(bestImg) {
        // Usar srcset primero, no src (puede ser placeholder)
        var bestUrl = getBestUrlFromSrcset(bestImg.srcset) || 
                      getBestUrlFromSrcset(bestImg.dataset?.srcset) ||
                      (bestImg.src && !bestImg.src.startsWith('data:') ? bestImg.src : null);
        
        if (bestUrl && !bestUrl.startsWith('http')) {
          bestUrl = 'https:' + bestUrl;
        }
        
        if (bestUrl) {
          urls.push(bestUrl);
        }
      }
    }
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📸 IMÁGENES DEL PRODUCTO DETECTADAS: ' + urls.length);
    console.log('═══════════════════════════════════════════════════════════════');
    
    urls.forEach(function(url, idx) {
      console.log('📷 Imagen [' + idx + ']:');
      console.log('   URL: ' + url);
      // Mostrar preview visual en consola
      console.log('%c ', 'font-size: 100px; background: url(' + url + ') no-repeat center; background-size: contain; padding: 50px 100px; border: 2px solid #4CAF50; border-radius: 8px;');
    });
    
    if(urls.length === 0) {
      console.error('❌ NO SE ENCONTRARON IMÁGENES DEL PRODUCTO');
      console.log('🔍 Selector usado: ' + CONFIG.imageSelector);
      console.log('🔍 Intentá con otro selector o verificá que las imágenes existan en la página');
    }
    
    console.log('═══════════════════════════════════════════════════════════════');
    
    return urls.slice(0, 4); // Máximo 4 imágenes
  }

  // ============================================
  // VALIDAR SI UNA IMAGEN ES VÁLIDA (no negra/vacía)
  // ============================================
  function isImageValid(canvas) {
    try {
      var ctx = canvas.getContext('2d');
      var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var data = imageData.data;
      
      var totalPixels = data.length / 4;
      var blackPixels = 0;
      var threshold = 30; // Píxeles con valores < 30 se consideran "negros"
      
      // Muestrear cada 100 píxeles para rapidez
      for (var i = 0; i < data.length; i += 400) {
        var r = data[i];
        var g = data[i + 1];
        var b = data[i + 2];
        
        if (r < threshold && g < threshold && b < threshold) {
          blackPixels++;
        }
      }
      
      var sampledPixels = totalPixels / 100;
      var blackPercentage = (blackPixels / sampledPixels) * 100;
      
      console.log('   🔍 Análisis: ' + blackPercentage.toFixed(1) + '% píxeles negros');
      
      // Si más del 90% es negro, la imagen es inválida
      if (blackPercentage > 90) {
        console.warn('   ⚠️ Imagen detectada como NEGRA/INVÁLIDA (>' + blackPercentage.toFixed(1) + '% negro)');
        return false;
      }
      
      return true;
    } catch(e) {
      console.warn('   ⚠️ No se pudo analizar la imagen:', e.message);
      return true; // Asumir válida si no podemos analizar
    }
  }

  // ============================================
  // CONVERTIR URL A BASE64 (SIEMPRE JPEG)
  // Convierte cualquier formato (WebP, PNG, etc.) a JPEG
  // para compatibilidad con OpenAI Vision
  // ============================================
  async function imageUrlToBase64(url) {
    console.log('🔄 Convirtiendo imagen a JPEG:', url.substring(0, 50) + '...');
    
    return new Promise(function(resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = function() {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          
          // Validar que la imagen no sea negra/vacía
          if (!isImageValid(canvas)) {
            console.warn('   ⛔ Imagen descartada por ser negra/inválida');
            resolve(null); // Retornar null para filtrar después
            return;
          }
          
          // Siempre convertir a JPEG para compatibilidad con OpenAI
          var jpegDataUrl = canvas.toDataURL('image/jpeg', 0.9);
          console.log('✅ Imagen convertida a JPEG: ' + (jpegDataUrl.length / 1024).toFixed(2) + ' KB');
          resolve(jpegDataUrl);
        } catch(e) {
          console.error('❌ Error convirtiendo imagen:', e);
          resolve(null); // Retornar null en caso de error
        }
      };
      
      img.onerror = function() {
        console.warn('⚠️ Error cargando imagen, intentando fetch...');
        // Fallback: intentar con fetch
        fetch(url)
          .then(function(response) { return response.blob(); })
          .then(function(blob) {
            var reader = new FileReader();
            reader.onloadend = function() {
              // Convertir el resultado a JPEG usando canvas
              var tempImg = new Image();
              tempImg.onload = function() {
                var canvas = document.createElement('canvas');
                canvas.width = tempImg.width;
                canvas.height = tempImg.height;
                var ctx = canvas.getContext('2d');
                ctx.drawImage(tempImg, 0, 0);
                
                // Validar que no sea negra
                if (!isImageValid(canvas)) {
                  console.warn('   ⛔ Imagen descartada (fallback) por ser negra/inválida');
                  resolve(null);
                  return;
                }
                
                resolve(canvas.toDataURL('image/jpeg', 0.9));
              };
              tempImg.onerror = function() { 
                console.warn('   ⛔ Error en fallback, descartando imagen');
                resolve(null); 
              };
              tempImg.src = reader.result;
            };
            reader.readAsDataURL(blob);
          })
          .catch(function() { 
            console.warn('   ⛔ Fetch falló, descartando imagen');
            resolve(null); 
          });
      };
      
      // Cache busting para evitar problemas de caché
      var separator = url.includes('?') ? '&' : '?';
      img.src = url + separator + '_cb=' + Date.now();
    });
  }

  // ============================================
  // LIMPIAR PREFIJOS DUPLICADOS
  // ============================================
  function cleanBase64Prefix(dataUrl) {
    if(!dataUrl) return dataUrl;
    
    var duplicatePrefixes = [
      'data:image/jpeg;base64,data:image/jpeg;base64,',
      'data:image/png;base64,data:image/png;base64,',
      'data:image/webp;base64,data:image/webp;base64,'
    ];
    
    for(var i = 0; i < duplicatePrefixes.length; i++) {
      if(dataUrl.startsWith(duplicatePrefixes[i])) {
        var format = duplicatePrefixes[i].split(';')[0].split('/')[1];
        dataUrl = 'data:image/' + format + ';base64,' + dataUrl.substring(duplicatePrefixes[i].length);
        console.log('🔧 Prefijo duplicado corregido');
        break;
      }
    }
    
    return dataUrl;
  }

  // ============================================
  // ESTILOS (diseño Star Concept)
  // ============================================
  var style = document.createElement('style');
  style.id = 'aitw-styles';
  style.textContent = `
    #ai-widget {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.15);
      backdrop-filter: blur(2px);
      z-index: 999999;
      display: none;
      justify-content: center;
      align-items: center;
      overflow-y: auto;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #ai-widget.active { display: flex; }
    
    .ai-modal {
      background: white;
      border-radius: 16px;
      padding: 40px;
      max-width: 600px;
      width: 90%;
      position: relative;
      box-shadow: 0 20px 40px rgba(0,0,0,0.1);
      margin: 20px auto;
      max-height: 90vh;
      overflow-y: auto;
    }
    
    .ai-close {
      position: absolute;
      top: 20px;
      right: 20px;
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #999;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
    }
    .ai-close:hover { color: #333; }
    
    .ai-step { display: none; }
    .ai-step.active { display: block; }
    .ai-step h2 {
      font-size: 24px;
      font-weight: bold;
      color: #333;
      margin: 0 0 8px 0;
    }
    .ai-step p {
      font-size: 14px;
      color: #666;
      margin: 0 0 20px 0;
    }
    
    .upload-area {
      border: 2px dashed #ddd;
      border-radius: 12px;
      padding: 40px 20px;
      text-align: center;
      background: #fafafa;
      margin-bottom: 20px;
      position: relative;
      min-height: 200px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      cursor: pointer;
      transition: all 0.3s;
    }
    .upload-area:hover {
      border-color: #999;
      background: #f5f5f5;
    }
    .upload-area.has-image {
      padding: 10px;
      min-height: auto;
    }
    .upload-area.has-image img {
      max-width: 100%;
      max-height: 250px;
      border-radius: 8px;
    }
    
    .ai-size {
      display: flex;
      gap: 8px;
      justify-content: center;
      align-items: center;
      margin-bottom: 20px;
    }
    .ai-size-btn {
      padding: 10px 14px;
      border: 2px solid #e0e0e0;
      background: white;
      border-radius: 50%;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      opacity: 0.5;
      transition: all 0.2s;
      min-width: 44px;
      min-height: 44px;
    }
    .ai-size-btn:hover {
      border-color: #999;
      opacity: 0.8;
    }
    .ai-size-btn.selected {
      border-color: #333;
      background: #333;
      color: white;
      opacity: 1;
    }
    
    .ai-btn {
      background: #f5f0e8;
      color: #333;
      border: none;
      padding: 15px 30px;
      border-radius: 8px;
      cursor: pointer;
      width: 100%;
      font-size: 16px;
      font-weight: bold;
      min-height: 48px;
      transition: all 0.2s;
    }
    .ai-btn:hover:not(:disabled) { background: #e8e3db; }
    .ai-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .ai-btn-dark { background: #333; color: white; }
    .ai-btn-dark:hover { background: #444; }
    .ai-btn-outline { background: white; border: 1px solid #ddd; }
    .ai-btn-outline:hover { background: #f5f5f5; }
    
    .feedback-btn {
      background: none;
      border: 2px solid #e0e0e0;
      border-radius: 50%;
      width: 50px;
      height: 50px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #999;
      transition: all 0.3s ease;
    }
    .feedback-btn:hover { border-color: #999; }
    .feedback-btn.selected.like {
      border-color: #4CAF50;
      background: rgba(76,175,80,0.1);
      color: #4CAF50;
    }
    .feedback-btn.selected.dislike {
      border-color: #f44336;
      background: rgba(244,67,54,0.1);
      color: #f44336;
    }
    
    .ai-widget-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px 24px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      width: 100%;
      margin: 10px 0;
      background: #1a1a1a;
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      transition: all 0.3s;
    }
    .ai-widget-btn:hover { background: #333; }
    
    .ai-back-btn {
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: #999;
      margin-right: 15px;
      min-width: 44px;
      min-height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ai-back-btn:hover { color: #333; }
    
    @media (max-width: 480px) {
      .ai-modal {
        padding: 20px;
        width: 95%;
        margin: 10px auto;
      }
      .upload-area { padding: 30px 15px; }
      .ai-step h2 { font-size: 20px; }
      .ai-size-btn { min-width: 40px; min-height: 40px; padding: 8px 12px; }
    }
  `;
  document.head.appendChild(style);

  // ============================================
  // HTML DEL WIDGET
  // ============================================
  var widget = document.createElement('div');
  widget.id = 'ai-widget';
  widget.innerHTML = `
    <div class="ai-modal" onclick="event.stopPropagation()">
      <button class="ai-close" id="ai-close">&times;</button>
      
      <!-- Paso 1: Subir foto -->
      <div id="step-upload" class="ai-step active">
        <h2>Sube tu foto</h2>
        <p>Tip: Elige la pose que más te guste para ver el atuendo de la mejor manera!</p>
        
        <div class="upload-area" id="upload-area">
          <div style="font-size: 48px; margin-bottom: 20px;">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
              <circle cx="12" cy="13" r="3"/>
            </svg>
          </div>
          <div style="font-size: 18px; font-weight: bold; color: #333; margin-bottom: 8px;">Seleccionar foto</div>
          <div style="font-size: 14px; color: #666;">o arrastra y suelta aquí</div>
        </div>
        <input type="file" id="ai-file-input" accept="image/*" style="display:none">
      </div>

      <!-- Paso 2: Confirmar y elegir talle -->
      <div id="step-confirm" class="ai-step">
        <div style="display: flex; align-items: center; margin-bottom: 20px;">
          <button class="ai-back-btn" id="back-to-upload">‹</button>
          <h2 style="margin: 0; font-size: 20px;">Tus fotos:</h2>
        </div>
        
        <div style="display: flex; gap: 15px; margin-bottom: 30px;">
          <div style="width: 80px; height: 80px; border-radius: 8px; overflow: hidden; position: relative; background: #f5f5f5;">
            <img id="user-preview" style="width: 100%; height: 100%; object-fit: cover;">
            <div id="user-preview-check" style="position: absolute; top: 5px; left: 5px; width: 20px; height: 20px; background: #4CAF50; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
          </div>
          <div style="width: 80px; height: 80px; border: 2px dashed #ddd; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: #fafafa;">
            <div style="font-size: 24px; color: #999;">+</div>
          </div>
        </div>

        <div style="text-align: center; margin-bottom: 20px;">
          <p style="font-size: 16px; color: #333; margin-bottom: 15px;">Selecciona tu talle para ajustar la prenda</p>
          <div class="ai-size">
            <button class="ai-arrow-btn" style="background: none; border: none; font-size: 16px; cursor: pointer; color: #999;">‹</button>
            <button class="ai-size-btn" data-size="XS">XS</button>
            <button class="ai-size-btn" data-size="S">S</button>
            <button class="ai-size-btn selected" data-size="M">M</button>
            <button class="ai-size-btn" data-size="L">L</button>
            <button class="ai-size-btn" data-size="XL">XL</button>
            <button class="ai-arrow-btn" style="background: none; border: none; font-size: 16px; cursor: pointer; color: #999;">›</button>
          </div>
        </div>

        <button class="ai-btn" id="generate-btn">Generar</button>
      </div>

      <!-- Paso 3: Procesando -->
      <div id="step-processing" class="ai-step" style="text-align: center;">
        <div style="margin-bottom: 30px;">
          <div style="position: relative; display: inline-block;">
            <svg width="120" height="120" style="transform: rotate(-90deg);">
              <circle cx="60" cy="60" r="50" stroke="#e0e0e0" stroke-width="8" fill="none"/>
              <circle id="progress-circle" cx="60" cy="60" r="50" stroke="#333" stroke-width="8" fill="none" 
                      stroke-dasharray="314" stroke-dashoffset="314" stroke-linecap="round"
                      style="transition: stroke-dashoffset 0.3s ease;"></circle>
            </svg>
            <div id="progress-text" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 18px; font-weight: bold;">0%</div>
          </div>
        </div>
        <h2>Creando tu look...</h2>
        <p id="processing-message">Estamos procesando tu imagen...</p>
      </div>

      <!-- Paso 4: Resultado -->
      <div id="step-result" class="ai-step">
        <div style="display: flex; align-items: center; margin-bottom: 20px;">
          <button class="ai-back-btn" id="back-to-confirm">‹</button>
          <button class="ai-back-btn" id="close-result" style="margin-left: auto; margin-right: 0;">×</button>
        </div>
        
        <div style="text-align: center; margin-bottom: 20px;">
          <div style="position: relative; display: inline-block;">
            <img id="result-image" style="max-width: 100%; max-height: 400px; border-radius: 12px; display: block;">
            <button id="fullscreen-btn" style="position: absolute; top: 10px; right: 10px; background: rgba(255,255,255,0.9); border: none; border-radius: 50%; width: 30px; height: 30px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center;">⤢</button>
          </div>
        </div>
        
        <h2 style="text-align: center; font-size: 24px; margin-bottom: 20px;">¡Wow, un match perfecto!</h2>
        
        <div style="text-align: center; margin-bottom: 25px;">
          <p style="font-size: 14px; color: #666; margin-bottom: 12px;">¿Te gusta el resultado?</p>
          <div style="display: flex; gap: 20px; justify-content: center; align-items: center;">
            <button class="feedback-btn dislike" id="feedback-dislike">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" transform="rotate(180 12 12)"/>
              </svg>
            </button>
            <button class="feedback-btn like" id="feedback-like">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/>
              </svg>
            </button>
          </div>
          <div id="feedback-message" style="font-size: 12px; color: #4CAF50; margin-top: 8px; opacity: 0; transition: opacity 0.3s ease;"></div>
        </div>
        
        <div style="display: flex; gap: 15px;">
          <button class="ai-btn ai-btn-outline" id="download-btn" style="flex:1">Guardar</button>
          <button class="ai-btn ai-btn-dark" id="continue-btn" style="flex:1">Continuar compra</button>
        </div>
      </div>
    </div>
  `;
  widget.onclick = function(e) { if(e.target === widget) closeModal(); };
  document.body.appendChild(widget);

  // ============================================
  // FUNCIONES PRINCIPALES
  // ============================================
  function showStep(step) {
    document.querySelectorAll('.ai-step').forEach(function(s) { s.classList.remove('active'); });
    var targetStep = document.getElementById(step);
    if(targetStep) targetStep.classList.add('active');
  }
  
  function openModal() {
    // Generar nuevo ID de producto
    CONFIG.currentProductId = 'product_' + Date.now() + '_' + Math.random().toString(36).substring(7);
    console.log('🆔 Nuevo producto ID:', CONFIG.currentProductId);
    
    widget.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  
  function closeModal() {
    widget.classList.remove('active');
    document.body.style.overflow = '';
  }
  
  function updateProgress(percent) {
    var circle = document.getElementById('progress-circle');
    var text = document.getElementById('progress-text');
    if(circle) circle.style.strokeDashoffset = 314 - (314 * percent / 100);
    if(text) text.textContent = Math.round(percent) + '%';
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================
  document.getElementById('ai-close').onclick = function(e) { e.stopPropagation(); closeModal(); };
  document.getElementById('close-result').onclick = function(e) { e.stopPropagation(); closeModal(); };
  document.getElementById('back-to-upload').onclick = function(e) { e.stopPropagation(); showStep('step-upload'); };
  document.getElementById('back-to-confirm').onclick = function(e) { e.stopPropagation(); showStep('step-confirm'); };
  
  var uploadArea = document.getElementById('upload-area');
  var fileInput = document.getElementById('ai-file-input');
  
  uploadArea.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    fileInput.click();
  };
  
  fileInput.onchange = function(e) {
    var file = e.target.files[0];
    if(file) {
      console.log('📁 Archivo seleccionado:', file.name, '(' + (file.size / 1024).toFixed(2) + ' KB)');
      
      var reader = new FileReader();
      reader.onload = function(ev) {
        userImageDataUrl = ev.target.result;
        document.getElementById('user-preview').src = userImageDataUrl;
        showStep('step-confirm');
      };
      reader.readAsDataURL(file);
    }
  };

  // Selector de talles
  document.querySelectorAll('.ai-size-btn').forEach(function(btn) {
    btn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll('.ai-size-btn').forEach(function(b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
      CONFIG.selectedSize = btn.dataset.size;
      console.log('📏 Talle seleccionado:', CONFIG.selectedSize);
    };
  });

  // Botones de acción
  document.getElementById('generate-btn').onclick = function(e) { e.preventDefault(); e.stopPropagation(); generate(); };
  document.getElementById('download-btn').onclick = function(e) { e.preventDefault(); e.stopPropagation(); downloadImage(); };
  document.getElementById('continue-btn').onclick = function(e) { e.preventDefault(); e.stopPropagation(); closeModal(); };
  document.getElementById('fullscreen-btn').onclick = function(e) { e.preventDefault(); e.stopPropagation(); viewFullImage(); };
  
  // Feedback
  document.getElementById('feedback-like').onclick = function(e) { e.stopPropagation(); feedback('like', this); };
  document.getElementById('feedback-dislike').onclick = function(e) { e.stopPropagation(); feedback('dislike', this); };

  function feedback(type, btn) {
    document.querySelectorAll('.feedback-btn').forEach(function(b) { b.classList.remove('selected'); });
    btn.classList.add('selected');
    console.log('📊 Feedback:', type);
    
    fetch(CONFIG.apiUrl.replace('try-on', 'feedback'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        type: type,
        apiKey: CONFIG.apiKey,
        pageUrl: window.location.href,
        size: CONFIG.selectedSize
      })
    }).catch(console.error);
  }

  // Descargar imagen generada
  function downloadImage() {
    var resultImg = document.getElementById('result-image');
    if(!resultImg || !resultImg.src) return;
    
    var link = document.createElement('a');
    link.download = 'mi-look-' + Date.now() + '.jpg';
    link.href = resultImg.src;
    link.click();
    console.log('📥 Imagen descargada');
  }

  // Ver imagen en pantalla completa
  function viewFullImage() {
    var resultImg = document.getElementById('result-image');
    if(!resultImg || !resultImg.src) return;
    
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.95);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:20px;cursor:zoom-out;';
    
    var img = document.createElement('img');
    img.src = resultImg.src;
    img.style.cssText = 'max-width:95%;max-height:95%;object-fit:contain;border-radius:8px;';
    
    var closeBtn = document.createElement('button');
    closeBtn.innerHTML = '×';
    closeBtn.style.cssText = 'position:absolute;top:20px;right:20px;background:rgba(255,255,255,0.9);border:none;border-radius:50%;width:40px;height:40px;font-size:24px;cursor:pointer;';
    
    modal.appendChild(img);
    modal.appendChild(closeBtn);
    document.body.appendChild(modal);
    
    var closeModal = function() { document.body.removeChild(modal); };
    modal.onclick = closeModal;
    closeBtn.onclick = closeModal;
    
    document.addEventListener('keydown', function handleEscape(e) {
      if(e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', handleEscape);
      }
    });
    
    console.log('🔍 Imagen en pantalla completa');
  }

  // ============================================
  // GENERAR IMAGEN CON IA (VERSIÓN COMPLETA)
  // ============================================
  async function generate() {
    if(!userImageDataUrl) return;
    
    var requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substring(7);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🚀 INICIANDO PROCESAMIENTO [' + requestId + ']');
    console.log('═══════════════════════════════════════════════════════════════');
    
    showStep('step-processing');
    
    var messages = [
      'Analizando tu foto...',
      'Detectando orientación...',
      'Buscando imágenes del producto...',
      'Ajustando al talle ' + CONFIG.selectedSize + '...',
      'Generando imagen con IA...',
      'Aplicando detalles finales...'
    ];
    var progress = 0;
    var msgEl = document.getElementById('processing-message');

    progressInterval = setInterval(function() {
      progress += Math.random() * 6;
      if(progress > 90) progress = 90;
      updateProgress(progress);
      if(msgEl) msgEl.textContent = messages[Math.min(Math.floor(progress / 15), messages.length - 1)];
    }, 1500);

    try {
      // PASO 1: Analizar orientación de la imagen del usuario
      console.log('📸 PASO 1: Analizando imagen del usuario...');
      var userCanvas = document.createElement('canvas');
      var userImg = new Image();
      
      await new Promise(function(resolve) {
        userImg.onload = function() {
          userCanvas.width = userImg.width;
          userCanvas.height = userImg.height;
          var ctx = userCanvas.getContext('2d');
          ctx.drawImage(userImg, 0, 0);
          resolve();
        };
        userImg.src = userImageDataUrl;
      });
      
      var userAnalysis = await analyzeImageForPersonAndOrientation(userCanvas);
      CONFIG.userImageOrientation = userAnalysis.orientation;
      console.log('👤 Orientación del usuario: ' + CONFIG.userImageOrientation);
      
      // PASO 2: Obtener imágenes del producto
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('🔍 PASO 2: Obteniendo imágenes del producto...');
      console.log('═══════════════════════════════════════════════════════════════');
      var productImageUrls = getProductImages();
      
      if(productImageUrls.length === 0) {
        throw new Error('No se encontraron imágenes del producto. Verificá el selector: ' + CONFIG.imageSelector);
      }
      
      // PASO 3: Convertir a base64 con cache busting
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('🔄 PASO 3: Convirtiendo ' + productImageUrls.length + ' imágenes a JPEG/base64...');
      console.log('═══════════════════════════════════════════════════════════════');
      var productImagesBase64Raw = await Promise.all(productImageUrls.map(imageUrlToBase64));
      
      // FILTRAR imágenes nulas/inválidas (negras, con error, etc.)
      var productImagesBase64 = productImagesBase64Raw.filter(function(img) {
        return img !== null && img !== undefined;
      });
      
      console.log('🧹 Filtrado: ' + productImagesBase64Raw.length + ' → ' + productImagesBase64.length + ' imágenes válidas');
      
      if(productImagesBase64.length === 0) {
        throw new Error('Todas las imágenes del producto son inválidas o negras. Verificá que las imágenes carguen correctamente.');
      }
      
      // Mostrar imágenes convertidas
      console.log('✅ Imágenes válidas convertidas a base64:');
      productImagesBase64.forEach(function(b64, idx) {
        var sizeKB = (b64.length / 1024).toFixed(2);
        var isJpeg = b64.includes('image/jpeg');
        console.log('   [' + idx + ']: ' + sizeKB + ' KB - Formato: ' + (isJpeg ? 'JPEG ✅' : 'OTRO ⚠️'));
      });
      
      // PASO 4: Comprimir imágenes
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('📦 PASO 4: Comprimiendo imágenes...');
      console.log('═══════════════════════════════════════════════════════════════');
      var compressedUserImage = await compressImage(userImageDataUrl, 1024, 0.75);
      var compressedProductImages = await compressImages(productImagesBase64, 1024, 0.75);
      
      console.log('✅ Compresión completada:');
      console.log('   Usuario: ' + (compressedUserImage.length / 1024).toFixed(2) + ' KB');
      compressedProductImages.forEach(function(img, idx) {
        console.log('   Producto [' + idx + ']: ' + (img.length / 1024).toFixed(2) + ' KB');
      });
      
      // Verificar tamaño del payload
      var totalPayloadKB = (compressedUserImage.length + compressedProductImages.reduce(function(a, i) { return a + i.length; }, 0)) / 1024;
      console.log('📊 Tamaño del payload: ' + (totalPayloadKB / 1024).toFixed(2) + ' MB');
      
      // Si es muy grande, comprimir más
      if(totalPayloadKB > 4000) {
        console.warn('⚠️ Payload muy grande, aplicando compresión extra...');
        compressedUserImage = await compressImage(compressedUserImage, 800, 0.6);
        compressedProductImages = await compressImages(compressedProductImages, 800, 0.6);
      }
      
      // Limpiar prefijos duplicados
      compressedUserImage = cleanBase64Prefix(compressedUserImage);
      compressedProductImages = compressedProductImages.map(cleanBase64Prefix);
      
      // PASO 5: Enviar a la API
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('📤 PASO 5: ENVIANDO A LA API');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('   URL: ' + CONFIG.apiUrl);
      console.log('   User orientation: ' + CONFIG.userImageOrientation);
      console.log('   Product images: ' + compressedProductImages.length);
      console.log('   Size: ' + CONFIG.selectedSize);
      
      // Mostrar preview visual de imagen del usuario
      console.log('📷 IMAGEN USUARIO (preview en consola):');
      console.log('%c     ', 'font-size: 100px; background: url(' + compressedUserImage + ') no-repeat center; background-size: contain;');
      
      // Mostrar preview visual de imágenes del producto
      console.log('📷 IMÁGENES PRODUCTO (preview en consola):');
      compressedProductImages.forEach(function(img, idx) {
        console.log('   [' + idx + ']:');
        console.log('%c     ', 'font-size: 100px; background: url(' + img + ') no-repeat center; background-size: contain;');
      });
      
      var response = await fetch(CONFIG.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userImage: compressedUserImage,
          productImages: compressedProductImages,
          size: CONFIG.selectedSize,
          userOrientation: CONFIG.userImageOrientation,
          apiKey: CONFIG.apiKey,
          pageUrl: window.location.href,
          requestId: requestId
        })
      });

      clearInterval(progressInterval);
      
      if(!response.ok) {
        var errorText = await response.text();
        throw new Error('Error del servidor: ' + response.status + ' - ' + errorText);
      }
      
      var result = await response.json();
      
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('✅ RESPUESTA RECIBIDA [' + requestId + ']');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('   Success:', result.success);
      console.log('   Fallback:', result.fallback);
      console.log('   Has image:', !!result.generatedImage);
      
      updateProgress(100);

      if(result.success && result.generatedImage) {
        var cleanedImage = cleanBase64Prefix(result.generatedImage);
        document.getElementById('result-image').src = cleanedImage;
        setTimeout(function() { showStep('step-result'); }, 500);
        
        if(result.fallback) {
          console.warn('⚠️ API en modo fallback');
        }
      } else {
        throw new Error(result.error || 'Error generando imagen');
      }
    } catch(error) {
      clearInterval(progressInterval);
      console.error('❌ ERROR:', error);
      alert('Error: ' + error.message);
      showStep('step-confirm');
    }
  }

  // ============================================
  // DETECTAR DÓNDE PONER EL BOTÓN
  // ============================================
  function findButtonTarget() {
    if(CONFIG.buttonTarget) {
      return document.querySelector(CONFIG.buttonTarget);
    }

    var selectors = [
      '.js-addtocart',
      '.add-to-cart',
      '.btn-addtocart',
      '.product-form__submit',
      '[name="add"]',
      '.single_add_to_cart_button',
      '.add_to_cart_button',
      'form[action*="cart"] button[type="submit"]',
      '.product-form button'
    ];

    for(var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if(el) {
        console.log('🎯 Button target found:', selectors[i]);
        return el;
      }
    }

    return null;
  }

  // ============================================
  // CREAR E INSERTAR BOTÓN
  // ============================================
  function createButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai-widget-btn';
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
        <circle cx="12" cy="13" r="3"/>
      </svg>
      ${CONFIG.buttonText}
    `;
    btn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      openModal();
      return false;
    };
    return btn;
  }

  // ============================================
  // INICIALIZAR
  // ============================================
  function init() {
    var target = findButtonTarget();
    var btn = createButton();
    
    if(target) {
      var form = target.closest('form');
      if(form && form.parentElement) {
        form.parentElement.insertBefore(btn, form.nextSibling);
        console.log('✅ Button inserted after form');
      } else if(target.parentElement) {
        target.parentElement.insertBefore(btn, target.nextSibling);
        console.log('✅ Button inserted after target');
      } else {
        document.body.appendChild(btn);
        console.log('⚠️ Button added to body (fallback)');
      }
    } else {
      document.body.appendChild(btn);
      console.log('⚠️ No target found, button added to body');
    }
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ AI Try-On Widget FULL VERSION ready!');
    console.log('═══════════════════════════════════════════════════════════════');
  }

  // Esperar a que el DOM esté listo
  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // API pública
  window.AITryOnWidget = {
    open: openModal,
    close: closeModal,
    config: CONFIG,
    version: '2.0-full'
  };

})();
