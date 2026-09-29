import { findPhotoSeries } from './analysis.js';
import { getSeriesSettings } from './settingsManager.js';
import { db } from './db.js';

export class PhotoGridPanel {
    constructor({ headerEl, listEl, onSeriesClick, onPhotoClick, onViewModeChange, initialViewMode = 'series' }) {
        this._headerEl = headerEl;
        this._listEl = listEl;
        this._onSeriesClick = onSeriesClick;
        this._onPhotoClick = onPhotoClick;
        this._onViewModeChange = onViewModeChange;
        this._viewMode = initialViewMode;
        this._series = [];
        this._photos = [];
        this._folderId = null;
        this._folderName = null;
    }

    clear() {
        this._headerEl.innerHTML = '';
        this._listEl.innerHTML = '';
    }

    setViewMode(mode) {
        this._viewMode = mode;
        if (this._folderId !== null) this._render().catch(console.error);
    }

    async loadFolder(folderId, folderName) {
        this._folderId = folderId;
        this._folderName = folderName;
        this._series = [];
        this._headerEl.innerHTML = `Loading ${folderName}…`;
        this._listEl.innerHTML = '';

        const photos = await db.getPhotosByFolderId(folderId);
        if (photos.length === 0) {
            this._photos = [];
            this._listEl.innerHTML = '<div style="padding:16px;color:#888">No photos scanned yet. Click ↑ to scan this folder.</div>';
            this._renderHeader();
            return;
        }

        const settings = await getSeriesSettings();

        this._series = await findPhotoSeries(photos, {
            minGroupSize: settings.minGroupSize,
            maxTimeGap: settings.maxTimeGap,
        });

        this._photos = photos.slice().sort((a, b) => (a.photo_taken_ts || 0) - (b.photo_taken_ts || 0));
        await this._render();
    }

    async _render() {
        this._listEl.innerHTML = '';
        this._renderHeader();
        if (this._viewMode === 'allphotos') {
            this._renderAllPhotos();
        } else {
            await this._renderSeriesView();
        }
    }

    _renderHeader() {
        this._headerEl.innerHTML = '';
        this._headerEl.style.cssText = 'display:flex;align-items:center;gap:8px';

        const info = document.createElement('span');
        info.style.flex = '1';
        if (this._folderId && this._photos.length > 0) {
            const seriesInfo = this._series.length > 0 ? ` · ${this._series.length} series` : '';
            info.textContent = `${this._photos.length} photos${seriesInfo}`;
        } else if (this._folderId) {
            info.textContent = this._folderName || '';
        }
        this._headerEl.appendChild(info);
        this._headerEl.appendChild(this._buildToggle());
    }

    _buildToggle() {
        const wrap = document.createElement('div');
        wrap.className = 'view-toggle';

        const btnSeries = document.createElement('button');
        btnSeries.className = 'view-toggle__btn' + (this._viewMode === 'series' ? ' view-toggle__btn--active' : '');
        btnSeries.textContent = 'Series';

        const btnAll = document.createElement('button');
        btnAll.className = 'view-toggle__btn' + (this._viewMode === 'allphotos' ? ' view-toggle__btn--active' : '');
        btnAll.textContent = 'All photos';

        btnSeries.addEventListener('click', () => this._handleToggle('series'));
        btnAll.addEventListener('click', () => this._handleToggle('allphotos'));

        wrap.appendChild(btnSeries);
        wrap.appendChild(btnAll);
        return wrap;
    }

    _handleToggle(mode) {
        if (this._viewMode === mode) return;
        this._viewMode = mode;
        this._render().catch(console.error);
        this._onViewModeChange?.(mode);
    }

    async _renderSeriesView() {
        const timeline = this._buildTimeline(this._photos);
        const container = document.createElement('div');
        container.className = 'photo-grid-timeline';

        for (const item of timeline) {
            if (item.type === 'series') {
                container.appendChild(await this._renderSeriesBlock(item.series, item.index));
            } else {
                container.appendChild(this._renderStandaloneGroup(item.photos));
            }
        }

        this._listEl.appendChild(container);
    }

