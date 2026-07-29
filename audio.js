/* BINGO SCAN DIGITAL - SERVICIO DE AUDIO SINTETIZADO (WEB AUDIO API) */

class AudioService {
    constructor() {
        this.ctx = null;
        this.enabled = true;
    }

    /**
     * Inicializa el AudioContext en respuesta a una interacción del usuario.
     */
    initContext() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    /**
     * Habilita o deshabilita los sonidos.
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }

    /**
     * Tono corto para cuando el usuario marca o desmarca un número.
     */
    playTap() {
        if (!this.enabled) return;
        this.initContext();

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, this.ctx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(1174.66, this.ctx.currentTime + 0.08); // D6

        gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);

        osc.start(this.ctx.currentTime);
        osc.stop(this.ctx.currentTime + 0.1);
    }

    /**
     * Tono de éxito cuando se realiza una acción correcta o se confirma algo.
     */
    playSuccess() {
        if (!this.enabled) return;
        this.initContext();

        const now = this.ctx.currentTime;
        const playTone = (freq, time, duration) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, time);

            gain.gain.setValueAtTime(0.1, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

            osc.start(time);
            osc.stop(time + duration);
        };

        playTone(523.25, now, 0.15); // C5
        playTone(659.25, now + 0.1, 0.15); // E5
        playTone(784.00, now + 0.2, 0.3); // G5
    }

    /**
     * Sonido de error bajo y ronco para advertencias o entradas inválidas.
     */
    playError() {
        if (!this.enabled) return;
        this.initContext();

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(80, this.ctx.currentTime + 0.25);

        gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);

        osc.start(this.ctx.currentTime);
        osc.stop(this.ctx.currentTime + 0.25);
    }

    /**
     * Melodía triunfal ascendente y festiva para cuando se completa una línea o BINGO.
     */
    playWin() {
        if (!this.enabled) return;
        this.initContext();

        const now = this.ctx.currentTime;
        const notes = [
            523.25, // C5
            587.33, // D5
            659.25, // E5
            698.46, // F5
            784.00, // G5
            880.00, // A5
            987.77, // B5
            1046.50 // C6
        ];

        notes.forEach((freq, idx) => {
            const time = now + idx * 0.12;
            const duration = 0.25;

            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.type = idx === notes.length - 1 ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(freq, time);

            // Añadir un ligero vibrato a la nota final sostenida
            if (idx === notes.length - 1) {
                const lfo = this.ctx.createOscillator();
                const lfoGain = this.ctx.createGain();
                lfo.frequency.value = 6; // 6 Hz vibrato
                lfoGain.gain.value = 15; // profundidad del vibrato
                lfo.connect(lfoGain);
                lfoGain.connect(osc.frequency);
                lfo.start(time);
                lfo.stop(time + 1.2);
            }

            const gainVal = idx === notes.length - 1 ? 0.25 : 0.12;
            const decay = idx === notes.length - 1 ? 1.2 : 0.2;

            gain.gain.setValueAtTime(gainVal, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

            osc.start(time);
            osc.stop(time + decay);
        });
    }
}

// Exportar instancia global
window.audioService = new AudioService();
