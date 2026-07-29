/* BINGO SCAN DIGITAL - MOTOR OCR Y CONTROL DE CÁMARA */

class OcrService {
    constructor() {
        this.stream = null;
        this.videoElement = null;
        this.tesseractWorker = null;
        this.isWorkerInitializing = false;
    }

    /**
     * Inicia la transmisión de la cámara en el elemento de video dado.
     */
    async startCamera(videoElement) {
        this.videoElement = videoElement;
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
            console.error("Error al iniciar cámara: ", err);
            // Intentar cualquier cámara disponible si la trasera falla
            try {
                this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                this.videoElement.srcObject = this.stream;
                await this.videoElement.play();
                return true;
            } catch (innerErr) {
                console.error("Fallo total de cámara: ", innerErr);
                return false;
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
        if (!this.videoElement || !this.stream) return null;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const videoWidth = this.videoElement.videoWidth;
        const videoHeight = this.videoElement.videoHeight;

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

    /**
     * Inicializa el Worker de Tesseract.js (soporta offline si está cacheado).
     */
    async initTesseract(statusCallback) {
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

        detectedNumbers.forEach(item => {
            if (item.val === "LIBRE") {
                colN.push(item);
            } else if (item.val >= 1 && item.val <= 15) {
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
}

// Exportar instancia global
window.ocrService = new OcrService();
