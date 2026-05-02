import { db } from './db.js';

const QUEUE_KEY = 'scanQueue';

export class ScanQueue {
    constructor() {
        this._queue = [];
        this._loaded = false;
    }

    async load() {
        const saved = await db.getSetting(QUEUE_KEY);
        this._queue = Array.isArray(saved) ? saved : [];
        this._loaded = true;
    }

    async _persist() {
        await db.setSetting(QUEUE_KEY, this._queue);
    }

    async enqueue(entry) {
        if (!this._loaded) await this.load();
        const exists = this._queue.some(e => e.folderId === entry.folderId);
        if (exists) {
            if (entry.priority === 'high') {
                this._queue = this._queue.filter(e => e.folderId !== entry.folderId);
            } else {
                return;
            }
        }
        if (entry.priority === 'high') {
            const firstNormal = this._queue.findIndex(e => e.priority === 'normal');
            firstNormal === -1 ? this._queue.push(entry) : this._queue.splice(firstNormal, 0, entry);
        } else {
            this._queue.push(entry);
        }
        await this._persist();
    }

    async dequeue() {
        if (!this._loaded) await this.load();
        if (this._queue.length === 0) return null;
        const entry = this._queue.shift();
        await this._persist();
        return entry;
    }

    async isEmpty() {
        if (!this._loaded) await this.load();
        return this._queue.length === 0;
    }

    async getAll() {
        if (!this._loaded) await this.load();
        return [...this._queue];
    }

    async remove(folderId) {
        if (!this._loaded) await this.load();
        this._queue = this._queue.filter(e => e.folderId !== folderId);
        await this._persist();
    }

    async clear() {
        this._queue = [];
        await this._persist();
    }

    get length() { return this._queue.length; }
}

export const scanQueue = new ScanQueue();
