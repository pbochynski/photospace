# Step 05: Main.js — App Bootstrap and Panel Wiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `src/main.js` to boot the app (auth, db init, scan engine start) and wire all three panels together. This is the orchestration layer — it delegates rendering to panel modules created in Steps 06–08.

**Architecture:** `main.js` owns auth state, `appState` (selectedFolderId, selectedSeriesIndex), and the scan engine. It imports panel renderers and calls them. No inline HTML generation in main.js — just wiring.

**Tech Stack:** Vanilla JS ES modules, MSAL.js v3

---

### Task 1: Create folderPanel.js renderer

**Files:**
- Create: `src/lib/folderPanel.js`

Renders the folder tree into `#folder-tree`. Calls back to main via a callback when a folder is clicked.

- [ ] **Step 1: Create src/lib/folderPanel.js**

```javascript
import { getRootFolders, getFolderChildren } from './graph.js';
import { db } from './db.js';

const STALE_DAYS = 7;

export class FolderPanel {
    constructor(containerEl, { onFolderClick, onPromoteClick }) {
        this._container = containerEl;
        this._onFolderClick = onFolderClick;
        this._onPromoteClick = onPromoteClick;
        this._expandedFolders = new Set();
        this._folderStatus = new Map();
        this._selectedFolderId = null;
    }

    setFolderStatus(folderId, status, photoCount) {
        this._folderStatus.set(folderId, { status, photoCount });
        this._rerender();
    }

    setSelected(folderId) {
        this._selectedFolderId = folderId;
        this._rerender();
    }

    async loadRoot() {
        try {
            const folders = await getRootFolders();
            this._rootFolders = folders;
            const folderMeta = (await db.getSetting('folderMeta')) || {};
            const STALE_MS = 7 * 24 * 60 * 60 * 1000;
            folders.forEach(folder => {
                const meta = folderMeta[folder.id];
                if (meta) {
                    const status = (Date.now() - meta.lastScannedAt > STALE_MS) ? 'stale' : 'scanned';
                    this._folderStatus.set(folder.id, { status, photoCount: meta.photoCount });
                }
            });
            this._rerender();
        } catch (e) {
            this._container.innerHTML = `<div style="padding:12px;color:#888">Failed to load folders</div>`;
        }
    }

    _rerender() {
        if (!this._rootFolders) return;
        this._container.innerHTML = '';
        this._renderFolders(this._rootFolders, this._container, 0);
    }

    _renderFolders(folders, parentEl, depth) {
        folders.forEach(folder => {
            const item = document.createElement('div');
            item.className = 'folder-item' + (this._selectedFolderId === folder.id ? ' folder-item--selected' : '');
            item.style.paddingLeft = `${12 + depth * 16}px`;

            const statusInfo = this._folderStatus.get(folder.id);
            const status = statusInfo?.status || 'not_scanned';
            const photoCount = statusInfo?.photoCount;

            const badgeText = this._statusBadgeText(status, photoCount);
            const badgeClass = status === 'scanning' ? 'folder-item__badge--scanning' :
                               status === 'stale' ? 'folder-item__badge--stale' : '';

            item.innerHTML = `
                <span>📁</span>
                <span class="folder-item__name">${folder.name}</span>
                ${badgeText ? `<span class="folder-item__badge ${badgeClass}">${badgeText}</span>` : ''}
                ${status === 'not_scanned' || status === 'stale' ? `<button class="folder-item__promote-btn" data-folder-id="${folder.id}" data-folder-name="${folder.name}">↑</button>` : ''}
            `;

            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('folder-item__promote-btn')) {
                    e.stopPropagation();
                    this._onPromoteClick(folder.id, folder.name, folder.parentReference?.driveId);
                } else {
                    this._onFolderClick(folder.id, folder.name, folder.parentReference?.driveId);
                }
            });

            parentEl.appendChild(item);
        });
    }

    _statusBadgeText(status, photoCount) {
        if (status === 'scanning') return 'scanning…';
        if (status === 'scanned' && photoCount != null) return `${photoCount} photos`;
        if (status === 'stale') return 'stale';
        if (status === 'not_scanned') return '';
        return '';
    }
}
```

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/lib/folderPanel.js
git commit -m "feat: add FolderPanel renderer"
```

---

### Task 2: Create seriesPanel.js renderer

**Files:**
- Create: `src/lib/seriesPanel.js`

Renders the series list for the selected folder into `#series-list` and `#series-header`.

- [ ] **Step 1: Create src/lib/seriesPanel.js**

