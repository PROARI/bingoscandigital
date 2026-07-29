/* BINGO SCAN DIGITAL - MOTOR OCR Y CONTROL DE CÁMARA */

class OcrService {
    constructor() {
        this.stream = null;
        this.videoElement = null;
        this.simulatorCanvas = null;
        this.tesseractWorker = null;
        this.isWorkerInitializing = false;
        this.isSimulated = false;
    }

    /**
     * Inicia la transmisión de la cámara en el elemento de video dado.
     */
    async startCamera(videoElement, simulatorCanvas) {
        this.videoElement = videoElement;
        this.simulatorCanvas = simulatorCanvas;
        this.isSimulated = false;

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
            return true;
        } catch (err) {
            console.warn("Fallo cámara trasera, intentando genérica...", err);
            // Intentar cualquier cámara disponible si la trasera falla
            try {
                this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                this.videoElement.srcObject = this.stream;
                await this.videoElement.play();
                return true;
            } catch (innerErr) {
                console.error("Fallo total de cámara, activando simulador...", innerErr);
                this.isSimulated = true;
                if (this.videoElement) this.videoElement.classList.add('hidden');
                if (this.simulatorCanvas) {
                    this.simulatorCanvas.classList.remove('hidden');
                    this.drawSimulatedCard(this.simulatorCanvas);
                }
                return true; // Retornar true para habilitar el flujo con simulador
            }
        }
    }

    /**
     * Detiene la transmisión de la cámara.
     */
    stopCamera() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        if (this.videoElement) {
            this.videoElement.srcObject = null;
        }
    }

    /**
     * Captura el frame actual de video, recorta la región del recuadro
     * y realiza un preprocesamiento de contraste y escala de grises.
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

        // Preprocesar imagen: Grayscale + Umbralización (Binarización) + Contraste
        const imgData = ctx.getImageData(0, 0, 400, 400);
        const data = imgData.data;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // Fórmula de luminancia para escala de grises
            let gray = 0.299 * r + 0.587 * g + 0.114 * b;

            // Binarización adaptativa simple (umbral en 120)
            // Si es más oscuro de 120, se vuelve negro (0), de lo contrario blanco (255)
            const threshold = 120;
            const finalVal = gray < threshold ? 0 : 255;

            data[i] = finalVal;     // R
            data[i + 1] = finalVal; // G
            data[i + 2] = finalVal; // B
        }

        ctx.putImageData(imgData, 0, 0);
        return canvas; // Retornamos el canvas procesado listo para OCR
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

        try {
            // Crear el worker indicando que use la versión en español/inglés
            this.tesseractWorker = await Tesseract.createWorker('spa', 1, {
                workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/worker.min.js',
                langPath: 'https://tessdata.projectnaptha.com/4.0.0',
                corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.2/tesseract-core.wasm.js'
            });
            
            if (statusCallback) statusCallback("OCR Listo");
        } catch (err) {
            console.error("Fallo al inicializar Tesseract en línea, intentando fallback local:", err);
            try {
                // Fallback simplificado a carga por defecto si las rutas personalizadas fallan offline
                this.tesseractWorker = await Tesseract.createWorker();
                await this.tesseractWorker.loadLanguage('spa');
                await this.tesseractWorker.initialize('spa');
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
                { text: "59", bbox: { x0: 210, y0: 230, x1: 230, y1: 250 } },
                { text: "73", bbox: { x0: 270, y0: 230, x1: 290, y1: 250 } },

                { text: "14", bbox: { x0: 30, y0: 280, x1: 50, y1: 300 } },
                { text: "22", bbox: { x0: 90, y0: 280, x1: 110, y1: 300 } },
                { text: "45", bbox: { x0: 150, y0: 280, x1: 170, y1: 300 } },
                { text: "61", bbox: { x0: 210, y0: 280, x1: 230, y1: 300 } },
                { text: "68", bbox: { x0: 270, y0: 280, x: 290, y: 300 } }
            ];
            return this.reconstructGrid(mockWords);
        }

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
     * Algoritmo de Reconstrucción Inteligente de Cuadrícula Bingo 5x5
     * Clasifica palabras con números por coordenadas e integra las reglas del juego.
     */
    reconstructGrid(ocrWords) {
        // Matriz vacía 5x5
        const grid = Array(5).fill(null).map(() => Array(5).fill(""));
        
        // 1. Filtrar palabras que contengan números válidos (1-75) y guardar su posición
        const detectedNumbers = [];
        ocrWords.forEach(w => {
            // Limpiar texto para buscar números
            const cleanText = w.text.replace(/[^0-9]/g, '');
            const num = parseInt(cleanText, 10);
            
            if (!isNaN(num) && num >= 1 && num <= 75) {
                detectedNumbers.push({
                    val: num,
                    x: (w.bbox.x0 + w.bbox.x1) / 2, // Centro X
                    y: (w.bbox.y0 + w.bbox.y1) / 2  // Centro Y
                });
            } else if (w.text.toLowerCase().includes("lib") || w.text.toLowerCase().includes("fre")) {
                detectedNumbers.push({
                    val: "LIBRE",
                    x: (w.bbox.x0 + w.bbox.x1) / 2,
                    y: (w.bbox.y0 + w.bbox.y1) / 2
                });
            }
        });

        // 2. Clasificar los números detectados en sus columnas de Bingo por su VALOR (Lógica del Juego)
        // Esto corrige automáticamente los errores de inclinación del papel
        const colB = []; // 1-15
        const colI = []; // 16-30
        const colN = []; // 31-45 (y "LIBRE")
        const colG = []; // 46-60
        const colO = []; // 61-75

        const seenValues = new Set();
        detectedNumbers.forEach(item => {
            if (item.val === "LIBRE") {
                colN.push(item);
            } else {
                if (seenValues.has(item.val)) return; // Evitar números duplicados en el cartón
                seenValues.add(item.val);

                if (item.val >= 1 && item.val <= 15) {
                    colB.push(item);
                } else if (item.val >= 16 && item.val <= 30) {
                    colI.push(item);
                } else if (item.val >= 31 && item.val <= 45) {
                    colN.push(item);
                } else if (item.val >= 46 && item.val <= 60) {
                    colG.push(item);
                } else if (item.val >= 61 && item.val <= 75) {
                    colO.push(item);
                }
            }
        });

        // 3. Para cada columna, ordenar los elementos de arriba a abajo usando su coordenada Y
        const sortCoordsY = (a, b) => a.y - b.y;
        colB.sort(sortCoordsY);
        colI.sort(sortCoordsY);
        colN.sort(sortCoordsY);
        colG.sort(sortCoordsY);
        colO.sort(sortCoordsY);

        // 4. Asignar los elementos ordenados a las filas correspondientes de la matriz 5x5
        // Nota: El centro (fila 2, columna 2) es siempre "LIBRE" (FREE)
        for (let row = 0; row < 5; row++) {
            // Columna B (col 0)
            if (colB[row]) grid[row][0] = colB[row].val;
            
            // Columna I (col 1)
            if (colI[row]) grid[row][1] = colI[row].val;
            
            // Columna N (col 2)
            if (row === 2) {
                grid[row][2] = "LIBRE";
            } else {
                // Tomar el elemento de colN correspondiente (cuidado con no pisar el centro)
                const nIndex = row > 2 ? row - 1 : row;
                if (colN[nIndex]) grid[row][2] = colN[nIndex].val;
            }

            // Columna G (col 3)
            if (colG[row]) grid[row][3] = colG[row].val;

            // Columna O (col 4)
            if (colO[row]) grid[row][4] = colO[row].val;
        }

        // 5. Autocompletar casillas vacías con números válidos aleatorios para evitar celdas rotas
        this.fillEmptyCells(grid);

        return grid;
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
