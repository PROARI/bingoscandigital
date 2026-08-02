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

    /* --- OPERACIONES DE ANUNCIOS --- */

    /**
     * Guarda un anuncio nuevo o actualiza uno existente en el hosting y actualiza caché local.
     * @param {Object} ad Objeto del anuncio
     */
    saveAd(ad) {
        return new Promise(async (resolve, reject) => {
            const adminPassword = sessionStorage.getItem('adminPassword') || '';
            try {
                const response = await fetch('./ads.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Admin-Password': adminPassword
                    },
                    body: JSON.stringify({
                        action: 'save',
                        ad: ad
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || `Error del servidor: ${response.status}`);
                }

                // Guardar también en la caché local IndexedDB
                const transaction = this.db.transaction(['ads'], 'readwrite');
                const store = transaction.objectStore('ads');
                const request = store.put(ad);
                request.onsuccess = () => resolve(ad);
                request.onerror = () => reject("Guardado en hosting, pero falló la caché local.");
            } catch (err) {
                console.error("Error al guardar anuncio en hosting:", err);
                reject(err.message || err);
            }
        });
    }

    /**
     * Recupera todos los anuncios desde el hosting, sincroniza caché local y retorna.
     * Con fallback a IndexedDB si se encuentra sin conexión.
     */
    getAllAds() {
        return new Promise(async (resolve, reject) => {
            try {
                // Forzar consulta a la red agregando timestamp
                const response = await fetch(`./ads.php?t=${Date.now()}`);
                if (!response.ok) throw new Error("HTTP " + response.status);
                const ads = await response.json();
                if (Array.isArray(ads)) {
                    // Sincronizar en caché local de IndexedDB
                    const transaction = this.db.transaction(['ads'], 'readwrite');
                    const store = transaction.objectStore('ads');
                    store.clear();
                    ads.forEach(ad => store.put(ad));
                    resolve(ads);
                    return;
                }
            } catch (err) {
                console.warn("No se pudo obtener anuncios desde el hosting, usando caché local:", err);
            }

            // Fallback a IndexedDB local
            try {
                const transaction = this.db.transaction(['ads'], 'readonly');
                const store = transaction.objectStore('ads');
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject("Error al recuperar anuncios de caché local.");
            } catch (errDb) {
                reject("Fallo general de base de datos local: " + errDb);
            }
        });
    }

    /**
     * Elimina un anuncio por su ID del hosting y actualiza la caché local.
     */
    deleteAd(id) {
        return new Promise(async (resolve, reject) => {
            const adminPassword = sessionStorage.getItem('adminPassword') || '';
            try {
                const response = await fetch('./ads.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Admin-Password': adminPassword
                    },
                    body: JSON.stringify({
                        action: 'delete',
                        id: id
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || `Error del servidor: ${response.status}`);
                }

                // Eliminar de la caché local de IndexedDB
                const transaction = this.db.transaction(['ads'], 'readwrite');
                const store = transaction.objectStore('ads');
                const request = store.delete(id);
                request.onsuccess = () => resolve(true);
                request.onerror = () => reject("Eliminado de hosting, pero falló la caché local.");
            } catch (err) {
                console.error("Error al eliminar anuncio del hosting:", err);
                reject(err.message || err);
            }
        });
    }
}

// Exportar una instancia global
window.dbService = new BingoDB();
