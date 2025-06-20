class PhotoDB {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            // Bump version to trigger onupgradeneeded for the new index
            const request = indexedDB.open('PhotoSpaceDB', 4);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                let store;
                if (!db.objectStoreNames.contains('photos')) {
                    store = db.createObjectStore('photos', { keyPath: 'file_id' });
                    store.createIndex('by_timestamp', 'photo_taken_ts');
                    store.createIndex('by_embedding_status', 'embedding_status');
                } else {
                    store = event.target.transaction.objectStore('photos');
                }
                
                // NEW: Add an index for scan_id if it doesn't exist
                if (!store.indexNames.contains('by_scan_id')) {
                    store.createIndex('by_scan_id', 'scan_id');
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

    // --- NEW Smarter "upsert" function ---
    async addOrUpdatePhotos(photos) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("Database not initialized.");
            const tx = this.db.transaction('photos', 'readwrite');
            const store = tx.objectStore('photos');

            let promises = photos.map(newPhoto => {
                return new Promise((resolvePhoto, rejectPhoto) => {
                    const request = store.get(newPhoto.file_id);
                    request.onsuccess = () => {
                        const existingPhoto = request.result;
                        if (existingPhoto) {
                            // Photo exists, update only the scan_id
                            existingPhoto.scan_id = newPhoto.scan_id;
                            store.put(existingPhoto);
                        } else {
                            // New photo, add it completely
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

    // --- NEW function to clean up old files ---
    async deletePhotosNotMatchingScanId(currentScanId) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('photos', 'readwrite');
            const store = tx.objectStore('photos');
            const index = store.index('by_scan_id');
            const range = IDBKeyRange.upperBound(currentScanId, true); // Everything less than currentScanId

            let deletedCount = 0;
            const cursorRequest = index.openCursor(range);
            
            cursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    store.delete(cursor.primaryKey);
                    deletedCount++;
                    cursor.continue();
                } else {
                    // End of cursor
                    console.log(`Deleted ${deletedCount} stale photos.`);
                    resolve(deletedCount);
                }
            };
            cursorRequest.onerror = (event) => reject(event.target.error);
        });
    }
        
    // NEW: Functions to get/set settings like the deltaLink
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
    
    // --- Unchanged functions from before ---
    async updatePhotoEmbedding(file_id, embedding) { /* ... same as before ... */ }
    async getPhotosWithoutEmbedding() { /* ... same as before ... */ }
    async getAllPhotosWithEmbedding() { /* ... same as before ... */ }
    async getPhotoCount() { /* ... same as before ... */ }
}

// Re-paste unchanged functions here to have a complete file
PhotoDB.prototype.updatePhotoEmbedding = async function(file_id, embedding) {
    return new Promise((resolve, reject) => {
        const tx = this.db.transaction('photos', 'readwrite');
        const store = tx.objectStore('photos');
        const request = store.get(file_id);
        
        request.onsuccess = () => {
             const photo = request.result;
             if (photo) {
                 photo.embedding = embedding;
                 photo.embedding_status = 1;
                 store.put(photo);
                 resolve();
             } else {
                 reject(`Photo with id ${file_id} not found.`);
             }
        };
        request.onerror = (event) => reject(event.target.error);
    });
};
PhotoDB.prototype.getPhotosWithoutEmbedding = async function() {
    const tx = this.db.transaction('photos', 'readonly');
    const store = tx.objectStore('photos');
    const index = store.index('by_embedding_status');
    return new Promise((resolve, reject) => {
        const request = index.getAll(0);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
};
PhotoDB.prototype.getAllPhotosWithEmbedding = async function() {
    const tx = this.db.transaction('photos', 'readonly');
    const store = tx.objectStore('photos');
    const index = store.index('by_embedding_status');
    return new Promise((resolve, reject) => {
        const request = index.getAll(1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
};
PhotoDB.prototype.getPhotoCount = async function() {
    return new Promise((resolve, reject) => {
        if (!this.db) return reject("Database not initialized.");
        const tx = this.db.transaction('photos', 'readonly');
        const store = tx.objectStore('photos');
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
};


export const db = new PhotoDB();