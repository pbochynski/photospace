import { db } from './db.js';

export class QualityProcessor extends EventTarget {
    constructor(workerCount = 2) {
        super();
        this._workerCount = workerCount;
        this._workers = [];
        this._queue = [];
        this._processing = new Set();
        this._initialized = false;
        this._workerLoad = new Map();
    }

    async init() {
        if (this._initialized) return;
        for (let i = 0; i < this._workerCount; i++) {
            const worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
            this._workerLoad.set(worker, null);
            await new Promise((resolve) => {
                worker.onmessage = (e) => {
                    if (e.data.type === 'ready') resolve();
                    else this._handleMessage(e.data, worker);
                };
                worker.postMessage({ type: 'init', workerId: `Q${i}` });
            });
            worker.onmessage = (e) => this._handleMessage(e.data, worker);
            this._workers.push(worker);
        }
        this._initialized = true;
        console.log(`QualityProcessor: ${this._workerCount} workers ready`);
    }

    _handleMessage(data, worker) {
        if (data.type === 'console') return;
        if (data.type === 'quality_result') {
            this._workerLoad.set(worker, null);
            this._processing.delete(data.fileId);
            db.updatePhotoEmbedding(data.fileId, null, data.qualityMetrics)
                .then(() => {
                    this.dispatchEvent(new CustomEvent('quality_done', { detail: { fileId: data.fileId, metrics: data.qualityMetrics } }));
                })
                .catch(err => console.warn('QualityProcessor: DB write failed for', data.fileId, err))
                .finally(() => this._processNext());
        } else if (data.type === 'quality_error') {
            this._workerLoad.set(worker, null);
            this._processing.delete(data.fileId);
            console.warn('Quality error for', data.fileId, data.error);
            this._processNext();
        }
    }

    enqueue(fileId, fetchUrl, authToken) {
        if (this._processing.has(fileId) || this._queue.some(t => t.fileId === fileId)) return;
        this._queue.push({ fileId, fetchUrl, authToken });
        this._processNext();
    }

    _processNext() {
        if (this._queue.length === 0) return;
        const availableWorker = this._workers.find(w => this._workerLoad.get(w) === null);
        if (!availableWorker) return;
        const task = this._queue.shift();
        this._processing.add(task.fileId);
        this._workerLoad.set(availableWorker, task.fileId);
        availableWorker.postMessage({ type: 'process_photo', ...task });
    }

    get pendingCount() {
        return this._queue.length + this._processing.size;
    }

    terminate() {
        this._workers.forEach(w => w.terminate());
        this._workers = [];
        this._workerLoad = new Map();
        this._queue = [];
        this._processing = new Set();
        this._initialized = false;
    }
}

export const qualityProcessor = new QualityProcessor(2);