```javascript
import { findPhotoSeries } from './analysis.js';
import { classifySeries } from './reviewManager.js';
import { getCalibration } from './calibration.js';
import { db } from './db.js';
import { isSeriesReviewed } from './reviewManager.js';

export class SeriesPanel {
    constructor({ headerEl, listEl, progressBarEl, progressLabelEl, onSeriesClick }) {
        this._headerEl = headerEl;
        this._listEl = listEl;
        this._progressBarEl = progressBarEl;
        this._progressLabelEl = progressLabelEl;
        this._onSeriesClick = onSeriesClick;
        this._series = [];
        this._selectedIndex = null;
        this._folderId = null;
        this._folderName = null;
    }

    async loadFolder(folderId, folderName) {
        this._folderId = folderId;
        this._folderName = folderName;
        this._selectedIndex = null;
        this._headerEl.textContent = `Loading series in ${folderName}…`;
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

        await this._render();
    }

    async _render() {
        this._listEl.innerHTML = '';
        if (this._series.length === 0) {
            this._listEl.innerHTML = '<div style="padding:16px;color:#888">No burst series found in this folder.</div>';
            this._headerEl.textContent = this._folderName || '';
            return;
        }

        let reviewedCount = 0;
        for (const s of this._series) {
            if (await isSeriesReviewed(this._folderId, s.startTime)) reviewedCount++;
        }

        this._headerEl.textContent = `${this._series.length} series · ${Math.round(reviewedCount / this._series.length * 100)}% reviewed`;
        const pct = this._series.length > 0 ? reviewedCount / this._series.length * 100 : 0;
        this._progressBarEl.style.width = `${pct}%`;
        this._progressLabelEl.textContent = `${reviewedCount} of ${this._series.length} reviewed`;

        const calibration = await getCalibration(this._folderId);

        this._series.forEach((series, i) => {
            const classification = classifySeries(series, calibration);
            const card = document.createElement('div');
            card.className = 'series-card' +
                (this._selectedIndex === i ? ' series-card--selected' : '');

            const date = new Date(series.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const tagClass = classification === 'burst' ? 'series-card__tag--burst' :
                             classification === 'sparse' ? 'series-card__tag--sparse' : 'series-card__tag--keep3';
            const tagLabel = classification === 'burst' ? 'burst · keep 1' :
                             classification === 'sparse' ? 'keep all' : 'keep 3';
            const densityClass = series.density >= (calibration?.burstThreshold ?? 5) ? 'density-bar--burst' :
                                 series.density >= 2 ? 'density-bar--medium' : 'density-bar--spread';

            card.innerHTML = `
                <div class="series-card__header">
                    <span class="series-card__date">${date}</span>
                    <span class="series-card__count">${series.photoCount} photos</span>
                    <span class="series-card__tag ${tagClass}">${tagLabel}</span>
                </div>
                <div class="density-bar ${densityClass}" style="width:100%"></div>
            `;
            card.addEventListener('click', () => {
                this._selectedIndex = i;
                this._render();
                this._onSeriesClick(series, this._folderId, i);
            });
            this._listEl.appendChild(card);
        });
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

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/lib/seriesPanel.js
git commit -m "feat: add SeriesPanel renderer"
```

---

### Task 3: Rewrite main.js

**Files:**
- Modify: `src/main.js`

`main.js` is fully rewritten. It boots auth, initializes db, wires panels, and starts the scan engine.

- [ ] **Step 1: Read the auth.js interface**

Read `src/lib/auth.js` to confirm the exported functions (login, getAuthToken, checkAuth, etc.)

- [ ] **Step 2: Rewrite src/main.js**

