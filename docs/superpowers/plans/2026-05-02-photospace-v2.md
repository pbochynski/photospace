# Photospace v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Photospace from the current ~8,000-line v1 into a lean folder-first burst-series cleanup tool. Remove CLIP entirely, add three-column UI, scan queue, calibration, and per-series review with keep/delete state.

**Architecture:** Seven sequential implementation steps, each self-contained and buildable. Each step ends with a passing `npm run build` and a git commit. Steps 01–03 are backend/data; Steps 04–07 are UI. After Step 07 the app is fully functional.

**Tech Stack:** Vanilla JS ES modules, Vite, IndexedDB, MSAL.js v3, @vladmandic/human, Microsoft Graph API

---

## File Map

### Deleted in Step 01
- `src/lib/embedding-processor.js`
- `src/lib/backupManager.js`
- `src/lib/similarPhotosManager.js`
- `src/lib/modalManager.js`
- `src/lib/clipTextEncoder.js`
- `src/lib/embeddingExport.js`
- `src/lib/embeddingImport.js`
- `public/models/` (CLIP model files)
- `@xenova/transformers` npm dependency

### Modified
- `src/worker.js` — strip CLIP, keep quality scoring only
- `src/lib/analysis.js` — remove `findSimilarGroups` and `cosineSimilarity`
- `src/lib/db.js` — add `deleteStalePhotosInFolder`, `getPhotosByFolderId`
- `src/lib/graph.js` — add `folder_id` to photo records, add `getFolderChildren`/`getRootFolders`
- `src/lib/settingsManager.js` — lean getters/setters only (remove DOM coupling)
- `src/index.html` — full rewrite: three-column skeleton
- `src/style.css` — full rewrite: three-column dark theme
- `src/main.js` — full rewrite: auth boot, panel wiring, scan engine

### Created
- `src/lib/scanQueue.js` — priority FIFO queue, IndexedDB-persisted
- `src/lib/calibration.js` — auto-calibrate series params from folder timestamps
- `src/lib/reviewManager.js` — per-series keep/delete state in IndexedDB
- `src/lib/scanEngine.js` — drives scan queue, emits events, calls cleanup + calibration
- `src/lib/qualityProcessor.js` — lean 2-worker quality-only pool
- `src/lib/folderPanel.js` — renders folder tree with scan status badges
- `src/lib/seriesPanel.js` — renders series list with density bars and tags
- `src/lib/reviewGrid.js` — renders review grid, fullscreen preview, delete button
- `src/lib/settingsDrawer.js` — Advanced settings drawer with slider persistence

---

## Step 01: Remove CLIP Infrastructure

_(See also: `docs/superpowers/plans/step-01-remove-clip.md` for full detail)_

### Task 1.1: Delete CLIP-related files

**Files:**
- Delete: `src/lib/embedding-processor.js`, `src/lib/backupManager.js`, `src/lib/similarPhotosManager.js`, `src/lib/modalManager.js`, `src/lib/clipTextEncoder.js`, `src/lib/embeddingExport.js`, `src/lib/embeddingImport.js`

- [ ] **Step 1: Delete CLIP lib files**

```bash
rm src/lib/embedding-processor.js \
   src/lib/backupManager.js \
   src/lib/similarPhotosManager.js \
   src/lib/modalManager.js \
   src/lib/clipTextEncoder.js \
   src/lib/embeddingExport.js \
   src/lib/embeddingImport.js
```

- [ ] **Step 2: Verify deletions**

```bash
ls src/lib/
```

Expected: `analysis.js auth.js db.js debugConsole.js graph.js photoDeleteManager.js settingsManager.js uiUtils.js urlStateManager.js`

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: delete CLIP embedding infrastructure files"
```

---

### Task 1.2: Strip CLIP from worker.js

**Files:**
- Modify: `src/worker.js`

- [ ] **Step 1: Replace entire src/worker.js**

Replace the complete file content with a quality-only worker (no CLIP, no @xenova/transformers imports):

```javascript
import Human from 'https://cdn.jsdelivr.net/npm/@vladmandic/human/dist/human.esm.js';

let workerId = 'Unknown';

const originalConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };

function sendConsoleToMain(level, args) {
    const prefixedArgs = [`[Worker ${workerId}]`, ...args];
    self.postMessage({
        type: 'console', level,
        args: prefixedArgs.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg))
    });
    originalConsole[level].apply(console, prefixedArgs);
}

