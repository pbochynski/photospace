# Step 02: Core Data Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three new library files (`scanQueue.js`, `calibration.js`, `reviewManager.js`) and extend `db.js` with the per-folder cleanup method.

**Architecture:** Each new file has a single responsibility and a clean interface. They import only from `db.js` and `analysis.js`. No UI code in these files.

**Tech Stack:** Vanilla JS ES modules, IndexedDB via existing `db.js`

---

### Task 1: Add deletePhotosFromScannedFoldersByScanId to db.js

**Files:**
- Modify: `src/lib/db.js`

The spec requires: after completing a full folder scan, delete photos in that folder that don't match the current `scan_id`. The existing `deletePhotosFromScannedFoldersNotMatchingScanId(currentScanId, scannedFolderPaths)` does this but takes an array of paths. We need a version that takes a single `folderId` and a `scanId` and deletes photos in that folder not stamped with that `scanId`.

- [ ] **Step 1: Add the new method to db.js**

Add the following method to the `PhotoDB` class in `src/lib/db.js` (after the `deletePhotosFromScannedFoldersNotMatchingScanId` method):

```javascript
async deleteStalePhotosInFolder(folderId, scanId) {
    return new Promise((resolve, reject) => {
        const tx = this.db.transaction('photos', 'readwrite');
        const store = tx.objectStore('photos');
        const request = store.getAll();
        let deletedCount = 0;
        request.onsuccess = () => {
            const photos = request.result;
            const toDelete = photos.filter(p => p.folder_id === folderId && p.scan_id !== scanId);
            const deletePromises = toDelete.map(p =>
                new Promise((res, rej) => {
                    const dr = store.delete(p.file_id);
                    dr.onsuccess = () => { deletedCount++; res(); };
                    dr.onerror = rej;
                })
            );
            Promise.all(deletePromises)
                .then(() => {
                    console.log(`Deleted ${deletedCount} stale photos from folder ${folderId}`);
                    resolve(deletedCount);
                })
                .catch(reject);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}
```

Also add `getPhotosByFolderId` for the folder tree photo count:

```javascript
async getPhotosByFolderId(folderId) {
    return new Promise((resolve, reject) => {
        const tx = this.db.transaction('photos', 'readonly');
        const store = tx.objectStore('photos');
        const request = store.getAll();
        request.onsuccess = () => {
            resolve(request.result.filter(p => p.folder_id === folderId));
        };
        request.onerror = (e) => reject(e.target.error);
    });
}
```

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.js
git commit -m "feat: add deleteStalePhotosInFolder and getPhotosByFolderId to db"
```

---

### Task 2: Create scanQueue.js

**Files:**
- Create: `src/lib/scanQueue.js`

The scan queue persists in IndexedDB (`settings` key `scanQueue`). Entries: `{ folderId, folderPath, driveId, priority: 'high' | 'normal' }`. High-priority entries go to the front; within same priority, FIFO.

- [ ] **Step 1: Create src/lib/scanQueue.js**

```javascript
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
            if (firstNormal === -1) {
                this._queue.push(entry);
            } else {
                this._queue.splice(firstNormal, 0, entry);
            }
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

    async peek() {
        if (!this._loaded) await this.load();
        return this._queue[0] || null;
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

    get length() {
        return this._queue.length;
    }
}

export const scanQueue = new ScanQueue();
```

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/lib/scanQueue.js
git commit -m "feat: add ScanQueue with IndexedDB persistence"
```

---

### Task 3: Create calibration.js

**Files:**
- Create: `src/lib/calibration.js`

Calibration samples photo timestamp gaps within a folder to auto-set `maxTimeGap`, `minDensity`, and `burstThreshold`. Runs after a folder with 50+ photos finishes scanning.

- [ ] **Step 1: Create src/lib/calibration.js**

