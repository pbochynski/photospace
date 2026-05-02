# Step 01: Remove CLIP Infrastructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete all CLIP/embedding code and dependencies, leaving a clean lean quality-only worker.

**Architecture:** Delete files, strip CLIP imports from worker.js, remove @xenova/transformers from package.json, keep the quality-scoring (sharpness/exposure/face) logic.

**Tech Stack:** Vanilla JS, Vite, Web Workers

---

### Task 1: Delete CLIP-related files

**Files:**
- Delete: `src/lib/embedding-processor.js`
- Delete: `src/lib/backupManager.js`
- Delete: `src/lib/similarPhotosManager.js`
- Delete: `src/lib/modalManager.js`
- Delete: `src/lib/clipTextEncoder.js`
- Delete: `src/lib/embeddingExport.js`
- Delete: `src/lib/embeddingImport.js`

- [ ] **Step 1: Delete CLIP-related lib files**

```bash
rm src/lib/embedding-processor.js \
   src/lib/backupManager.js \
   src/lib/similarPhotosManager.js \
   src/lib/modalManager.js \
   src/lib/clipTextEncoder.js \
   src/lib/embeddingExport.js \
   src/lib/embeddingImport.js
```

Expected: No errors, files gone.

- [ ] **Step 2: Verify deletions**

```bash
ls src/lib/
```

Expected: only `analysis.js auth.js db.js debugConsole.js graph.js photoDeleteManager.js settingsManager.js uiUtils.js urlStateManager.js` remain.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete CLIP embedding infrastructure files"
```

---

### Task 2: Strip CLIP code from worker.js

**Files:**
- Modify: `src/worker.js`

The current `src/worker.js` imports `@huggingface/transformers` (CLIP) and `@vladmandic/human` (face detection). We keep only the quality-scoring portion: `estimateSharpness`, `estimateExposure`, the Human face-detection setup, and the `message` handler for `process_photo`.

- [ ] **Step 1: Read the full worker to understand structure**

Read `src/worker.js` fully.

- [ ] **Step 2: Rewrite worker.js keeping only quality scoring**

Replace the entire content of `src/worker.js` with:

```javascript
import Human from 'https://cdn.jsdelivr.net/npm/@vladmandic/human/dist/human.esm.js';

let workerId = 'Unknown';

const originalConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };

function sendConsoleToMain(level, args) {
    const prefixedArgs = [`[Worker ${workerId}]`, ...args];
    self.postMessage({
        type: 'console',
        level,
        args: prefixedArgs.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        )
    });
    originalConsole[level].apply(console, prefixedArgs);
}

console.log = (...args) => sendConsoleToMain('log', args);
console.error = (...args) => sendConsoleToMain('error', args);
console.warn = (...args) => sendConsoleToMain('warn', args);
console.info = (...args) => sendConsoleToMain('info', args);

self.addEventListener('error', (event) => {
    sendConsoleToMain('error', [`Worker Error: ${event.message}`]);
});
self.addEventListener('unhandledrejection', (event) => {
    sendConsoleToMain('error', [`Worker Unhandled Rejection: ${event.reason}`]);
});

// --- Human face detection setup ---
const humanConfig = {
    modelBasePath: 'https://cdn.jsdelivr.net/npm/@vladmandic/human/models',
    filter: { enabled: false },
    face: { enabled: true, detector: { enabled: true, rotation: false }, mesh: { enabled: false }, iris: { enabled: false }, description: { enabled: false }, emotion: { enabled: false } },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: false },
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
        console.warn('Human init failed, face detection disabled:', e.message);
    }
}

// --- Quality scoring functions ---

function estimateSharpness(imageData, width, height) {
    const data = imageData;
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
    let laplacianSum = 0;
    let count = 0;
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const lap = Math.abs(
                -gray[idx - width - 1] - gray[idx - width] - gray[idx - width + 1]
                - gray[idx - 1] + 8 * gray[idx] - gray[idx + 1]
                - gray[idx + width - 1] - gray[idx + width] - gray[idx + width + 1]
            );
            laplacianSum += lap;
            count++;
        }
    }
    const rawScore = count > 0 ? laplacianSum / count : 0;
    return Math.min(100, rawScore * 2);
}