console.log = (...args) => sendConsoleToMain('log', args);
console.error = (...args) => sendConsoleToMain('error', args);
console.warn = (...args) => sendConsoleToMain('warn', args);
console.info = (...args) => sendConsoleToMain('info', args);

self.addEventListener('error', (e) => sendConsoleToMain('error', [`Worker Error: ${e.message}`]));
self.addEventListener('unhandledrejection', (e) => sendConsoleToMain('error', [`Worker Unhandled Rejection: ${e.reason}`]));

const humanConfig = {
    modelBasePath: 'https://cdn.jsdelivr.net/npm/@vladmandic/human/models',
    filter: { enabled: false },
    face: { enabled: true, detector: { enabled: true, rotation: false }, mesh: { enabled: false }, iris: { enabled: false }, description: { enabled: false }, emotion: { enabled: false } },
    body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false },
};

let human = null;
let humanReady = false;

async function initHuman() {
    if (humanReady) return;
    try {
        human = new Human(humanConfig);
        await human.load();
        humanReady = true;
        console.log('Human face detection initialized');
    } catch (e) {
        console.warn('Human init failed:', e.message);
    }
}

function estimateSharpness(data, width, height) {
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
    let sum = 0, count = 0;
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const lap = Math.abs(-gray[idx-width-1]-gray[idx-width]-gray[idx-width+1]-gray[idx-1]+8*gray[idx]-gray[idx+1]-gray[idx+width-1]-gray[idx+width]-gray[idx+width+1]);
            sum += lap; count++;
        }
    }
    return Math.min(100, (count > 0 ? sum / count : 0) * 2);
}

function estimateExposure(data, width, height) {
    const total = width * height;
    let brightnessSum = 0, overexposed = 0, underexposed = 0;
    for (let i = 0; i < total; i++) {
        const idx = i * 4;
        const b = (data[idx] + data[idx+1] + data[idx+2]) / 3;
        brightnessSum += b;
        if (b > 240) overexposed++;
        if (b < 15) underexposed++;
    }
    const avg = brightnessSum / total;
    const brightPenalty = Math.abs(avg - 128) / 128;
    const clipPenalty = (overexposed + underexposed) / total * 2;
    return Math.max(0, 100 - brightPenalty * 30 - clipPenalty * 100);
}

async function detectFaces(blob) {
    if (!humanReady || !human) return { detected: false, score: 0 };
    try {
        const bmp = await createImageBitmap(blob);
        const result = await human.detect(bmp);
        bmp.close();
        if (result.face?.length > 0) {
            const best = result.face.reduce((b, f) => (f.score||0) > (b.score||0) ? f : b, result.face[0]);
            return { detected: true, score: (best.score||0)*100, count: result.face.length };
        }
        return { detected: false, score: 0, count: 0 };
    } catch (e) {
        console.warn('Face detection error:', e.message);
        return { detected: false, score: 0 };
    }
}

self.onmessage = async (event) => {
    const { type, workerId: id, fileId, blob, fetchUrl, authToken } = event.data;

    if (type === 'init') {
        workerId = id || workerId;
        await initHuman();
        self.postMessage({ type: 'ready', workerId });
        return;
    }

    if (type === 'process_photo') {
        try {
            let imageBlob = blob;
            if (!imageBlob && fetchUrl && authToken) {
                const res = await fetch(fetchUrl, { headers: { Authorization: `Bearer ${authToken}` } });
                if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
                imageBlob = await res.blob();
            }
            if (!imageBlob) throw new Error('No image data');

            const bmp = await createImageBitmap(imageBlob);
            const { width, height } = bmp;
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bmp, 0, 0);
            bmp.close();
            const imageData = ctx.getImageData(0, 0, width, height);

            const sharpness = estimateSharpness(imageData.data, width, height);
            const exposure = estimateExposure(imageData.data, width, height);
            const faceResult = await detectFaces(imageBlob);

            let qualityScore = sharpness * 0.5 + exposure * 0.3;
            if (faceResult.detected) qualityScore += faceResult.score * 0.2;

            self.postMessage({
                type: 'quality_result', fileId,
                qualityMetrics: { sharpness: Math.round(sharpness), exposure: Math.round(exposure), face: faceResult, qualityScore: Math.round(Math.min(100, qualityScore)) }
            });
        } catch (e) {
            self.postMessage({ type: 'quality_error', fileId, error: e.message });
        }
    }
};
```

- [ ] **Step 2: Remove @xenova/transformers from package.json**

Open `package.json`. Remove the line containing `"@xenova/transformers"` from the `dependencies` object.

- [ ] **Step 3: Remove public/models/ if present**

```bash
ls public/models/ 2>/dev/null && rm -rf public/models/ || echo "no models dir"
```

- [ ] **Step 4: Install and build**

```bash
npm install && npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: strip CLIP from worker, remove @xenova/transformers"
```

---

### Task 1.3: Remove findSimilarGroups from analysis.js

**Files:**
- Modify: `src/lib/analysis.js`

- [ ] **Step 1: Delete cosineSimilarity and findSimilarGroups**

In `src/lib/analysis.js`, delete lines 1–204 (the `cosineSimilarity` function and the entire `findSimilarGroups` export). Keep only `pickBestPhotoByQuality` and `findPhotoSeries`. The file should start with:

```javascript
export async function pickBestPhotoByQuality(photoGroup) {
    if (photoGroup.length === 1) return photoGroup[0];
    photoGroup.sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
    return photoGroup[0];
}

