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
        const { getDateFilter } = await import('./settingsManager.js');
        const dateFilter = await getDateFilter();
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
                            <span style="flex:1">${this._escapeHtml(p.label)}</span>
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
            const el = this._contentEl.querySelector(`#${id}`);
            const valEl = this._contentEl.querySelector(`#${id}-val`);
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

        const dateEnabled = this._contentEl.querySelector('#s-date-enabled');
        const dateFields = this._contentEl.querySelector('#s-date-fields');
        dateEnabled?.addEventListener('change', async () => {
            await setSetting('dateEnabled', dateEnabled.checked);
            if (dateFields) dateFields.style.display = dateEnabled.checked ? '' : 'none';
            this._onSettingsChange?.();
        });

        this._contentEl.querySelector('#s-date-from')?.addEventListener('change', async (e) => {
            await setSetting('dateFrom', e.target.value);
            this._onSettingsChange?.();
        });
        this._contentEl.querySelector('#s-date-to')?.addEventListener('change', async (e) => {
            await setSetting('dateTo', e.target.value);
            this._onSettingsChange?.();
        });

        this._contentEl.querySelectorAll('[data-remove-period]').forEach(btn => {
            btn.addEventListener('click', async () => {
                await removeIgnoredPeriod(Number(btn.dataset.removePeriod));
                await this.render();
                this._onSettingsChange?.();
            });
        });

        this._contentEl.querySelector('#btn-add-period')?.addEventListener('click', () => {
            const start = prompt('Start date/time (YYYY-MM-DD HH:MM):');
            const end = prompt('End date/time (YYYY-MM-DD HH:MM):');
            if (start && end) {
                addIgnoredPeriod(new Date(start).getTime(), new Date(end).getTime())
                    .then(() => { this.render(); this._onSettingsChange?.(); });
            }
        });

        this._contentEl.querySelector('#btn-reset-calibration')?.addEventListener('click', async () => {
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

    _escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}
