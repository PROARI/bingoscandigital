/* BINGO SCAN DIGITAL - MÓDULO DE RECONOCIMIENTO DE VOZ */

class VoiceService {
    constructor() {
        this.recognition = null;
        this.isListening = false;
        this.onNumberDetectedCallback = null;
        this.onStatusChangeCallback = null;
        this.onTranscriptCallback = null;
        this.continuousPref = true;

        this.initRecognition();
    }

    /**
     * Inicializa el motor de Speech Recognition si es compatible con el navegador.
     */
    initRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn("Speech Recognition API no soportada en este navegador.");
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'es-ES';
        this.recognition.continuous = true;
        this.recognition.interimResults = false;
        this.recognition.maxAlternatives = 1;

        this.recognition.onstart = () => {
            this.isListening = true;
            if (this.onStatusChangeCallback) this.onStatusChangeCallback(true);
        };

        this.recognition.onend = () => {
            // Si el servicio debe estar escuchando y se detiene automáticamente, reiniciarlo
            if (this.isListening && this.continuousPref) {
                try {
                    this.recognition.start();
                } catch (e) {
                    console.error("Error al reiniciar reconocimiento de voz:", e);
                }
            } else {
                this.isListening = false;
                if (this.onStatusChangeCallback) this.onStatusChangeCallback(false);
            }
        };

        this.recognition.onerror = (event) => {
            console.error("Error de reconocimiento de voz:", event.error);
            if (event.error === 'not-allowed') {
                this.isListening = false;
                if (this.onStatusChangeCallback) this.onStatusChangeCallback(false);
            }
        };

        this.recognition.onresult = (event) => {
            const transcript = event.results[event.results.length - 1][0].transcript;
            console.log("Audio detectado:", transcript);
            
            if (this.onTranscriptCallback) {
                this.onTranscriptCallback(transcript);
            }

            this.parseSpeechTranscript(transcript);
        };
    }

    /**
     * Inicia la escucha de voz.
     */
    start() {
        if (!this.recognition) return false;
        if (this.isListening) return true;

        try {
            this.recognition.start();
            return true;
        } catch (e) {
            console.error("No se pudo iniciar la voz:", e);
            return false;
        }
    }

    /**
     * Detiene la escucha de voz.
     */
    stop() {
        if (!this.recognition) return;
        this.isListening = false;
        try {
            this.recognition.stop();
        } catch (e) {
            console.error("Error al detener la voz:", e);
        }
    }

    /**
     * Analiza el texto escuchado buscando números hablados en español o dígitos directos.
     */
    parseSpeechTranscript(text) {
        if (!text) return;

        // Limpiar texto: minúsculas y sin acentos comunes
        let cleanText = text.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Eliminar acentos
            .replace(/[,.]/g, ' ') // Quitar comas y puntos
            .replace(/\s+/g, ' ')  // Quitar espacios extras
            .trim();

        console.log("Texto normalizado de voz:", cleanText);

        // 1. Intentar buscar dígitos numéricos directos (ej. "33", "45", "7")
        const digitPattern = /\b\d{1,2}\b/g;
        const digitMatches = cleanText.match(digitPattern);
        
        let numbersFound = [];

        if (digitMatches) {
            digitMatches.forEach(m => {
                const val = parseInt(m, 10);
                if (val >= 1 && val <= 75) {
                    numbersFound.push(val);
                }
            });
        }

        // 2. Mapear números textuales en español
        // Separamos por espacios para analizar combinaciones habladas
        const words = cleanText.split(' ');
        
        const units = {
            "uno": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
            "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10,
            "once": 11, "doce": 12, "trece": 13, "catorce": 14, "quince": 15,
            "dieciseis": 16, "diecisiete": 17, "dieciocho": 18, "diecinueve": 19,
            "veinte": 20, "veintiun": 21, "veintidos": 22, "veintitres": 23,
            "veinticuatro": 24, "veinticinco": 25, "veintiseis": 26,
            "veintisiete": 27, "veintiocho": 28, "veintinueve": 29
        };

        const tens = {
            "treinta": 30,
            "cuarenta": 40,
            "cincuenta": 50,
            "sesenta": 60,
            "setenta": 70
        };

        // Escanear buscando unidades sueltas o combinaciones "treinta y tres"
        for (let i = 0; i < words.length; i++) {
            const word = words[i];

            // Caso A: Es un número básico directo (1-29)
            if (units[word] !== undefined) {
                numbersFound.push(units[word]);
                continue;
            }

            // Caso B: Es una decena redonda (30, 40, 50, 60, 70)
            if (tens[word] !== undefined) {
                // Comprobamos si le sigue "y" y una unidad (ej: "treinta y cinco")
                if (i + 2 < words.length && words[i + 1] === "y" && units[words[i + 2]] !== undefined) {
                    numbersFound.push(tens[word] + units[words[i + 2]]);
                    i += 2; // Saltar los siguientes dos tokens procesados
                } else {
                    numbersFound.push(tens[word]);
                }
                continue;
            }
            
            // Caso especial: "setenta y cinco" -> setenta(70) + y + cinco(5)
            // Se maneja arriba en el bucle
        }

        // Eliminar duplicados
        numbersFound = [...new Set(numbersFound)];

        // Filtrar rango del Bingo (1-75)
        const validBingoNumbers = numbersFound.filter(n => n >= 1 && n <= 75);

        if (validBingoNumbers.length > 0 && this.onNumberDetectedCallback) {
            console.log("Números parseados válidos:", validBingoNumbers);
            validBingoNumbers.forEach(n => this.onNumberDetectedCallback(n));
        }
    }
}

// Exportar instancia global
window.voiceService = new VoiceService();
