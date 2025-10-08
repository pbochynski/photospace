/**
 * Embedding Processor Module
 * Manages embedding generation workers and processing queue
 */

import { db } from './db.js';

export class EmbeddingProcessor {
    constructor(options = {}) {
        // Callbacks for UI updates and service worker
        this.updateStatus = options.updateStatus || (() => {});
        this.updateButton = options.updateButton || (() => {});
        this.initializeServiceWorker = options.initializeServiceWorker || (async () => {});
        
        // Worker management
        this.workers = [];
        this.workersInitialized = false;
        
        // Queue management
        this.queue = [];
        this.isProcessing = false;
        this.isPaused = false;
        this.currentPromise = null;
    }
    
    /**
     * Get worker count setting from database
     * @returns {Promise<number>} Worker count
     */
    async getWorkerCount() {
        try {
            const workerCount = await db.getSetting('workerCount');
            return (workerCount != null) ? workerCount : 4;
        } catch (error) {
            console.error('Error getting worker count:', error);
            return 4;
        }
    }
    
    /**
     * Add photos to embedding queue
     * @param {Array<Object>} photos - Photos to add
     * @param {boolean} priority - If true, add to beginning of queue
     */
    async addToQueue(photos, priority = false) {
        if (!photos || photos.length === 0) return;
        
        // Filter out photos that are already in the queue
        const queuedFileIds = new Set(this.queue.map(p => p.file_id));
        const newPhotos = photos.filter(p => !queuedFileIds.has(p.file_id));
        
        if (newPhotos.length === 0) {
            console.log(`⏭️ Skipped adding photos - all ${photos.length} already in queue`);
            return;
        }
        
        if (priority) {
            // Add to beginning of queue (priority for browsed folders)
            this.queue.unshift(...newPhotos);
            console.log(`✨ Added ${newPhotos.length} photos to beginning of embedding queue (priority)`);
        } else {
            // Add to end of queue
            this.queue.push(...newPhotos);
            console.log(`📥 Added ${newPhotos.length} photos to embedding queue`);
        }
        
        // Update button state
        this.updateButton();
    }
    
    /**
     * Initialize persistent workers
     */
    async initializeWorkers() {
        if (this.workersInitialized) {
            console.log('Workers already initialized');
            return;
        }
        
        const numWorkers = await this.getWorkerCount();
        console.log(`🚀 Initializing ${numWorkers} persistent workers...`);
        
        // Create workers with event listeners attached immediately
        const readyPromises = [];
        
        for (let i = 0; i < numWorkers; i++) {
            const worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
            
            const workerInfo = {
                worker,
                id: i,
                busy: false,
                ready: false
            };
            
            // Create promise that resolves when this worker is ready
            const readyPromise = new Promise((resolve) => {
                const handleInit = (event) => {
                    if (event.data.status === 'model_ready') {
                        workerInfo.ready = true;
                        console.log(`✅ Worker ${i} ready (models loaded)`);
                        worker.removeEventListener('message', handleInit);
                        resolve();
                    } else if (event.data.status === 'model_loading') {
                        console.log(`⏳ Worker ${i} loading models...`);
                    }
                };
                worker.addEventListener('message', handleInit);
            });
            
            readyPromises.push(readyPromise);
            
            worker.onerror = (err) => {
                console.error(`Worker ${i} error:`, err);
            };
            
            this.workers.push(workerInfo);
            
            // Send worker ID
            worker.postMessage({ type: 'setWorkerId', workerId: i });
            
            // Initialize worker (load models)
            worker.postMessage({ type: 'init' });
        }
        
        this.workersInitialized = true;
        console.log(`✅ ${numWorkers} workers initialized, waiting for models to load...`);
        
        // Wait for all workers to finish loading models
        await Promise.all(readyPromises);
        console.log(`🎉 All ${numWorkers} workers ready!`);
    }
    
    /**
     * Terminate all workers (cleanup)
     */
    terminateWorkers() {
        console.log('🛑 Terminating all workers...');
        this.workers.forEach(w => w.worker.terminate());
        this.workers = [];
        this.workersInitialized = false;
    }
    
    /**
     * Start embedding workers to process the queue
     */
    async start() {
        if (this.isProcessing) {
            console.log('Embedding workers already running');
            return;
        }
        
        if (this.queue.length === 0) {
            // Check for photos without embeddings
            const photosWithoutEmbeddings = await db.getPhotosWithoutEmbedding();
            if (photosWithoutEmbeddings.length > 0) {
                this.queue.push(...photosWithoutEmbeddings);
                console.log(`📥 Added ${photosWithoutEmbeddings.length} photos without embeddings to queue`);
            } else {
                this.updateStatus('No photos need embeddings', false);
                return;
            }
        }
        
        // Initialize workers if not already done
        if (!this.workersInitialized) {
            await this.initializeWorkers();
        }
        
        this.isProcessing = true;
        this.isPaused = false;
        this.updateButton();
        
        this.currentPromise = this.processQueue();
    }
    