export async function findPhotoSeries(photos, options = {}, progressCallback = null) {
```

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/lib/analysis.js && git commit -m "chore: remove findSimilarGroups from analysis.js"
```

---

## Step 02: Core Data Layer

_(See also: `docs/superpowers/plans/step-02-core-data-layer.md` for full detail)_

### Task 2.1: Extend db.js

**Files:**
- Modify: `src/lib/db.js`

- [ ] **Step 1: Add deleteStalePhotosInFolder method to PhotoDB class**

Add after the `deletePhotosFromScannedFoldersNotMatchingScanId` method:

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
            const ops = toDelete.map(p => new Promise((res, rej) => {
                const dr = store.delete(p.file_id);
                dr.onsuccess = () => { deletedCount++; res(); };
                dr.onerror = rej;
            }));
            Promise.all(ops).then(() => {
                console.log(`Deleted ${deletedCount} stale photos from folder ${folderId}`);
                resolve(deletedCount);
            }).catch(reject);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

async getPhotosByFolderId(folderId) {
    return new Promise((resolve, reject) => {
        const tx = this.db.transaction('photos', 'readonly');
        const store = tx.objectStore('photos');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result.filter(p => p.folder_id === folderId));
        request.onerror = (e) => reject(e.target.error);
    });
}
```

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.js && git commit -m "feat: add deleteStalePhotosInFolder and getPhotosByFolderId to db"
```

---

### Task 2.2: Create scanQueue.js

**Files:**
- Create: `src/lib/scanQueue.js`

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
```

- [ ] **Step 2: Build and commit**

```bash
npm run build 2>&1 | tail -10
git add src/lib/scanQueue.js && git commit -m "feat: add ScanQueue with IndexedDB persistence"
```

---

### Task 2.3: Create calibration.js

**Files:**
- Create: `src/lib/calibration.js`

- [ ] **Step 1: Create src/lib/calibration.js**

```javascript
import { db } from './db.js';

const CALIBRATION_KEY = 'calibration';

export async function calibrateFolder(folderId) {
    const photos = await db.getPhotosByFolderId(folderId);
    if (photos.length < 50) return null;

    const timestamps = photos
        .map(p => typeof p.photo_taken_ts === 'string' ? new Date(p.photo_taken_ts).getTime() : p.photo_taken_ts)
        .filter(ts => ts && !isNaN(ts))
        .sort((a, b) => a - b);

    if (timestamps.length < 10) return null;

    const gaps = [];
    for (let i = 1; i < timestamps.length; i++) gaps.push((timestamps[i] - timestamps[i-1]) / 60000);
    gaps.sort((a, b) => a - b);

    const p10 = gaps[Math.floor(gaps.length * 0.1)];
    const p90 = gaps[Math.floor(gaps.length * 0.9)];
    const p50 = gaps[Math.floor(gaps.length * 0.5)];

    const maxTimeGap    = Math.max(2, Math.min(30, p90));
    const minDensity    = Math.max(0.5, 1 / Math.max(0.1, p50));
    const burstThreshold = Math.max(3, 1 / Math.max(0.01, p10));

    const result = {
        maxTimeGap: Math.round(maxTimeGap * 10) / 10,
        minDensity: Math.round(minDensity * 10) / 10,
        burstThreshold: Math.round(burstThreshold * 10) / 10,
        computedAt: Date.now()
    };

    const all = (await db.getSetting(CALIBRATION_KEY)) || {};
    all[folderId] = result;
    await db.setSetting(CALIBRATION_KEY, all);
    return result;
}

