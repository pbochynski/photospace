export class PhotoDB {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('PhotoSpaceDB', 7);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                let store;
                if (!db.objectStoreNames.contains('photos')) {
                    store = db.createObjectStore('photos', { keyPath: 'file_id' });
                    store.createIndex('by_timestamp', 'photo_taken_ts');
                } else {
                    store = event.target.transaction.objectStore('photos');
                }

                if (store.indexNames.contains('by_embedding_status')) {
                    store.deleteIndex('by_embedding_status');
                }
                if (!store.indexNames.contains('by_scan_id')) {
                    store.createIndex('by_scan_id', 'scan_id');
                }
                if (!store.indexNames.contains('by_folder_id')) {
                    store.createIndex('by_folder_id', 'folder_id');
                }
                if (!store.indexNames.contains('by_item_type')) {
                    store.createIndex('by_item_type', 'item_type');
                }

                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('Database initialized');
                resolve();
            };

            request.onerror = (event) => {
                console.error('Database error:', event.target.errorCode);
                reject(event.target.error);
            };
        });
    }

    async addOrUpdatePhotos(photos) {        return new Promise((resolve, reject) => {
            if (!this.db) return reject("Database not initialized.");
            const tx = this.db.transaction('photos', 'readwrite');
            const store = tx.objectStore('photos');

            let promises = photos.map(newPhoto => {
                return new Promise((resolvePhoto, rejectPhoto) => {
                    const request = store.get(newPhoto.file_id);
                    request.onsuccess = () => {
                        const existingPhoto = request.result;
                        if (existingPhoto) {
                            existingPhoto.scan_id = newPhoto.scan_id;
                            store.put(existingPhoto);
                        } else {
                            store.put(newPhoto);
                        }
                        resolvePhoto();
                    };
                    request.onerror = (e) => rejectPhoto(e.target.error);
                });
            });

            Promise.all(promises)
                .then(() => tx.done)
                .then(resolve)
                .catch(reject);
        });
    }

    async deleteStalePhotosInFolder(folderId, scanId) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('photos', 'readwrite');
            const store = tx.objectStore('photos');
            const index = store.index('by_folder_id');
            let deletedCount = 0;
            const cursorRequest = index.openCursor(IDBKeyRange.only(folderId));
            cursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    if (cursor.value.scan_id !== scanId) {
                        store.delete(cursor.primaryKey);
                        deletedCount++;
                    }
                    cursor.continue();
                } else {
                    resolve(deletedCount);
                }
            };
            cursorRequest.onerror = (e) => reject(e.target.error);
        });
    }

    async getPhotosByFolderId(folderId) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('photos', 'readonly');
            const index = tx.objectStore('photos').index('by_folder_id');
            const request = index.getAll(folderId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async getItemsByType(itemType) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('photos', 'readonly');
            const index = tx.objectStore('photos').index('by_item_type');
            const request = index.getAll(itemType);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async getPhotosByMonth(year, month) {
        const pad = (n) => String(n).padStart(2, '0');
        const lower = `${year}-${pad(month)}-01T00:00:00.000Z`;
        const upper = `${year}-${pad(month)}-31T23:59:59.999Z`;
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('photos', 'readonly');
            const index = tx.objectStore('photos').index('by_timestamp');
            const range = IDBKeyRange.bound(lower, upper);
            const request = index.getAll(range);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async rebuildMonthIndex() {
        const index = {};
        const photos = await new Promise((resolve, reject) => {
            const tx = this.db.transaction('photos', 'readonly');
            const request = tx.objectStore('photos').getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
        for (const photo of photos) {
            if (!photo.photo_taken_ts) continue;
            const key = photo.photo_taken_ts.slice(0, 7); // "YYYY-MM"
            index[key] = (index[key] || 0) + 1;
        }
        await this.setSetting('monthIndex', index);
        return index;
    }

    async getSetting(key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('settings', 'readonly');
            const store = tx.objectStore('settings');
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result?.value);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async setSetting(key, value) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('settings', 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onerror = (event) => reject(event.target.error);
            const store = tx.objectStore('settings');
            store.put({ key, value });
        });
    }

    async deletePhotos(photoIds) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("Database not initialized.");
            const tx = this.db.transaction('photos', 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onerror = (event) => reject(event.target.error);
            const store = tx.objectStore('photos');
            for (const id of photoIds) {
                store.delete(id);
            }
        });
    }

    async clearAllPhotos() {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("Database not initialized.");
            const tx = this.db.transaction('photos', 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onerror = (event) => reject(event.target.error);
            const store = tx.objectStore('photos');
            store.clear();
        });
    }

    async getPhotoById(fileId) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("Database not initialized.");
            const tx = this.db.transaction('photos', 'readonly');
            const store = tx.objectStore('photos');
            const request = store.get(fileId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async getPhotoCount() {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("Database not initialized.");
            const tx = this.db.transaction('photos', 'readonly');
            const store = tx.objectStore('photos');
            const request = store.count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }
}

export const db = new PhotoDB();