```javascript
import { db } from './lib/db.js';
import { scanEngine } from './lib/scanEngine.js';
import { qualityProcessor } from './lib/qualityProcessor.js';
import { FolderPanel } from './lib/folderPanel.js';
import { SeriesPanel } from './lib/seriesPanel.js';
import { ReviewGrid } from './lib/reviewGrid.js';
import { getAuthToken, login, msalInstance } from './lib/auth.js';

const appState = {
    authenticated: false,
    selectedFolderId: null,
    selectedFolderName: null,
    selectedSeries: null,
    selectedFolderIdForSeries: null,
};

// DOM refs
const loginScreen   = document.getElementById('login-screen');
const btnLogin      = document.getElementById('btn-login');
const headerStatus  = document.getElementById('header-status');
const btnQuick      = document.getElementById('btn-quick');
const btnAdvanced   = document.getElementById('btn-advanced');
const settingsDrawer = document.getElementById('settings-drawer');

// Panel renderers (created after DOM ready)
let folderPanel, seriesPanel, reviewGrid;

async function boot() {
    await db.init();

    // Initialize MSAL (handles redirect response if present)
    await msalInstance.initialize();
    await msalInstance.handleRedirectPromise();

    let token = null;
    try { token = await getAuthToken(); } catch (_) {}

    if (token) {
        await onAuthenticated();
    } else {
        loginScreen.hidden = false;
    }

    btnLogin?.addEventListener('click', async () => {
        try {
            await login();
            loginScreen.hidden = true;
            await onAuthenticated();
        } catch (e) {
            console.error('Login failed:', e);
        }
    });

    btnQuick?.addEventListener('click', () => toggleMode('quick'));
    btnAdvanced?.addEventListener('click', () => toggleMode('advanced'));
}

function toggleMode(mode) {
    const isAdvanced = mode === 'advanced';
    btnQuick.classList.toggle('mode-btn--active', !isAdvanced);
    btnAdvanced.classList.toggle('mode-btn--active', isAdvanced);
    settingsDrawer.hidden = !isAdvanced;
}

async function onAuthenticated() {
    appState.authenticated = true;

    folderPanel = new FolderPanel(document.getElementById('folder-tree'), {
        onFolderClick: handleFolderClick,
        onPromoteClick: handlePromoteClick,
    });

    seriesPanel = new SeriesPanel({
        headerEl:       document.getElementById('series-header'),
        listEl:         document.getElementById('series-list'),
        progressBarEl:  document.getElementById('series-progress-bar'),
        progressLabelEl: document.getElementById('series-progress-label'),
        onSeriesClick:  handleSeriesClick,
    });

    reviewGrid = new ReviewGrid({
        headerEl: document.getElementById('review-header'),
        gridEl:   document.getElementById('review-grid'),
        footerEl: document.getElementById('review-footer'),
        fullscreenOverlay: document.getElementById('fullscreen-overlay'),
        fullscreenPhoto:   document.getElementById('fullscreen-photo'),
        fullscreenSidebar: document.getElementById('fullscreen-sidebar'),
    });

    // Check if first-run (no photos in db)
    const photoCount = await db.getPhotoCount();
    if (photoCount === 0) {
        seriesPanel.showOnboarding();
    }

    // Wire scan engine events
    scanEngine.addEventListener('folder_status', (e) => {
        const { folderId, status, photoCount } = e.detail;
        folderPanel.setFolderStatus(folderId, status, photoCount);
        if (status === 'scanned' && folderId === appState.selectedFolderId) {
            seriesPanel.loadFolder(folderId, appState.selectedFolderName);
        }
        updateHeaderStatus();
    });

    scanEngine.addEventListener('scan_idle', () => updateHeaderStatus());

    // Wire quality processor events
    qualityProcessor.addEventListener('quality_done', () => updateHeaderStatus());

    // Load folder tree
    await folderPanel.loadRoot();

    // Resume any pending scan queue
    await scanEngine.start();

    await qualityProcessor.init();

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') reviewGrid.closeFullscreen();
    });
}

async function handleFolderClick(folderId, folderName, driveId) {
    appState.selectedFolderId = folderId;
    appState.selectedFolderName = folderName;
    folderPanel.setSelected(folderId);
    await seriesPanel.loadFolder(folderId, folderName);
    await scanEngine.enqueueFolder(folderId, folderName, driveId, 'high');
}

async function handlePromoteClick(folderId, folderName, driveId) {
    await scanEngine.enqueueFolder(folderId, folderName, driveId, 'high');
}

async function handleSeriesClick(series, folderId, index) {
    appState.selectedSeries = series;
    appState.selectedFolderIdForSeries = folderId;
    await reviewGrid.loadSeries(series, folderId);
}

function updateHeaderStatus() {
    const pending = qualityProcessor.pendingCount;
    if (pending > 0) {
        headerStatus.textContent = `● Quality scoring ${pending} photos`;
    } else if (scanEngine._running) {
        headerStatus.textContent = '● Scanning…';
    } else {
        headerStatus.textContent = '';
    }
}

boot().catch(console.error);
```

- [ ] **Step 3: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build (ReviewGrid is referenced — it will be created in Step 07; at this point the build will fail until that file exists. Add an empty stub first).

Create stub `src/lib/reviewGrid.js`:

```javascript
export class ReviewGrid {
    constructor(opts) { this._opts = opts; }
    async loadSeries(series, folderId) {}
    closeFullscreen() {}
}
```

Then build again:

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/main.js src/lib/reviewGrid.js src/lib/folderPanel.js src/lib/seriesPanel.js
git commit -m "feat: rewrite main.js with three-panel wiring, add panel renderers and ReviewGrid stub"
```
