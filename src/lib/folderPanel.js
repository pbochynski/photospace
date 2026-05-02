import { getRootFolders, getFolderChildren } from './graph.js';
import { db } from './db.js';

const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export class FolderPanel {
    constructor(containerEl, { onFolderClick, onPromoteClick }) {
        this._container = containerEl;
        this._onFolderClick = onFolderClick;
        this._onPromoteClick = onPromoteClick;
        this._expandedFolders = new Set();
        this._folderStatus = new Map();
        this._selectedFolderId = null;
        this._childFolders = new Map();
        this._folderMeta = {};
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
            this._folderMeta = (await db.getSetting('folderMeta')) || {};
            folders.forEach(folder => {
                const meta = this._folderMeta[folder.id];
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

    async _expandFolder(folderId) {
        if (this._expandedFolders.has(folderId)) {
            this._expandedFolders.delete(folderId);
            this._rerender();
            return;
        }
        this._expandedFolders.add(folderId);
        if (!this._childFolders.has(folderId)) {
            const children = await getFolderChildren(folderId);
            children.forEach(child => {
                const meta = this._folderMeta[child.id];
                if (meta) {
                    const status = (Date.now() - meta.lastScannedAt > STALE_MS) ? 'stale' : 'scanned';
                    this._folderStatus.set(child.id, { status, photoCount: meta.photoCount });
                }
            });
            this._childFolders.set(folderId, children);
            if (children.length === 0) {
                this._expandedFolders.delete(folderId);
            }
        }
        this._rerender();
    }

    _rerender() {
        if (!this._rootFolders) return;
        this._container.innerHTML = '';
        this._renderFolders(this._rootFolders, this._container, 0);
    }

    _renderFolders(folders, parentEl, depth) {
        folders.forEach(folder => {
            // Assume has children until we've loaded and confirmed otherwise
            const loadedChildren = this._childFolders.get(folder.id);
            const hasChildren = loadedChildren === undefined || loadedChildren.length > 0;
            const isExpanded = this._expandedFolders.has(folder.id);

            const item = document.createElement('div');
            item.className = 'folder-item' + (this._selectedFolderId === folder.id ? ' folder-item--selected' : '');
            item.style.paddingLeft = `${12 + depth * 16}px`;

            const statusInfo = this._folderStatus.get(folder.id);
            const status = statusInfo?.status || 'not_scanned';
            const photoCount = statusInfo?.photoCount;

            const badgeText = this._statusBadgeText(status, photoCount);
            const badgeClass = status === 'scanning' ? 'folder-item__badge--scanning' :
                               status === 'stale' ? 'folder-item__badge--stale' : '';

            const chevron = hasChildren
                ? `<span class="folder-item__chevron" data-folder-id="${folder.id}">${isExpanded ? '▾' : '▸'}</span>`
                : `<span class="folder-item__chevron folder-item__chevron--leaf"></span>`;

            item.innerHTML = `
                ${chevron}
                <span>📁</span>
                <span class="folder-item__name">${folder.name}</span>
                ${badgeText ? `<span class="folder-item__badge ${badgeClass}">${badgeText}</span>` : ''}
                ${status === 'not_scanned' || status === 'stale' ? `<button class="folder-item__promote-btn" data-folder-id="${folder.id}" data-folder-name="${folder.name}">↑</button>` : ''}
            `;

            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('folder-item__promote-btn')) {
                    e.stopPropagation();
                    this._onPromoteClick(folder.id, folder.name, folder.parentReference?.driveId);
                } else if (e.target.classList.contains('folder-item__chevron') && hasChildren) {
                    e.stopPropagation();
                    this._expandFolder(folder.id);
                } else {
                    this._onFolderClick(folder.id, folder.name, folder.parentReference?.driveId);
                }
            });

            parentEl.appendChild(item);

            if (isExpanded && this._childFolders.has(folder.id)) {
                const children = this._childFolders.get(folder.id);
                if (children.length > 0) {
                    this._renderFolders(children, parentEl, depth + 1);
                }
            }
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
