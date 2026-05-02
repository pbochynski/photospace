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
