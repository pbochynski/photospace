# Step 06: Review Grid Panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `ReviewGrid` — the right panel showing photo thumbnails sorted by quality score, with keep/delete state, a delete button, and full-screen preview trigger.

**Architecture:** `ReviewGrid` replaces the stub in `src/lib/reviewGrid.js`. It imports `reviewManager.js` for state and `photoDeleteManager.js` for deletion. Thumbnails are fetched via the service worker's `/api/thumb/<fileId>` proxy.

**Tech Stack:** Vanilla JS ES modules, Service Worker thumbnail proxy (existing sw.js)

---

### Task 1: Implement ReviewGrid

**Files:**
- Modify: `src/lib/reviewGrid.js` (replace stub)

- [ ] **Step 1: Read photoDeleteManager.js to understand the delete API**

Read `src/lib/photoDeleteManager.js` to confirm the function signatures for deleting photos.

- [ ] **Step 2: Replace src/lib/reviewGrid.js with full implementation**

```javascript
import { preselectSeries, loadSeriesState, saveSeriesState, togglePhotoKeep } from './reviewManager.js';
import { getCalibration } from './calibration.js';
import { db } from './db.js';

export class ReviewGrid {
    constructor({ headerEl, gridEl, footerEl, fullscreenOverlay, fullscreenPhoto, fullscreenSidebar }) {
        this._headerEl = headerEl;
        this._gridEl = gridEl;
        this._footerEl = footerEl;
        this._fsOverlay = fullscreenOverlay;
        this._fsPhoto = fullscreenPhoto;
        this._fsSidebar = fullscreenSidebar;

        this._series = null;
        this._folderId = null;
        this._photos = [];
        this._keptIds = [];
        this._deletedIds = [];
        this._fsIndex = null;

        this._fsOverlay.addEventListener('click', (e) => {
            if (e.target === this._fsOverlay) this.closeFullscreen();
        });
    }

    async loadSeries(series, folderId) {
        this._series = series;
        this._folderId = folderId;
        this._photos = [...series.photos].sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));

        const saved = await loadSeriesState(folderId, series.startTime);
        if (saved) {
            this._keptIds = saved.keptIds;
            this._deletedIds = saved.deletedIds;
        } else {
            const calibration = await getCalibration(folderId);
            const preselect = await preselectSeries(series, folderId, calibration);
            this._keptIds = preselect.keptIds;
            this._deletedIds = preselect.deletedIds;
            await saveSeriesState(folderId, series.startTime, this._keptIds, this._deletedIds);
        }

        this._render();
    }

    _render() {
        if (!this._series) return;

        const date = new Date(this._series.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        this._headerEl.innerHTML = `
            <strong>${date} · ${this._series.photoCount} photos</strong><br>
            <span style="color:#888;font-size:12px">${this._deletedIds.length} pre-selected for deletion</span>
        `;

        this._gridEl.innerHTML = '';
        const grid = document.createElement('div');
        grid.className = 'review-grid';

        this._photos.forEach((photo, i) => {
            const isKept = this._keptIds.includes(photo.file_id);
            const isDeleted = this._deletedIds.includes(photo.file_id);
            const cell = document.createElement('div');
            cell.className = 'thumb-cell' +
                (isKept ? ' thumb-cell--keep' : '') +
                (isDeleted ? ' thumb-cell--delete' : '');
            cell.dataset.index = i;

            const score = photo.quality_score != null ? photo.quality_score : '…';
            cell.innerHTML = `
                <img src="/api/thumb/${photo.file_id}" alt="" loading="lazy"
                     onerror="this.style.background='#333';this.removeAttribute('src')" />
                ${isKept ? '<span class="thumb-cell__star">★</span>' : ''}
                <span class="thumb-cell__score">${score}</span>
                <div class="thumb-cell__overlay">
                    <span style="color:white;font-size:20px">${isKept ? '★' : '✕'}</span>
                </div>
            `;

            cell.addEventListener('click', (e) => {
                if (e.target.classList.contains('thumb-cell__overlay') || e.target.closest('.thumb-cell__overlay')) {
                    this._toggleKeep(photo.file_id);
                } else {
                    this._openFullscreen(i);
                }
            });

            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this._toggleKeep(photo.file_id);
            });

            grid.appendChild(cell);
        });

        this._gridEl.appendChild(grid);
        this._renderFooter();
    }

    _renderFooter() {
        const deleteCount = this._deletedIds.length;
        this._footerEl.innerHTML = `
            <button id="btn-delete-series" class="btn-delete" ${deleteCount === 0 ? 'disabled' : ''}>
                🗑 Delete ${deleteCount} photo${deleteCount !== 1 ? 's' : ''}
            </button>
            <div style="display:flex;gap:12px;margin-top:6px">
                <button id="btn-select-all" class="btn-text">Deselect all</button>
                <button id="btn-deselect-all" class="btn-text">Keep all</button>
            </div>
        `;

        document.getElementById('btn-delete-series')?.addEventListener('click', () => this._confirmDelete());
        document.getElementById('btn-select-all')?.addEventListener('click', () => this._markAllDelete());
        document.getElementById('btn-deselect-all')?.addEventListener('click', () => this._markAllKeep());
    }

    async _toggleKeep(fileId) {
        const result = await togglePhotoKeep(this._folderId, this._series.startTime, fileId, this._keptIds, this._deletedIds);
        this._keptIds = result.keptIds;
        this._deletedIds = result.deletedIds;
        this._render();
        if (this._fsIndex !== null) this._renderFullscreen(this._fsIndex);
    }

    async _markAllDelete() {
        this._keptIds = this._photos.slice(0, 1).map(p => p.file_id);
        this._deletedIds = this._photos.slice(1).map(p => p.file_id);
        await saveSeriesState(this._folderId, this._series.startTime, this._keptIds, this._deletedIds);
        this._render();
    }

    async _markAllKeep() {
        this._keptIds = this._photos.map(p => p.file_id);
        this._deletedIds = [];
        await saveSeriesState(this._folderId, this._series.startTime, this._keptIds, this._deletedIds);
        this._render();
    }

    async _confirmDelete() {
        if (this._deletedIds.length === 0) return;
        const confirmed = confirm(`Delete ${this._deletedIds.length} photos? This cannot be undone.`);
        if (!confirmed) return;
        try {
            const { deletePhotoFromOneDrive } = await import('./photoDeleteManager.js');
            const idsToDelete = [...this._deletedIds];
            for (const fileId of idsToDelete) {
                await deletePhotoFromOneDrive(fileId);
            }
            this._series.photos = this._series.photos.filter(p => !idsToDelete.includes(p.file_id));
            this._deletedIds = [];
            this._keptIds = this._series.photos.map(p => p.file_id);
            await saveSeriesState(this._folderId, this._series.startTime, this._keptIds, this._deletedIds);
            this._photos = [...this._series.photos].sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
            this._render();
        } catch (e) {
            alert(`Delete failed: ${e.message}`);
        }
    }

    _openFullscreen(index) {
        this._fsIndex = index;
        this._fsOverlay.hidden = false;
        this._renderFullscreen(index);
    }

    _renderFullscreen(index) {
        const photo = this._photos[index];
        const isKept = this._keptIds.includes(photo.file_id);

        this._fsPhoto.innerHTML = `
            <button onclick="document.getElementById('fullscreen-overlay').hidden=true"
                style="position:absolute;top:12px;right:12px;background:rgba(0,0,0,0.5);border:none;color:white;font-size:20px;cursor:pointer;padding:4px 10px;border-radius:4px">✕</button>
            <button id="fs-prev" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);border:none;color:white;font-size:28px;cursor:pointer;padding:8px 14px;border-radius:4px"
                ${index === 0 ? 'disabled' : ''}>‹</button>
            <img src="/api/image/${photo.file_id}" style="max-width:100%;max-height:100%;object-fit:contain" />
            <button id="fs-next" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);border:none;color:white;font-size:28px;cursor:pointer;padding:8px 14px;border-radius:4px"
                ${index === this._photos.length - 1 ? 'disabled' : ''}>›</button>
        `;

        this._fsSidebar.innerHTML = `
            <div style="margin-bottom:12px">
                <div style="color:#888;font-size:11px;margin-bottom:2px">Photo ${index + 1} of ${this._photos.length}</div>
                <div style="font-size:12px;word-break:break-all">${photo.name}</div>
            </div>
            <div style="margin-bottom:16px">
                <div style="font-weight:600;margin-bottom:8px">Quality Score</div>
                ${this._scoreBar('Overall', photo.quality_score)}
                ${this._scoreBar('Sharpness', photo.sharpness)}
                ${this._scoreBar('Exposure', photo.exposure)}
                ${photo.face?.detected ? this._scoreBar('Face', photo.face.score) : '<div style="color:#888;font-size:12px">Face — n/a</div>'}
            </div>
            <button onclick="window.__reviewGrid._toggleKeep('${photo.file_id}')"
                style="width:100%;padding:8px;background:${isKept ? 'var(--color-keep)' : 'var(--color-delete)'};border:none;color:white;border-radius:4px;cursor:pointer;font-size:13px">
                ${isKept ? '★ Kept — click to mark for deletion' : '✕ Marked for deletion — click to keep'}
            </button>
        `;

        document.getElementById('fs-prev')?.addEventListener('click', () => this._renderFullscreen(index - 1));
        document.getElementById('fs-next')?.addEventListener('click', () => this._renderFullscreen(index + 1));

        window.__reviewGrid = this;
        this._fsIndex = index;
    }

    _scoreBar(label, value) {
        const v = value != null ? Math.round(value) : null;
        return `
            <div style="margin-bottom:6px">
                <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">
                    <span>${label}</span><span>${v != null ? v : '…'}</span>
                </div>
                <div style="background:#333;border-radius:2px;height:4px">
                    <div style="background:var(--color-accent);height:100%;border-radius:2px;width:${v != null ? v : 0}%"></div>
                </div>
            </div>
        `;
    }

    closeFullscreen() {
        this._fsOverlay.hidden = true;
        this._fsIndex = null;
    }
}
```