function estimateExposure(imageData, width, height) {
    const data = imageData;
    const total = width * height;
    let brightnessSum = 0;
    let overexposed = 0;
    let underexposed = 0;
    for (let i = 0; i < total; i++) {
        const idx = i * 4;
        const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        brightnessSum += brightness;
        if (brightness > 240) overexposed++;
        if (brightness < 15) underexposed++;
    }
    const avgBrightness = brightnessSum / total;
    const overexposedRatio = overexposed / total;
    const underexposedRatio = underexposed / total;
    const brightnessPenalty = Math.abs(avgBrightness - 128) / 128;
    const clippingPenalty = (overexposedRatio + underexposedRatio) * 2;
    const score = Math.max(0, 100 - brightnessPenalty * 30 - clippingPenalty * 100);
    return score;
}

async function detectFaces(blob) {
    if (!humanReady || !human) return { detected: false, score: 0 };
    try {
        const imageBitmap = await createImageBitmap(blob);
        const result = await human.detect(imageBitmap);
        imageBitmap.close();
        if (result.face && result.face.length > 0) {
            const bestFace = result.face.reduce((best, f) =>
                (f.score || 0) > (best.score || 0) ? f : best, result.face[0]);
            return { detected: true, score: (bestFace.score || 0) * 100, count: result.face.length };
        }
        return { detected: false, score: 0, count: 0 };
    } catch (e) {
        console.warn('Face detection error:', e.message);
        return { detected: false, score: 0 };
    }
}

// --- Message handler ---

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

            const imageBitmap = await createImageBitmap(imageBlob);
            const { width, height } = imageBitmap;
            const offscreen = new OffscreenCanvas(width, height);
            const ctx = offscreen.getContext('2d');
            ctx.drawImage(imageBitmap, 0, 0);
            imageBitmap.close();
            const imageData = ctx.getImageData(0, 0, width, height);

            const sharpness = estimateSharpness(imageData.data, width, height);
            const exposure = estimateExposure(imageData.data, width, height);
            const faceResult = await detectFaces(imageBlob);

            let qualityScore = sharpness * 0.5 + exposure * 0.3;
            if (faceResult.detected) qualityScore += faceResult.score * 0.2;
            qualityScore = Math.min(100, qualityScore);

            self.postMessage({
                type: 'quality_result',
                fileId,
                qualityMetrics: {
                    sharpness: Math.round(sharpness),
                    exposure: Math.round(exposure),
                    face: faceResult,
                    qualityScore: Math.round(qualityScore)
                }
            });
        } catch (e) {
            self.postMessage({ type: 'quality_error', fileId, error: e.message });
        }
    }
};
```

- [ ] **Step 3: Remove @xenova/transformers from package.json**

Open `package.json` and remove the `"@xenova/transformers"` entry from dependencies.

- [ ] **Step 4: Run npm install to sync lockfile**

```bash
npm install
```

Expected: No errors, `node_modules/@xenova` no longer present.

- [ ] **Step 5: Remove public/models/ directory if it exists**

```bash
ls public/models/ 2>/dev/null && rm -rf public/models/ || echo "no models dir"
```

- [ ] **Step 6: Build to verify no import errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: Build succeeds (no "Cannot find module" errors).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: strip CLIP from worker, remove @xenova/transformers dependency"
```

---

### Task 3: Remove findSimilarGroups from analysis.js

**Files:**
- Modify: `src/lib/analysis.js`

- [ ] **Step 1: Remove findSimilarGroups function**

In `src/lib/analysis.js`, delete the `cosineSimilarity` function (lines 1–11) and the entire `findSimilarGroups` export (lines 31–204). Keep only `pickBestPhotoByQuality` and `findPhotoSeries`.

The file after edit should start with:

```javascript
/**
 * Pick the best photo from a group based on stored quality metrics.
 */
export async function pickBestPhotoByQuality(photoGroup) {
    if (photoGroup.length === 1) return photoGroup[0];
    photoGroup.sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
    return photoGroup[0];
}

export async function findPhotoSeries(photos, options = {}, progressCallback = null) {
    // ... existing implementation unchanged ...
```

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/lib/analysis.js
git commit -m "chore: remove findSimilarGroups from analysis.js"
```
