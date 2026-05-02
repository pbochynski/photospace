# Step 03: Scanning Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the `ScanQueue` into the app's scanning loop so folders are fetched in priority order, photos are upserted with `scan_id` and `folder_id`, and stale photos are cleaned up after a full folder completes.

**Architecture:** A new `scanEngine.js` drives the queue-based scan loop. It imports `scanQueue`, `graph.js`, `db.js`, and `calibration.js`. `main.js` calls `scanEngine.startScanning()`. The scan engine runs one folder at a time and emits events for the UI.

**Tech Stack:** Vanilla JS ES modules, Microsoft Graph API (existing graph.js)

---

### Task 1: Extend graph.js with folder-id–aware photo fetch

**Files:**
- Modify: `src/lib/graph.js`

The existing `fetchPhotosFromSingleFolder(scanId, folderId)` stores `path` but not `folder_id`. We need `folder_id` on each record so `deleteStalePhotosInFolder` and `getPhotosByFolderId` work.

- [ ] **Step 1: Read current fetchPhotosFromSingleFolder in graph.js**

Read `src/lib/graph.js` lines 46–130 to confirm the photo record shape.

- [ ] **Step 2: Add folder_id to photo records in fetchPhotosFromSingleFolder**

In `src/lib/graph.js`, find the `photoMetadata` object inside `fetchPhotosFromSingleFolder`. Add `folder_id: folderId` to it:

```javascript
const photoMetadata = {
    file_id: item.id,
    name: item.name,
    size: item.size,
    path: fullPath,
    folder_id: folderId,           // ← add this line
    last_modified: item.lastModifiedDateTime,
    photo_taken_ts: item.photo.takenDateTime,
    thumbnail_url: null,
    scan_id: scanId,
    embedding_status: 0,
    embedding: null,
    quality_score: null
};
```

- [ ] **Step 3: Also add getFolderChildren to graph.js for folder tree**

Add this function to `src/lib/graph.js` for fetching immediate subfolders:

```javascript
export async function getFolderChildren(folderId = 'root') {
    const token = await getAuthToken();
    if (!token) throw new Error('Not authenticated');
    const url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children?$filter=folder ne null&$select=id,name,folder,parentReference`;
    const response = await fetchWithAutoRefresh(url, {}, getAuthToken);
    return response.value || [];
}
```

- [ ] **Step 4: Add getRootFolders to graph.js**

```javascript
export async function getRootFolders() {
    return getFolderChildren('root');
}
```

- [ ] **Step 5: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add src/lib/graph.js
git commit -m "feat: add folder_id to photo records, add getFolderChildren/getRootFolders"
```

---

### Task 2: Create scanEngine.js

**Files:**
- Create: `src/lib/scanEngine.js`

The scan engine drives the queue, emits progress events, and calls cleanup + calibration when a folder completes.

- [ ] **Step 1: Create src/lib/scanEngine.js**

```javascript
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
                console.error(`Scan failed for folder ${folderId}:`, err.message);
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
```

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/lib/scanEngine.js
git commit -m "feat: add ScanEngine driving priority queue and per-folder cleanup"
```

---

### Task 3: Add quality worker pool (QualityProcessor)

**Files:**
- Create: `src/lib/qualityProcessor.js`

Replaces `EmbeddingProcessor` with a lean pool that only does quality scoring.

- [ ] **Step 1: Create src/lib/qualityProcessor.js**

```javascript
import { db } from './db.js';

export class QualityProcessor extends EventTarget {
    constructor(workerCount = 2) {
        super();
        this._workerCount = workerCount;
        this._workers = [];
        this._queue = [];
        this._processing = new Set();
        this._initialized = false;
    }

    async init() {
        if (this._initialized) return;
        for (let i = 0; i < this._workerCount; i++) {
            const worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
            await new Promise((resolve) => {
                worker.onmessage = (e) => {
                    if (e.data.type === 'ready') resolve();
                    else this._handleMessage(e.data);
                };
                worker.postMessage({ type: 'init', workerId: `Q${i}` });
            });
            worker.onmessage = (e) => this._handleMessage(e.data);
            this._workers.push(worker);
        }
        this._initialized = true;
        console.log(`QualityProcessor: ${this._workerCount} workers ready`);
    }

    _handleMessage(data) {
        if (data.type === 'console') return;
        if (data.type === 'quality_result') {
            this._processing.delete(data.fileId);
            db.updatePhotoEmbedding(data.fileId, null, data.qualityMetrics)
                .then(() => {
                    this.dispatchEvent(new CustomEvent('quality_done', { detail: { fileId: data.fileId, metrics: data.qualityMetrics } }));
                    this._processNext();
                });
        } else if (data.type === 'quality_error') {
            this._processing.delete(data.fileId);
            console.warn('Quality error for', data.fileId, data.error);
            this._processNext();
        }
    }

    enqueue(fileId, fetchUrl, authToken) {
        if (!this._processing.has(fileId)) {
            this._queue.push({ fileId, fetchUrl, authToken });
            this._processNext();
        }
    }

    _processNext() {
        const availableWorker = this._workers.find((_, i) =>
            ![...this._processing].some(id => this._workerIndex(id) === i)
        );
        if (!availableWorker || this._queue.length === 0) return;
        const task = this._queue.shift();
        this._processing.add(task.fileId);
        availableWorker.postMessage({ type: 'process_photo', ...task });
    }

    _workerIndex(fileId) {
        return this._workers.indexOf(this._workers.find(w => w._currentFileId === fileId));
    }

    get pendingCount() {
        return this._queue.length + this._processing.size;
    }

    terminate() {
        this._workers.forEach(w => w.terminate());
        this._workers = [];
        this._initialized = false;
    }
}

export const qualityProcessor = new QualityProcessor(2);
```

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/lib/qualityProcessor.js
git commit -m "feat: add QualityProcessor replacing EmbeddingProcessor"
```
