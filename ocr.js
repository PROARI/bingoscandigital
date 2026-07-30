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

        try {
            // Crear el worker indicando que use la versión en español/inglés
            this.tesseractWorker = await Tesseract.createWorker('spa', 1, {
                workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/worker.min.js',
                langPath: 'https://tessdata.projectnaptha.com/4.0.0',
                corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.2/tesseract-core.wasm.js'
            });
            
            await this.tesseractWorker.setParameters({
                tessedit_char_whitelist: '0123456789LIBREfreeFREE '
            });

            if (statusCallback) statusCallback("OCR Listo");
        } catch (err) {
            console.error("Fallo al inicializar Tesseract en línea, intentando fallback local:", err);
            try {
                // Fallback simplificado a carga por defecto si las rutas personalizadas fallan offline
                this.tesseractWorker = await Tesseract.createWorker();
                await this.tesseractWorker.loadLanguage('spa');
                await this.tesseractWorker.initialize('spa');
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
