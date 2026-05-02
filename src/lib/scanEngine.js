import { scanQueue } from './scanQueue.js';
import { fetchPhotosFromSingleFolder } from './graph.js';
import { db } from './db.js';
import { calibrateFolder } from './calibration.js';

export class ScanEngine extends EventTarget {
    constructor() {
        super();
        this._running = false;
        this._abortController = null;
        this._currentFolderId = null;
        this._folderStatus = new Map();
    }

    getFolderStatus(folderId) {
        return this._folderStatus.get(folderId) || 'not_scanned';
    }

    _setFolderStatus(folderId, status, photoCount = null) {
        this._folderStatus.set(folderId, status);
        this.dispatchEvent(new CustomEvent('folder_status', {
            detail: { folderId, status, photoCount }
        }));
    }

    async enqueueFolder(folderId, folderPath, driveId, priority = 'normal') {
        await scanQueue.enqueue({ folderId, folderPath, driveId, priority });
        if (!this._running) this.start();
    }

    async start() {
        if (this._running) return;
        this._running = true;
        this.dispatchEvent(new CustomEvent('scan_started'));

        while (!(await scanQueue.isEmpty())) {
            const entry = await scanQueue.dequeue();
            if (!entry) break;

            const { folderId, folderPath } = entry;
            this._currentFolderId = folderId;
            this._setFolderStatus(folderId, 'scanning');

            try {
                const scanId = crypto.randomUUID();
                this.dispatchEvent(new CustomEvent('folder_scan_start', { detail: { folderId, folderPath } }));

                const photoCount = await fetchPhotosFromSingleFolder(scanId, folderId);

                await db.deleteStalePhotosInFolder(folderId, scanId);

                const photos = await db.getPhotosByFolderId(folderId);
                if (photos.length >= 50) {
                    await calibrateFolder(folderId);
                }

                const lastScannedAt = Date.now();
                const folderMeta = (await db.getSetting('folderMeta')) || {};
                folderMeta[folderId] = { lastScannedAt, photoCount: photos.length };
                await db.setSetting('folderMeta', folderMeta);

                this._setFolderStatus(folderId, 'scanned', photos.length);
                this.dispatchEvent(new CustomEvent('folder_scan_complete', {
                    detail: { folderId, folderPath, photoCount: photos.length }
                }));
            } catch (err) {
                console.error(`Scan failed for folder ${folderId}:`, err);
                this._setFolderStatus(folderId, 'error');
                this.dispatchEvent(new CustomEvent('folder_scan_error', {
                    detail: { folderId, error: err.message }
                }));
            }

            this._currentFolderId = null;
        }

        this._running = false;
        this.dispatchEvent(new CustomEvent('scan_idle'));
    }

    stop() {
        this._running = false;
    }
}

export const scanEngine = new ScanEngine();
