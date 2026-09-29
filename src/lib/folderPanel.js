import { getRootFolders, getFolderChildren } from './graph.js';
import { db } from './db.js';

const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export class FolderPanel {
    constructor(containerEl, { onFolderClick, onPromoteClick, onRecursiveScanClick }) {
        this._container = containerEl;
        this._onFolderClick = onFolderClick;
        this._onPromoteClick = onPromoteClick;
        this._onRecursiveScanClick = onRecursiveScanClick;
        this._expandedFolders = new Set();
        this._folderStatus = new Map();
        this._selectedFolderId = null;
        this._childFolders = new Map();
        this._parentOf = new Map(); // childId → parentId (null for root)
        this._folderMeta = {};
        this._contextMenu = document.getElementById('folder-context-menu');
        this._ctxScanFolder = document.getElementById('ctx-scan-folder');
        this._ctxScanRecursive = document.getElementById('ctx-scan-recursive');
        this._bindContextMenuDismiss();
    }

    _hideContextMenu() {
        this._contextMenu.hidden = true;
    }

    _bindContextMenuDismiss() {
        document.addEventListener('click', () => this._hideContextMenu());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this._hideContextMenu();
        });
    }

    setFolderStatus(folderId, status, photoCount) {
        this._folderStatus.set(folderId, { status, photoCount });
        this._rerender();
    }

    setSelected(folderId) {
        this._selectedFolderId = folderId;
        this._rerender();
    }

    findFolderById(folderId) {
        for (const f of (this._rootFolders || [])) {
            if (f.id === folderId) return { id: f.id, name: f.name, driveId: f.parentReference?.driveId };
        }
        for (const children of this._childFolders.values()) {
            for (const f of children) {
                if (f.id === folderId) return { id: f.id, name: f.name, driveId: f.parentReference?.driveId };
            }
        }
        return null;
    }

    async loadRoot() {
        try {
            const folders = await getRootFolders();
            this._rootFolders = folders;
            this._folderMeta = (await db.getSetting('folderMeta')) || {};
            folders.forEach(folder => {
                this._parentOf.set(folder.id, null);
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

    // Expand the tree to reveal folderId, loading parent levels as needed.
    // Returns true if the folder was found, false if it doesn't exist in OneDrive.
    async expandToFolder(folderId) {
        // Already known — just expand ancestors
        if (this._parentOf.has(folderId)) {
            await this._expandAncestors(folderId);
            return true;
        }
        // Unknown — fetch via parentReference.id stored in folderNames setting
        const folderNames = await db.getSetting('folderNames');
        const saved = folderNames?.[folderId];
        if (!saved?.parentId) return false;

        // Walk up: load each ancestor level until we reach an already-known parent
        const chain = [folderId];
        let cur = saved.parentId;
        while (cur && !this._parentOf.has(cur)) {
            const parentSaved = folderNames?.[cur];
            if (!parentSaved?.parentId) break;
            chain.push(cur);
            cur = parentSaved.parentId;
        }
        chain.push(cur); // the known anchor

        // Expand from the anchor down the chain
        for (let i = chain.length - 2; i >= 0; i--) {
            const parentId = chain[i + 1];
            if (!this._childFolders.has(parentId)) {
                await this._loadChildren(parentId);
            }
            this._expandedFolders.add(parentId);
        }
        this._rerender();
        return this._parentOf.has(folderId);
    }

    async _expandAncestors(folderId) {
        const ancestors = [];
        let cur = this._parentOf.get(folderId);
        while (cur !== undefined && cur !== null) {
            ancestors.unshift(cur);
            cur = this._parentOf.get(cur);
        }
        for (const ancestorId of ancestors) {
            if (!this._childFolders.has(ancestorId)) {
                await this._loadChildren(ancestorId);
            }
            this._expandedFolders.add(ancestorId);
        }
        this._rerender();
    }

    async _loadChildren(folderId) {
        const children = await getFolderChildren(folderId);
        children.forEach(child => {
            this._parentOf.set(child.id, folderId);
            const meta = this._folderMeta[child.id];
            if (meta) {
                const status = (Date.now() - meta.lastScannedAt > STALE_MS) ? 'stale' : 'scanned';
                this._folderStatus.set(child.id, { status, photoCount: meta.photoCount });
            }
        });
        this._childFolders.set(folderId, children);
        return children;
    }

    async _expandFolder(folderId) {
        if (this._expandedFolders.has(folderId)) {
            this._expandedFolders.delete(folderId);
            this._rerender();
            return;
        }
        this._expandedFolders.add(folderId);
        if (!this._childFolders.has(folderId)) {
            const children = await this._loadChildren(folderId);
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
                ? `<span class="folder-item__chevron">${isExpanded ? '▾' : '▸'}</span>`
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
                } else {
                    this._onFolderClick(folder.id, folder.name, folder.parentReference?.driveId);
                    this._expandFolder(folder.id).catch(err => console.error('Failed to expand folder:', err));
                }
            });

            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const fId = folder.id;
                const fName = folder.name;
                const dId = folder.parentReference?.driveId;
                this._ctxScanFolder.onclick = () => {
                    this._onPromoteClick(fId, fName, dId);
                    this._hideContextMenu();
                };
                this._ctxScanRecursive.onclick = () => {
                    this._onRecursiveScanClick(fId, fName, dId);
                    this._hideContextMenu();
                };
                this._contextMenu.style.left = `${e.clientX}px`;
                this._contextMenu.style.top = `${e.clientY}px`;
                this._contextMenu.hidden = false;
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
