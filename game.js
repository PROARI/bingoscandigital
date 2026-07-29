/* BINGO SCAN DIGITAL - MOTOR DE JUEGO Y DETECTOR DE FIGURAS */

class BingoGameEngine {
    constructor() {
        this.activeCards = [];         // Lista de cartones participando en la partida activa
        this.drawnNumbers = [];        // Lista de números cantados (historial)
        this.undoStack = [];           // Pila para rehacer/deshacer marcas
        this.activeFigures = {         // Configuración de figuras a comprobar
            'line-h': true,
            'line-v': true,
            'diagonal': true,
            'x': false,
            'corners': false,
            'cross': false,
            't': false,
            'l': false,
            'frame': false,
            'full': true
        };
        // Para no alertar múltiples veces por la misma figura en el mismo cartón
        this.alertedFigures = {}; // Clave: 'cardId-figureName' -> true
    }

    /**
     * Establece los cartones que jugarán en esta partida.
     */
    startNewGame(cards) {
        this.activeCards = JSON.parse(JSON.stringify(cards)); // Clonar para mantener marcas limpias
        this.drawnNumbers = [];
        this.undoStack = [];
        this.alertedFigures = {};

        // Inicializar marcas: todas false excepto la celda central "LIBRE"
        this.activeCards.forEach(card => {
            card.marks = Array(5).fill(null).map(() => Array(5).fill(false));
            card.marks[2][2] = true; // El centro siempre está marcado por defecto
        });
    }

    /**
     * Limpia únicamente las marcas para reiniciar la partida actual.
     */
    resetMarks() {
        this.drawnNumbers = [];
        this.undoStack = [];
        this.alertedFigures = {};
        this.activeCards.forEach(card => {
            card.marks = Array(5).fill(null).map(() => Array(5).fill(false));
            card.marks[2][2] = true;
        });
    }

    /**
     * Agrega o cambia la configuración de una figura ganadora activa.
     */
    setFigureStatus(figureKey, isEnabled) {
        if (this.activeFigures.hasOwnProperty(figureKey)) {
            this.activeFigures[figureKey] = isEnabled;
        }
    }

    /**
     * Intenta marcar un número en TODOS los cartones activos.
     * @param {number} number Número a marcar (1-75)
     * @returns {Object} Detalle de los cartones afectados
     */
    markNumber(number) {
        if (this.drawnNumbers.includes(number)) {
            return { success: false, msg: "El número ya fue cantado." };
        }

        const affected = [];
        this.activeCards.forEach(card => {
            for (let r = 0; r < 5; r++) {
                for (let c = 0; c < 5; c++) {
                    if (card.numbers[r][c] === number && !card.marks[r][c]) {
                        card.marks[r][c] = true;
                        affected.push({
                            cardId: card.id,
                            cardName: card.name,
                            row: r,
                            col: c
                        });
                    }
                }
            }
        });

        if (affected.length > 0) {
            this.drawnNumbers.unshift(number); // Insertar al inicio (más reciente primero)
            this.undoStack.push({
                type: 'mark',
                number: number,
                affected: affected
            });
            return { success: true, affected: affected };
        }

        return { success: false, msg: `El número ${number} no está en ningún cartón activo.` };
    }

    /**
     * Alterna la marca en una celda específica del cartón activo al hacer clic directamente.
     */
    toggleCell(cardId, row, col) {
        if (row === 2 && col === 2) return null; // No tocar el centro LIBRE
        
        const card = this.activeCards.find(c => c.id === cardId);
        if (!card) return null;

        const cellValue = card.numbers[row][col];
        const isMarking = !card.marks[row][col];
        card.marks[row][col] = isMarking;

        if (isMarking) {
            // Si marcamos, registramos en el historial si es un número válido
            if (typeof cellValue === 'number' && !this.drawnNumbers.includes(cellValue)) {
                this.drawnNumbers.unshift(cellValue);
            }
            this.undoStack.push({
                type: 'toggle',
                cardId,
                row,
                col,
                prevVal: false,
                value: cellValue
            });
        } else {
            // Si desmarcamos
            this.undoStack.push({
                type: 'toggle',
                cardId,
                row,
                col,
                prevVal: true,
                value: cellValue
            });
        }

        return { card, marked: isMarking };
    }

