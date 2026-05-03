# Chronological Photo Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the series-card list in the middle panel with a chronological photo grid where series appear as bordered thumbnail blocks and standalone photos appear inline between them.

**Architecture:** A new `PhotoGridPanel` class replaces `SeriesPanel`. It loads all photos for a folder, runs `findPhotoSeries` with the same calibration logic, builds a chronological timeline of series blocks and standalone photo groups, and renders them as a scrollable thumbnail grid. Clicking a series header loads it into the right review panel; clicking a photo thumbnail opens the fullscreen overlay.

**Tech Stack:** Vanilla JS ES modules, IndexedDB via `PhotoDB`, existing `findPhotoSeries` / `classifySeries` / `reviewManager`, Service Worker thumbnail URLs (`/api/thumb/<id>`), Vite dev server.

> **No test framework** — this project is a browser PWA with no test runner. Manual verification via `npm run dev` replaces automated test steps.

---

### Task 1: Add CSS for the photo grid timeline

**Files:**
- Modify: `src/style.css` (append new rules at the end)

- [ ] **Step 1: Append new CSS rules to `src/style.css`**

Add at the very end of the file:

```css
/* Photo grid timeline */
.photo-grid-timeline {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.series-block {
  border-radius: 5px;
  overflow: hidden;
  border-left: 3px solid var(--color-border);
  background: rgba(255,255,255,0.02);
}
.series-block--burst  { border-left-color: #e57373; }
.series-block--spread { border-left-color: #aed581; }
.series-block--sparse { border-left-color: var(--color-border); }

.series-block__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
}
.series-block__header:hover { background: rgba(255,255,255,0.05); }
.series-block__date  { font-weight: 600; font-size: 11px; color: var(--color-accent); }
.series-block__count { font-size: 11px; color: var(--color-text-muted); }
.series-block__open  { margin-left: auto; font-size: 10px; color: var(--color-text-muted); }

.series-block__tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
}
.series-block__tag--burst  { background: rgba(229,115,115,0.25); color: #e57373; }
.series-block__tag--spread { background: rgba(174,213,129,0.25); color: #aed581; }
.series-block__tag--sparse { background: rgba(255,255,255,0.1);  color: var(--color-text-muted); }

.series-block__thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 4px 6px 6px;
}

.standalone-photos {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.photo-thumb {
  width: 52px;
  height: 52px;
  border-radius: 3px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  flex-shrink: 0;
  background: #252535;
}
.photo-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.photo-thumb--keep   { border-color: var(--color-keep); }
.photo-thumb--delete { border-color: var(--color-delete); opacity: 0.6; }
.photo-thumb--overflow {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: 11px;
  border-color: var(--color-border);
}
```

- [ ] **Step 2: Start dev server and verify no CSS errors**

```bash
npm run dev
```

Open http://localhost:5173. The app should load normally (no visible change yet — the new CSS classes are unused). Check browser console for errors.

- [ ] **Step 3: Commit**

```bash
git add src/style.css
git commit -m "feat: add CSS for photo grid timeline and series blocks"
```

---

### Task 2: Create `PhotoGridPanel`

**Files:**
- Create: `src/lib/photoGridPanel.js`

- [ ] **Step 1: Create `src/lib/photoGridPanel.js` with the full implementation**