    _renderAllPhotos() {
        const grid = document.createElement('div');
        grid.className = 'review-grid';
        for (const photo of this._photos) {
            grid.appendChild(this._makeAllPhotoCell(photo));
        }
        this._listEl.appendChild(grid);
    }

    _makeAllPhotoCell(photo) {
        const cell = document.createElement('div');
        cell.className = 'thumb-cell thumb-cell--sm' + (photo.item_type === 'video' ? ' thumb-cell--video' : '');
        if (photo.width && photo.height) {
            cell.style.setProperty('--aspect', photo.width / photo.height);
        }
        const img = document.createElement('img');
        img.src = `/api/thumb/${photo.file_id}`;
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = function() { this.style.background = '#333'; this.removeAttribute('src'); };
        img.onload = () => {
            if (img.naturalWidth && img.naturalHeight) {
                cell.style.setProperty('--aspect', img.naturalWidth / img.naturalHeight);
            }
        };
        cell.appendChild(img);
        cell.addEventListener('click', () => this._onPhotoClick(photo, null));
        return cell;
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
        const seriesIndexMap = new Map(this._series.map((s, i) => [s, i]));

        for (const photo of sorted) {
            const series = photoIdToSeries.get(photo.file_id);
            if (series) {
                if (!emittedSeries.has(series)) {
                    emittedSeries.add(series);
                    raw.push({ type: 'series', series, index: seriesIndexMap.get(series) });
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

    async _renderSeriesBlock(series, seriesIndex) {
        const keepCount = Math.min(1, series.photoCount);
        const tagLabel = keepCount >= series.photoCount ? 'keep all' : `keep ${keepCount}`;

        const date = new Date(series.startTime).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        const block = document.createElement('div');
        block.className = 'series-block';

        const header = document.createElement('div');
        header.className = 'series-block__header';

        const dateSpan = document.createElement('span');
        dateSpan.className = 'series-block__date';
        dateSpan.textContent = date;

        const tagSpan = document.createElement('span');
        tagSpan.className = 'series-block__tag';
        tagSpan.textContent = tagLabel;

        const countSpan = document.createElement('span');
        countSpan.className = 'series-block__count';
        countSpan.textContent = `${series.photoCount} photos`;

        const openSpan = document.createElement('span');
        openSpan.className = 'series-block__open';
        openSpan.textContent = '▶ open in review';

        header.appendChild(dateSpan);
        header.appendChild(tagSpan);
        header.appendChild(countSpan);
        header.appendChild(openSpan);

        header.addEventListener('click', () => this._onSeriesClick(series, this._folderId, seriesIndex));
        block.appendChild(header);

        const thumbsEl = document.createElement('div');
        thumbsEl.className = 'series-block__thumbs';

        const MAX_THUMBS = 12;
        const visiblePhotos = series.photos.slice(0, MAX_THUMBS);
        const overflowCount = series.photos.length - MAX_THUMBS;

        for (const photo of visiblePhotos) {
            const thumb = document.createElement('div');
            thumb.className = 'photo-thumb';
            const img = document.createElement('img');
            img.src = `/api/thumb/${photo.file_id}`;
            img.alt = '';
            img.loading = 'lazy';
            img.onerror = function() { this.style.background = '#333'; this.removeAttribute('src'); };
            thumb.appendChild(img);
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
            const img = document.createElement('img');
            img.src = `/api/thumb/${photo.file_id}`;
            img.alt = '';
            img.loading = 'lazy';
            img.onerror = function() { this.style.background = '#333'; this.removeAttribute('src'); };
            thumb.appendChild(img);
            thumb.addEventListener('click', () => this._onPhotoClick(photo, null));
            wrap.appendChild(thumb);
        }
        return wrap;
    }

    getPhotos() {
        return this._photos;
    }

    showOnboarding() {
        this._listEl.innerHTML = `
            <div class="onboarding-card">
                <h3>Start by picking a folder to scan</h3>
                <p>Navigate to a folder in the left panel. Photospace will scan it and find burst series — groups of photos taken in quick succession. Then pick the best shots and delete the rest.</p>
            </div>
        `;
        this._headerEl.innerHTML = '';
    }
}