    /**
     * Deshace la última acción (marcado numérico o clic directo).
     */
    undoLastAction() {
        if (this.undoStack.length === 0) return null;

        const action = this.undoStack.pop();

        if (action.type === 'mark') {
            // Desmarcar todos los afectados por el número
            action.affected.forEach(aff => {
                const card = this.activeCards.find(c => c.id === aff.cardId);
                if (card) {
                    card.marks[aff.row][aff.col] = false;
                }
            });
            // Quitar el número del historial
            const idx = this.drawnNumbers.indexOf(action.number);
            if (idx > -1) {
                this.drawnNumbers.splice(idx, 1);
            }
            return { type: 'mark', number: action.number };
        } else if (action.type === 'toggle') {
            const card = this.activeCards.find(c => c.id === action.cardId);
            if (card) {
                card.marks[action.row][action.col] = action.prevVal;
            }
            return { type: 'toggle', cardId: action.cardId, row: action.row, col: action.col };
        }

        return null;
    }

    /**
     * MÓDULO INDEPENDIENTE DE COMPROBACIÓN DE FIGURAS
     * Verifica si se ha completado alguna figura ganadora activa en los cartones.
     * @returns {Array} Lista de alertas de figuras completadas en este turno
     */
    checkWinningFigures() {
        const completedAlerts = [];

        this.activeCards.forEach(card => {
            const marks = card.marks;

            // Definiciones de figuras
            const checkList = [
                { key: 'full', name: 'CARTÓN COMPLETO (BINGO)', fn: () => this._checkFull(marks) },
                { key: 'line-h', name: 'LÍNEA HORIZONTAL', fn: () => this._checkLineH(marks) },
                { key: 'line-v', name: 'LÍNEA VERTICAL', fn: () => this._checkLineV(marks) },
                { key: 'diagonal', name: 'DIAGONAL', fn: () => this._checkDiagonals(marks) },
                { key: 'x', name: 'FIGURA EN X', fn: () => this._checkX(marks) },
                { key: 'corners', name: 'CUATRO ESQUINAS', fn: () => this._checkCorners(marks) },
                { key: 'cross', name: 'CRUZ', fn: () => this._checkCross(marks) },
                { key: 't', name: 'FIGURA EN T', fn: () => this._checkT(marks) },
                { key: 'l', name: 'FIGURA EN L', fn: () => this._checkL(marks) },
                { key: 'frame', name: 'MARCO COMPLETO', fn: () => this._checkFrame(marks) }
            ];

            checkList.forEach(fig => {
                if (this.activeFigures[fig.key]) {
                    const result = fig.fn();
                    if (result.won) {
                        const alertKey = `${card.id}-${fig.key}`;
                        // Si es la primera vez que se detecta esta figura en este cartón durante esta partida
                        if (!this.alertedFigures[alertKey]) {
                            this.alertedFigures[alertKey] = true;
                            completedAlerts.push({
                                cardId: card.id,
                                cardName: card.name,
                                figureKey: fig.key,
                                figureName: fig.name,
                                cells: result.cells
                            });
                        }
                    }
                }
            });
        });

        return completedAlerts;
    }

    /* --- ALGORITMOS DE DETECCIÓN DE PATRONES --- */

