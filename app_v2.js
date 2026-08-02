/* BINGO SCAN DIGITAL - CONTROLADOR PRINCIPAL Y ENRUTADOR */

document.addEventListener("DOMContentLoaded", async () => {
    // 0. DETECTOR DE PWA STANDALONE (GATEKEEPER)
    function isStandalone() {
        const urlParams = new URLSearchParams(window.location.search);
        // Permitir bypass en desarrollo/sandbox si la URL tiene dev=true o v (cache buster)
        if (urlParams.get('dev') === 'true' || urlParams.get('v')) {
            return true;
        }
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }

    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        const installBtn = document.getElementById('btn-pwa-install');
        if (installBtn) {
            installBtn.style.display = 'inline-flex';
        }
    });

    // Pestañas de instrucciones manuales
    document.querySelectorAll('.inst-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.inst-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.inst-step').forEach(s => s.classList.remove('active'));

            tab.classList.add('active');
            const targetId = tab.dataset.target;
            const targetStep = document.getElementById(targetId);
            if (targetStep) targetStep.classList.add('active');
        });
    });

    // Botón de instalación
    const installBtn = document.getElementById('btn-pwa-install');
    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                console.log(`PWA install choice: ${outcome}`);
                deferredPrompt = null;
                installBtn.style.display = 'none';
            } else {
                showToast("Por favor, sigue las instrucciones manuales de abajo para agregar la app.", "warning");
            }
        });
    }

    // 1. INICIALIZAR SERVICIOS
    try {
        await window.dbService.init();
        console.log("IndexedDB inicializado con éxito.");
    } catch (e) {
        showToast("Error de base de datos local. El almacenamiento no persistirá.", "danger");
    }

    // 4. MANEJO DE CONFIGURACIÓN
    let appSettings = {
        sound: true,
        vibrate: true,
        voiceContinuous: true,
        figures: {
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
        }
    };

    // Cargar configuraciones guardadas
    await loadSettingsFromDb();

    // 2. REFERENCIAS DOM DE VISTAS
    const views = {
        'install-gate': document.getElementById('view-install-gate'),
        main: document.getElementById('view-main'),
        scan: document.getElementById('view-scan'),
        verify: document.getElementById('view-verify'),
        cards: document.getElementById('view-cards'),
        play: document.getElementById('view-play'),
        config: document.getElementById('view-config'),
        adminAds: document.getElementById('view-admin-ads')
    };

    // 3. ENRUTADOR DE VISTAS
    function showView(viewId) {
        // Redirigir al gatekeeper si no está en modo standalone/instalado
        if (!isStandalone()) {
            viewId = 'install-gate';
            document.getElementById('app-header-global').style.display = 'none';
        } else {
            document.getElementById('app-header-global').style.display = 'flex';
        }

        // Detener cámara si salimos de la vista de escaneo
        if (views.scan && views.scan.classList.contains('active') && viewId !== 'scan') {
            window.ocrService.stopCamera();
            window.ocrService.stopScanLoop();
        }

        // Desactivar todas las vistas
        Object.values(views).forEach(v => {
            if (v) v.classList.remove('active');
        });

        // Activar la vista seleccionada
        if (views[viewId]) {
            views[viewId].classList.add('active');
            views[viewId].scrollIntoView({ behavior: 'smooth' });
        }

        // Inicializaciones al entrar a vistas específicas
        if (viewId === 'cards') {
            renderCardsGallery();
        } else if (viewId === 'config') {
            renderConfigScreen();
        } else if (viewId === 'adminAds') {
            renderAdminAdsScreen();
        }

        // Actualizar el banner de anuncios para la vista actual
        if (window.bannerManager) {
            window.bannerManager.updateBannerForView(viewId);
        }
    }

    // Comprobar estado de instalación inicial
    showView('main');

    // Registrar Service Worker para PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log("Service Worker registrado con éxito."))
            .catch(err => console.warn("Fallo de Service Worker:", err));
    }

    // Enlazar botones con clase 'btn-back' para volver a Inicio
    document.querySelectorAll('.btn-back').forEach(btn => {
        btn.addEventListener('click', () => showView('main'));
    });

    async function loadSettingsFromDb() {
        appSettings.sound = await window.dbService.getSetting('soundEnabled', true);
        appSettings.vibrate = await window.dbService.getSetting('vibrateEnabled', true);
        appSettings.voiceContinuous = await window.dbService.getSetting('voiceContinuous', true);
        
        const dbFigs = await window.dbService.getSetting('activeFigures', null);
        if (dbFigs) {
            appSettings.figures = dbFigs;
        }

        // Aplicar configuraciones iniciales a los servicios
        window.audioService.setEnabled(appSettings.sound);
        window.voiceService.continuousPref = appSettings.voiceContinuous;
        
        // Cargar en el motor de juego
        Object.keys(appSettings.figures).forEach(key => {
            window.gameService.setFigureStatus(key, appSettings.figures[key]);
        });
    }

    function renderConfigScreen() {
        document.getElementById('pref-sound').checked = appSettings.sound;
        document.getElementById('pref-vibrate').checked = appSettings.vibrate;
        document.getElementById('pref-voice-continuous').checked = appSettings.voiceContinuous;

        Object.keys(appSettings.figures).forEach(key => {
            const cb = document.getElementById(`fig-${key}`);
            if (cb) cb.checked = appSettings.figures[key];
        });
    }

    // Guardar configuraciones al interactuar
    const saveConfigState = async () => {
        appSettings.sound = document.getElementById('pref-sound').checked;
        appSettings.vibrate = document.getElementById('pref-vibrate').checked;
        appSettings.voiceContinuous = document.getElementById('pref-voice-continuous').checked;

        Object.keys(appSettings.figures).forEach(key => {
            const cb = document.getElementById(`fig-${key}`);
            if (cb) appSettings.figures[key] = cb.checked;
        });

        // Persistir
        await window.dbService.saveSetting('soundEnabled', appSettings.sound);
        await window.dbService.saveSetting('vibrateEnabled', appSettings.vibrate);
        await window.dbService.saveSetting('voiceContinuous', appSettings.voiceContinuous);
        await window.dbService.saveSetting('activeFigures', appSettings.figures);

        // Actualizar servicios activos
        window.audioService.setEnabled(appSettings.sound);
        window.voiceService.continuousPref = appSettings.voiceContinuous;
        Object.keys(appSettings.figures).forEach(key => {
            window.gameService.setFigureStatus(key, appSettings.figures[key]);
        });
    };

    // Vincular eventos de cambios de configuración
    document.querySelectorAll('.config-container input').forEach(input => {
        input.addEventListener('change', saveConfigState);
    });

    // 5. ACCIONES DE MENÚ PRINCIPAL
    const addCardModal = document.getElementById('add-card-modal');

    document.getElementById('btn-start-scan').addEventListener('click', () => {
        addCardModal.classList.remove('hidden');
    });

    document.getElementById('btn-my-cards').addEventListener('click', () => showView('cards'));

    document.getElementById('btn-quick-play').addEventListener('click', async () => {
        const cards = await window.dbService.getAllCards();
        if (cards.length === 0) {
            showToast("Primero debes agregar al menos un cartón.", "warning");
            showView('cards');
        } else {
            // Seleccionar por defecto el primer cartón
            startBingoGame([cards[0]]);
        }
    });

    document.getElementById('btn-global-config').addEventListener('click', () => showView('config'));

    // Modal para agregar cartón
    document.getElementById('modal-btn-close').addEventListener('click', () => {
        addCardModal.classList.add('hidden');
    });

    document.getElementById('modal-btn-scan').addEventListener('click', async () => {
        addCardModal.classList.add('hidden');
        showView('scan');
        showOcrLoader("Inicializando cámara...");
        const video = document.getElementById('scan-video');
        const simulatorCanvas = document.getElementById('scan-simulator-canvas');
        const success = await window.ocrService.startCamera(video, simulatorCanvas);
        if (success) {
            if (window.ocrService.isSimulated) {
                showToast("Usando cámara de prueba simulada.", "warning");
                hideOcrLoader();
            }
            
            // Iniciar bucle de escaneo continuo en tiempo real con realidad aumentada e inicialización paralela
            window.ocrService.startScanLoop(async (canvas) => {
                window.audioService.playTap();
                window.ocrService.stopCamera();
                showOcrLoader("Ejecutando doble verificación...");
                try {
                    const result = await window.ocrService.scanBingoCardDoubleVerification(canvas, (status) => {
                        showOcrLoader(status);
                    });
                    hideOcrLoader();
                    showToast("Cartón verificado con éxito.", "success");
                    openVerificationScreen(`Escaneado ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`, result.grid, result.statuses);
                } catch (err) {
                    hideOcrLoader();
                    window.audioService.playError();
                    showToast("Fallo al verificar el cartón. Cargando editor manual.", "warning");
                    const grid = window.ocrService.generateRandomCardGrid();
                    openVerificationScreen("Escaneado", grid);
                }
            }, (status) => {
                showOcrLoader(status);
                if (status.includes("Listo")) {
                    setTimeout(() => hideOcrLoader(), 800);
                }
            });
        } else {
            hideOcrLoader();
            showToast("No se pudo acceder a la cámara ni al simulador.", "danger");
            showView('main');
        }
    });

    // Alternar linterna desde el botón en la cámara
    const torchBtn = document.getElementById('btn-toggle-torch');
    if (torchBtn) {
        torchBtn.addEventListener('click', async () => {
            window.audioService.playTap();
            const toggled = await window.ocrService.toggleTorch();
            if (toggled) {
                if (window.ocrService.isTorchActive) {
                    torchBtn.classList.add('active');
                    showToast("Linterna encendida.", "success");
                } else {
                    torchBtn.classList.remove('active');
                    showToast("Linterna apagada.", "warning");
                }
            } else {
                showToast("La linterna no está disponible.", "danger");
            }
        });
    }

    document.getElementById('modal-btn-gallery').addEventListener('click', () => {
        addCardModal.classList.add('hidden');
        document.getElementById('scan-file-input').click();
    });

    document.getElementById('modal-btn-manual').addEventListener('click', () => {
        addCardModal.classList.add('hidden');
        editCardId = null; // Modo creación
        const grid = window.ocrService.generateRandomCardGrid();
        openVerificationScreen("Cartón Manual", grid);
    });

    // 6. FLUJO DEL ESCÁNER & OCR
    const ocrLoading = document.getElementById('ocr-loading');
    const ocrStatusText = document.getElementById('ocr-status-text');

    function showOcrLoader(text) {
        ocrStatusText.textContent = text;
        ocrLoading.classList.remove('hidden');
    }

    function hideOcrLoader() {
        ocrLoading.classList.add('hidden');
    }

    // Botón de captura de cámara
    document.getElementById('btn-capture').addEventListener('click', async () => {
        window.audioService.playTap();
        window.ocrService.stopScanLoop();
        const canvas = window.ocrService.captureAndProcess();
        if (!canvas) {
            showToast("La cámara aún no está lista.", "warning");
            return;
        }

        showOcrLoader("Inicializando OCR...");
        window.ocrService.stopCamera();

        try {
            const result = await window.ocrService.scanBingoCardDoubleVerification(canvas, (status) => {
                showOcrLoader(status);
            });
            hideOcrLoader();
            showToast("Cartón verificado con éxito.", "success");
            openVerificationScreen(`Escaneado ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`, result.grid, result.statuses);
        } catch (err) {
            hideOcrLoader();
            window.audioService.playError();
            showToast("Fallo al escanear. Cargando editor manual.", "warning");
            const grid = window.ocrService.generateRandomCardGrid();
            openVerificationScreen("Cartón Escaneado", grid);
        }
    });

    // Subida desde Galería
    document.getElementById('scan-file-input').addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        showOcrLoader("Procesando imagen...");
        showView('scan'); // Cambiar a la vista para ver el estado

        const img = new Image();
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 400;
            canvas.height = 400;
            
            // Ajustar al cuadrado
            ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, 400, 400);

            try {
                const result = await window.ocrService.scanBingoCardDoubleVerification(canvas, (status) => {
                    showOcrLoader(status);
                });
                hideOcrLoader();
                showToast("Imagen importada con doble verificación.", "success");
                openVerificationScreen("Importado de Galería", result.grid, result.statuses);
            } catch (err) {
                hideOcrLoader();
                window.audioService.playError();
                showToast("Error de lectura. Cargando editor manual.", "warning");
                const grid = window.ocrService.generateRandomCardGrid();
                openVerificationScreen("Importado", grid);
            }
        };
        img.src = URL.createObjectURL(file);
    });

    document.getElementById('btn-manual-create-quick').addEventListener('click', () => {
        editCardId = null;
        const grid = window.ocrService.generateRandomCardGrid();
        openVerificationScreen("Mi Cartón", grid);
    });

    // 7. FLUJO DE VERIFICACIÓN (EDICIÓN MANUAL)
    let editCardId = null; // Si no es nulo, estamos editando un cartón existente
    const verifyGridBody = document.getElementById('verify-grid-body');
    const verifyCardName = document.getElementById('verify-card-name');

    function openVerificationScreen(name, grid, statuses = null) {
        verifyCardName.value = name;
        verifyGridBody.innerHTML = '';

        for (let row = 0; row < 5; row++) {
            const tr = document.createElement('tr');
            for (let col = 0; col < 5; col++) {
                const td = document.createElement('td');
                const val = grid[row][col];
                const status = statuses ? statuses[row][col] : null;

                if (row === 2 && col === 2) {
                    td.innerHTML = `<input type="text" class="verify-grid-cell-input free-cell" value="LIBRE" readonly tabindex="-1">`;
                } else {
                    let statusClass = '';
                    let statusTitle = '';
                    if (status === 'verified') {
                        statusClass = 'cell-verified';
                        statusTitle = 'Número verificado doblemente';
                    } else if (status === 'conflict') {
                        statusClass = 'cell-conflict';
                        statusTitle = 'Conflicto detectado. Por favor, verificar.';
                    } else if (status === 'empty') {
                        statusClass = 'cell-empty';
                        statusTitle = 'Número no detectado. Por favor, ingresar.';
                    } else if (status === 'detected') {
                        statusClass = 'cell-detected';
                        statusTitle = 'Número detectado en una sola pasada';
                    }

                    td.innerHTML = `
                        <div class="verify-cell-container ${statusClass}" title="${statusTitle}">
                            <input type="number" class="verify-grid-cell-input" min="1" max="75" value="${val}" data-row="${row}" data-col="${col}">
                            ${status ? '<span class="status-indicator"></span>' : ''}
                        </div>
                    `;
                }
                tr.appendChild(td);
            }
            verifyGridBody.appendChild(tr);
        }

        // Agregar listeners para validar rangos numéricos al cambiar foco
        document.querySelectorAll('.verify-grid-cell-input:not(.free-cell)').forEach(input => {
            input.addEventListener('change', (e) => {
                validateCellRange(e.target);
            });
        });

        showView('verify');
    }

    function validateCellRange(input) {
        const col = parseInt(input.dataset.col, 10);
        const val = parseInt(input.value, 10);

        const ranges = [
            { min: 1, max: 15, colName: 'B' },
            { min: 16, max: 30, colName: 'I' },
            { min: 31, max: 45, colName: 'N' },
            { min: 46, max: 60, colName: 'G' },
            { min: 61, max: 75, colName: 'O' }
        ];

        const range = ranges[col];
        if (isNaN(val) || val < range.min || val > range.max) {
            input.classList.add('invalid-blink');
            window.audioService.playError();
            showToast(`Columna ${range.colName} debe tener un número entre ${range.min} y ${range.max}.`, "danger");
            // Auto corregir con el valor mínimo para no romper el flujo
            input.value = range.min;
            setTimeout(() => input.classList.remove('invalid-blink'), 1000);
            return false;
        }
        return true;
    }

    document.getElementById('btn-verify-rescan').addEventListener('click', () => {
        window.audioService.playTap();
        document.getElementById('btn-start-scan').click();
    });



    document.getElementById('btn-verify-confirm').addEventListener('click', async () => {
        // Validar todos los campos
        const inputs = document.querySelectorAll('.verify-grid-cell-input:not(.free-cell)');
        let isValid = true;
        inputs.forEach(input => {
            if (!validateCellRange(input)) isValid = false;
        });

        if (!isValid) return;

        // Reconstruir cuadrícula final
        const finalNumbers = Array(5).fill(null).map(() => Array(5).fill(""));
        finalNumbers[2][2] = "LIBRE";

        inputs.forEach(input => {
            const row = parseInt(input.dataset.row, 10);
            const col = parseInt(input.dataset.col, 10);
            finalNumbers[row][col] = parseInt(input.value, 10);
        });

        // Comprobar duplicados en la columna
        for (let col = 0; col < 5; col++) {
            const values = [];
            for (let row = 0; row < 5; row++) {
                if (row === 2 && col === 2) continue;
                values.push(finalNumbers[row][col]);
            }
            const duplicates = values.filter((item, index) => values.indexOf(item) !== index);
            if (duplicates.length > 0) {
                window.audioService.playError();
                showToast(`Números repetidos en la columna: ${duplicates.join(', ')}`, "danger");
                return;
            }
        }

        const cardObject = {
            id: editCardId || Date.now(),
            name: verifyCardName.value.trim() || "Cartón Bingo",
            numbers: finalNumbers,
            dateCreated: new Date().getTime(),
            selected: false
        };

        await window.dbService.saveCard(cardObject);
        window.audioService.playSuccess();
        showToast("Cartón guardado con éxito.", "success");
        showView('cards');
    });

    // 8. GALERÍA DE CARTONES (MIS CARTONES)
    const cardsList = document.getElementById('cards-list');
    const emptyState = document.getElementById('empty-gallery-state');
    const playSelectedBtn = document.getElementById('btn-gallery-play-all');
    const selectedCountSpan = document.getElementById('selected-cards-count');

    let allSavedCards = [];
    let selectedCardIds = new Set();

    async function renderCardsGallery() {
        try {
            allSavedCards = await window.dbService.getAllCards();
        } catch (e) {
            allSavedCards = [];
        }

        cardsList.innerHTML = '';
        selectedCardIds.clear();
        selectedCountSpan.textContent = '0';

        if (allSavedCards.length === 0) {
            emptyState.style.display = 'flex';
            playSelectedBtn.classList.add('hidden');
            return;
        }

        emptyState.style.display = 'none';
        playSelectedBtn.classList.remove('hidden');

        allSavedCards.forEach(card => {
            const item = document.createElement('div');
            item.className = 'saved-card-item animate-scale-up';
            item.dataset.id = card.id;

            // Preview pequeño
            let previewHtml = '<div class="mini-board-preview">';
            for (let r = 0; r < 5; r++) {
                for (let c = 0; c < 5; c++) {
                    const cellVal = card.numbers[r][c];
                    if (r === 2 && c === 2) {
                        previewHtml += `<div class="free">★</div>`;
                    } else {
                        previewHtml += `<div>${cellVal}</div>`;
                    }
                }
            }
            previewHtml += '</div>';

            item.innerHTML = `
                <div class="saved-card-item-title">${card.name}</div>
                ${previewHtml}
                <div class="saved-card-actions">
                    <button class="btn-primary btn-play-card" data-id="${card.id}">Jugar</button>
                    <button class="btn-secondary btn-edit-card" data-id="${card.id}">Editar</button>
                    <button class="btn-danger btn-delete-card" data-id="${card.id}">Eliminar</button>
                </div>
            `;

            // Alternar selección al presionar la tarjeta general
            item.addEventListener('click', (e) => {
                // Evitar alternar si se pulsa un botón de acción interna
                if (e.target.tagName === 'BUTTON') return;

                if (selectedCardIds.has(card.id)) {
                    selectedCardIds.delete(card.id);
                    item.classList.remove('selected');
                } else {
                    selectedCardIds.add(card.id);
                    item.classList.add('selected');
                }
                selectedCountSpan.textContent = selectedCardIds.size;
            });

            cardsList.appendChild(item);
        });

        // Registrar listeners de los botones de tarjetas
        document.querySelectorAll('.btn-play-card').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt(e.target.dataset.id, 10);
                const card = allSavedCards.find(c => c.id === id);
                if (card) startBingoGame([card]);
            });
        });

        document.querySelectorAll('.btn-edit-card').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt(e.target.dataset.id, 10);
                const card = allSavedCards.find(c => c.id === id);
                if (card) {
                    editCardId = card.id;
                    openVerificationScreen(card.name, card.numbers);
                }
            });
        });

        document.querySelectorAll('.btn-delete-card').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = parseInt(e.target.dataset.id, 10);
                if (confirm("¿Seguro que deseas eliminar este cartón?")) {
                    await window.dbService.deleteCard(id);
                    showToast("Cartón eliminado.", "warning");
                    renderCardsGallery();
                }
            });
        });
    }

    document.getElementById('btn-gallery-add').addEventListener('click', () => {
        addCardModal.classList.remove('hidden');
    });

    document.getElementById('btn-empty-add').addEventListener('click', () => {
        addCardModal.classList.remove('hidden');
    });

    document.getElementById('btn-gallery-play-all').addEventListener('click', () => {
        if (selectedCardIds.size === 0) {
            showToast("Toca alguna de las tarjetas para seleccionarla.", "warning");
            return;
        }

        const selectedCards = allSavedCards.filter(c => selectedCardIds.has(c.id));
        startBingoGame(selectedCards);
    });

    // 9. FLUJO DE JUEGO (GAMEPLAY)
    let activeCardIndex = 0; // Índice del cartón visualizado en la pantalla de juego

    function startBingoGame(cards) {
        window.audioService.playSuccess();
        window.gameService.startNewGame(cards);
        activeCardIndex = 0;
        showView('play');
        renderGameLayout();
        showToast(`Comenzando partida con ${cards.length} cartón(es).`, "success");
    }

    function renderGameLayout() {
        const game = window.gameService;
        const activeCard = game.activeCards[activeCardIndex];

        // 1. Mostrar cabeceras y stats
        document.getElementById('game-last-number').textContent = game.drawnNumbers.length > 0 ? game.drawnNumbers[0] : '-';
        document.getElementById('game-drawn-count').textContent = game.drawnNumbers.length;
        
        // 2. Renderizar Tabs si hay más de 1 cartón participando
        const tabsContainer = document.getElementById('game-cards-tabs');
        tabsContainer.innerHTML = '';
        
        if (game.activeCards.length > 1) {
            game.activeCards.forEach((card, idx) => {
                const tab = document.createElement('div');
                tab.className = `card-tab ${idx === activeCardIndex ? 'active' : ''}`;
                tab.textContent = card.name;
                tab.addEventListener('click', () => {
                    window.audioService.playTap();
                    activeCardIndex = idx;
                    renderGameLayout();
                });
                tabsContainer.appendChild(tab);
            });
        }

        // 3. Renderizar el cartón activo
        document.getElementById('game-active-card-name').textContent = activeCard.name;
        document.getElementById('game-active-card-id').textContent = `#${activeCardIndex + 1}`;

        const boardBody = document.getElementById('game-board-body');
        boardBody.innerHTML = '';

        for (let r = 0; r < 5; r++) {
            const tr = document.createElement('tr');
            for (let c = 0; c < 5; c++) {
                const td = document.createElement('td');
                const num = activeCard.numbers[r][c];
                const isMarked = activeCard.marks[r][c];

                if (r === 2 && c === 2) {
                    td.innerHTML = `<button class="game-cell-btn free-cell ${isMarked ? 'marked' : ''}">LIBRE</button>`;
                } else {
                    td.innerHTML = `<button class="game-cell-btn ${isMarked ? 'marked' : ''}" data-row="${r}" data-col="${c}">${num}</button>`;
                }

                // Evento click en celda
                const btn = td.querySelector('.game-cell-btn');
                btn.addEventListener('click', () => {
                    const result = window.gameService.toggleCell(activeCard.id, r, c);
                    if (result) {
                        window.audioService.playTap();
                        if (appSettings.vibrate) navigator.vibrate(30);
                        renderGameLayout();
                        checkGameWinners();
                    }
                });

                tr.appendChild(td);
            }
            boardBody.appendChild(tr);
        }

        // 4. Renderizar historial strip
        const historyContainer = document.getElementById('drawn-history-list');
        historyContainer.innerHTML = '';
        game.drawnNumbers.forEach(n => {
            const chip = document.createElement('div');
            chip.className = 'drawn-number-chip';
            chip.textContent = n;
            historyContainer.appendChild(chip);
        });
    }

    // Comprobación de ganadores del juego
    function checkGameWinners() {
        const wins = window.gameService.checkWinningFigures();
        if (wins.length > 0) {
            // Haptic e interrupt
            if (appSettings.vibrate) navigator.vibrate([150, 100, 150, 100, 300]);
            window.audioService.playWin();

            // Rellenar información de victoria
            const primaryWin = wins[0];
            document.getElementById('win-title').textContent = primaryWin.figureKey === 'full' ? '🏆 ¡BINGO COMPLETO! 🏆' : '🎉 ¡FIGURA COMPLETADA! 🎉';
            document.getElementById('win-figure-name').textContent = primaryWin.figureName;
            document.getElementById('win-card-info').textContent = `Completada en: "${primaryWin.cardName}"`;
            
            // Activar animación Confetti
            startConfettiEffect();

            // Mostrar el Overlay
            document.getElementById('win-overlay').classList.remove('hidden');
        }
    }

    // Botón de cerrar victoria
    document.getElementById('btn-win-close').addEventListener('click', () => {
        stopConfettiEffect();
        document.getElementById('win-overlay').classList.add('hidden');
    });

    // Marcado manual por número escrito
    const markInput = document.getElementById('game-num-input');
    document.getElementById('btn-game-mark').addEventListener('click', () => {
        executeManualMark();
    });
    
    markInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') executeManualMark();
    });

    function executeManualMark() {
        const val = parseInt(markInput.value, 10);
        if (isNaN(val) || val < 1 || val > 75) {
            window.audioService.playError();
            showToast("Introduce un número válido entre 1 y 75.", "danger");
            return;
        }

        markInput.value = '';
        processNumberDrawn(val);
    }

    function processNumberDrawn(num) {
        const res = window.gameService.markNumber(num);
        if (res.success) {
            window.audioService.playSuccess();
            if (appSettings.vibrate) navigator.vibrate(60);
            
            // Destacar número último cantado con flash
            const lastNumEl = document.getElementById('game-last-number');
            lastNumEl.classList.add('highlight-number');
            setTimeout(() => lastNumEl.classList.remove('highlight-number'), 600);

            // Si hay múltiples afectados, flashear los tabs que cambiaron
            if (res.affected.length > 0) {
                res.affected.forEach(aff => {
                    const tabs = document.querySelectorAll('.card-tab');
                    const game = window.gameService;
                    const idx = game.activeCards.findIndex(c => c.id === aff.cardId);
                    if (idx > -1 && tabs[idx]) {
                        tabs[idx].classList.add('affected-flash');
                        setTimeout(() => tabs[idx].classList.remove('affected-flash'), 2000);
                    }
                });
                
                showToast(`¡Número ${num} marcado en ${res.affected.length} cartón(es)!`, "success");
            }
            
            renderGameLayout();
            checkGameWinners();
        } else {
            window.audioService.playError();
            showToast(res.msg, "warning");
        }
    }

    // Configuración de Deshacer
    document.getElementById('btn-game-undo').addEventListener('click', () => {
        const undone = window.gameService.undoLastAction();
        if (undone) {
            window.audioService.playTap();
            showToast("Último marcado revertido.", "warning");
            renderGameLayout();
        } else {
            showToast("No hay marcas para deshacer.", "warning");
        }
    });

    // Nueva Partida / Reiniciar marcas
    document.getElementById('btn-game-restart').addEventListener('click', () => {
        if (confirm("¿Quieres borrar las marcas y reiniciar esta partida?")) {
            window.audioService.playTap();
            window.gameService.resetMarks();
            renderGameLayout();
            showToast("Partida reiniciada. Las marcas se han vaciado.", "warning");
        }
    });

    // Salir del juego
    document.getElementById('btn-game-quit').addEventListener('click', () => {
        if (confirm("¿Deseas terminar la partida activa y volver al menú?")) {
            // Detener el micrófono si está activo
            window.voiceService.stop();
            const micBtn = document.getElementById('btn-game-voice');
            micBtn.classList.remove('listening');
            document.getElementById('voice-transcript-panel').classList.add('hidden');
            
            showView('main');
        }
    });

    // 10. RECONOCIMIENTO DE VOZ CONTINUO
    const voiceBtn = document.getElementById('btn-game-voice');
    const voicePanel = document.getElementById('voice-transcript-panel');
    const voiceText = document.getElementById('voice-transcript-text');

    voiceBtn.addEventListener('click', () => {
        window.audioService.playTap();
        
        if (window.voiceService.isListening) {
            window.voiceService.stop();
        } else {
            const started = window.voiceService.start();
            if (!started) {
                showToast("El navegador no soporta el reconocimiento de voz.", "danger");
            }
        }
    });

    // Callbacks del servicio de voz
    window.voiceService.onStatusChangeCallback = (listening) => {
        if (listening) {
            voiceBtn.classList.add('listening');
            voicePanel.classList.remove('hidden');
            voiceText.textContent = "Escuchando... Di un número (1 al 75)";
        } else {
            voiceBtn.classList.remove('listening');
            voicePanel.classList.add('hidden');
        }
    };

    window.voiceService.onTranscriptCallback = (transcript) => {
        voiceText.textContent = `"${transcript}"`;
    };

    window.voiceService.onNumberDetectedCallback = (number) => {
        processNumberDrawn(number);
    };

    // 11. SISTEMA DE TOAST NOTIFICATIONS
    const toastContainer = document.getElementById('toast-container');
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span>${message}</span>
            <span style="cursor:pointer; font-weight:800; margin-left: 10px;">×</span>
        `;

        toast.querySelector('span:last-child').addEventListener('click', () => toast.remove());

        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // 12. SISTEMA DE CONFETTI CANVAS (ANIMACIÓN PREMIUM)
    const confettiCanvas = document.getElementById('confetti-canvas');
    const confettiCtx = confettiCanvas.getContext('2d');
    let confettiActive = false;
    let particles = [];

    function resizeConfettiCanvas() {
        confettiCanvas.width = confettiCanvas.parentElement.clientWidth;
        confettiCanvas.height = confettiCanvas.parentElement.clientHeight;
    }

    class ConfettiParticle {
        constructor() {
            this.x = Math.random() * confettiCanvas.width;
            this.y = Math.random() * -confettiCanvas.height;
            this.size = Math.random() * 8 + 6;
            this.color = ['#06b6d4', '#a855f7', '#ec4899', '#10b981', '#fbbf24'][Math.floor(Math.random() * 5)];
            this.speedY = Math.random() * 3 + 2;
            this.speedX = Math.random() * 2 - 1;
            this.rotation = Math.random() * 360;
            this.rotationSpeed = Math.random() * 4 - 2;
        }

        update() {
            this.y += this.speedY;
            this.x += this.speedX;
            this.rotation += this.rotationSpeed;

            if (this.y > confettiCanvas.height) {
                this.y = -20;
                this.x = Math.random() * confettiCanvas.width;
            }
        }

        draw() {
            confettiCtx.save();
            confettiCtx.translate(this.x, this.y);
            confettiCtx.rotate(this.rotation * Math.PI / 180);
            confettiCtx.fillStyle = this.color;
            confettiCtx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
            confettiCtx.restore();
        }
    }

    function startConfettiEffect() {
        resizeConfettiCanvas();
        window.addEventListener('resize', resizeConfettiCanvas);
        confettiActive = true;
        particles = Array(120).fill(null).map(() => new ConfettiParticle());
        animateConfetti();
    }

    function stopConfettiEffect() {
        confettiActive = false;
        window.removeEventListener('resize', resizeConfettiCanvas);
        confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    }

    function animateConfetti() {
        if (!confettiActive) return;
        confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);

        particles.forEach(p => {
            p.update();
            p.draw();
        });

        requestAnimationFrame(animateConfetti);
    }

    // ==========================================================================
    // SISTEMA DE ADMINISTRACIÓN DE ANUNCIOS Y BANNERS (PUBLICIDAD)
    // ==========================================================================
    let activeAds = [];
    let uploadedAdImageBase64 = "";

    const ADS_API_URL = 'ads_api.php';

    async function fetchAdsFromServer() {
        const t = Date.now();
        try {
            const response = await fetch(`${ADS_API_URL}?t=${t}`);
            if (!response.ok) throw new Error('Error al obtener anuncios del servidor');
            const ads = await response.json();
            // Guardar copia local para offline fallback
            try {
                const localAds = await window.dbService.getAllAds();
                for (const la of localAds) {
                    await window.dbService.deleteAd(la.id);
                }
                for (const ad of ads) {
                    await window.dbService.saveAd(ad);
                }
            } catch (e) {
                console.warn("No se pudo actualizar el fallback local de anuncios:", e);
            }
            return ads;
        } catch (err) {
            console.warn("Fallo al conectar con el servidor de anuncios, usando base de datos local:", err);
            return await window.dbService.getAllAds();
        }
    }

    async function sendAdActionToServer(action, adData = null, adId = null) {
        const password = adminPasswordInput ? adminPasswordInput.value : "";
        const response = await fetch(ADS_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Password': password || "4206371Luis*"
            },
            body: JSON.stringify({ 
                action, 
                adData, 
                adId, 
                password: password || "4206371Luis*" 
            })
        });
        
        let result;
        try {
            result = await response.json();
        } catch (e) {
            throw new Error('Respuesta inválida del servidor');
        }

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Error al procesar solicitud en el servidor');
        }
        return result;
    }

    // Elementos del DOM para administración
    const adminAuthModal = document.getElementById('admin-auth-modal');
    const adminPasswordInput = document.getElementById('admin-password-input');
    const adminAuthError = document.getElementById('admin-auth-error');
    const btnAdminAccess = document.getElementById('btn-admin-access');
    const btnAdminAuthSubmit = document.getElementById('btn-admin-auth-submit');
    const btnAdminAuthCancel = document.getElementById('btn-admin-auth-cancel');
    const btnAdminBack = document.getElementById('btn-admin-back');

    const adminAdForm = document.getElementById('admin-ad-form');
    const adEditIdInput = document.getElementById('ad-edit-id');
    const adTitleInput = document.getElementById('ad-title');
    const adImageFileInput = document.getElementById('ad-image-file');
    const adImageDropzone = document.getElementById('ad-image-dropzone');
    const adImageStatus = document.getElementById('ad-image-status');
    const adImagePreview = document.getElementById('ad-image-preview');
    const adLinkUrlInput = document.getElementById('ad-link-url');
    const adStartDateInput = document.getElementById('ad-start-date');
    const adEndDateInput = document.getElementById('ad-end-date');
    const adShowMainCheckbox = document.getElementById('ad-show-main');
    const adShowCardsCheckbox = document.getElementById('ad-show-cards');
    const adShowPlayCheckbox = document.getElementById('ad-show-play');
    const btnAdSave = document.getElementById('btn-ad-save');
    const btnAdCancelEdit = document.getElementById('btn-ad-cancel-edit');
    const adminAdsList = document.getElementById('admin-ads-list');

    const adSyncEnabledToggle = document.getElementById('ad-sync-enabled');
    const adSyncUrlContainer = document.getElementById('ad-sync-url-container');
    const adSyncUrlInput = document.getElementById('ad-sync-url');
    const btnAdSyncNow = document.getElementById('btn-ad-sync-now');
    const btnAdExport = document.getElementById('btn-ad-export');
    const exportJsonContainer = document.getElementById('export-json-container');
    const exportJsonTextarea = document.getElementById('export-json-textarea');
    const btnCopyExportJson = document.getElementById('btn-copy-export-json');

    const adBannerContainer = document.getElementById('ad-banner-container');
    const adBannerLink = document.getElementById('ad-banner-link');
    const adBannerImage = document.getElementById('ad-banner-image');
    const btnAdClose = document.getElementById('btn-ad-close');

    // 1. Acceso seguro por contraseña
    if (btnAdminAccess) {
        btnAdminAccess.addEventListener('click', () => {
            adminPasswordInput.value = "";
            adminAuthError.classList.add('hidden');
            adminAuthModal.classList.remove('hidden');
            adminPasswordInput.focus();
        });
    }

    if (btnAdminAuthCancel) {
        btnAdminAuthCancel.addEventListener('click', () => {
            adminAuthModal.classList.add('hidden');
        });
    }

    function submitAdminPassword() {
        const password = adminPasswordInput.value;
        if (password === "4206371Luis*") {
            adminAuthModal.classList.add('hidden');
            adminAuthError.classList.add('hidden');
            showView('adminAds');
        } else {
            adminAuthError.classList.remove('hidden');
            // Efecto shake
            adminAuthError.style.animation = 'none';
            setTimeout(() => adminAuthError.style.animation = '', 10);
        }
    }

    if (btnAdminAuthSubmit) {
        btnAdminAuthSubmit.addEventListener('click', submitAdminPassword);
    }
    
    if (adminPasswordInput) {
        adminPasswordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                submitAdminPassword();
            }
        });
    }

    if (btnAdminBack) {
        btnAdminBack.addEventListener('click', () => {
            showView('config');
        });
    }

    // 2. Manejo de Subida de Imagen (FileReader a Base64)
    if (adImageDropzone) {
        adImageDropzone.addEventListener('click', () => adImageFileInput.click());
        
        adImageDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            adImageDropzone.style.borderColor = 'var(--primary-cyan)';
        });
        
        adImageDropzone.addEventListener('dragleave', () => {
            adImageDropzone.style.borderColor = 'var(--glass-border)';
        });
        
        adImageDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            adImageDropzone.style.borderColor = 'var(--glass-border)';
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                adImageFileInput.files = e.dataTransfer.files;
                handleAdImageSelect({ target: adImageFileInput });
            }
        });
    }
    
    if (adImageFileInput) {
        adImageFileInput.addEventListener('change', handleAdImageSelect);
    }

    function handleAdImageSelect(e) {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showToast('El archivo seleccionado no es una imagen.', 'danger');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            uploadedAdImageBase64 = event.target.result;
            adImagePreview.src = uploadedAdImageBase64;
            adImagePreview.classList.remove('hidden');
            adImageStatus.textContent = `Imagen cargada: ${file.name}`;
        };
        reader.readAsDataURL(file);
    }

    // 3. Formulario de guardar / editar anuncio
    if (btnAdSave) {
        btnAdSave.addEventListener('click', async (e) => {
            e.preventDefault();
            const title = adTitleInput.value.trim();
            const linkUrl = adLinkUrlInput.value.trim();
            const startDate = adStartDateInput.value;
            const endDate = adEndDateInput.value;
            const showOnMain = adShowMainCheckbox.checked;
            const showOnCards = adShowCardsCheckbox.checked;
            const showOnPlay = adShowPlayCheckbox.checked;
            const id = adEditIdInput.value || `ad_${Date.now()}`;

            if (!title) {
                showToast('Por favor, ingresa un título.', 'danger');
                return;
            }

            if (!uploadedAdImageBase64 && !adEditIdInput.value) {
                showToast('Por favor, sube una imagen de banner.', 'danger');
                return;
            }

            let existingAd = null;
            if (adEditIdInput.value) {
                // Si editamos y no cargamos nueva imagen, mantenemos la anterior
                const allAds = await fetchAdsFromServer();
                existingAd = allAds.find(a => a.id === adEditIdInput.value);
            }

            const adData = {
                id,
                title,
                imageUrl: uploadedAdImageBase64 || (existingAd ? existingAd.imageUrl : ""),
                linkUrl,
                startDate,
                endDate,
                showOnMain,
                showOnCards,
                showOnPlay,
                isActive: existingAd ? existingAd.isActive : true
            };

            try {
                await sendAdActionToServer('save', adData);
                showToast(adEditIdInput.value ? 'Anuncio actualizado con éxito.' : 'Anuncio guardado con éxito.');
                resetAdForm();
                await renderAdminAdsScreen();
                await bannerManager.refresh();
             } catch (err) {
                console.error(err);
                showToast('Error al guardar: ' + err.message, 'danger');
            }
        });
    }

    if (btnAdCancelEdit) {
        btnAdCancelEdit.addEventListener('click', () => {
            resetAdForm();
        });
    }

    function resetAdForm() {
        adEditIdInput.value = "";
        adTitleInput.value = "";
        adLinkUrlInput.value = "";
        adStartDateInput.value = "";
        adEndDateInput.value = "";
        adShowMainCheckbox.checked = true;
        adShowCardsCheckbox.checked = true;
        adShowPlayCheckbox.checked = true;
        adImageFileInput.value = "";
        adImagePreview.src = "";
        adImagePreview.classList.add('hidden');
        adImageStatus.textContent = "Haz clic o arrastra una imagen (Recomendado: 500x70)";
        uploadedAdImageBase64 = "";

        document.getElementById('ad-form-title').textContent = "Programar Nuevo Anuncio";
        btnAdSave.textContent = "Guardar Anuncio";
        btnAdCancelEdit.classList.add('hidden');
    }

    // 4. Renderizar panel administrador de anuncios
    async function renderAdminAdsScreen() {
        if (!adminAdsList) return;
        try {
            const allAds = await fetchAdsFromServer();
            adminAdsList.innerHTML = "";

            if (allAds.length === 0) {
                adminAdsList.innerHTML = `<p style="font-size:0.85rem; color:var(--text-muted); text-align:center; padding: 20px;">No hay anuncios programados todavía.</p>`;
                return;
            }

            allAds.forEach(ad => {
                const item = document.createElement('div');
                item.className = 'ad-list-item';
                item.style.cssText = 'display: flex; gap: 12px; background: rgba(15, 23, 42, 0.4); border: 1px solid var(--glass-border); border-radius: var(--border-radius-sm); padding: 12px; align-items: center;';
                
                const showScreens = [];
                if (ad.showOnMain) showScreens.push('Inicio');
                if (ad.showOnCards) showScreens.push('Galería');
                if (ad.showOnPlay) showScreens.push('Juego');

                item.innerHTML = `
                    <img src="${ad.imageUrl}" style="width: 60px; height: 40px; border-radius: 4px; object-fit: cover; background: #000; border: 1px solid rgba(255,255,255,0.05);">
                    <div style="flex: 1; min-width: 0;">
                        <h4 style="font-size: 0.9rem; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color:var(--text-main); font-weight:600;">${ad.title}</h4>
                        <p style="font-size: 0.75rem; color: var(--text-muted); margin: 2px 0 0 0;">
                            ${ad.startDate ? new Date(ad.startDate).toLocaleDateString() : 'Siempre'} - 
                            ${ad.endDate ? new Date(ad.endDate).toLocaleDateString() : 'Siempre'}
                        </p>
                        <p style="font-size: 0.7rem; color: var(--primary-cyan); margin: 2px 0 0 0; font-weight:600;">
                            ${showScreens.join(', ')}
                        </p>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-end;">
                        <label class="switch" style="transform: scale(0.8); transform-origin: right;">
                            <input type="checkbox" class="ad-toggle-active" data-id="${ad.id}" ${ad.isActive ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                        <div style="display: flex; gap: 6px;">
                            <button class="btn-edit-ad btn-icon" data-id="${ad.id}" title="Editar" style="padding: 4px; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius:4px; cursor:pointer;">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"/></svg>
                            </button>
                            <button class="btn-delete-ad btn-icon" data-id="${ad.id}" title="Eliminar" style="padding: 4px; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius:4px; color: var(--color-danger); cursor:pointer;">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                        </div>
                    </div>
                `;

                // Toggle active switch
                item.querySelector('.ad-toggle-active').addEventListener('change', async (e) => {
                    const adId = e.target.getAttribute('data-id');
                    const checked = e.target.checked;
                    const ad = allAds.find(a => a.id === adId);
                    if (ad) {
                        const previousState = ad.isActive;
                        ad.isActive = checked;
                        try {
                            await sendAdActionToServer('save', ad);
                            showToast(checked ? 'Anuncio activado.' : 'Anuncio desactivado.');
                            await bannerManager.refresh();
                        } catch (err) {
                            console.error(err);
                            e.target.checked = previousState;
                            ad.isActive = previousState;
                            showToast('Error al activar/desactivar: ' + err.message, 'danger');
                        }
                    }
                });

                // Edit click
                item.querySelector('.btn-edit-ad').addEventListener('click', () => {
                    adEditIdInput.value = ad.id;
                    adTitleInput.value = ad.title;
                    adLinkUrlInput.value = ad.linkUrl;
                    adStartDateInput.value = ad.startDate || "";
                    adEndDateInput.value = ad.endDate || "";
                    adShowMainCheckbox.checked = ad.showOnMain;
                    adShowCardsCheckbox.checked = ad.showOnCards;
                    adShowPlayCheckbox.checked = ad.showOnPlay;
                    
                    uploadedAdImageBase64 = ""; // Mantener la anterior
                    adImagePreview.src = ad.imageUrl;
                    adImagePreview.classList.remove('hidden');
                    adImageStatus.textContent = "Imagen actual (deja en blanco para mantener)";

                    document.getElementById('ad-form-title').textContent = "Editar Anuncio";
                    btnAdSave.textContent = "Actualizar Anuncio";
                    btnAdCancelEdit.classList.remove('hidden');
                    document.getElementById('ad-form-title').scrollIntoView({ behavior: 'smooth' });
                });

                // Delete click
                item.querySelector('.btn-delete-ad').addEventListener('click', async () => {
                    if (confirm(`¿Estás seguro de eliminar el anuncio "${ad.title}"?`)) {
                        try {
                            await sendAdActionToServer('delete', null, ad.id);
                            showToast('Anuncio eliminado.');
                            await renderAdminAdsScreen();
                            await bannerManager.refresh();
                        } catch (err) {
                            console.error(err);
                            showToast('Error al eliminar: ' + err.message, 'danger');
                        }
                    }
                });

                adminAdsList.appendChild(item);
            });
        } catch (err) {
            console.error(err);
            showToast('Error al renderizar los anuncios.', 'danger');
        }
    }

    // 5. Sincronización Remota e Importar/Exportar
    if (adSyncEnabledToggle) {
        adSyncEnabledToggle.addEventListener('change', async () => {
            const enabled = adSyncEnabledToggle.checked;
            adSyncUrlContainer.style.display = enabled ? 'flex' : 'none';
            await window.dbService.saveSetting('adSyncEnabled', enabled);
        });
    }

    if (adSyncUrlInput) {
        adSyncUrlInput.addEventListener('change', async () => {
            await window.dbService.saveSetting('adSyncUrl', adSyncUrlInput.value.trim());
        });
    }

    if (btnAdSyncNow) {
        btnAdSyncNow.addEventListener('click', syncAdsFromServer);
    }

    async function syncAdsFromServer() {
        const enabled = adSyncEnabledToggle.checked;
        const url = adSyncUrlInput.value.trim();
        if (!enabled || !url) {
            showToast('Por favor activa la sincronización remota e ingresa una URL válida.', 'warning');
            return;
        }

        btnAdSyncNow.disabled = true;
        btnAdSyncNow.querySelector('span').textContent = 'Sincronizando...';

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('Error al descargar anuncios');
            const data = await res.json();
            
            // Validar que la respuesta sea un array
            const adsToImport = Array.isArray(data) ? data : (data.ads || []);
            if (!Array.isArray(adsToImport)) {
                throw new Error('El formato JSON no es válido.');
            }

            // Guardar anuncios remotos en el servidor de hosting
            for (const remoteAd of adsToImport) {
                if (remoteAd.id && remoteAd.title && remoteAd.imageUrl) {
                    // Completar campos faltantes por seguridad
                    const adObj = {
                        id: remoteAd.id,
                        title: remoteAd.title,
                        imageUrl: remoteAd.imageUrl,
                        linkUrl: remoteAd.linkUrl || "",
                        startDate: remoteAd.startDate || "",
                        endDate: remoteAd.endDate || "",
                        showOnMain: remoteAd.showOnMain !== undefined ? remoteAd.showOnMain : true,
                        showOnCards: remoteAd.showOnCards !== undefined ? remoteAd.showOnCards : true,
                        showOnPlay: remoteAd.showOnPlay !== undefined ? remoteAd.showOnPlay : true,
                        isActive: remoteAd.isActive !== undefined ? remoteAd.isActive : true
                    };
                    await sendAdActionToServer('save', adObj);
                }
            }

            showToast('¡Sincronización remota completada con éxito!');
            await renderAdminAdsScreen();
            await bannerManager.refresh();
        } catch (err) {
            console.error(err);
            showToast('Fallo al sincronizar: ' + err.message, 'danger');
        } finally {
            btnAdSyncNow.disabled = false;
            btnAdSyncNow.querySelector('span').textContent = 'Sincronizar Ahora';
        }
    }

    if (btnAdExport) {
        btnAdExport.addEventListener('click', async () => {
            try {
                const allAds = await fetchAdsFromServer();
                exportJsonTextarea.value = JSON.stringify(allAds, null, 2);
                exportJsonContainer.classList.remove('hidden');
                exportJsonTextarea.scrollIntoView({ behavior: 'smooth' });
            } catch (err) {
                showToast('Error al exportar anuncios.', 'danger');
            }
        });
    }

    if (btnCopyExportJson) {
        btnCopyExportJson.addEventListener('click', () => {
            exportJsonTextarea.select();
            document.execCommand('copy');
            showToast('JSON copiado al portapapeles.');
        });
    }

    // Cargar configuraciones de sincronización inicial
    async function loadSyncSettings() {
        if (!adSyncEnabledToggle) return;
        const syncEnabled = await window.dbService.getSetting('adSyncEnabled', false);
        adSyncEnabledToggle.checked = syncEnabled;
        adSyncUrlContainer.style.display = syncEnabled ? 'flex' : 'none';

        const syncUrl = await window.dbService.getSetting('adSyncUrl', '');
        adSyncUrlInput.value = syncUrl;

        // Si la sincronización está activa y hay una URL, intentar sincronizar al iniciar (solo si el admin está autenticado)
        if (syncEnabled && syncUrl && adminPasswordInput && adminPasswordInput.value) {
            setTimeout(() => {
                syncAdsFromServer().catch(err => console.warn("Sincronización inicial falló:", err));
            }, 2000);
        }
    }
    await loadSyncSettings();

    // 6. Administrador del Banner (Visualización y rotación dinámica)
    class BannerManager {
        constructor() {
            this.rotationInterval = null;
            this.currentViewId = 'main';
            this.matchingAds = [];
            this.currentAdIndex = 0;
            this.isDismissedForView = false;
            
            // Vincular evento de cerrado
            if (btnAdClose) {
                btnAdClose.addEventListener('click', () => {
                    this.dismissBanner();
                });
            }
        }

        async refresh() {
            await this.updateBannerForView(this.currentViewId);
        }

        dismissBanner() {
            this.isDismissedForView = true;
            adBannerContainer.classList.add('hidden');
            document.querySelector('.app-main').classList.remove('has-ad');
            this.stopRotation();
        }

        stopRotation() {
            if (this.rotationInterval) {
                clearInterval(this.rotationInterval);
                this.rotationInterval = null;
            }
        }

        async updateBannerForView(viewId) {
            this.currentViewId = viewId;
            
            // Restablecer el estado de cerrado si cambiamos de vista
            this.isDismissedForView = false;
            this.stopRotation();

            // Vistas donde NO se debe mostrar la publicidad por usabilidad
            const bannedViews = ['install-gate', 'scan', 'verify', 'adminAds'];
            if (bannedViews.includes(viewId)) {
                adBannerContainer.classList.add('hidden');
                document.querySelector('.app-main').classList.remove('has-ad');
                return;
            }

            try {
                const allAds = await fetchAdsFromServer();
                const now = new Date();

                // Filtrar anuncios activos y programados
                this.matchingAds = allAds.filter(ad => {
                    if (!ad.isActive) return false;

                    // Validar filtros por vista activa
                    if (viewId === 'main' && !ad.showOnMain) return false;
                    if (viewId === 'cards' && !ad.showOnCards) return false;
                    if (viewId === 'play' && !ad.showOnPlay) return false;
                    if (viewId === 'config' && !ad.showOnMain) return false; // Mostramos los de main en config por consistencia

                    // Validar programación horaria
                    if (ad.startDate && now < new Date(ad.startDate)) return false;
                    if (ad.endDate && now > new Date(ad.endDate)) return false;

                    return true;
                });

                if (this.matchingAds.length === 0) {
                    adBannerContainer.classList.add('hidden');
                    document.querySelector('.app-main').classList.remove('has-ad');
                    return;
                }

                // Iniciar visualización
                this.currentAdIndex = 0;
                this.displayAd(this.matchingAds[0]);

                if (this.matchingAds.length > 1) {
                    // Rotar cada 10 segundos
                    this.rotationInterval = setInterval(() => {
                        this.currentAdIndex = (this.currentAdIndex + 1) % this.matchingAds.length;
                        this.displayAd(this.matchingAds[this.currentAdIndex]);
                    }, 10000);
                }
            } catch (err) {
                console.error("Error al cargar publicidad para el banner:", err);
            }
        }

        displayAd(ad) {
            if (this.isDismissedForView) return;

            // Suave transición fade-out
            adBannerImage.style.opacity = '0';
            
            setTimeout(() => {
                adBannerImage.src = ad.imageUrl;
                adBannerImage.alt = ad.title;
                
                if (ad.linkUrl) {
                    adBannerLink.href = ad.linkUrl;
                    adBannerLink.style.pointerEvents = 'auto';
                } else {
                    adBannerLink.removeAttribute('href');
                    adBannerLink.style.pointerEvents = 'none';
                }

                // Fade-in
                adBannerImage.style.opacity = '1';

                // Mostrar el contenedor
                adBannerContainer.classList.remove('hidden');
                document.querySelector('.app-main').classList.add('has-ad');
            }, 250);
        }
    }

    // Instanciar el gestor globalmente
    window.bannerManager = new BannerManager();
    // Forzar actualización inicial
    setTimeout(() => {
        window.bannerManager.updateBannerForView('main');
    }, 1000);
});