```javascript
import { db } from './db.js';

const CALIBRATION_KEY = 'calibration';

export async function calibrateFolder(folderId) {
    const photos = await db.getPhotosByFolderId(folderId);
    if (photos.length < 50) return null;

    const timestamps = photos
        .map(p => typeof p.photo_taken_ts === 'string'
            ? new Date(p.photo_taken_ts).getTime()
            : p.photo_taken_ts)
        .filter(ts => ts && !isNaN(ts))
        .sort((a, b) => a - b);

    if (timestamps.length < 10) return null;

    const gaps = [];
    for (let i = 1; i < timestamps.length; i++) {
        gaps.push((timestamps[i] - timestamps[i - 1]) / 60000);
    }
    gaps.sort((a, b) => a - b);

    const p50 = gaps[Math.floor(gaps.length * 0.5)];
    const p90 = gaps[Math.floor(gaps.length * 0.9)];
    const p95 = gaps[Math.floor(gaps.length * 0.95)];

    const maxTimeGap = Math.max(2, Math.min(30, p90));
    const minDensity = Math.max(0.5, 1 / Math.max(0.1, p50));
    const burstThreshold = Math.max(3, 1 / Math.max(0.01, gaps[Math.floor(gaps.length * 0.1)]));

    const result = {
        maxTimeGap: Math.round(maxTimeGap * 10) / 10,
        minDensity: Math.round(minDensity * 10) / 10,
        burstThreshold: Math.round(burstThreshold * 10) / 10,
        computedAt: Date.now()
    };

    const allCalibration = (await db.getSetting(CALIBRATION_KEY)) || {};
    allCalibration[folderId] = result;
    await db.setSetting(CALIBRATION_KEY, allCalibration);

    console.log(`Calibration for folder ${folderId}:`, result);
    return result;
}

export async function getCalibration(folderId) {
    const allCalibration = (await db.getSetting(CALIBRATION_KEY)) || {};
    return allCalibration[folderId] || null;
}
```

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/lib/calibration.js
git commit -m "feat: add calibration module for auto-tuning series parameters"
```

---

### Task 4: Create reviewManager.js

**Files:**
- Create: `src/lib/reviewManager.js`

Manages keep/delete state per series. Series review progress is stored in `settings` under `reviewedSeries`. SeriesKey is `{folderId}_{seriesStartTimestampMs}`.

- [ ] **Step 1: Create src/lib/reviewManager.js**

```javascript
import { db } from './db.js';
import { pickBestPhotoByQuality } from './analysis.js';

const REVIEWED_KEY = 'reviewedSeries';

function seriesKey(folderId, seriesStartMs) {
    return `${folderId}_${seriesStartMs}`;
}

export function classifySeries(series, calibration) {
    const durationMinutes = series.timeSpanMinutes || 0;
    const density = series.density || 0;
    const burstThreshold = calibration?.burstThreshold ?? 5;

    if (durationMinutes > 10 && density < 1) return 'sparse';
    if (density >= burstThreshold) return 'burst';
    return 'spread';
}

export function getKeepCount(classification) {
    if (classification === 'burst') return 1;
    if (classification === 'sparse') return series => series.photos.length;
    return 3;
}

export async function preselectSeries(series, folderId, calibration) {
    const classification = classifySeries(series, calibration);
    const photos = [...series.photos];

    if (classification === 'sparse') {
        return { keptIds: photos.map(p => p.file_id), deletedIds: [], classification };
    }

    const keepCount = classification === 'burst' ? 1 : 3;
    const sorted = [...photos].sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
    const keptIds = sorted.slice(0, keepCount).map(p => p.file_id);
    const deletedIds = sorted.slice(keepCount).map(p => p.file_id);

    return { keptIds, deletedIds, classification };
}

export async function loadSeriesState(folderId, seriesStartMs) {
    const key = seriesKey(folderId, seriesStartMs);
    const allReviewed = (await db.getSetting(REVIEWED_KEY)) || {};
    return allReviewed[key] || null;
}

export async function saveSeriesState(folderId, seriesStartMs, keptIds, deletedIds) {
    const key = seriesKey(folderId, seriesStartMs);
    const allReviewed = (await db.getSetting(REVIEWED_KEY)) || {};
    allReviewed[key] = { keptIds, deletedIds, timestamp: Date.now() };
    await db.setSetting(REVIEWED_KEY, allReviewed);
}

export async function togglePhotoKeep(folderId, seriesStartMs, fileId, currentKeptIds, currentDeletedIds) {
    let keptIds = [...currentKeptIds];
    let deletedIds = [...currentDeletedIds];

    if (keptIds.includes(fileId)) {
        keptIds = keptIds.filter(id => id !== fileId);
        deletedIds.push(fileId);
    } else {
        deletedIds = deletedIds.filter(id => id !== fileId);
        keptIds.push(fileId);
    }

    await saveSeriesState(folderId, seriesStartMs, keptIds, deletedIds);
    return { keptIds, deletedIds };
}

export async function isSeriesReviewed(folderId, seriesStartMs) {
    const state = await loadSeriesState(folderId, seriesStartMs);
    return state !== null;
}
```

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/lib/reviewManager.js
git commit -m "feat: add reviewManager for per-series keep/delete state"
```
