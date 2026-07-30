/* BINGO SCAN DIGITAL - MOTOR OCR Y CONTROL DE CÁMARA */

class OcrService {
    constructor() {
        this.stream = null;
        this.videoElement = null;
        this.simulatorCanvas = null;
        this.tesseractWorker = null;
        this.isWorkerInitializing = false;
        this.isSimulated = false;
        this.isTorchActive = false;
        
        // Propiedades para escaneo en tiempo real y overlays
        this.isScanningLoopRunning = false;
        this.isOcrProcessing = false;
        this.detectedWordsCache = [];
        this.onCardAutoCapturedCallback = null;
    }

    /**
     * Inicia la transmisión de la cámara en el elemento de video dado.
     */
    async startCamera(videoElement, simulatorCanvas) {
        this.videoElement = videoElement;
        this.simulatorCanvas = simulatorCanvas;
        this.isSimulated = false;
        this.isTorchActive = false;

        if (this.simulatorCanvas) {
            this.simulatorCanvas.classList.add('hidden');
        }
        if (this.videoElement) {
            this.videoElement.classList.remove('hidden');
        }

        try {
            if (this.stream) {
                this.stopCamera();
            }

            // Preferir la cámara trasera ("environment")
            const constraints = {
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoElement.srcObject = this.stream;
            await this.videoElement.play();
            this.checkTorchSupport();
            return true;
        } catch (err) {
            console.warn("Fallo cámara trasera, intentando genérica...", err);
            // Intentar cualquier cámara disponible si la trasera falla
            try {
                this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                this.videoElement.srcObject = this.stream;
                await this.videoElement.play();
                this.checkTorchSupport();
                return true;
            } catch (innerErr) {
                console.error("Fallo total de cámara, activando simulador...", innerErr);
                this.isSimulated = true;
                if (this.videoElement) this.videoElement.classList.add('hidden');
                if (this.simulatorCanvas) {
                    this.simulatorCanvas.classList.remove('hidden');
                    this.drawSimulatedCard(this.simulatorCanvas);
                }
                this.checkTorchSupport();
                return true; // Retornar true para habilitar el flujo con simulador
            }
        }
    }

    /**
     * Detiene la transmisión de la cámara.
     */
    stopCamera() {
        this.isTorchActive = false;
        const torchBtn = document.getElementById('btn-toggle-torch');
        if (torchBtn) {
            torchBtn.classList.add('hidden');
            torchBtn.classList.remove('active');
        }
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        if (this.videoElement) {
            this.videoElement.srcObject = null;
        }
    }

    /**
     * Comprueba si el dispositivo soporta linterna (torch) y actualiza el botón en pantalla.
     */
    checkTorchSupport() {
        const torchBtn = document.getElementById('btn-toggle-torch');
        if (!torchBtn) return;

        if (this.isSimulated || !this.stream) {
            torchBtn.classList.add('hidden');
            return;
        }

        const track = this.stream.getVideoTracks()[0];
        if (!track) {
            torchBtn.classList.add('hidden');
            return;
        }

        // Si getCapabilities está soportado, lo usamos para validar.
        // Si no lo está (ej. iOS Safari), mostramos el botón por defecto para permitir el intento.
        if (typeof track.getCapabilities === 'function') {
            try {
                const capabilities = track.getCapabilities();
                if (capabilities && capabilities.torch) {
                    torchBtn.classList.remove('hidden');
                    return;
                } else {
                    torchBtn.classList.add('hidden');
                    return;
                }
            } catch (e) {
                console.warn("Error al leer capacidades de cámara para la linterna:", e);
            }
        }

        // Fallback para navegadores que no exponen getCapabilities pero podrían soportar linterna
        torchBtn.classList.remove('hidden');
    }

    /**
     * Alterna el encendido/apagado de la linterna (torch) de la cámara.
     */
    async toggleTorch() {
        if (!this.stream || this.isSimulated) return false;
        const track = this.stream.getVideoTracks()[0];
        if (!track) return false;

        // Si getCapabilities está soportado y explícitamente dice que no tiene linterna, cancelamos.
        if (typeof track.getCapabilities === 'function') {
            try {
                const capabilities = track.getCapabilities();
                if (capabilities && capabilities.torch === false) {
                    console.warn("Linterna no soportada en esta cámara.");
                    return false;
                }
            } catch (e) {
                console.warn("Error leyendo capabilities al alternar linterna:", e);
            }
        }

        const targetState = !this.isTorchActive;
        try {
            await track.applyConstraints({
                advanced: [{ torch: targetState }]
            });
            this.isTorchActive = targetState;
            return true;
        } catch (err) {
            console.error("Error al aplicar constraints de linterna:", err);
            return false;
        }
    }

    /**
     * Inicia el bucle de escaneo continuo en tiempo real con realidad aumentada.
     */
    startScanLoop(onAutoCaptureCallback, statusCallback) {
        this.isScanningLoopRunning = true;
        this.isOcrProcessing = false;
        this.detectedWordsCache = [];
        this.onCardAutoCapturedCallback = onAutoCaptureCallback;

        // Limpiar el canvas de overlays
        const canvas = document.getElementById('scan-overlay-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        // Iniciar el bucle de animación
        this.tickScanLoop();

        // Pre-inicializar Tesseract de inmediato en segundo plano para que esté cargado
        this.initTesseract(statusCallback).catch(err => console.error("Error al pre-inicializar Tesseract:", err));

        if (this.isSimulated) {
            // Flujo simulado: simula detecciones y autocaptura tras 1.8 segundos
            setTimeout(() => {
                if (!this.isScanningLoopRunning) return;
                this.detectedWordsCache = [
                    { text: "7", bbox: { x0: 30, y0: 80, x1: 50, y1: 100 } },
                    { text: "18", bbox: { x0: 90, y0: 80, x1: 110, y1: 100 } },
                    { text: "33", bbox: { x0: 150, y0: 80, x1: 170, y1: 100 } },
                    { text: "48", bbox: { x0: 210, y0: 80, x1: 230, y1: 100 } },
                    { text: "64", bbox: { x0: 270, y0: 80, x1: 290, y1: 100 } },
                    
                    { text: "12", bbox: { x0: 30, y0: 130, x1: 50, y1: 150 } },
                    { text: "25", bbox: { x0: 90, y0: 130, x1: 110, y1: 150 } },
                    { text: "37", bbox: { x0: 150, y0: 130, x1: 170, y1: 150 } },
                    { text: "52", bbox: { x0: 210, y0: 130, x1: 230, y1: 150 } },
                    { text: "70", bbox: { x0: 270, y0: 130, x1: 290, y1: 150 } },

                    { text: "4", bbox: { x0: 30, y0: 180, x1: 50, y1: 200 } },
                    { text: "20", bbox: { x0: 90, y0: 180, x1: 110, y1: 200 } },
                    { text: "LIBRE", bbox: { x0: 150, y0: 180, x1: 170, y1: 200 } },
                    { text: "55", bbox: { x0: 210, y0: 180, x1: 230, y1: 200 } },
                    { text: "66", bbox: { x0: 270, y0: 180, x1: 290, y1: 200 } },

                    { text: "9", bbox: { x0: 30, y0: 230, x1: 50, y1: 250 } },
                    { text: "29", bbox: { x0: 90, y0: 230, x1: 110, y1: 250 } },
                    { text: "41", bbox: { x0: 150, y0: 230, x1: 170, y1: 250 } },
                    { text: "59", bbox: { x0: 210, y0: 230, x1: 230, y1: 250 } },
                    { text: "73", bbox: { x0: 270, y0: 230, x1: 290, y1: 250 } },

                    { text: "14", bbox: { x0: 30, y: 280, x: 50, y: 300 } },
                    { text: "22", bbox: { x0: 90, y: 280, x: 110, y: 300 } },
                    { text: "45", bbox: { x0: 150, y: 280, x: 170, y: 300 } },
                    { text: "61", bbox: { x0: 210, y: 280, x: 230, y: 300 } },
                    { text: "68", bbox: { x0: 270, y: 280, x: 290, y: 300 } }
                ];
                
                setTimeout(() => {
                    if (!this.isScanningLoopRunning) return;
                    this.stopScanLoop();
                    const grid = this.reconstructGrid(this.detectedWordsCache);
                    if (this.onCardAutoCapturedCallback) {
                        this.onCardAutoCapturedCallback(grid);
                    }
                }, 800);
            }, 1000);
        }
    }

    /**
     * Detiene el bucle de escaneo.
     */
    stopScanLoop() {
        this.isScanningLoopRunning = false;
        const canvas = document.getElementById('scan-overlay-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    /**
     * Ejecuta un paso del bucle de animación y escaneo continuo.
     */
    async tickScanLoop() {
        if (!this.isScanningLoopRunning) return;

        // 1. Dibujar overlays
        this.drawOverlays();

        // 2. Procesar OCR de forma no-bloqueante
        if (!this.isOcrProcessing && this.tesseractWorker && !this.isWorkerInitializing && !this.isSimulated) {
            this.isOcrProcessing = true;

            const canvas = this.captureAndProcess();
            if (canvas) {
                // Preprocesar canvas para binarizar antes de mandarlo al worker
                this.preprocessCanvas(canvas);

                this.tesseractWorker.recognize(canvas)
                    .then(result => {
                        if (!this.isScanningLoopRunning) return;

                        const words = result.data.words;
                        this.detectedWordsCache = words || [];

                        // Intentar reconstruir cuadrícula
                        const grid = this.reconstructGrid(words);

                        // Si cumple los requisitos de densidad y coherencia de 75 bolas, autocapturar
                        if (this.isValid75BallCard(grid)) {
                            this.stopScanLoop();
                            if (this.onCardAutoCapturedCallback) {
                                const finalCanvas = this.captureAndProcess();
                                this.onCardAutoCapturedCallback(finalCanvas);
                            }
                        }
                        this.isOcrProcessing = false;
                    })
                    .catch(err => {
                        console.error("Error en reconocimiento continuo:", err);
                        this.isOcrProcessing = false;
                    });
            } else {
                this.isOcrProcessing = false;
            }
        }

        requestAnimationFrame(() => this.tickScanLoop());
    }

    /**
     * Dibuja los números reconocidos y recuadros sobre el stream en tiempo real.
     */
    drawOverlays() {
        const canvas = document.getElementById('scan-overlay-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        const rect = canvas.getBoundingClientRect();
        if (canvas.width !== rect.width || canvas.height !== rect.height) {
            canvas.width = rect.width;
            canvas.height = rect.height;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const scaleX = canvas.width / 400;
        const scaleY = canvas.height / 400;

        this.detectedWordsCache.forEach(w => {
            if (!w.text || !w.bbox) return;

            const x0 = w.bbox.x0 * scaleX;
            const y0 = w.bbox.y0 * scaleY;
            const x1 = w.bbox.x1 * scaleX;
            const y1 = w.bbox.y1 * scaleY;
            const rw = x1 - x0;
            const rh = y1 - y0;

            const cy = (w.bbox.y0 + w.bbox.y1) / 2;
            if (cy < 45) return; // Ignorar cabecera

            const upper = w.text.toUpperCase();
            const isLibre = upper.includes("LIBRE") || upper.includes("FREE") || upper.includes("L1BRE") || upper.includes("FRE");

            let isValid = false;
            let displayVal = "";
            const cx = (w.bbox.x0 + w.bbox.x1) / 2;
            const colIdx = Math.max(0, Math.min(4, Math.floor(cx / 80)));

            if (isLibre) {
                isValid = true;
                displayVal = "LIBRE";
            } else {
                const corrected = this.correctNumberForColumn(w.text, colIdx);
                if (corrected !== null) {
                    isValid = true;
                    displayVal = corrected.toString();
                } else {
                    displayVal = w.text.replace(/[^0-9]/g, '');
                }
            }

            // Dibujar recuadro de celda
            ctx.shadowBlur = 8;
            if (isValid) {
                ctx.strokeStyle = '#06b6d4'; // Cyan para válidos
                ctx.fillStyle = 'rgba(6, 182, 212, 0.15)';
                ctx.shadowColor = 'rgba(6, 182, 212, 0.6)';
            } else {
                ctx.strokeStyle = '#ef4444'; // Rojo para dudosos
                ctx.fillStyle = 'rgba(239, 68, 68, 0.1)';
                ctx.shadowColor = 'rgba(239, 68, 68, 0.5)';
            }

            ctx.lineWidth = 2;
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(x0, y0, rw, rh, 6);
            } else {
                ctx.rect(x0, y0, rw, rh);
            }
            ctx.fill();
            ctx.stroke();

            // Dibujar número digital clonado
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${Math.max(12, Math.round(rh * 0.7))}px 'Outfit', Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(displayVal, x0 + rw / 2, y0 + rh / 2);
        });
    }

    /**
     * Determina si se ha identificado de manera estable un cartón de bingo tradicional de 75 bolas.
     */
    isValid75BallCard(grid) {
        let validDetectionsCount = 0;

        this.detectedWordsCache.forEach(w => {
            const cy = (w.bbox.y0 + w.bbox.y1) / 2;
            if (cy < 45) return;

            const upper = w.text.toUpperCase();
            const isLibre = upper.includes("LIBRE") || upper.includes("FREE") || upper.includes("L1BRE") || upper.includes("FRE");

            if (isLibre) {
                validDetectionsCount++;
            } else {
                const cx = (w.bbox.x0 + w.bbox.x1) / 2;
                const colIdx = Math.max(0, Math.min(4, Math.floor(cx / 80)));
                const corrected = this.correctNumberForColumn(w.text, colIdx);
                if (corrected !== null) {
                    validDetectionsCount++;
                }
            }
        });

        // Retorna true si hay al menos 12 celdas numéricas detectadas de forma válida en el cartón.
        // Esto previene que se capturen objetos aleatorios o texto parcial.
        return validDetectionsCount >= 12;
    }

    /**
     * Captura el frame actual de video y recorta la región del recuadro.
     */
    captureAndProcess() {
        if (this.isSimulated) {
            if (!this.simulatorCanvas) return null;
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 400;
            canvas.height = 400;
            ctx.drawImage(this.simulatorCanvas, 0, 0, 400, 400);
            return canvas;
        }

        if (!this.videoElement || !this.stream) return null;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        let videoWidth = this.videoElement.videoWidth;
        let videoHeight = this.videoElement.videoHeight;

        // Fallback si la cámara no reporta tamaño nativo todavía
        if (!videoWidth || !videoHeight) {
            videoWidth = this.videoElement.clientWidth || 640;
            videoHeight = this.videoElement.clientHeight || 480;
        }

        // La guía de escaneo es un cuadrado del 80% del menor lado en el centro
        const boxSize = Math.min(videoWidth, videoHeight) * 0.8;
        const sx = (videoWidth - boxSize) / 2;
        const sy = (videoHeight - boxSize) / 2;

        // Tamaño objetivo del canvas preprocesado (400x400 px es ideal para OCR veloz)
        canvas.width = 400;
        canvas.height = 400;

        // Dibujar el recorte en el canvas
        ctx.drawImage(this.videoElement, sx, sy, boxSize, boxSize, 0, 0, 400, 400);

        return canvas; // Retornamos el canvas recortado
    }

    /**
     * Aplica umbralización adaptativa local (Bradley-Roth) para binarizar la imagen.
     * Esto conserva bordes de números, ignora sombras y mejora enormemente el OCR.
     */
    adaptiveThreshold(data, width, height) {
        // 1. Convertir a escala de grises en array temporal
        const gray = new Uint8Array(width * height);
        for (let i = 0; i < data.length; i += 4) {
            gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        }

        // 2. Calcular imagen integral
        const integral = new Uint32Array(width * height);
        for (let x = 0; x < width; x++) {
            let sum = 0;
            for (let y = 0; y < height; y++) {
                const idx = y * width + x;
                sum += gray[idx];
                if (x === 0) {
                    integral[idx] = sum;
                } else {
                    integral[idx] = integral[idx - 1] + sum;
                }
            }
        }

        // 3. Umbralización adaptativa
        const S = Math.round(width / 8); // Ventana de vecindad
        const s2 = Math.round(S / 2);
        const T = 0.15; // Porcentaje de diferencia tolerado (15%)

        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                const idx = y * width + x;
                const x1 = Math.max(x - s2, 0);
                const x2 = Math.min(x + s2, width - 1);
                const y1 = Math.max(y - s2, 0);
                const y2 = Math.min(y + s2, height - 1);

                const count = (x2 - x1 + 1) * (y2 - y1 + 1);

                // Calcular suma de la ventana usando la imagen integral
                const idx_br = y2 * width + x2;
                const idx_tl = Math.max(y1 - 1, 0) * width + Math.max(x1 - 1, 0);
                const idx_tr = Math.max(y1 - 1, 0) * width + x2;
                const idx_bl = y2 * width + Math.max(x1 - 1, 0);

                let sum = integral[idx_br];
                if (x1 > 0 && y1 > 0) {
                    sum += integral[idx_tl] - integral[idx_tr] - integral[idx_bl];
                } else if (x1 > 0) {
                    sum -= integral[idx_bl];
                } else if (y1 > 0) {
                    sum -= integral[idx_tr];
                }

                // Binarizar: si es menor que el promedio local con tolerancia T, se vuelve negro (texto)
                const val = (gray[idx] * count) < (sum * (1.0 - T)) ? 0 : 255;
                const rgbaIdx = idx * 4;
                data[rgbaIdx] = val;
                data[rgbaIdx + 1] = val;
                data[rgbaIdx + 2] = val;
            }
        }
    }

    /**
     * Aplica el preprocesamiento completo (grises + binarización adaptativa) a un canvas.
     */
    preprocessCanvas(canvas) {
        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        this.adaptiveThreshold(imgData.data, canvas.width, canvas.height);
        ctx.putImageData(imgData, 0, 0);
    }

    async initTesseract(statusCallback) {
        if (typeof Tesseract === 'undefined') {
            console.warn("Tesseract.js no detectado. Activando OCR simulado.");
            if (statusCallback) statusCallback("OCR Listo (Simulado)");
            return;
        }
        if (this.tesseractWorker) return;
        if (this.isWorkerInitializing) return;

        this.isWorkerInitializing = true;
        if (statusCallback) statusCallback("Cargando OCR...");

        // Definir una promesa para iniciar el worker en línea
        const initOnlineWorker = async () => {
            const worker = await Tesseract.createWorker('eng', 1, {
                workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/worker.min.js',
                langPath: 'https://tessdata.projectnaptha.com/4.0.0',
                corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.2/tesseract-core.wasm.js'
            });
            
            await worker.setParameters({
                tessedit_char_whitelist: '0123456789LIBREfreeFREE '
            });
            return worker;
        };

        // Crear una promesa de timeout que se rechaza a los 4 segundos
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Timeout inicializando Tesseract en línea")), 4000)
        );

        try {
            // Intentar cargar en línea con un límite de tiempo
            this.tesseractWorker = await Promise.race([initOnlineWorker(), timeoutPromise]);
            if (statusCallback) statusCallback("OCR Listo");
        } catch (err) {
            console.warn("Fallo o timeout al inicializar Tesseract en línea, intentando fallback:", err);
            try {
                // Fallback a carga local/estándar por defecto
                this.tesseractWorker = await Tesseract.createWorker();
                await this.tesseractWorker.loadLanguage('eng');
                await this.tesseractWorker.initialize('eng');
                await this.tesseractWorker.setParameters({
                    tessedit_char_whitelist: '0123456789LIBREfreeFREE '
                });
                if (statusCallback) statusCallback("OCR Listo (Local)");
            } catch (fallbackErr) {
                console.error("Fallo total al cargar Tesseract.js:", fallbackErr);
                this.tesseractWorker = null;
                throw new Error("No se pudo cargar el motor OCR local.");
            }
        } finally {
            this.isWorkerInitializing = false;
        }
    }

    /**
     * Realiza OCR sobre un canvas y reconstruye la estructura 5x5 del cartón.
     */
    async scanBingoCard(canvas, statusCallback) {
        if (typeof Tesseract === 'undefined') {
            if (statusCallback) statusCallback("Escaneando (Simulado)...");
            await new Promise(resolve => setTimeout(resolve, 1200));

            // Palabras simuladas correspondientes al cartón dibujado en drawSimulatedCard
            const mockWords = [
                { text: "7", bbox: { x0: 30, y0: 80, x1: 50, y1: 100 } },
                { text: "18", bbox: { x0: 90, y0: 80, x1: 110, y1: 100 } },
                { text: "33", bbox: { x0: 150, y0: 80, x1: 170, y1: 100 } },
                { text: "48", bbox: { x0: 210, y0: 80, x1: 230, y1: 100 } },
                { text: "64", bbox: { x0: 270, y0: 80, x1: 290, y1: 100 } },
                
                { text: "12", bbox: { x0: 30, y0: 130, x1: 50, y1: 150 } },
                { text: "25", bbox: { x0: 90, y0: 130, x1: 110, y1: 150 } },
                { text: "37", bbox: { x0: 150, y0: 130, x1: 170, y1: 150 } },
                { text: "52", bbox: { x0: 210, y0: 130, x1: 230, y1: 150 } },
                { text: "70", bbox: { x0: 270, y0: 130, x1: 290, y1: 150 } },

                { text: "4", bbox: { x0: 30, y0: 180, x1: 50, y1: 200 } },
                { text: "20", bbox: { x0: 90, y0: 180, x1: 110, y1: 200 } },
                { text: "LIBRE", bbox: { x0: 150, y0: 180, x1: 170, y1: 200 } },
                { text: "55", bbox: { x0: 210, y0: 180, x1: 230, y1: 200 } },
                { text: "66", bbox: { x0: 270, y0: 180, x1: 290, y1: 200 } },

                { text: "9", bbox: { x0: 30, y0: 230, x1: 50, y1: 250 } },
                { text: "29", bbox: { x0: 90, y0: 230, x1: 110, y1: 250 } },
                { text: "41", bbox: { x0: 150, y0: 230, x1: 170, y1: 250 } },
                { text: "59", bbox: { x0: 210, y0: 230, x: 230, y: 250 } },
                { text: "73", bbox: { x0: 270, y: 230, x: 290, y: 250 } },

                { text: "14", bbox: { x0: 30, y: 280, x: 50, y: 300 } },
                { text: "22", bbox: { x0: 90, y: 280, x: 110, y: 300 } },
                { text: "45", bbox: { x0: 150, y: 280, x: 170, y: 300 } },
                { text: "61", bbox: { x0: 210, y: 280, x: 230, y: 300 } },
                { text: "68", bbox: { x0: 270, y: 280, x: 290, y: 300 } }
            ];
            return this.reconstructGrid(mockWords);
        }

        if (statusCallback) statusCallback("Preprocesando imagen...");
        this.preprocessCanvas(canvas);

        await this.initTesseract(statusCallback);
        if (statusCallback) statusCallback("Escaneando números...");

        try {
            const result = await this.tesseractWorker.recognize(canvas);
            const words = result.data.words;
            
            return this.reconstructGrid(words);
        } catch (err) {
            console.error("Error durante reconocimiento OCR: ", err);
            throw err;
        }
    }

    /**
     * Incrementa el contraste de la imagen para mejorar la lectura de números con trazos finos.
     * Mapea el rango de grises presente del mínimo al máximo para ocupar todo el rango [0, 255].
     */
    contrastStretch(data, width, height) {
        let min = 255, max = 0;
        const grays = new Uint8Array(width * height);
        for (let i = 0; i < data.length; i += 4) {
            const g = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            grays[i / 4] = g;
            if (g < min) min = g;
            if (g > max) max = g;
        }

        const range = max - min;
        if (range > 0) {
            for (let i = 0; i < data.length; i += 4) {
                const g = grays[i / 4];
                const val = Math.round(((g - min) / range) * 255);
                data[i] = val;
                data[i + 1] = val;
                data[i + 2] = val;
            }
        }
    }

    /**
     * Realiza OCR con un proceso de doble verificación en dos pases independientes
     * con preprocesamiento adaptativo y ajuste de contraste, respectivamente.
     */
    async scanBingoCardDoubleVerification(canvas, statusCallback) {
        if (this.isSimulated || typeof Tesseract === 'undefined') {
            if (statusCallback) statusCallback("Verificación: Pase 1 (Simulado)...");
            await new Promise(resolve => setTimeout(resolve, 800));
            if (statusCallback) statusCallback("Verificación: Pase 2 (Simulado)...");
            await new Promise(resolve => setTimeout(resolve, 800));

            const grid = [
                [7, 18, 33, 48, 64],
                ["", 25, 37, 52, 70],
                [4, 20, "LIBRE", 55, 66],
                [9, 29, 41, 59, 73],
                [14, 22, 45, 61, 68]
            ];

            const statuses = [
                ["verified", "verified", "verified", "conflict", "verified"],
                ["empty", "verified", "detected", "verified", "verified"],
                ["verified", "verified", "verified", "verified", "verified"],
                ["verified", "conflict", "verified", "verified", "verified"],
                ["verified", "verified", "verified", "verified", "verified"]
            ];

            return { grid, statuses };
        }

        // 1. Pase A: Adaptativo Bradley-Roth
        if (statusCallback) statusCallback("Pase 1: Umbralización adaptativa...");
        const canvasA = document.createElement('canvas');
        canvasA.width = canvas.width;
        canvasA.height = canvas.height;
        const ctxA = canvasA.getContext('2d');
        ctxA.drawImage(canvas, 0, 0);
        this.preprocessCanvas(canvasA);

        await this.initTesseract(statusCallback);
        const resultA = await this.tesseractWorker.recognize(canvasA);
        const wordsA = resultA.data.words || [];
        const gridA = this.reconstructGridRaw(wordsA);

        // 2. Pase B: Contraste Grayscale
        if (statusCallback) statusCallback("Pase 2: Optimización de contraste...");
        const canvasB = document.createElement('canvas');
        canvasB.width = canvas.width;
        canvasB.height = canvas.height;
        const ctxB = canvasB.getContext('2d');
        ctxB.drawImage(canvas, 0, 0);
        
        const imgDataB = ctxB.getImageData(0, 0, canvasB.width, canvasB.height);
        this.contrastStretch(imgDataB.data, canvasB.width, canvasB.height);
        ctxB.putImageData(imgDataB, 0, 0);

        const resultB = await this.tesseractWorker.recognize(canvasB);
        const wordsB = resultB.data.words || [];
        const gridB = this.reconstructGridRaw(wordsB);

        // 3. Cruzar resultados
        const finalGrid = Array(5).fill(null).map(() => Array(5).fill(""));
        const statuses = Array(5).fill(null).map(() => Array(5).fill(""));

        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                if (r === 2 && c === 2) {
                    finalGrid[r][c] = "LIBRE";
                    statuses[r][c] = "verified";
                    continue;
                }

                const cellA = gridA[r][c];
                const cellB = gridB[r][c];

                const valA = cellA.value;
                const valB = cellB.value;

                if (valA !== "" && valB !== "") {
                    if (valA === valB) {
                        finalGrid[r][c] = valA;
                        statuses[r][c] = "verified";
                    } else {
                        // Conflicto de valores detectado
                        // Usar el de mayor confianza
                        if (cellA.confidence >= cellB.confidence) {
                            finalGrid[r][c] = valA;
                        } else {
                            finalGrid[r][c] = valB;
                        }
                        statuses[r][c] = "conflict";
                    }
                } else if (valA !== "") {
                    finalGrid[r][c] = valA;
                    statuses[r][c] = "detected";
                } else if (valB !== "") {
                    finalGrid[r][c] = valB;
                    statuses[r][c] = "detected";
                } else {
                    finalGrid[r][c] = "";
                    statuses[r][c] = "empty";
                }
            }
        }

        return { grid: finalGrid, statuses: statuses };
    }