    _checkFull(m) {
        const cells = [];
        let won = true;
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                if (!m[r][c]) won = false;
                cells.push({ row: r, col: c });
            }
        }
        return { won, cells };
    }

    _checkLineH(m) {
        // Devuelve la primera fila ganadora encontrada
        for (let r = 0; r < 5; r++) {
            let rowWon = true;
            const cells = [];
            for (let c = 0; c < 5; c++) {
                if (!m[r][c]) rowWon = false;
                cells.push({ row: r, col: c });
            }
            if (rowWon) return { won: true, cells };
        }
        return { won: false, cells: [] };
    }

    _checkLineV(m) {
        for (let c = 0; c < 5; c++) {
            let colWon = true;
            const cells = [];
            for (let r = 0; r < 5; r++) {
                if (!m[r][c]) colWon = false;
                cells.push({ row: r, col: c });
            }
            if (colWon) return { won: true, cells };
        }
        return { won: false, cells: [] };
    }

    _checkDiagonals(m) {
        // Diagonal 1: top-left to bottom-right
        let d1Won = true;
        const d1Cells = [];
        for (let i = 0; i < 5; i++) {
            if (!m[i][i]) d1Won = false;
            d1Cells.push({ row: i, col: i });
        }
        if (d1Won) return { won: true, cells: d1Cells };

        // Diagonal 2: top-right to bottom-left
        let d2Won = true;
        const d2Cells = [];
        for (let i = 0; i < 5; i++) {
            if (!m[i][4 - i]) d2Won = false;
            d2Cells.push({ row: i, col: 4 - i });
        }
        if (d2Won) return { won: true, cells: d2Cells };

        return { won: false, cells: [] };
    }

    _checkX(m) {
        const cells = [];
        let won = true;
        for (let i = 0; i < 5; i++) {
            if (!m[i][i]) won = false;
            if (!m[i][4 - i]) won = false;
            cells.push({ row: i, col: i });
            if (i !== 2) cells.push({ row: i, col: 4 - i });
        }
        return { won, cells: won ? cells : [] };
    }

    _checkCorners(m) {
        const cells = [
            { row: 0, col: 0 },
            { row: 0, col: 4 },
            { row: 4, col: 0 },
            { row: 4, col: 4 }
        ];
        const won = cells.every(c => m[c.row][c.col]);
        return { won, cells: won ? cells : [] };
    }

    _checkCross(m) {
        const cells = [];
        // Fila 2 y Columna 2
        for (let i = 0; i < 5; i++) {
            cells.push({ row: 2, col: i });
            if (i !== 2) cells.push({ row: i, col: 2 });
        }
        const won = cells.every(c => m[c.row][c.col]);
        return { won, cells: won ? cells : [] };
    }

    _checkT(m) {
        const cells = [];
        // Fila 0 (columnas 0 a 4)
        for (let c = 0; c < 5; c++) {
            cells.push({ row: 0, col: c });
        }
        // Columna 2 (filas 1 a 4)
        for (let r = 1; r < 5; r++) {
            cells.push({ row: r, col: 2 });
        }
        const won = cells.every(c => m[c.row][c.col]);
        return { won, cells: won ? cells : [] };
    }

    _checkL(m) {
        const cells = [];
        // Columna 0 (filas 0 a 4)
        for (let r = 0; r < 5; r++) {
            cells.push({ row: r, col: 0 });
        }
        // Fila 4 (columnas 1 a 4)
        for (let c = 1; c < 5; c++) {
            cells.push({ row: 4, col: c });
        }
        const won = cells.every(c => m[c.row][c.col]);
        return { won, cells: won ? cells : [] };
    }

    _checkFrame(m) {
        const cells = [];
        // Perímetro exterior
        for (let i = 0; i < 5; i++) {
            cells.push({ row: 0, col: i }); // Borde superior
            cells.push({ row: 4, col: i }); // Borde inferior
            if (i > 0 && i < 4) {
                cells.push({ row: i, col: 0 }); // Borde izquierdo
                cells.push({ row: i, col: 4 }); // Borde derecho
            }
        }
        const won = cells.every(c => m[c.row][c.col]);
        return { won, cells: won ? cells : [] };
    }
}

// Exportar instancia global
window.gameService = new BingoGameEngine();
