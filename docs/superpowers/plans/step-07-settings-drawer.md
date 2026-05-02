# Step 07: Quick/Advanced Settings Drawer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Advanced settings drawer: sliders for series parameters, worker count, date range filter, and ignored periods list. Quick mode hides all sliders and uses calibration. Toggle between modes is in the header.

**Architecture:** A new `settingsDrawer.js` renders the drawer content into `#settings-content`. Settings are persisted via the existing `db.setSetting`/`db.getSetting` API. Quick mode reads from `calibration.js`; Advanced mode reads from raw `db` settings.

**Tech Stack:** Vanilla JS ES modules, IndexedDB via existing db.js

---

### Task 1: Rewrite settingsManager.js for v2

**Files:**
- Modify: `src/lib/settingsManager.js`

The existing `settingsManager.js` ties settings to specific DOM element IDs from the old UI. In v2, settings are read/written directly by the new `settingsDrawer.js` and `calibration.js`. We keep only the pure getter/setter functions.

- [ ] **Step 1: Replace settingsManager.js with a lean version**

Replace the entire content of `src/lib/settingsManager.js` with:

```javascript
import { db } from './db.js';

export async function getSetting(key, defaultValue) {
    const val = await db.getSetting(key);
    return val !== null && val !== undefined ? val : defaultValue;
}

export async function setSetting(key, value) {
    await db.setSetting(key, value);
}

// Series analysis settings
export async function getSeriesSettings() {
    const [minGroupSize, minDensity, maxTimeGap, workerCount] = await Promise.all([
        getSetting('seriesMinGroupSize', 2),
        getSetting('seriesMinDensity', 1),
        getSetting('seriesMaxTimeGap', 5),
        getSetting('workerCount', 2),
    ]);
    return { minGroupSize, minDensity, maxTimeGap, workerCount };
}

export async function getDateFilter() {
    const [enabled, from, to] = await Promise.all([
        getSetting('dateEnabled', false),
        getSetting('dateFrom', null),
        getSetting('dateTo', null),
    ]);
    return { enabled, from, to };
}

export async function getIgnoredPeriods() {
    const val = await db.getSetting('ignoredPeriods');
    return Array.isArray(val) ? val : [];
}

export async function addIgnoredPeriod(startTime, endTime, label = '') {
    const periods = await getIgnoredPeriods();
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const newPeriod = {
        id: Date.now(),
        startTime,
        endTime,
        label: label || `${fmt(startDate)} → ${fmt(endDate)}`
    };
    periods.push(newPeriod);
    await db.setSetting('ignoredPeriods', periods);
    return periods;
}

export async function removeIgnoredPeriod(periodId) {
    const periods = await getIgnoredPeriods();
    const filtered = periods.filter(p => p.id !== periodId);
    await db.setSetting('ignoredPeriods', filtered);
    return filtered;
}
```

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settingsManager.js
git commit -m "refactor: lean settingsManager with pure getters/setters for v2"
```

---

### Task 2: Create settingsDrawer.js

**Files:**
- Create: `src/lib/settingsDrawer.js`

- [ ] **Step 1: Create src/lib/settingsDrawer.js**

```javascript
import { getSetting, setSetting, getSeriesSettings, getIgnoredPeriods, addIgnoredPeriod, removeIgnoredPeriod } from './settingsManager.js';
import { getCalibration } from './calibration.js';

export class SettingsDrawer {
    constructor(contentEl, { onSettingsChange }) {
        this._contentEl = contentEl;
        this._onSettingsChange = onSettingsChange;
        this._currentFolderId = null;
    }

    setCurrentFolder(folderId) {
        this._currentFolderId = folderId;
    }

    async render() {
        const settings = await getSeriesSettings();
        const dateFilter = await (await import('./settingsManager.js')).getDateFilter();
        const ignoredPeriods = await getIgnoredPeriods();
        const calibration = this._currentFolderId ? await getCalibration(this._currentFolderId) : null;

        this._contentEl.innerHTML = `
            <h3 style="margin-bottom:16px">Advanced Settings</h3>

            ${calibration ? `
            <div style="background:#1e2a1e;border:1px solid #2d4a2d;border-radius:6px;padding:12px;margin-bottom:16px;font-size:12px">
                <div style="font-weight:600;margin-bottom:6px">Calibration result (auto)</div>
                <div style="color:#888">Max time gap: ${calibration.maxTimeGap} min</div>
                <div style="color:#888">Min density: ${calibration.minDensity} photos/min</div>
                <div style="color:#888">Burst threshold: ${calibration.burstThreshold} photos/min</div>
                <button id="btn-reset-calibration" class="btn-text" style="margin-top:6px">Reset to recommended</button>
            </div>
            ` : ''}

            <div class="settings-field">
                <label>Max time gap between photos (minutes)</label>
                <div style="display:flex;align-items:center;gap:8px">
                    <input type="range" id="s-max-time-gap" min="1" max="60" value="${settings.maxTimeGap}" style="flex:1" />
                    <span id="s-max-time-gap-val">${settings.maxTimeGap}</span>
                </div>
            </div>

            <div class="settings-field">
                <label>Min density (photos/min)</label>
                <div style="display:flex;align-items:center;gap:8px">
                    <input type="range" id="s-min-density" min="0.5" max="10" step="0.5" value="${settings.minDensity}" style="flex:1" />
                    <span id="s-min-density-val">${settings.minDensity}</span>
                </div>
            </div>

            <div class="settings-field">
                <label>Min series size (photos)</label>
                <div style="display:flex;align-items:center;gap:8px">
                    <input type="range" id="s-min-group-size" min="2" max="100" value="${settings.minGroupSize}" style="flex:1" />
                    <span id="s-min-group-size-val">${settings.minGroupSize}</span>
                </div>
            </div>

            <div class="settings-field">
                <label>Worker count</label>
                <div style="display:flex;align-items:center;gap:8px">
                    <input type="range" id="s-worker-count" min="1" max="4" value="${settings.workerCount}" style="flex:1" />
                    <span id="s-worker-count-val">${settings.workerCount}</span>
                </div>
            </div>

            <div class="settings-field">
                <label style="display:flex;align-items:center;gap:8px">
                    <input type="checkbox" id="s-date-enabled" ${dateFilter.enabled ? 'checked' : ''} />
                    Enable date filter
                </label>
                <div id="s-date-fields" ${!dateFilter.enabled ? 'style="display:none"' : ''}>
                    <input type="date" id="s-date-from" value="${dateFilter.from || ''}" style="margin-top:6px;width:100%;background:#1a1a1a;border:1px solid #444;color:#e0e0e0;padding:4px;border-radius:4px" />
                    <input type="date" id="s-date-to" value="${dateFilter.to || ''}" style="margin-top:4px;width:100%;background:#1a1a1a;border:1px solid #444;color:#e0e0e0;padding:4px;border-radius:4px" />
                </div>
            </div>

            <div class="settings-field">
                <label>Ignored periods</label>
                <div id="ignored-periods-list">
                    ${ignoredPeriods.map(p => `
                        <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;color:#888">
                            <span style="flex:1">${p.label}</span>
                            <button class="btn-text" data-remove-period="${p.id}">✕</button>
                        </div>
                    `).join('') || '<div style="color:#555;font-size:12px">No ignored periods</div>'}
                </div>
                <button id="btn-add-period" class="btn-text" style="margin-top:6px">+ Add ignored period</button>
            </div>
        `;

        this._wireEvents();
    }