export async function getCalibration(folderId) {
    const all = (await db.getSetting(CALIBRATION_KEY)) || {};
    return all[folderId] || null;
}
```

- [ ] **Step 2: Build and commit**

```bash
npm run build 2>&1 | tail -10
git add src/lib/calibration.js && git commit -m "feat: add calibration module for auto-tuning series params"
```

---

### Task 2.4: Create reviewManager.js

**Files:**
- Create: `src/lib/reviewManager.js`

- [ ] **Step 1: Create src/lib/reviewManager.js**

```javascript
import { db } from './db.js';

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

export async function preselectSeries(series, folderId, calibration) {
    const classification = classifySeries(series, calibration);
    const photos = [...series.photos];

    if (classification === 'sparse') {
        return { keptIds: photos.map(p => p.file_id), deletedIds: [], classification };
    }

    const keepCount = classification === 'burst' ? 1 : 3;
    const sorted = [...photos].sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
    return {
        keptIds: sorted.slice(0, keepCount).map(p => p.file_id),
        deletedIds: sorted.slice(keepCount).map(p => p.file_id),
        classification
    };
}

export async function loadSeriesState(folderId, seriesStartMs) {
    const key = seriesKey(folderId, seriesStartMs);
    const all = (await db.getSetting(REVIEWED_KEY)) || {};
    return all[key] || null;
}

export async function saveSeriesState(folderId, seriesStartMs, keptIds, deletedIds) {
    const key = seriesKey(folderId, seriesStartMs);
    const all = (await db.getSetting(REVIEWED_KEY)) || {};
    all[key] = { keptIds, deletedIds, timestamp: Date.now() };
    await db.setSetting(REVIEWED_KEY, all);
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
    return (await loadSeriesState(folderId, seriesStartMs)) !== null;
}
```

- [ ] **Step 2: Build and commit**

```bash
npm run build 2>&1 | tail -10
git add src/lib/reviewManager.js && git commit -m "feat: add reviewManager for per-series keep/delete state"
```

---

## Step 03: Scanning Engine

_(See also: `docs/superpowers/plans/step-03-scanning-engine.md` for full detail)_

### Task 3.1: Add folder_id to photo records and Graph helpers

**Files:**
- Modify: `src/lib/graph.js`

- [ ] **Step 1: Add folder_id: folderId to photoMetadata in fetchPhotosFromSingleFolder**

In `src/lib/graph.js`, inside `fetchPhotosFromSingleFolder`, find the `photoMetadata` object and add `folder_id: folderId` as a field:

```javascript
const photoMetadata = {
    file_id: item.id,
    name: item.name,
    size: item.size,
    path: fullPath,
    folder_id: folderId,          // add this line
    last_modified: item.lastModifiedDateTime,
    photo_taken_ts: item.photo.takenDateTime,
    thumbnail_url: null,
    scan_id: scanId,
    embedding_status: 0,
    embedding: null,
    quality_score: null
};
```

- [ ] **Step 2: Add getFolderChildren and getRootFolders exports to graph.js**

Append to the end of `src/lib/graph.js`:

```javascript
export async function getFolderChildren(folderId = 'root') {
    const token = await getAuthToken();
    if (!token) throw new Error('Not authenticated');
    const url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children?$filter=folder ne null&$select=id,name,folder,parentReference`;
    const response = await fetchWithAutoRefresh(url, {}, getAuthToken);
    return response.value || [];
}

export async function getRootFolders() {
    return getFolderChildren('root');
}
```

- [ ] **Step 3: Build and commit**

```bash
npm run build 2>&1 | tail -10
git add src/lib/graph.js && git commit -m "feat: add folder_id to photo records, add getFolderChildren/getRootFolders"
```

---

### Task 3.2: Create scanEngine.js

**Files:**
- Create: `src/lib/scanEngine.js`

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
        this._currentFolderId = null;
        this._folderStatus = new Map();
    }

    getFolderStatus(folderId) {
        return this._folderStatus.get(folderId) || 'not_scanned';
    }

    _setFolderStatus(folderId, status, photoCount = null) {
        this._folderStatus.set(folderId, status);
        this.dispatchEvent(new CustomEvent('folder_status', { detail: { folderId, status, photoCount } }));
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

                await fetchPhotosFromSingleFolder(scanId, folderId);
                await db.deleteStalePhotosInFolder(folderId, scanId);

                const photos = await db.getPhotosByFolderId(folderId);
                if (photos.length >= 50) await calibrateFolder(folderId);

                const folderMeta = (await db.getSetting('folderMeta')) || {};
                folderMeta[folderId] = { lastScannedAt: Date.now(), photoCount: photos.length };
                await db.setSetting('folderMeta', folderMeta);

                this._setFolderStatus(folderId, 'scanned', photos.length);
                this.dispatchEvent(new CustomEvent('folder_scan_complete', { detail: { folderId, folderPath, photoCount: photos.length } }));
            } catch (err) {
                console.error(`Scan failed for folder ${folderId}:`, err.message);
                this._setFolderStatus(folderId, 'error');
                this.dispatchEvent(new CustomEvent('folder_scan_error', { detail: { folderId, error: err.message } }));
            }
            this._currentFolderId = null;
        }

        this._running = false;
        this.dispatchEvent(new CustomEvent('scan_idle'));
    }

    stop() { this._running = false; }
}