```js
import { findPhotoSeries } from './analysis.js';
import { classifySeries, isSeriesReviewed, loadSeriesState } from './reviewManager.js';
import { getCalibration } from './calibration.js';
import { db } from './db.js';

export class PhotoGridPanel {
    constructor({ headerEl, listEl, progressBarEl, progressLabelEl, onSeriesClick, onPhotoClick }) {
        this._headerEl = headerEl;
        this._listEl = listEl;
        this._progressBarEl = progressBarEl;
        this._progressLabelEl = progressLabelEl;
        this._onSeriesClick = onSeriesClick;
        this._onPhotoClick = onPhotoClick;
        this._series = [];
        this._folderId = null;
        this._folderName = null;
    }

    async loadFolder(folderId, folderName) {
        this._folderId = folderId;
        this._folderName = folderName;
        this._series = [];
        this._headerEl.textContent = `Loading ${folderName}…`;
        this._listEl.innerHTML = '';

        const photos = await db.getPhotosByFolderId(folderId);
        if (photos.length === 0) {
            this._listEl.innerHTML = '<div style="padding:16px;color:#888">No photos scanned yet. Click ↑ to scan this folder.</div>';
            this._headerEl.textContent = folderName;
            return;
        }

        const calibration = await getCalibration(folderId);
        const maxTimeGap = calibration?.maxTimeGap ?? 5;
        const minDensity = calibration?.minDensity ?? 1;

        this._series = await findPhotoSeries(photos, {
            minGroupSize: 2,
            minDensity,
            maxTimeGap,
        });

        await this._render(photos, calibration);
    }

    async _render(photos, calibration) {
        this._listEl.innerHTML = '';

        // Update progress header
        let reviewedCount = 0;
        for (const s of this._series) {
            if (await isSeriesReviewed(this._folderId, s.startTime)) reviewedCount++;
        }

        if (this._series.length > 0) {
            const pct = Math.round(reviewedCount / this._series.length * 100);
            this._headerEl.textContent = `${photos.length} photos · ${this._series.length} series · ${pct}% reviewed`;
            this._progressBarEl.style.width = `${pct}%`;
            this._progressLabelEl.textContent = `${reviewedCount} of ${this._series.length} series reviewed`;
        } else {
            this._headerEl.textContent = `${photos.length} photos`;
            this._progressBarEl.style.width = '0%';
            this._progressLabelEl.textContent = '';
        }

        const timeline = this._buildTimeline(photos);
        const container = document.createElement('div');
        container.className = 'photo-grid-timeline';

        for (const item of timeline) {
            if (item.type === 'series') {
                container.appendChild(await this._renderSeriesBlock(item.series, calibration));
            } else {
                container.appendChild(this._renderStandaloneGroup(item.photos));
            }
        }

        this._listEl.appendChild(container);
    }

    // Returns an array of { type: 'series', series } | { type: 'standalone', photos: [...] }
    // Consecutive standalone photos are merged into a single group.
    _buildTimeline(photos) {
        const sorted = [...photos]
            .filter(p => p.photo_taken_ts)
            .sort((a, b) => a.photo_taken_ts - b.photo_taken_ts);

        const photoIdToSeries = new Map();
        for (const series of this._series) {
            for (const photo of series.photos) {
                photoIdToSeries.set(photo.file_id, series);
            }
        }

        const raw = [];
        const emittedSeries = new Set();

        for (const photo of sorted) {
            const series = photoIdToSeries.get(photo.file_id);
            if (series) {
                if (!emittedSeries.has(series.startTime)) {
                    emittedSeries.add(series.startTime);
                    raw.push({ type: 'series', series });
                }
            } else {
                raw.push({ type: 'photo', photo });
            }
        }

        // Merge consecutive standalone photos into groups
        const timeline = [];
        let standaloneBuffer = [];

        const flushStandalone = () => {
            if (standaloneBuffer.length > 0) {
                timeline.push({ type: 'standalone', photos: [...standaloneBuffer] });
                standaloneBuffer = [];
            }
        };

        for (const item of raw) {
            if (item.type === 'photo') {
                standaloneBuffer.push(item.photo);
            } else {
                flushStandalone();
                timeline.push(item);
            }
        }
        flushStandalone();

        return timeline;
    }

    async _renderSeriesBlock(series, calibration) {
        const classification = classifySeries(series, calibration);
        const modClass = classification === 'burst' ? 'series-block--burst' :
                         classification === 'sparse' ? 'series-block--sparse' : 'series-block--spread';
        const tagClass = classification === 'burst' ? 'series-block__tag--burst' :
                         classification === 'sparse' ? 'series-block__tag--sparse' : 'series-block__tag--spread';
        const tagLabel = classification === 'burst' ? 'burst · keep 1' :
                         classification === 'sparse' ? 'keep all' : 'keep 3';

        const date = new Date(series.startTime).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        const state = await loadSeriesState(this._folderId, series.startTime);
        const keptIds = state?.keptIds ?? [];
        const deletedIds = state?.deletedIds ?? [];

        const block = document.createElement('div');
        block.className = `series-block ${modClass}`;

        const header = document.createElement('div');
        header.className = 'series-block__header';
        header.innerHTML = `
            <span class="series-block__date">${date}</span>
            <span class="series-block__tag ${tagClass}">${tagLabel}</span>
            <span class="series-block__count">${series.photoCount} photos</span>
            <span class="series-block__open">▶ open in review</span>
        `;
        const seriesIndex = this._series.indexOf(series);
        header.addEventListener('click', () => this._onSeriesClick(series, this._folderId, seriesIndex));
        block.appendChild(header);

        const thumbsEl = document.createElement('div');
        thumbsEl.className = 'series-block__thumbs';

        const MAX_THUMBS = 12;
        const visiblePhotos = series.photos.slice(0, MAX_THUMBS);
        const overflowCount = series.photos.length - MAX_THUMBS;

        for (const photo of visiblePhotos) {
            const isKept = keptIds.includes(photo.file_id);
            const isDeleted = deletedIds.includes(photo.file_id);
            const thumb = document.createElement('div');
            thumb.className = 'photo-thumb' +
                (isKept ? ' photo-thumb--keep' : '') +
                (isDeleted ? ' photo-thumb--delete' : '');
            thumb.innerHTML = `<img src="/api/thumb/${photo.file_id}" alt="" loading="lazy"
                onerror="this.style.background='#333';this.removeAttribute('src')" />`;
            thumb.addEventListener('click', () => this._onPhotoClick(photo, series));
            thumbsEl.appendChild(thumb);
        }

        if (overflowCount > 0) {
            const overflow = document.createElement('div');
            overflow.className = 'photo-thumb photo-thumb--overflow';
            overflow.textContent = `+${overflowCount}`;
            overflow.addEventListener('click', () => this._onSeriesClick(series, this._folderId, seriesIndex));
            thumbsEl.appendChild(overflow);
        }

        block.appendChild(thumbsEl);
        return block;
    }

    _renderStandaloneGroup(photos) {
        const wrap = document.createElement('div');
        wrap.className = 'standalone-photos';
        for (const photo of photos) {
            const thumb = document.createElement('div');
            thumb.className = 'photo-thumb';
            thumb.innerHTML = `<img src="/api/thumb/${photo.file_id}" alt="" loading="lazy"
                onerror="this.style.background='#333';this.removeAttribute('src')" />`;
            thumb.addEventListener('click', () => this._onPhotoClick(photo, null));
            wrap.appendChild(thumb);
        }
        return wrap;
    }

    showOnboarding() {
        this._listEl.innerHTML = `
            <div class="onboarding-card">
                <h3>Start by picking a folder to scan</h3>
                <p>Navigate to a folder in the left panel. Photospace will scan it and find burst series — groups of photos taken in quick succession. Then pick the best shots and delete the rest.</p>
            </div>
        `;
        this._headerEl.textContent = '';
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/photoGridPanel.js
git commit -m "feat: add PhotoGridPanel — chronological photo grid with series blocks"
```