    /**
     * Pause embedding workers (workers stay alive, just stop processing queue)
     */
    pause() {
        this.isPaused = true;
        this.updateButton();
        this.updateStatus('Embedding generation paused', false);
        console.log('⏸️ Embedding generation paused (workers still alive)');
    }
    
    /**
     * Resume embedding workers
     */
    async resume() {
        if (!this.isProcessing && this.queue.length > 0) {
            this.start();
        } else {
            this.isPaused = false;
            this.updateButton();
            this.updateStatus('Embedding generation resumed', false);
            console.log('▶️ Embedding generation resumed');
        }
    }
    
    /**
     * Process the embedding queue using persistent workers
     */
    async processQueue() {
        console.log(`📊 Starting queue processing: ${this.queue.length} photos`);
        
        // Workers are already ready after initializeWorkers()
        this.updateStatus(`Processing ${this.queue.length} photos...`, true, 0, this.queue.length);
        
        let processedCount = 0;
        const totalToProcess = this.queue.length;
        
        console.log(`💻 Using client-side processing for ${totalToProcess} photos`);
        
        // Send auth token to service worker
        try {
            await this.initializeServiceWorker();
        } catch (error) {
            console.error('Failed to send auth token to service worker:', error);
        }
        
        // Process photos using persistent workers (client-side only)
        while (this.queue.length > 0 && !this.isPaused) {
            // Find an available worker
            const availableWorker = this.workers.find(w => w.ready && !w.busy);
            
            if (!availableWorker) {
                // All workers busy, wait a bit
                await new Promise(resolve => setTimeout(resolve, 50));
                continue;
            }
            
            // Get next photo from queue
            const photo = this.queue.shift();
            availableWorker.busy = true;
            
            // Process this photo
            const promise = new Promise((resolve) => {
                const handleMessage = async (event) => {
                    // Handle console messages from worker
                    if (event.data.type === 'console') {
                        if (window.debugConsole) {
                            window.debugConsole.addEntry(event.data.level, event.data.args);
                        }
                        return;
                    }
                    
                    const { file_id, status, embedding, qualityMetrics, error } = event.data;
                    
                    if (file_id !== photo.file_id) return; // Not for this photo
                    
                    if (status === 'complete') {
                        await db.updatePhotoEmbedding(file_id, embedding, qualityMetrics);
                        processedCount++;
                        this.updateStatus(`Processing photos... ${processedCount}/${totalToProcess} complete, ${this.queue.length} in queue`, true, processedCount, totalToProcess);
                        availableWorker.busy = false;
                        availableWorker.worker.removeEventListener('message', handleMessage);
                        resolve();
                    } else if (status === 'error') {
                        console.error(`Worker error for file ${file_id}:`, error);
                        processedCount++;
                        this.updateStatus(`Processing photos... ${processedCount}/${totalToProcess} complete, ${this.queue.length} in queue (some errors)`, true, processedCount, totalToProcess);
                        availableWorker.busy = false;
                        availableWorker.worker.removeEventListener('message', handleMessage);
                        resolve();
                    }
                };
                
                availableWorker.worker.addEventListener('message', handleMessage);
                // Send photo data to worker (client-side processing only)
                availableWorker.worker.postMessage(photo);
            });
            
            // Don't wait for this promise, continue sending work to other workers
            promise.catch(err => console.error('Error processing photo:', err));
        }
        
        // Wait for all workers to finish
        console.log('⏳ Waiting for all workers to finish...');
        while (this.workers.some(w => w.busy)) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        this.isProcessing = false;
        this.updateButton();
        
        if (this.queue.length === 0) {
            this.updateStatus('All photos processed!', false);
            console.log('✅ Embedding queue empty - all photos processed');
        } else if (this.isPaused) {
            this.updateStatus(`Paused - ${this.queue.length} photos remaining in queue`, false);
            console.log('⏸️ Paused - photos remain in queue:', this.queue.length);
        }
    }
    
    /**
     * Get current state for UI
     * @returns {Object} Current state
     */
    getState() {
        return {
            queueLength: this.queue.length,
            isProcessing: this.isProcessing,
            isPaused: this.isPaused,
            workersInitialized: this.workersInitialized,
            workerCount: this.workers.length
        };
    }
}