    /**
     * Reconstruye la cuadrícula pero sin rellenar los vacíos y manteniendo la confianza del OCR
     */
    reconstructGridRaw(ocrWords) {
        const grid = Array(5).fill(null).map(() => Array(5).fill(null).map(() => ({ value: "", confidence: 0 })));

        // 1. Filtrar palabras válidas, ignorando la cabecera BINGO
        const validWords = [];
        ocrWords.forEach(w => {
            if (!w.text || !w.bbox) return;
            const cy = (w.bbox.y0 + w.bbox.y1) / 2;
            if (cy < 45) return; // Ignorar encabezado
            validWords.push(w);
        });

        if (validWords.length === 0) {
            return grid;
        }

        // 2. Agrupamiento por columnas usando 1D K-means determinista
        const initialCols = Array(5).fill(null).map(() => []);
        validWords.forEach(w => {
            const cx = (w.bbox.x0 + w.bbox.x1) / 2;
            let colIdx = Math.floor(cx / 80);
            colIdx = Math.max(0, Math.min(4, colIdx));
            initialCols[colIdx].push(cx);
        });

        const colCenters = Array(5).fill(0);
        for (let i = 0; i < 5; i++) {
            if (initialCols[i].length > 0) {
                colCenters[i] = initialCols[i].reduce((sum, val) => sum + val, 0) / initialCols[i].length;
            } else {
                colCenters[i] = -1;
            }
        }

        let firstKnownCol = -1;
        for (let i = 0; i < 5; i++) {
            if (colCenters[i] !== -1) {
                firstKnownCol = i;
                break;
            }
        }

        if (firstKnownCol === -1) {
            for (let i = 0; i < 5; i++) {
                colCenters[i] = 40 + i * 80;
            }
        } else {
            let colWidth = 80;
            let widthSum = 0;
            let widthCount = 0;
            for (let i = 0; i < 4; i++) {
                if (colCenters[i] !== -1 && colCenters[i+1] !== -1) {
                    widthSum += (colCenters[i+1] - colCenters[i]);
                    widthCount++;
                }
            }
            if (widthCount > 0) {
                colWidth = widthSum / widthCount;
            }

            for (let i = 0; i < 5; i++) {
                if (colCenters[i] === -1) {
                    colCenters[i] = colCenters[firstKnownCol] + (i - firstKnownCol) * colWidth;
                }
            }
        }

        // 3. Agrupamiento por filas usando 1D K-means determinista
        const initialRows = Array(5).fill(null).map(() => []);
        validWords.forEach(w => {
            const cy = (w.bbox.y0 + w.bbox.y1) / 2;
            let rowIdx = Math.floor((cy - 50) / 70);
            rowIdx = Math.max(0, Math.min(4, rowIdx));
            initialRows[rowIdx].push(cy);
        });

        const rowCenters = Array(5).fill(0);
        for (let i = 0; i < 5; i++) {
            if (initialRows[i].length > 0) {
                rowCenters[i] = initialRows[i].reduce((sum, val) => sum + val, 0) / initialRows[i].length;
            } else {
                rowCenters[i] = -1;
            }
        }

        let firstKnownRow = -1;
        for (let i = 0; i < 5; i++) {
            if (rowCenters[i] !== -1) {
                firstKnownRow = i;
                break;
            }
        }

        if (firstKnownRow === -1) {
            for (let i = 0; i < 5; i++) {
                rowCenters[i] = 85 + i * 70;
            }
        } else {
            let rowHeight = 70;
            let heightSum = 0;
            let heightCount = 0;
            for (let i = 0; i < 4; i++) {
                if (rowCenters[i] !== -1 && rowCenters[i+1] !== -1) {
                    heightSum += (rowCenters[i+1] - rowCenters[i]);
                    heightCount++;
                }
            }
            if (heightCount > 0) {
                rowHeight = heightSum / heightCount;
            }

            for (let i = 0; i < 5; i++) {
                if (rowCenters[i] === -1) {
                    rowCenters[i] = rowCenters[firstKnownRow] + (i - firstKnownRow) * rowHeight;
                }
            }
        }

        // 4. Asignar palabras a su celda correspondiente
        const cellWords = Array(5).fill(null).map(() => Array(5).fill(null).map(() => []));
        validWords.forEach(w => {
            const cx = (w.bbox.x0 + w.bbox.x1) / 2;
            const cy = (w.bbox.y0 + w.bbox.y1) / 2;

            let bestCol = 0;
            let minColDist = Infinity;
            for (let i = 0; i < 5; i++) {
                const dist = Math.abs(cx - colCenters[i]);
                if (dist < minColDist) {
                    minColDist = dist;
                    bestCol = i;
                }
            }

            let bestRow = 0;
            let minRowDist = Infinity;
            for (let i = 0; i < 5; i++) {
                const dist = Math.abs(cy - rowCenters[i]);
                if (dist < minRowDist) {
                    minRowDist = dist;
                    bestRow = i;
                }
            }

            cellWords[bestRow][bestCol].push(w);
        });

        // 5. Procesar celdas
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                if (r === 2 && c === 2) {
                    grid[r][c] = { value: "LIBRE", confidence: 100 };
                    continue;
                }

                const wordsInCell = cellWords[r][c];
                if (wordsInCell.length === 0) {
                    grid[r][c] = { value: "", confidence: 0 };
                    continue;
                }

                wordsInCell.sort((a, b) => a.bbox.x0 - b.bbox.x0);
                const combinedText = wordsInCell.map(w => w.text).join("");
                const avgConf = wordsInCell.reduce((sum, w) => sum + (w.confidence || 0), 0) / wordsInCell.length;
                const upperText = combinedText.toUpperCase();

                const isLibre = upperText.includes("LIBRE") || 
                                upperText.includes("L1BRE") || 
                                upperText.includes("LIBR") || 
                                upperText.includes("IBRE") || 
                                upperText.includes("FREE") || 
                                upperText.includes("FR33") || 
                                upperText.includes("FRE");

                if (isLibre) {
                    grid[r][c] = { value: "LIBRE", confidence: avgConf };
                } else {
                    const correctedNum = this.correctNumberForColumn(combinedText, c);
                    if (correctedNum !== null) {
                        grid[r][c] = { value: correctedNum, confidence: avgConf };
                    } else {
                        grid[r][c] = { value: "", confidence: 0 };
                    }
                }
            }
        }

        return grid;
    }
    /**
     * Algoritmo de Reconstrucción Inteligente de Cuadrícula Bingo 5x5
     * Clasifica palabras con números por coordenadas 2D e integra las reglas del juego.
     */
    reconstructGrid(ocrWords) {
        const grid = Array(5).fill(null).map(() => Array(5).fill(""));
        
        // 1. Filtrar palabras válidas, ignorando la cabecera BINGO
        const validWords = [];
        ocrWords.forEach(w => {
            if (!w.text || !w.bbox) return;
            const cy = (w.bbox.y0 + w.bbox.y1) / 2;
            if (cy < 45) return; // Ignorar encabezado
            validWords.push(w);
        });

        if (validWords.length === 0) {
            this.fillEmptyCells(grid);
            return grid;
        }

        // 2. Agrupamiento por columnas usando 1D K-means determinista
        const initialCols = Array(5).fill(null).map(() => []);
        validWords.forEach(w => {
            const cx = (w.bbox.x0 + w.bbox.x1) / 2;
            let colIdx = Math.floor(cx / 80);
            colIdx = Math.max(0, Math.min(4, colIdx));
            initialCols[colIdx].push(cx);
        });

        const colCenters = Array(5).fill(0);
        for (let i = 0; i < 5; i++) {
            if (initialCols[i].length > 0) {
                colCenters[i] = initialCols[i].reduce((sum, val) => sum + val, 0) / initialCols[i].length;
            } else {
                colCenters[i] = -1;
            }
        }

        let firstKnownCol = -1;
        for (let i = 0; i < 5; i++) {
            if (colCenters[i] !== -1) {
                firstKnownCol = i;
                break;
            }
        }

        if (firstKnownCol === -1) {
            for (let i = 0; i < 5; i++) {
                colCenters[i] = 40 + i * 80;
            }
        } else {
            let colWidth = 80;
            let widthSum = 0;
            let widthCount = 0;
            for (let i = 0; i < 4; i++) {
                if (colCenters[i] !== -1 && colCenters[i+1] !== -1) {
                    widthSum += (colCenters[i+1] - colCenters[i]);
                    widthCount++;
                }
            }
            if (widthCount > 0) {
                colWidth = widthSum / widthCount;
            }

            for (let i = 0; i < 5; i++) {
                if (colCenters[i] === -1) {
                    colCenters[i] = colCenters[firstKnownCol] + (i - firstKnownCol) * colWidth;
                }
            }
        }

        // 3. Agrupamiento por filas usando 1D K-means determinista
        const initialRows = Array(5).fill(null).map(() => []);
        validWords.forEach(w => {
            const cy = (w.bbox.y0 + w.bbox.y1) / 2;
            let rowIdx = Math.floor((cy - 50) / 70);
            rowIdx = Math.max(0, Math.min(4, rowIdx));
            initialRows[rowIdx].push(cy);
        });

        const rowCenters = Array(5).fill(0);
        for (let i = 0; i < 5; i++) {
            if (initialRows[i].length > 0) {
                rowCenters[i] = initialRows[i].reduce((sum, val) => sum + val, 0) / initialRows[i].length;
            } else {
                rowCenters[i] = -1;
            }
        }

        let firstKnownRow = -1;
        for (let i = 0; i < 5; i++) {
            if (rowCenters[i] !== -1) {
                firstKnownRow = i;
                break;
            }
        }

        if (firstKnownRow === -1) {
            for (let i = 0; i < 5; i++) {
                rowCenters[i] = 85 + i * 70;
            }
        } else {
            let rowHeight = 70;
            let heightSum = 0;
            let heightCount = 0;
            for (let i = 0; i < 4; i++) {
                if (rowCenters[i] !== -1 && rowCenters[i+1] !== -1) {
                    heightSum += (rowCenters[i+1] - rowCenters[i]);
                    heightCount++;
                }
            }
            if (heightCount > 0) {
                rowHeight = heightSum / heightCount;
            }

            for (let i = 0; i < 5; i++) {
                if (rowCenters[i] === -1) {
                    rowCenters[i] = rowCenters[firstKnownRow] + (i - firstKnownRow) * rowHeight;
                }
            }
        }

        // 4. Asignar palabras a su celda correspondiente
        const cellWords = Array(5).fill(null).map(() => Array(5).fill(null).map(() => []));
        validWords.forEach(w => {
            const cx = (w.bbox.x0 + w.bbox.x1) / 2;
            const cy = (w.bbox.y0 + w.bbox.y1) / 2;

            let bestCol = 0;
            let minColDist = Infinity;
            for (let i = 0; i < 5; i++) {
                const dist = Math.abs(cx - colCenters[i]);
                if (dist < minColDist) {
                    minColDist = dist;
                    bestCol = i;
                }
            }

            let bestRow = 0;
            let minRowDist = Infinity;
            for (let i = 0; i < 5; i++) {
                const dist = Math.abs(cy - rowCenters[i]);
                if (dist < minRowDist) {
                    minRowDist = dist;
                    bestRow = i;
                }
            }

            cellWords[bestRow][bestCol].push(w);
        });

        // 5. Procesar celdas
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                if (r === 2 && c === 2) {
                    grid[r][c] = "LIBRE";
                    continue;
                }

                const wordsInCell = cellWords[r][c];
                if (wordsInCell.length === 0) {
                    grid[r][c] = "";
                    continue;
                }

                // Concatenar de izquierda a derecha por si se dividió el número
                wordsInCell.sort((a, b) => a.bbox.x0 - b.bbox.x0);
                const combinedText = wordsInCell.map(w => w.text).join("");
                const upperText = combinedText.toUpperCase();

                const isLibre = upperText.includes("LIBRE") || 
                                upperText.includes("L1BRE") || 
                                upperText.includes("LIBR") || 
                                upperText.includes("IBRE") || 
                                upperText.includes("FREE") || 
                                upperText.includes("FR33") || 
                                upperText.includes("FRE");

                if (isLibre) {
                    grid[r][c] = "LIBRE";
                } else {
                    const correctedNum = this.correctNumberForColumn(combinedText, c);
                    if (correctedNum !== null) {
                        grid[r][c] = correctedNum;
                    } else {
                        grid[r][c] = "";
                    }
                }
            }
        }

        this.fillEmptyCells(grid);

        return grid;
    }

    /**
     * Corrige y valida un número detectado por OCR según su columna en un cartón de bingo de 75 bolas.
     * Rango de columnas:
     * - B (col 0): 1-15
     * - I (col 1): 16-30
     * - N (col 2): 31-45
     * - G (col 3): 46-60
     * - O (col 4): 61-75
     * Retorna el número entero corregido, o null si no se puede corregir al rango de la columna.
     */
    correctNumberForColumn(text, colIdx) {
        if (!text) return null;

        // Limpiar el texto de caracteres no numéricos
        let cleanText = text.replace(/[^0-9]/g, '');
        if (cleanText === '') return null;

        let num = parseInt(cleanText, 10);

        // Rangos para cada columna
        const ranges = [
            { min: 1, max: 15 },   // Col 0: B
            { min: 16, max: 30 },  // Col 1: I
            { min: 31, max: 45 },  // Col 2: N
            { min: 46, max: 60 },  // Col 3: G
            { min: 61, max: 75 }   // Col 4: O
        ];

        const range = ranges[colIdx];
        if (!range) return null;

        // Si ya está en el rango correcto, retornarlo directamente
        if (num >= range.min && num <= range.max) {
            return num;
        }

        // --- SISTEMA INTELIGENTE DE CORRECCIÓN DE ERRORES OCR ---
        // A veces el OCR lee dígitos de más o de menos, o confunde números.
        
        // 1. Si el número tiene 3 o más dígitos y el primero o el último es un "1" o "0" mal interpretado
        // intentamos recortarlo.
        let numStr = num.toString();
        if (numStr.length > 2) {
            // Probar recortar primer dígito
            let tryNum1 = parseInt(numStr.substring(1), 10);
            if (tryNum1 >= range.min && tryNum1 <= range.max) {
                return tryNum1;
            }
            // Probar recortar último dígito
            let tryNum2 = parseInt(numStr.substring(0, numStr.length - 1), 10);
            if (tryNum2 >= range.min && tryNum2 <= range.max) {
                return tryNum2;
            }
        }

        // 2. Si el número tiene 1 dígito pero la columna requiere 2 dígitos (columnas 1, 2, 3, 4)
        if (numStr.length === 1 && colIdx > 0) {
            if (colIdx === 1) { // 16-30
                if (10 + num >= 16 && 10 + num <= 30) return 10 + num;
                if (20 + num >= 16 && 20 + num <= 30) return 20 + num;
            } else if (colIdx === 2) { // 31-45
                if (30 + num >= 31 && 30 + num <= 45) return 30 + num;
                if (40 + num >= 31 && 40 + num <= 45) return 40 + num;
            } else if (colIdx === 3) { // 46-60
                if (40 + num >= 46 && 40 + num <= 60) return 40 + num;
                if (50 + num >= 46 && 50 + num <= 60) return 50 + num;
            } else if (colIdx === 4) { // 61-75
                if (60 + num >= 61 && 60 + num <= 75) return 60 + num;
                if (70 + num >= 61 && 70 + num <= 75) return 70 + num;
            }
        }
        
        return null;
    }

    /**
     * Rellena las celdas que el OCR no detectó con valores aleatorios válidos para ese rango
     * para asegurar que el usuario tenga un cartón completo antes de la edición manual.
     */
    fillEmptyCells(grid) {
        const ranges = [
            { min: 1, max: 15 },   // B
            { min: 16, max: 30 },  // I
            { min: 31, max: 45 },  // N
            { min: 46, max: 60 },  // G
            { min: 61, max: 75 }   // O
        ];

        for (let col = 0; col < 5; col++) {
            const range = ranges[col];
            // Obtener números ya usados en esta columna del cartón
            const used = [];
            for (let row = 0; row < 5; row++) {
                const val = parseInt(grid[row][col], 10);
                if (!isNaN(val)) used.push(val);
            }

            for (let row = 0; row < 5; row++) {
                if (row === 2 && col === 2) {
                    grid[row][col] = "LIBRE";
                    continue;
                }
                
                if (grid[row][col] === "") {
                    // Generar un aleatorio no repetido
                    let attempts = 0;
                    let randNum;
                    do {
                        randNum = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
                        attempts++;
                    } while (used.includes(randNum) && attempts < 100);
                    
                    grid[row][col] = randNum;
                    used.push(randNum);
                }
            }
        }
    }

    /**
     * Genera un cartón de Bingo 100% aleatorio válido (útil para pruebas o carga manual rápida).
     */
    generateRandomCardGrid() {
        const grid = Array(5).fill(null).map(() => Array(5).fill(""));
        this.fillEmptyCells(grid);
        return grid;
    }

    /**
     * Dibuja un cartón físico realista en el canvas simulado para propósitos de demostración.
     */
    drawSimulatedCard(canvas) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        // Dibujar fondo oscuro de mesa
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, w, h);

        // Dibujar papel del cartón de bingo inclinado ligeramente
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(0.03); // pequeña rotación real
        
        const cardSize = 290;
        ctx.fillStyle = '#ffffff';
        
        // Sombra realista
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 6;
        ctx.fillRect(-cardSize / 2, -cardSize / 2, cardSize, cardSize);
        ctx.shadowColor = 'transparent'; // limpiar sombras

        // Cabecera BINGO
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 20px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const cols = ['B', 'I', 'N', 'G', 'O'];
        const startY = -cardSize / 2 + 25;
        const colWidth = cardSize / 5;
        
        for (let c = 0; c < 5; c++) {
            const cx = -cardSize / 2 + (c * colWidth) + colWidth / 2;
            ctx.fillText(cols[c], cx, startY);
        }

        // Rejilla
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;
        const gridStartY = -cardSize / 2 + 50;
        const cellSize = (cardSize - 50) / 5;

        // Líneas horizontales
        for (let r = 0; r <= 5; r++) {
            ctx.beginPath();
            ctx.moveTo(-cardSize / 2, gridStartY + r * cellSize);
            ctx.lineTo(cardSize / 2, gridStartY + r * cellSize);
            ctx.stroke();
        }
        // Líneas verticales
        for (let c = 0; c <= 5; c++) {
            ctx.beginPath();
            ctx.moveTo(-cardSize / 2 + c * colWidth, gridStartY);
            ctx.lineTo(-cardSize / 2 + c * colWidth, gridStartY + 5 * cellSize);
            ctx.stroke();
        }

        // Rellenar números (ejemplo de la especificación)
        const numbers = [
            [7, 18, 33, 48, 64],
            [12, 25, 37, 52, 70],
            [4, 20, "LIBRE", 55, 66],
            [9, 29, 41, 59, 73],
            [14, 22, 45, 61, 68]
        ];

        ctx.fillStyle = '#0f172a';
        
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                const val = numbers[r][c];
                const cx = -cardSize / 2 + (c * colWidth) + colWidth / 2;
                const cy = gridStartY + (r * cellSize) + cellSize / 2;
                
                if (val === "LIBRE") {
                    ctx.fillStyle = '#ec4899';
                    ctx.font = 'bold 8px Arial, sans-serif';
                    ctx.fillText("LIBRE", cx, cy);
                    ctx.fillStyle = '#0f172a';
                } else {
                    ctx.font = 'bold 16px Arial, sans-serif';
                    ctx.fillText(val.toString(), cx, cy);
                }
            }
        }

        ctx.restore();
    }
}

// Exportar instancia global
window.ocrService = new OcrService();