export const scanEngine = new ScanEngine();
```

- [ ] **Step 2: Build and commit**

```bash
npm run build 2>&1 | tail -10
git add src/lib/scanEngine.js && git commit -m "feat: add ScanEngine driving priority queue and per-folder cleanup"
```

---

### Task 3.3: Create qualityProcessor.js

**Files:**
- Create: `src/lib/qualityProcessor.js`

- [ ] **Step 1: Create src/lib/qualityProcessor.js**

```javascript
import { db } from './db.js';

export class QualityProcessor extends EventTarget {
    constructor(workerCount = 2) {
        super();
        this._workerCount = workerCount;
        this._workers = [];
        this._workerBusy = [];
        this._queue = [];
        this._initialized = false;
    }

    async init() {
        if (this._initialized) return;
        for (let i = 0; i < this._workerCount; i++) {
            const worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
            this._workerBusy.push(false);
            await new Promise((resolve) => {
                const readyHandler = (e) => {
                    if (e.data.type === 'ready') {
                        worker.removeEventListener('message', readyHandler);
                        resolve();
                    }
                };
                worker.addEventListener('message', readyHandler);
                worker.postMessage({ type: 'init', workerId: `Q${i}` });
            });
            worker.addEventListener('message', (e) => this._handleMessage(i, e.data));
            this._workers.push(worker);
        }
        this._initialized = true;
    }

    _handleMessage(workerIndex, data) {
        if (data.type === 'console') return;
        this._workerBusy[workerIndex] = false;
        if (data.type === 'quality_result') {
            db.updatePhotoEmbedding(data.fileId, null, data.qualityMetrics)
                .then(() => this.dispatchEvent(new CustomEvent('quality_done', { detail: { fileId: data.fileId, metrics: data.qualityMetrics } })));
        } else if (data.type === 'quality_error') {
            console.warn('Quality error for', data.fileId, data.error);
        }
        this._processNext();
    }

    enqueue(fileId, fetchUrl, authToken) {
        if (!this._queue.some(t => t.fileId === fileId)) {
            this._queue.push({ fileId, fetchUrl, authToken });
            this._processNext();
        }
    }

    _processNext() {
        if (this._queue.length === 0) return;
        const freeIndex = this._workerBusy.indexOf(false);
        if (freeIndex === -1) return;
        const task = this._queue.shift();
        this._workerBusy[freeIndex] = true;
        this._workers[freeIndex].postMessage({ type: 'process_photo', ...task });
    }

    get pendingCount() { return this._queue.length + this._workerBusy.filter(b => b).length; }

    terminate() {
        this._workers.forEach(w => w.terminate());
        this._workers = [];
        this._workerBusy = [];
        this._initialized = false;
    }
}