---

### Task 3: Add `openPhotoById` and `openSinglePhoto` to `ReviewGrid`

**Files:**
- Modify: `src/lib/reviewGrid.js`

- [ ] **Step 1: Add two new public methods to `ReviewGrid`**

In `src/lib/reviewGrid.js`, add these two methods after the `closeFullscreen` method (line 233, before `_escapeHtml`):

```js
    openPhotoById(fileId) {
        const index = this._photos.findIndex(p => p.file_id === fileId);
        if (index !== -1) this._openFullscreen(index);
    }

    openSinglePhoto(photo) {
        this._photos = [photo];
        this._keptIds = [];
        this._deletedIds = [];
        this._series = null;
        this._openFullscreen(0);
    }
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/reviewGrid.js
git commit -m "feat: add openPhotoById and openSinglePhoto to ReviewGrid"
```

---

### Task 4: Wire `PhotoGridPanel` into `main.js`

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Replace the `SeriesPanel` import with `PhotoGridPanel`**

In `src/main.js`, change line 5:

```js
// Before:
import { SeriesPanel } from './lib/seriesPanel.js';

// After:
import { PhotoGridPanel } from './lib/photoGridPanel.js';
```

- [ ] **Step 2: Rename the `seriesPanel` variable to `photoGridPanel` throughout `main.js`**

Change line 27:
```js
// Before:
let folderPanel, seriesPanel, reviewGrid;

// After:
let folderPanel, photoGridPanel, reviewGrid;
```

- [ ] **Step 3: Replace `SeriesPanel` instantiation with `PhotoGridPanel` (in `onAuthenticated`, around line 90)**

```js
// Before:
    seriesPanel = new SeriesPanel({
        headerEl:       document.getElementById('series-header'),
        listEl:         document.getElementById('series-list'),
        progressBarEl:  document.getElementById('series-progress-bar'),
        progressLabelEl: document.getElementById('series-progress-label'),
        onSeriesClick:  handleSeriesClick,
    });

// After:
    photoGridPanel = new PhotoGridPanel({
        headerEl:        document.getElementById('series-header'),
        listEl:          document.getElementById('series-list'),
        progressBarEl:   document.getElementById('series-progress-bar'),
        progressLabelEl: document.getElementById('series-progress-label'),
        onSeriesClick:   handleSeriesClick,
        onPhotoClick:    handlePhotoClick,
    });
```

- [ ] **Step 4: Update `settingsDrawerPanel` callback (around line 111)**

```js
// Before:
        onSettingsChange: async () => {
            if (appState.selectedFolderId) {
                settingsDrawerPanel.setCurrentFolder(appState.selectedFolderId);
                await seriesPanel.loadFolder(appState.selectedFolderId, appState.selectedFolderName);
            }
        }

// After:
        onSettingsChange: async () => {
            if (appState.selectedFolderId) {
                settingsDrawerPanel.setCurrentFolder(appState.selectedFolderId);
                await photoGridPanel.loadFolder(appState.selectedFolderId, appState.selectedFolderName);
            }
        }
```