- [ ] **Step 2: Read photoDeleteManager.js to verify the delete function name**

Read `src/lib/photoDeleteManager.js` to see the exported function. If the export is not `deletePhotosBatch`, adjust the import in `_confirmDelete` accordingly.

- [ ] **Step 3: Add keyboard navigation for fullscreen**

In `main.js`, the `keydown` handler already calls `reviewGrid.closeFullscreen()` on Escape. Add arrow key handling. Add to the `onAuthenticated` function in `main.js`:

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

Replace the existing single-line keydown listener in `main.js` with this block.

- [ ] **Step 4: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reviewGrid.js src/main.js
git commit -m "feat: implement ReviewGrid with keep/delete, fullscreen preview, keyboard nav"
```

---

### Task 2: Wire service worker for thumbnail and image proxying

**Files:**
- Read: `src/sw.js` (verify it already handles `/api/thumb/` and `/api/image/`)

- [ ] **Step 1: Verify sw.js handles the URL patterns used by ReviewGrid**

Read `src/sw.js` to confirm it intercepts `/api/thumb/<fileId>` and `/api/image/<fileId>` and proxies them to Graph with auth token.

- [ ] **Step 2: Register service worker in main.js if not already done**

Add to `boot()` in `main.js` (before `db.init()`):

```javascript
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(e => console.warn('SW registration failed:', e));
}
```

- [ ] **Step 3: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: register service worker for auth-proxied thumbnail/image URLs"
```
