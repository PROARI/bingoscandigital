/* BINGO SCAN DIGITAL - BASE DE DATOS (INDEXEDDB) */

const DB_NAME = 'BingoScanDB';
const DB_VERSION = 2;

class BingoDB {
    constructor() {
        this.db = null;
    }

    /**
     * Inicializa la base de datos y crea los almacenes de objetos si no existen.
     */
    init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (e) => {
                console.error("Error al abrir IndexedDB:", e);
                reject("No se pudo iniciar la base de datos.");
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (e) => {
                const db = e.target.result;

                // Almacén para los cartones
                if (!db.objectStoreNames.contains('cards')) {
                    db.createObjectStore('cards', { keyPath: 'id' });
                }

                // Almacén para configuraciones/preferencias
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                // Almacén para anuncios (publicidad)
                if (!db.objectStoreNames.contains('ads')) {
                    db.createObjectStore('ads', { keyPath: 'id' });
                }
            };
        });
    }

    /* --- OPERACIONES DE CARTONES --- */

    /**
     * Guarda un cartón nuevo o actualiza uno existente.
     * @param {Object} card Objeto del cartón
     */
    saveCard(card) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['cards'], 'readwrite');
            const store = transaction.objectStore('cards');
            const request = store.put(card);

            request.onsuccess = () => resolve(card);
            request.onerror = () => reject("Error al guardar el cartón.");
        });
    }

    /**
     * Recupera todos los cartones guardados.
     */
    getAllCards() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['cards'], 'readonly');
            const store = transaction.objectStore('cards');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject("Error al recuperar los cartones.");
        });
    }

    /**
     * Recupera un cartón por su ID.
     */
    getCardById(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['cards'], 'readonly');
            const store = transaction.objectStore('cards');
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(`Error al recuperar el cartón con ID ${id}.`);
        });
    }

    /**
     * Elimina un cartón por su ID.
     */
    deleteCard(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['cards'], 'readwrite');
            const store = transaction.objectStore('cards');
            const request = store.delete(id);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(`Error al eliminar el cartón con ID ${id}.`);
        });
    }

    /* --- OPERACIONES DE CONFIGURACIÓN --- */

    /**
     * Guarda una preferencia de configuración.
     * @param {string} key Clave de la configuración
     * @param {*} value Valor
     */
    saveSetting(key, value) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['settings'], 'readwrite');
            const store = transaction.objectStore('settings');
            const request = store.put({ key, value });

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(`Error al guardar configuración: ${key}.`);
        });
    }

    /**
     * Obtiene una preferencia de configuración.
     * @param {string} key Clave
     * @param {*} defaultValue Valor por defecto si no existe
     */
    getSetting(key, defaultValue = null) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['settings'], 'readonly');
            const store = transaction.objectStore('settings');
            const request = store.get(key);

            request.onsuccess = () => {
                if (request.result) {
                    resolve(request.result.value);
                } else {
                    resolve(defaultValue);
                }
            };
            request.onerror = () => reject(`Error al leer configuración: ${key}.`);
        });
    }
}

// Exportar una instancia global
window.dbService = new BingoDB();
