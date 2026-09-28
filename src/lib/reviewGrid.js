import { saveSeriesState } from './reviewManager.js';

export class ReviewGrid {
    constructor({ headerEl, gridEl, footerEl, fullscreenOverlay, fullscreenPhoto, fullscreenSidebar, onClose }) {
        this._headerEl = headerEl;
        this._gridEl = gridEl;
        this._footerEl = footerEl;
        this._fsOverlay = fullscreenOverlay;
        this._fsPhoto = fullscreenPhoto;
        this._fsSidebar = fullscreenSidebar;
        this._onClose = onClose;

        this._series = null;
        this._folderId = null;
        this._photos = [];
        this._selectedIds = new Set();
        this._fsIndex = null;

        this._fsOverlay.addEventListener('click', (e) => {
            if (e.target === this._fsOverlay) this.closeFullscreen();
        });
    }

    async loadSeries(series, folderId) {
        this._series = series;
        this._folderId = folderId;
        this._photos = [...series.photos];
        this._selectedIds = new Set();
        this._render();
    }

    _render() {
        if (!this._series) return;

        const date = new Date(this._series.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        this._headerEl.innerHTML = `
            <button id="btn-review-back" style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:13px;padding:0;margin-right:10px">‹ back</button>
            <strong>${date} · ${this._series.photoCount} photos</strong>
        `;
        this._headerEl.querySelector('#btn-review-back')?.addEventListener('click', () => this._onClose?.());

        this._gridEl.innerHTML = '';

        const toolbar = document.createElement('div');
        toolbar.className = 'review-toolbar';
        toolbar.innerHTML = `
            <button id="btn-select-all" class="btn-text">Select all</button>
            <button id="btn-deselect-all" class="btn-text">Deselect all</button>
            <button id="btn-invert" class="btn-text">Invert</button>
        `;
        toolbar.querySelector('#btn-select-all').addEventListener('click', () => this._selectAll());
        toolbar.querySelector('#btn-deselect-all').addEventListener('click', () => this._deselectAll());
        toolbar.querySelector('#btn-invert').addEventListener('click', () => this._invertSelection());
        this._gridEl.appendChild(toolbar);

        const grid = document.createElement('div');
        grid.className = 'review-grid';

        this._photos.forEach((photo, i) => {
            const isSelected = this._selectedIds.has(photo.file_id);
            const cell = document.createElement('div');
            cell.className = 'thumb-cell' + (isSelected ? ' thumb-cell--selected' : '');
            cell.dataset.index = i;

            // Set initial aspect ratio from stored dimensions; update from image naturalWidth/Height on load
            if (photo.width && photo.height) {
                cell.style.setProperty('--aspect', photo.width / photo.height);
            }

            const img = document.createElement('img');
            img.src = `/api/thumb/${photo.file_id}`;
            img.alt = '';
            img.loading = 'lazy';
            img.onerror = function() { this.style.background = '#333'; this.removeAttribute('src'); };
            img.onload = function() {
                if (this.naturalWidth && this.naturalHeight) {
                    cell.style.setProperty('--aspect', this.naturalWidth / this.naturalHeight);
                }
            };

            const checkbox = document.createElement('div');
            checkbox.className = 'thumb-cell__checkbox';
            checkbox.title = isSelected ? 'Deselect' : 'Select for deletion';
            if (isSelected) {
                const check = document.createElement('span');
                check.className = 'thumb-cell__check';
                check.textContent = '✓';
                checkbox.appendChild(check);
            }

            cell.appendChild(img);
            cell.appendChild(checkbox);

            checkbox.addEventListener('click', (e) => {
                e.stopPropagation();
                this._toggleSelect(photo.file_id);
            });

            cell.addEventListener('click', () => this._openFullscreen(i));

            grid.appendChild(cell);
        });

        this._gridEl.appendChild(grid);
        this._renderActionBar();
    }

    _renderActionBar() {
        const count = this._selectedIds.size;
        if (count === 0) {
            this._footerEl.innerHTML = '';
            return;
        }
        this._footerEl.innerHTML = `
            <div class="action-bar">
                <div style="flex:1"></div>
                <button id="btn-delete-selected" class="btn-delete">
                    🗑 Delete ${count} photo${count !== 1 ? 's' : ''}
                </button>
            </div>
        `;
        this._footerEl.querySelector('#btn-delete-selected')?.addEventListener('click', () => this._confirmDelete());
    }

    _toggleSelect(fileId) {
        const nowSelected = !this._selectedIds.has(fileId);
        if (nowSelected) {
            this._selectedIds.add(fileId);
        } else {
            this._selectedIds.delete(fileId);
        }

        // Update only the affected cell — no full re-render
        const index = this._photos.findIndex(p => p.file_id === fileId);
        if (index !== -1) {
            const cell = this._gridEl.querySelector(`[data-index="${index}"]`);
            if (cell) {
                cell.classList.toggle('thumb-cell--selected', nowSelected);
                const checkbox = cell.querySelector('.thumb-cell__checkbox');
                if (checkbox) {
                    checkbox.title = nowSelected ? 'Deselect' : 'Select for deletion';
                    checkbox.innerHTML = nowSelected ? '<span class="thumb-cell__check">✓</span>' : '';
                }
            }
        }

        this._renderActionBar();
    }

    _selectAll() {
        this._selectedIds = new Set(this._photos.map(p => p.file_id));
        this._applySelectionToDOM();
    }

    _deselectAll() {
        this._selectedIds = new Set();
        this._applySelectionToDOM();
    }

    _invertSelection() {
        const next = new Set();
        for (const photo of this._photos) {
            if (!this._selectedIds.has(photo.file_id)) next.add(photo.file_id);
        }
        this._selectedIds = next;
        this._applySelectionToDOM();
    }

    _applySelectionToDOM() {
        this._photos.forEach((photo, i) => {
            const isSelected = this._selectedIds.has(photo.file_id);
            const cell = this._gridEl.querySelector(`[data-index="${i}"]`);
            if (!cell) return;
            cell.classList.toggle('thumb-cell--selected', isSelected);
            const checkbox = cell.querySelector('.thumb-cell__checkbox');
            if (checkbox) {
                checkbox.title = isSelected ? 'Deselect' : 'Select for deletion';
                checkbox.innerHTML = isSelected ? '<span class="thumb-cell__check">✓</span>' : '';
            }
        });
        this._renderActionBar();
    }

    async _confirmDelete() {
        const count = this._selectedIds.size;
        if (count === 0) return;
        const confirmed = confirm(`Delete ${count} photo${count !== 1 ? 's' : ''}? This cannot be undone.`);
        if (!confirmed) return;
        try {
            const { deletePhotoFromOneDrive } = await import('./photoDeleteManager.js');
            const idsToDelete = [...this._selectedIds];
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
                this._photos = [...this._series.photos];
                for (const id of deletedSuccessfully) this._selectedIds.delete(id);
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
        const isSelected = this._series && this._selectedIds.has(photo.file_id);

        this._fsPhoto.innerHTML = `
            <button id="fs-close"
                style="position:absolute;top:12px;right:12px;background:rgba(0,0,0,0.5);border:none;color:white;font-size:20px;cursor:pointer;padding:4px 10px;border-radius:4px">✕</button>
            <button id="fs-prev" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);border:none;color:white;font-size:28px;cursor:pointer;padding:8px 14px;border-radius:4px"
                ${index === 0 ? 'disabled' : ''}>‹</button>
            <img src="/api/image/${photo.file_id}" style="max-width:100%;max-height:100%;object-fit:contain" />
            <button id="fs-next" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);border:none;color:white;font-size:28px;cursor:pointer;padding:8px 14px;border-radius:4px"
                ${index === this._photos.length - 1 ? 'disabled' : ''}>›</button>
            ${this._series ? `
            <div id="fs-checkbox" class="fs-checkbox ${isSelected ? 'fs-checkbox--selected' : ''}" title="${isSelected ? 'Deselect' : 'Select for deletion'}">
                ${isSelected ? '<span class="fs-checkbox__check">✓</span>' : ''}
            </div>
            ` : ''}
        `;

        this._fsSidebar.innerHTML = `
            <div style="margin-bottom:12px">
                <div style="color:#888;font-size:11px;margin-bottom:2px">Photo ${index + 1} of ${this._photos.length}</div>
                <div style="font-size:12px;word-break:break-all">${this._escapeHtml(photo.name)}</div>
            </div>
        `;

        if (this._series) {
            this._fsPhoto.querySelector('#fs-checkbox')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this._toggleSelect(photo.file_id);
                const nowSelected = this._selectedIds.has(photo.file_id);
                const cb = this._fsPhoto.querySelector('#fs-checkbox');
                if (cb) {
                    cb.className = 'fs-checkbox' + (nowSelected ? ' fs-checkbox--selected' : '');
                    cb.title = nowSelected ? 'Deselect' : 'Select for deletion';
                    cb.innerHTML = nowSelected ? '<span class="fs-checkbox__check">✓</span>' : '';
                }
            });
        }

        document.getElementById('fs-prev')?.addEventListener('click', () => this._renderFullscreen(index - 1));
        document.getElementById('fs-next')?.addEventListener('click', () => this._renderFullscreen(index + 1));
        this._fsPhoto.querySelector('#fs-close')?.addEventListener('click', () => this.closeFullscreen());

        this._fsIndex = index;
    }

    toggleCurrentFullscreenSelection() {
        if (this._fsIndex === null || !this._series) return;
        const photo = this._photos[this._fsIndex];
        this._toggleSelect(photo.file_id);
        const nowSelected = this._selectedIds.has(photo.file_id);
        const cb = this._fsPhoto.querySelector('#fs-checkbox');
        if (cb) {
            cb.className = 'fs-checkbox' + (nowSelected ? ' fs-checkbox--selected' : '');
            cb.title = nowSelected ? 'Deselect' : 'Select for deletion';
            cb.innerHTML = nowSelected ? '<span class="fs-checkbox__check">✓</span>' : '';
        }
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
        this._selectedIds = new Set();
        this._series = null;
        this._folderId = null;
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