export const qualityProcessor = new QualityProcessor(2);
```

- [ ] **Step 2: Build and commit**

```bash
npm run build 2>&1 | tail -10
git add src/lib/qualityProcessor.js && git commit -m "feat: add QualityProcessor replacing EmbeddingProcessor"
```

---

## Step 04: Three-Column UI Shell

_(See also: `docs/superpowers/plans/step-04-ui-shell.md` for full CSS)_

### Task 4.1: Rewrite index.html

**Files:**
- Modify: `src/index.html`

- [ ] **Step 1: Read current src/index.html to find head/meta content to preserve**

- [ ] **Step 2: Replace body with three-column skeleton**

Keep the `<head>` with existing meta tags and Vite script. Replace `<body>` with:

```html
<body>
  <div id="app" class="app-layout">
    <header class="app-header">
      <div class="app-header__brand">📷 Photospace</div>
      <div class="app-header__status" id="header-status"></div>
      <div class="app-header__mode-toggle">
        <button id="btn-quick" class="mode-btn mode-btn--active">Quick cleanup</button>
        <button id="btn-advanced" class="mode-btn">Advanced</button>
      </div>
    </header>
    <div class="app-columns">
      <aside class="panel panel--folders" id="panel-folders">
        <div class="panel__body" id="folder-tree"></div>
        <div class="panel__footer">
          <button id="btn-scan-all" class="btn-text">⬇ Scan all remaining</button>
          <button id="btn-filter-date" class="btn-text">Filter by date…</button>
        </div>
      </aside>
      <section class="panel panel--series" id="panel-series">
        <div class="panel__header" id="series-header"></div>
        <div class="panel__body" id="series-list"></div>
        <div class="panel__footer">
          <div class="progress-bar-wrap"><div class="progress-bar" id="series-progress-bar"></div></div>
          <div class="progress-label" id="series-progress-label"></div>
        </div>
      </section>
      <aside class="panel panel--review" id="panel-review">
        <div class="panel__header" id="review-header"></div>
        <div class="panel__body" id="review-grid"></div>
        <div class="panel__footer" id="review-footer"></div>
      </aside>
    </div>
    <div class="settings-drawer" id="settings-drawer" hidden>
      <div class="settings-drawer__content" id="settings-content"></div>
    </div>
    <div class="fullscreen-overlay" id="fullscreen-overlay" hidden>
      <div class="fullscreen-overlay__photo" id="fullscreen-photo"></div>
      <div class="fullscreen-overlay__sidebar" id="fullscreen-sidebar"></div>
    </div>
    <div class="login-screen" id="login-screen" hidden>
      <div class="login-card">
        <h1>Photospace</h1>
        <p>Sign in with your Microsoft account to access your OneDrive photos.</p>
        <button id="btn-login" class="btn-primary">Sign in with Microsoft</button>
      </div>
    </div>
  </div>
  <script type="module" src="./main.js"></script>