- [ ] **Step 5: Update `photoCount === 0` check (around line 118)**

```js
// Before:
    if (photoCount === 0) {
        seriesPanel.showOnboarding();
    }

// After:
    if (photoCount === 0) {
        photoGridPanel.showOnboarding();
    }
```

- [ ] **Step 6: Update `scanEngine` event listener (around line 127)**

```js
// Before:
        if (status === 'scanned' && folderId === appState.selectedFolderId) {
            seriesPanel.loadFolder(folderId, appState.selectedFolderName);
        }

// After:
        if (status === 'scanned' && folderId === appState.selectedFolderId) {
            photoGridPanel.loadFolder(folderId, appState.selectedFolderName);
        }
```

- [ ] **Step 7: Update `handleFolderClick` (around line 160)**

```js
// Before:
    await seriesPanel.loadFolder(folderId, folderName);

// After:
    await photoGridPanel.loadFolder(folderId, folderName);
```

- [ ] **Step 8: Add `handlePhotoClick` function (add after `handleSeriesClick`)**

```js
async function handlePhotoClick(photo, series) {
    if (series) {
        appState.selectedSeries = series;
        appState.selectedFolderIdForSeries = appState.selectedFolderId;
        try {
            const token = await getAuthToken();
            await sendTokenToSW(token);
        } catch (_) {}
        await reviewGrid.loadSeries(series, appState.selectedFolderId);
        reviewGrid.openPhotoById(photo.file_id);
    } else {
        reviewGrid.openSinglePhoto(photo);
    }
}
```

- [ ] **Step 9: Verify in the browser**

With `npm run dev` running, open http://localhost:5173. Sign in, click a folder. The middle panel should now show a chronological thumbnail grid. Verify:
- Series blocks appear with a colored left border
- Clicking a series header loads it in the right review panel
- Clicking a photo thumbnail opens the fullscreen overlay
- Standalone photos (not in any series) appear in rows between series blocks

- [ ] **Step 10: Commit**

```bash
git add src/main.js
git commit -m "feat: wire PhotoGridPanel into main.js, replace SeriesPanel"
```

---

### Task 5: Remove `seriesPanel.js`

**Files:**
- Delete: `src/lib/seriesPanel.js`

- [ ] **Step 1: Delete the file**

```bash
git rm src/lib/seriesPanel.js
```

- [ ] **Step 2: Verify the dev server still starts cleanly**

```bash
npm run dev
```

Open http://localhost:5173. No import errors in the console. The app should work identically to after Task 4.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove SeriesPanel, replaced by PhotoGridPanel"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| All photos shown as thumbnails chronologically | Task 2 (`_buildTimeline` + `_render`) |
| Series as bordered blocks with header | Task 2 (`_renderSeriesBlock`) |
| Colored border by classification (burst/spread/sparse) | Tasks 1 & 2 |
| Standalone photos inline between series | Task 2 (`_buildTimeline` groups + `_renderStandaloneGroup`) |
| Click series header → right review panel | Task 2 (`header.addEventListener` → `onSeriesClick`) |
| Click photo thumbnail → fullscreen | Tasks 2 & 3 (`onPhotoClick` → `openPhotoById` / `openSinglePhoto`) |
| "+N" overflow chip → opens series in review panel | Task 2 (`overflow.addEventListener` → `onSeriesClick`) |
| Keep/delete borders on thumbnails | Task 2 (`loadSeriesState` → `photo-thumb--keep/delete`) |
| Max 12 thumbnails per series | Task 2 (`MAX_THUMBS = 12`) |
| Thumbnails via `/api/thumb/<id>` Service Worker URL | Task 2 (`img src="/api/thumb/${photo.file_id}"`) |
| Progress bar: N series · X% reviewed | Task 2 (`_render` header update) |
| Delete seriesPanel.js | Task 5 |
| `openPhotoById` on ReviewGrid | Task 3 |

**Placeholder scan:** No TBDs, todos, or vague steps found.

**Type consistency:**
- `classifySeries` returns `'burst' | 'spread' | 'sparse'` — CSS modifier classes use the same names (`series-block--burst`, `series-block--spread`, `series-block--sparse`) ✓
- `loadSeriesState` returns `{ keptIds, deletedIds, timestamp } | null` — accessed as `state?.keptIds ?? []` ✓
- `isSeriesReviewed(folderId, series.startTime)` — same signature as in `reviewManager.js` ✓
- `onSeriesClick(series, folderId, index)` — matches `handleSeriesClick` signature in `main.js` ✓
- `openPhotoById(fileId)` / `openSinglePhoto(photo)` added in Task 3, called in Task 4 ✓
