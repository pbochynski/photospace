class PhotoDB {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('PhotoSpaceDB', 2);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('photos')) {
                    const store = db.createObjectStore('photos', { keyPath: 'file_id' });
                    store.createIndex('by_timestamp', 'photo_taken_ts');
                    store.createIndex('by_embedding_status', 'embedding_status');
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

    async addPhotos(photos) {
        const tx = this.db.transaction('photos', 'readwrite');
        const store = tx.objectStore('photos');
        for (const photo of photos) {
            // Use put to upsert - avoids errors on re-scans
            store.put(photo);
        }
        return tx.done;
    }
    
    async updatePhotoEmbedding(file_id, embedding) {
        const tx = this.db.transaction('photos', 'readwrite');
        const store = tx.objectStore('photos');
        const request = store.get(file_id);
        
        return new Promise((resolve, reject) => {
           request.onsuccess = () => {
                const photo = request.result;
                if (photo) {
                    photo.embedding = embedding;
                    photo.embedding_status = 1; // 1 = done
                    store.put(photo);
                    resolve();
                } else {
                    reject(`Photo with id ${file_id} not found.`);
                }
           };
           request.onerror = (event) => reject(event.target.error);
        });
    }

    async getPhotosWithoutEmbedding() {
        const tx = this.db.transaction('photos', 'readonly');
        const store = tx.objectStore('photos');
        const index = store.index('by_embedding_status');
        return index.getAll(0); // 0 = new
    }

    async getAllPhotosWithEmbedding() {
        const tx = this.db.transaction('photos', 'readonly');
        const store = tx.objectStore('photos');
        const index = store.index('by_embedding_status');
        return index.getAll(1); // 1 = done
    }
    
    async getPhotoCount() {
        const tx = this.db.transaction('photos', 'readonly');
        const store = tx.objectStore('photos');
        return store.count();
    }
}

export const db = new PhotoDB();