</body>
```

- [ ] **Step 3: Build and commit**

```bash
npm run build 2>&1 | tail -10
git add src/index.html && git commit -m "feat: new three-column HTML skeleton"
```

---

### Task 4.2: Rewrite style.css

**Files:**
- Modify: `src/style.css`

- [ ] **Step 1: Replace entire src/style.css**

See `docs/superpowers/plans/step-04-ui-shell.md` Task 2 Step 1 for the full CSS content (three-column dark theme with CSS variables, folder tree, series cards, review grid, fullscreen overlay, login screen, settings drawer, density bars, score badge styles).

Key layout rules to confirm are present:
- `.app-layout { display:flex; flex-direction:column; height:100vh }`
- `.app-columns { display:flex; flex:1; overflow:hidden }`
- `.panel--folders { width:220px }` `.panel--series { flex:1; min-width:300px }` `.panel--review { width:310px }`
- `.fullscreen-overlay { position:fixed; inset:0; z-index:100 }`

- [ ] **Step 2: Build and commit**

```bash
npm run build 2>&1 | tail -10
git add src/style.css && git commit -m "feat: new three-column CSS layout"
```

---

## Step 05: Main.js + Panel Renderers

_(See also: `docs/superpowers/plans/step-05-main-wiring.md` for full code)_

### Task 5.1: Create folderPanel.js

**Files:**
- Create: `src/lib/folderPanel.js`

- [ ] **Step 1: Create src/lib/folderPanel.js**

See `docs/superpowers/plans/step-05-main-wiring.md` Task 1 for full source.

Key interface:
- `constructor(containerEl, { onFolderClick, onPromoteClick })`
- `setFolderStatus(folderId, status, photoCount)` — updates badge, re-renders
- `setSelected(folderId)` — highlights selected folder
- `loadRoot()` — fetches `getRootFolders()` and also reads `folderMeta` from db to set initial status (`scanned` vs `stale` for folders last scanned >7 days ago vs never). In `loadRoot()`, after fetching folders, read `db.getSetting('folderMeta')` and for each folder call `setFolderStatus(folderId, metaStatus, photoCount)` where `metaStatus` is `'stale'` if `Date.now() - meta.lastScannedAt > 7*24*60*60*1000`, `'scanned'` if within 7 days, `'not_scanned'` if no meta entry.

- [ ] **Step 2: Build and commit**

```bash
npm run build 2>&1 | tail -10
git add src/lib/folderPanel.js && git commit -m "feat: add FolderPanel renderer"
```

---

### Task 5.2: Create seriesPanel.js

**Files:**
- Create: `src/lib/seriesPanel.js`

- [ ] **Step 1: Create src/lib/seriesPanel.js**

See `docs/superpowers/plans/step-05-main-wiring.md` Task 2 for full source.

Key interface:
- `constructor({ headerEl, listEl, progressBarEl, progressLabelEl, onSeriesClick })`
- `loadFolder(folderId, folderName)` — reads photos from db, runs `findPhotoSeries`, renders cards
- `showOnboarding()` — shows first-run card

- [ ] **Step 2: Build and commit**

```bash
npm run build 2>&1 | tail -10
git add src/lib/seriesPanel.js && git commit -m "feat: add SeriesPanel renderer"
```

---

### Task 5.3: Create ReviewGrid stub + rewrite main.js

**Files:**
- Create: `src/lib/reviewGrid.js` (stub first, then full in Step 06)
- Modify: `src/main.js`

- [ ] **Step 1: Create src/lib/reviewGrid.js stub**

```javascript
export class ReviewGrid {
    constructor(opts) { this._opts = opts; }
    async loadSeries(series, folderId) {}
    closeFullscreen() {}
    get _fsIndex() { return null; }
    get _photos() { return []; }
}
```

- [ ] **Step 2: Rewrite src/main.js**

See `docs/superpowers/plans/step-05-main-wiring.md` Task 3 for full source.

Key responsibilities:
- `boot()` — `msalInstance.initialize()`, `handleRedirectPromise()`, check auth, show login or call `onAuthenticated()`
- `onAuthenticated()` — create FolderPanel, SeriesPanel, ReviewGrid, SettingsDrawer; wire scan engine events; load folder tree; start scan engine; init quality processor
- `handleFolderClick(folderId, folderName, driveId)` — enqueue high-priority, load series panel
- `handleSeriesClick(series, folderId, index)` — load review grid
- `toggleMode(mode)` — show/hide settings drawer

Auth imports: `import { getAuthToken, login, msalInstance } from './lib/auth.js'`

- [ ] **Step 3: Build and commit**

```bash
npm run build 2>&1 | tail -10
git add src/main.js src/lib/reviewGrid.js && git commit -m "feat: rewrite main.js with three-panel wiring"
```

---

## Step 06: Review Grid Panel

_(See also: `docs/superpowers/plans/step-06-review-grid.md` for full code)_

### Task 6.1: Implement ReviewGrid

**Files:**
- Modify: `src/lib/reviewGrid.js` (replace stub)

- [ ] **Step 1: Replace src/lib/reviewGrid.js with full implementation**

See `docs/superpowers/plans/step-06-review-grid.md` Task 1 Step 2 for full source.

Key behaviors:
- `loadSeries(series, folderId)` — loads/creates preselection state, renders grid sorted by quality score
- Grid thumbnails use `/api/thumb/<fileId>` (proxied by sw.js)
- Clicking thumbnail body → open fullscreen; clicking overlay → toggle keep/delete
- Footer: "Delete N photos" button, "Deselect all / Keep all" links
- `_confirmDelete()` — calls `deletePhotoFromOneDrive(fileId)` for each deleted photo
- Fullscreen: `/api/image/<fileId>`, quality score sidebar with bars, ‹ › navigation
- `closeFullscreen()` — hides overlay

Note: `deletePhotoFromOneDrive` is the correct function name from `src/lib/photoDeleteManager.js` (not `deletePhotosBatch`).

- [ ] **Step 2: Add keyboard navigation to main.js keydown handler**

Replace the single-line keydown listener in `main.js` with:

```javascript
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') reviewGrid.closeFullscreen();
    if (e.key === 'ArrowLeft' && reviewGrid._fsIndex !== null && reviewGrid._fsIndex > 0) {
        reviewGrid._renderFullscreen(reviewGrid._fsIndex - 1);
    }
    if (e.key === 'ArrowRight' && reviewGrid._fsIndex !== null && reviewGrid._fsIndex < reviewGrid._photos.length - 1) {
        reviewGrid._renderFullscreen(reviewGrid._fsIndex + 1);
    }
});
```

- [ ] **Step 3: Register service worker in main.js boot()**

Add to `boot()` before `db.init()`:

```javascript
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(e => console.warn('SW registration failed:', e));
}
```

- [ ] **Step 4: Build and commit**

```bash
npm run build 2>&1 | tail -10
git add src/lib/reviewGrid.js src/main.js && git commit -m "feat: implement ReviewGrid with fullscreen preview and delete"
```

---

## Step 07: Quick/Advanced Settings Drawer

_(See also: `docs/superpowers/plans/step-07-settings-drawer.md` for full code)_

### Task 7.1: Rewrite settingsManager.js

**Files:**
- Modify: `src/lib/settingsManager.js`

- [ ] **Step 1: Replace settingsManager.js with lean version**

See `docs/superpowers/plans/step-07-settings-drawer.md` Task 1 Step 1 for full source.

Remove all DOM coupling. Keep: `getSetting`, `setSetting`, `getSeriesSettings`, `getDateFilter`, `getIgnoredPeriods`, `addIgnoredPeriod`, `removeIgnoredPeriod`.

- [ ] **Step 2: Build and commit**

```bash
npm run build 2>&1 | tail -10
git add src/lib/settingsManager.js && git commit -m "refactor: lean settingsManager for v2"
```

---

### Task 7.2: Create settingsDrawer.js

**Files:**
- Create: `src/lib/settingsDrawer.js`

- [ ] **Step 1: Create src/lib/settingsDrawer.js**

See `docs/superpowers/plans/step-07-settings-drawer.md` Task 2 Step 1 for full source.

Key interface:
- `constructor(contentEl, { onSettingsChange })`
- `setCurrentFolder(folderId)` — used to show calibration card for current folder
- `render()` — builds sliders for `seriesMaxTimeGap`, `seriesMinDensity`, `seriesMinGroupSize`, `workerCount`; date filter toggle; ignored periods list

- [ ] **Step 2: Add .settings-field CSS to style.css**

Append to `src/style.css`:

```css
.settings-field { margin-bottom: 16px; }
.settings-field label { display: block; font-size: 12px; color: var(--color-text-muted); margin-bottom: 4px; }
```

- [ ] **Step 3: Wire settingsDrawer into main.js**

In `main.js`, add import at top:

```javascript
import { SettingsDrawer } from './lib/settingsDrawer.js';
```

In `onAuthenticated()`, add after reviewGrid creation:

```javascript
const settingsDrawer = new SettingsDrawer(document.getElementById('settings-content'), {
    onSettingsChange: async () => {
        if (appState.selectedFolderId) {
            await seriesPanel.loadFolder(appState.selectedFolderId, appState.selectedFolderName);
        }
    }
});
```

Replace the `toggleMode` function with:

```javascript
async function toggleMode(mode) {
    const isAdvanced = mode === 'advanced';
    btnQuick.classList.toggle('mode-btn--active', !isAdvanced);
    btnAdvanced.classList.toggle('mode-btn--active', isAdvanced);
    settingsDrawer.hidden = !isAdvanced;
    if (isAdvanced) {
        if (appState.selectedFolderId) settingsDrawer.setCurrentFolder(appState.selectedFolderId);
        await settingsDrawer.render();
    }
}
```

Note: `settingsDrawer` must be declared in `onAuthenticated` scope and accessible by `toggleMode`. Move `toggleMode` inside `onAuthenticated` or hoist `settingsDrawer` to module scope.

- [ ] **Step 4: Build and commit**

```bash
npm run build 2>&1 | tail -10
git add src/lib/settingsDrawer.js src/main.js src/style.css && git commit -m "feat: Quick/Advanced mode toggle with settings drawer"
```

---

## Final Verification

- [ ] **Run full build**

```bash
npm run build 2>&1
```

Expected: No errors, no warnings about missing modules.

- [ ] **Smoke test in browser**

```bash
npm run dev
```

Open `http://localhost:5173`, verify:
1. Login screen appears (or app loads if already authenticated)
2. Three columns render (folder tree, series list, review grid)
3. Header shows mode toggle buttons
4. Clicking Advanced opens settings drawer

- [ ] **Verify deleted files are gone**

```bash
ls src/lib/ | grep -E 'embedding|backup|similar|modal|clip'
```

Expected: No output.

- [ ] **Verify @xenova not in node_modules**

```bash
ls node_modules/@xenova 2>/dev/null || echo "xenova removed"
```

Expected: `xenova removed`
