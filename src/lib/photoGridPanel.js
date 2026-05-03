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