    _wireEvents() {
        const wire = (id, key, transform = v => v) => {
            const el = document.getElementById(id);
            const valEl = document.getElementById(id + '-val');
            if (!el) return;
            el.addEventListener('input', async () => {
                const v = transform(el.value);
                if (valEl) valEl.textContent = v;
                await setSetting(key, v);
                this._onSettingsChange?.();
            });
        };

        wire('s-max-time-gap', 'seriesMaxTimeGap', Number);
        wire('s-min-density', 'seriesMinDensity', Number);
        wire('s-min-group-size', 'seriesMinGroupSize', Number);
        wire('s-worker-count', 'workerCount', Number);

        const dateEnabled = document.getElementById('s-date-enabled');
        const dateFields = document.getElementById('s-date-fields');
        dateEnabled?.addEventListener('change', async () => {
            await setSetting('dateEnabled', dateEnabled.checked);
            if (dateFields) dateFields.style.display = dateEnabled.checked ? '' : 'none';
            this._onSettingsChange?.();
        });

        document.getElementById('s-date-from')?.addEventListener('change', async (e) => {
            await setSetting('dateFrom', e.target.value);
            this._onSettingsChange?.();
        });
        document.getElementById('s-date-to')?.addEventListener('change', async (e) => {
            await setSetting('dateTo', e.target.value);
            this._onSettingsChange?.();
        });

        document.querySelectorAll('[data-remove-period]').forEach(btn => {
            btn.addEventListener('click', async () => {
                await removeIgnoredPeriod(Number(btn.dataset.removePeriod));
                await this.render();
                this._onSettingsChange?.();
            });
        });

        document.getElementById('btn-add-period')?.addEventListener('click', () => {
            const start = prompt('Start date/time (YYYY-MM-DD HH:MM):');
            const end = prompt('End date/time (YYYY-MM-DD HH:MM):');
            if (start && end) {
                addIgnoredPeriod(new Date(start).getTime(), new Date(end).getTime())
                    .then(() => { this.render(); this._onSettingsChange?.(); });
            }
        });

        document.getElementById('btn-reset-calibration')?.addEventListener('click', async () => {
            if (!this._currentFolderId) return;
            const cal = await getCalibration(this._currentFolderId);
            if (cal) {
                await setSetting('seriesMaxTimeGap', cal.maxTimeGap);
                await setSetting('seriesMinDensity', cal.minDensity);
                await this.render();
                this._onSettingsChange?.();
            }
        });
    }
}
```

Add settings field styling to `src/style.css` (append):

```css
.settings-field {
  margin-bottom: 16px;
}
.settings-field label {
  display: block;
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 4px;
}
```

- [ ] **Step 2: Wire settingsDrawer into main.js**

In `main.js`, import and wire the drawer. Add to the top imports:

```javascript
import { SettingsDrawer } from './lib/settingsDrawer.js';
```

In the `onAuthenticated` function, add after the reviewGrid creation:

```javascript
const settingsDrawer = new SettingsDrawer(document.getElementById('settings-content'), {
    onSettingsChange: async () => {
        if (appState.selectedFolderId) {
            settingsDrawer.setCurrentFolder(appState.selectedFolderId);
            await seriesPanel.loadFolder(appState.selectedFolderId, appState.selectedFolderName);
        }
    }
});
```

Update `toggleMode` to also render the settings drawer when opening Advanced:

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

Note: `settingsDrawer` variable must be hoisted to module scope (declared at the top of the `onAuthenticated` function body and assigned there, or declared in module scope and assigned in `onAuthenticated`).

- [ ] **Step 3: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/lib/settingsDrawer.js src/lib/settingsManager.js src/main.js src/style.css
git commit -m "feat: Quick/Advanced mode toggle with settings drawer and calibration display"
```
