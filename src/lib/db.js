class PhotoDB {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            // Bump version to trigger onupgradeneeded
            const request = indexedDB.open('PhotoSpaceDB', 3);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('photos')) {
                    const store = db.createObjectStore('photos', { keyPath: 'file_id' });
                    store.createIndex('by_timestamp', 'photo_taken_ts');
                    store.createIndex('by_embedding_status', 'embedding_status');
                }
                // NEW: Add a key-value store for app settings
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

    async addOrUpdatePhotos(photos) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("Database not initialized.");
            const tx = this.db.transaction('photos', 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onerror = (event) => reject(event.target.error);
            const store = tx.objectStore('photos');
            for (const photo of photos) {
                store.put(photo);
            }
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