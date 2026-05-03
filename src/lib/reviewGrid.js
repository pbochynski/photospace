import { preselectSeries, loadSeriesState, saveSeriesState, togglePhotoKeep } from './reviewManager.js';
import { getCalibration } from './calibration.js';

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
                    <button class="thumb-cell__toggle-btn" title="${isKept ? 'Mark for deletion' : 'Keep'}">${isKept ? '★' : '✕'}</button>
                </div>
            `;

            cell.addEventListener('click', (e) => {
                if (e.target.closest('.thumb-cell__toggle-btn')) {
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

        this._footerEl.querySelector('#btn-delete-series')?.addEventListener('click', () => this._confirmDelete());
        this._footerEl.querySelector('#btn-select-all')?.addEventListener('click', () => this._markAllDelete());
        this._footerEl.querySelector('#btn-deselect-all')?.addEventListener('click', () => this._markAllKeep());
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
            const deletedSuccessfully = [];
            let lastError = null;
            for (const fileId of idsToDelete) {
                try {
                    await deletePhotoFromOneDrive(fileId);
                    deletedSuccessfully.push(fileId);
                } catch (err) {
                    lastError = err;
                }
            }
            if (deletedSuccessfully.length > 0) {
                this._series.photos = this._series.photos.filter(p => !deletedSuccessfully.includes(p.file_id));
                this._deletedIds = this._deletedIds.filter(id => !deletedSuccessfully.includes(id));
                this._keptIds = this._series.photos.map(p => p.file_id);
                await saveSeriesState(this._folderId, this._series.startTime, this._keptIds, this._deletedIds);
                this._photos = [...this._series.photos].sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
                this._render();
            }
            if (lastError) {
                alert(`Deleted ${deletedSuccessfully.length} of ${idsToDelete.length} photos. Some deletions failed: ${lastError.message}`);
            }
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
            <button id="fs-close"
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
                <div style="font-size:12px;word-break:break-all">${this._escapeHtml(photo.name)}</div>
            </div>
            <div style="margin-bottom:16px">
                <div style="font-weight:600;margin-bottom:8px">Quality Score</div>
                ${this._scoreBar('Overall', photo.quality_score)}
                ${this._scoreBar('Sharpness', photo.sharpness)}
                ${this._scoreBar('Exposure', photo.exposure)}
                ${photo.face?.detected ? this._scoreBar('Face', photo.face.score) : '<div style="color:#888;font-size:12px">Face — n/a</div>'}
            </div>
            <button id="fs-toggle-keep"
                style="width:100%;padding:8px;background:${isKept ? 'var(--color-keep)' : 'var(--color-delete)'};border:none;color:white;border-radius:4px;cursor:pointer;font-size:13px">
                ${isKept ? '★ Kept — click to mark for deletion' : '✕ Marked for deletion — click to keep'}
            </button>
        `;
        this._fsSidebar.querySelector('#fs-toggle-keep')?.addEventListener('click', () => this._toggleKeep(photo.file_id));

        document.getElementById('fs-prev')?.addEventListener('click', () => this._renderFullscreen(index - 1));
        document.getElementById('fs-next')?.addEventListener('click', () => this._renderFullscreen(index + 1));
        this._fsPhoto.querySelector('#fs-close')?.addEventListener('click', () => this.closeFullscreen());

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

    _escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}
