import { getRootFolders } from './graph.js';
import { db } from './db.js';

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
