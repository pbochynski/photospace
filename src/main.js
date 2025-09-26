import { msalInstance, login, getAuthToken } from './lib/auth.js';
import { fetchAllPhotos, fetchFolders, getFolderInfo, getFolderPath, fetchPhotosFromSingleFolder, fetchFolderChildren } from './lib/graph.js';
import { db } from './lib/db.js';
import { findSimilarGroups, pickBestPhotoByQuality } from './lib/analysis.js';
import { exportEmbeddingsToOneDrive, getLastExportInfo, estimateExportSize } from './lib/embeddingExport.js';
import { importEmbeddingsFromOneDrive, listAvailableEmbeddingFiles, deleteEmbeddingFileFromOneDrive, getLastImportInfo, validateEmbeddingFile, getEmbeddingFileMetadata } from './lib/embeddingImport.js';

// --- Debug Console Setup ---
class DebugConsole {
    constructor() {
        this.isVisible = false;
        this.isMinimized = false;
        this.entries = [];
        this.maxEntries = 1000;
        this.setupDOM();
        this.overrideConsole();
    }

    setupDOM() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initializeDOM());
        } else {
            this.initializeDOM();
        }
    }

    initializeDOM() {
        this.debugConsole = document.getElementById('debug-console');
        this.debugContent = document.getElementById('debug-content');
        this.debugShowBtn = document.getElementById('debug-show-btn');
        this.debugToggle = document.getElementById('debug-toggle');
        this.debugClear = document.getElementById('debug-clear');
        this.debugClose = document.getElementById('debug-close');

        if (!this.debugShowBtn) return; // Elements not ready yet

        // Event listeners
        this.debugShowBtn.addEventListener('click', () => this.show());
        this.debugToggle.addEventListener('click', () => this.toggleMinimize());
        this.debugClear.addEventListener('click', () => this.clear());
        this.debugClose.addEventListener('click', () => this.hide());

        // Auto-show on mobile devices
        if (this.isMobile()) {
            this.show();
        }
    }

    isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    overrideConsole() {
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;
        const originalInfo = console.info;

        console.log = (...args) => {
            originalLog.apply(console, args);
            this.addEntry('log', args);
        };

        console.error = (...args) => {
            originalError.apply(console, args);
            this.addEntry('error', args);
        };

        console.warn = (...args) => {
            originalWarn.apply(console, args);
            this.addEntry('warn', args);
        };

        console.info = (...args) => {
            originalInfo.apply(console, args);
            this.addEntry('info', args);
        };

        // Catch unhandled errors
        window.addEventListener('error', (event) => {
            this.addEntry('error', [`Uncaught Error: ${event.error?.message || event.message}`, event.error?.stack || '']);
        });

        window.addEventListener('unhandledrejection', (event) => {
            this.addEntry('error', [`Unhandled Promise Rejection: ${event.reason}`]);
        });
    }

    addEntry(level, args) {
        const timestamp = new Date().toLocaleTimeString();
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        const entry = { timestamp, level, message };
        this.entries.push(entry);

        // Keep only recent entries
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(-this.maxEntries);
        }

        this.render();
    }

    render() {
        if (!this.debugContent) return;

        const html = this.entries.map(entry => 
            `<div class="debug-entry ${entry.level}">
                <span class="timestamp">[${entry.timestamp}]</span> ${entry.message}
            </div>`
        ).join('');

        this.debugContent.innerHTML = html;
        this.debugContent.scrollTop = this.debugContent.scrollHeight;
    }

    show() {
        if (!this.debugConsole) return;
        this.debugConsole.style.display = 'flex';
        this.debugShowBtn.style.display = 'none';
        this.isVisible = true;
    }

    hide() {
        if (!this.debugConsole) return;
        this.debugConsole.style.display = 'none';
        this.debugShowBtn.style.display = 'block';
        this.isVisible = false;
        this.isMinimized = false;
    }

    toggleMinimize() {
        if (!this.debugContent) return;
        this.isMinimized = !this.isMinimized;
        this.debugContent.style.display = this.isMinimized ? 'none' : 'block';
        this.debugToggle.textContent = this.isMinimized ? '□' : '_';
    }

    clear() {
        this.entries = [];
        this.render();
    }
}

// Initialize debug console
const debugConsole = new DebugConsole();

// Make debug console globally accessible for worker messages
window.debugConsole = debugConsole;

// --- DOM Elements ---
const loginButton = document.getElementById('login-button');
const userInfo = document.getElementById('user-info');
const mainContent = document.getElementById('main-content');
const statusText = document.getElementById('status-text');
const progressBar = document.getElementById('progress-bar');
const startScanButton = document.getElementById('start-scan-button');
const startEmbeddingButton = document.getElementById('start-embedding-button');
const embeddingMenuBtn = document.getElementById('embedding-menu-btn');
const embeddingMenu = document.getElementById('embedding-menu');
const embeddingCurrentBtn = document.getElementById('embedding-current-folder');
const embeddingAllBtn = document.getElementById('embedding-all-folders');
const embeddingAllIndexedBtn = document.getElementById('embedding-all-indexed');
const startAnalysisButton = document.getElementById('start-analysis-button');
const resultsContainer = document.getElementById('results-container');
const browserPhotoGrid = document.getElementById('browser-photo-grid');
const browserSortSelect = document.getElementById('browser-sort');
const browserRefreshBtn = document.getElementById('browser-refresh');
const browserUpBtn = document.getElementById('browser-up');
const browserAddScannedBtn = document.getElementById('browser-add-scanned');
const browserCurrentPath = document.getElementById('browser-current-path');
const analysisMenuBtn = document.getElementById('analysis-menu-btn');
const analysisMenu = document.getElementById('analysis-menu');
const analysisCurrentBtn = document.getElementById('analysis-current-folder');
const analysisAllBtn = document.getElementById('analysis-all-folders');

// Folder selector elements
const selectedFolderInput = null;
const browseFolderBtn = null;
const clearFolderBtn = null;

// Embedding options
const forceReprocessCheckbox = document.getElementById('force-reprocess-checkbox');

// Analysis options
const similarityThresholdSlider = document.getElementById('similarity-threshold');
const thresholdValueDisplay = document.getElementById('threshold-value');
const timeSpanSlider = document.getElementById('time-span');
const timeSpanValueDisplay = document.getElementById('time-span-value');
const minGroupSizeSlider = document.getElementById('min-group-size');
const minGroupSizeValueDisplay = document.getElementById('min-group-size-value');
const resultsSortSelect = document.getElementById('results-sort');
const workerCountSlider = document.getElementById('worker-count');
const workerCountValueDisplay = document.getElementById('worker-count-value');

// Date filter elements
const dateFromInput = document.getElementById('date-from');
const dateToInput = document.getElementById('date-to');
const dateEnabledToggle = document.getElementById('date-enabled-toggle');

// Embedding backup elements
const exportEmbeddingsBtn = document.getElementById('export-embeddings-btn');
const importEmbeddingsBtn = document.getElementById('import-embeddings-btn');
const exportInfo = document.getElementById('export-info');
const importInfo = document.getElementById('import-info');
const embeddingFilesList = document.getElementById('embedding-files-list');
const fileListContainer = document.getElementById('file-list-container');

// Import modal elements
const importModal = document.getElementById('import-modal');
const importModalClose = document.getElementById('import-modal-close');
const importLoading = document.getElementById('import-loading');
const importFileSelection = document.getElementById('import-file-selection');
const importFileList = document.getElementById('import-file-list');
const importOptions = document.querySelector('.import-options');
const conflictStrategySelect = document.getElementById('conflict-strategy');
const confirmImportBtn = document.getElementById('confirm-import-btn');
const cancelImportBtn = document.getElementById('cancel-import-btn');
const importProgress = document.getElementById('import-progress');
const importProgressBar = document.getElementById('import-progress-bar');
const importStatus = document.getElementById('import-status');
const importResults = document.getElementById('import-results');
const importSummary = document.getElementById('import-summary');
const closeImportBtn = document.getElementById('close-import-btn');

// Folder browser elements
const folderModal = document.getElementById('folder-modal');
const folderModalClose = document.getElementById('folder-modal-close');
const currentPathElement = document.getElementById('current-path');
const folderUpBtn = document.getElementById('folder-up-btn');
const folderRefreshBtn = document.getElementById('folder-refresh-btn');
const folderList = document.getElementById('folder-list');
const selectFolderBtn = document.getElementById('select-folder-btn');
const cancelFolderBtn = document.getElementById('cancel-folder-btn');

let embeddingWorker = null;
let selectedFolderId = null; // null means no folder filter (all folders)
let selectedFolderPath = null; // null means no folder filter
let selectedFolderDisplayName = 'All folders'; // Display for no filter
let currentBrowsingFolderId = 'root';
let folderHistory = []; // Stack for navigation

// --- URL Parameter Functions ---
function updateURLWithFilters() {
    const url = new URL(window.location);
    
    // Update folder path
    if (selectedFolderPath) {
        url.searchParams.set('path', selectedFolderPath);
    } else {
        url.searchParams.delete('path');
    }
    
    // Update date filter enable flag
    const dateEnabled = isDateFilterEnabled();
    if (dateEnabled) {
        url.searchParams.set('dateEnabled', 'true');
    } else {
        url.searchParams.set('dateEnabled', 'false');
    }
    
    // Update date range
    const dateFrom = dateFromInput.value;
    const dateTo = dateToInput.value;
    
    if (dateEnabled && dateFrom) {
        url.searchParams.set('dateFrom', dateFrom);
    } else {
        url.searchParams.delete('dateFrom');
    }
    
    if (dateEnabled && dateTo) {
        url.searchParams.set('dateTo', dateTo);
    } else {
        url.searchParams.delete('dateTo');
    }
    
    window.history.pushState({}, '', url);
}

function updateURLWithPath(folderPath) {
    // Keep existing behavior for backward compatibility
    selectedFolderPath = folderPath;
    updateURLWithFilters();
}

function getPathFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('path') || null; // null means no folder filter
}

function getDateFiltersFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    return {
        dateEnabled: urlParams.get('dateEnabled') !== 'false',
        dateFrom: urlParams.get('dateFrom') || null,
        dateTo: urlParams.get('dateTo') || null
    };
}

function setDefaultDateRange() {
    // Set default to last month
    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
    
    dateFromInput.value = lastMonth.toISOString().split('T')[0];
    dateToInput.value = today.toISOString().split('T')[0];
}

function restoreDateFiltersFromURL() {
    const dateFilters = getDateFiltersFromURL();
    
    // Restore toggle
    dateEnabledToggle.checked = dateFilters.dateEnabled !== false;
    
    if (dateFilters.dateFrom || dateFilters.dateTo) {
        // Restore from URL
        dateFromInput.value = dateFilters.dateFrom || '';
        dateToInput.value = dateFilters.dateTo || '';
    } else {
        // Set default to last month
        setDefaultDateRange();
    }
    applyDateEnabledUI();
}

async function restoreFolderFromURL() {
    const pathFromURL = getPathFromURL();
    if (pathFromURL) {
        try {
            // Try to find the folder by path
            const folderId = await findFolderIdByPath(pathFromURL);
            if (folderId) {
                selectedFolderId = folderId;
                selectedFolderPath = pathFromURL;
                selectedFolderDisplayName = pathToDisplayName(pathFromURL);
                // input removed
                updateStatus(`Restored folder filter: ${selectedFolderDisplayName}`, false);
            } else {
                console.warn('Could not find folder for path:', pathFromURL);
                // Reset to no filter if folder not found
                resetFolderToNoFilter();
            }
        } catch (error) {
            console.error('Error restoring folder from URL:', error);
            resetFolderToNoFilter();
        }
    } else {
        resetFolderToNoFilter();
    }
}

function resetFolderToNoFilter() {
    selectedFolderId = null;
    selectedFolderPath = null;
    selectedFolderDisplayName = 'All folders';
    // input removed
}

async function restoreFiltersFromURL() {
    // Restore folder filter
    await restoreFolderFromURL();
    
    // Restore date filters
    restoreDateFiltersFromURL();
    
    // Update URL to ensure consistency
    updateURLWithFilters();
}

function resetToNoFilter() {
    resetFolderToNoFilter();
    updateURLWithFilters();
}

function pathToDisplayName(path) {
    if (!path || path === '/drive/root:') {
        return 'OneDrive (Root)';
    }
    // Convert path like "/drive/root:/Pictures/Camera Roll" to "OneDrive / Pictures / Camera Roll"
    const pathParts = path.replace('/drive/root:', '').split('/').filter(part => part.length > 0);
    return 'OneDrive' + (pathParts.length > 0 ? ' / ' + pathParts.join(' / ') : ' (Root)');
}

async function findFolderIdByPath(targetPath) {
    // This is a simplified approach - in a real implementation you might want to cache folder mappings
    // For now, we'll try to navigate through the folder structure to find the ID
    if (!targetPath || targetPath === '/drive/root:') {
        return 'root';
    }
    
    try {
        // Extract path parts
        const pathParts = targetPath.replace('/drive/root:', '').split('/').filter(part => part.length > 0);
        let currentId = 'root';
        
        // Navigate through each path part
        for (const partName of pathParts) {
            const folders = await fetchFolders(currentId);
            const foundFolder = folders.find(folder => folder.name === partName);
            if (foundFolder) {
                currentId = foundFolder.id;
            } else {
                return null; // Path not found
            }
        }
        
        return currentId;
    } catch (error) {
        console.error('Error finding folder by path:', error);
        return null;
    }
}

// --- Filter Functions ---
function clearFolderFilter() {
    resetToNoFilter();
    updateStatus('Folder filter cleared - will analyze all folders', false);
}

// Parse user input folder path and convert to internal format
function parseUserFolderPath(userInput) {
    if (!userInput || userInput.trim() === '' || userInput === 'All folders') {
        return null; // No filter
    }
    
    // Remove leading/trailing slashes and spaces
    const cleanPath = userInput.trim().replace(/^\/+|\/+$/g, '');
    
    if (cleanPath === '') {
        return '/drive/root:'; // Root folder
    }
    
    // Convert user path like "Pictures/Vacation" to "/drive/root:/Pictures/Vacation"
    return '/drive/root:/' + cleanPath;
}

// Convert internal path to user-friendly display
function formatPathForUser(internalPath) {
    if (!internalPath || internalPath === '/drive/root:') {
        return ''; // Root or no filter shows as empty
    }
    
    // Convert "/drive/root:/Pictures/Vacation" to "Pictures/Vacation"
    return internalPath.replace('/drive/root:/', '');
}

// Handle folder input changes (when user types a path)
async function handleFolderInputChange() {
    const userInput = '';
    
    if (userInput === 'All folders' || userInput.trim() === '') {
        clearFolderFilter();
        return;
    }
    
    try {
        const internalPath = parseUserFolderPath(userInput);
        const folderId = await findFolderIdByPath(internalPath);
        
        if (folderId) {
            // Valid path found
            selectedFolderId = folderId;
            selectedFolderPath = internalPath;
            selectedFolderDisplayName = internalPath ? pathToDisplayName(internalPath) : 'OneDrive (Root)';
            updateURLWithFilters();
            updateStatus(`Folder filter set: ${selectedFolderDisplayName}`, false);
        } else {
            // Invalid path - reset input and show error
            updateStatus('Invalid folder path. Please check the path or use Browse button.', false);
            setTimeout(() => {
                // input removed
            }, 100);
        }
    } catch (error) {
        console.error('Error validating folder path:', error);
        updateStatus('Error validating folder path', false);
    }
}

function isDateFilterEnabled() {
    return dateEnabledToggle ? dateEnabledToggle.checked : true;
}

function applyDateEnabledUI() {
    const disabled = !isDateFilterEnabled();
    dateFromInput.disabled = disabled;
    dateToInput.disabled = disabled;
    const switchText = document.querySelector('.switch-text');
    if (switchText) {
        switchText.textContent = disabled ? 'Disabled' : 'Enabled';
    }
}

function getDateFilter() {
    if (!isDateFilterEnabled()) {
        return null;
    }
    const fromDate = dateFromInput.value;
    const toDate = dateToInput.value;
    
    if (!fromDate && !toDate) {
        return null; // No date filter
    }
    
    return {
        from: fromDate ? new Date(fromDate + 'T00:00:00').getTime() : null,
        to: toDate ? new Date(toDate + 'T23:59:59').getTime() : null
    };
}

function applyFilters(photos) {
    let filteredPhotos = [...photos];
    
    // Apply folder filter
    if (selectedFolderPath) {
        filteredPhotos = filteredPhotos.filter(photo => 
            photo.path && photo.path.startsWith(selectedFolderPath)
        );
    }
    
    // Apply date filter
    const dateFilter = getDateFilter();
    if (dateFilter) {
        filteredPhotos = filteredPhotos.filter(photo => {
            const photoDate = photo.photo_taken_ts || photo.last_modified;
            if (!photoDate) return false;
            
            const photoTime = new Date(photoDate).getTime();
            
            if (dateFilter.from && photoTime < dateFilter.from) return false;
            if (dateFilter.to && photoTime > dateFilter.to) return false;
            
            return true;
        });
    }
    
    return filteredPhotos;
}

// --- UI Update Functions ---
function updateStatus(text, showProgress = false, progressValue = 0, progressMax = 100) {
    statusText.textContent = text;
    if (showProgress) {
        progressBar.style.display = 'block';
        progressBar.value = progressValue;
        progressBar.max = progressMax;
    } else {
        progressBar.style.display = 'none';
    }
}

// Helper function to initialize service worker with auth token
async function initializeServiceWorkerToken() {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        try {
            const token = await getAuthToken();
            navigator.serviceWorker.controller.postMessage({
                type: 'SET_TOKEN',
                token: token
            });
            console.log('Service worker initialized with auth token');
        } catch (error) {
            console.error('Failed to initialize service worker with token:', error);
        }
    }
}

async function displayLoggedIn(account) {
    loginButton.style.display = 'none';
    userInfo.textContent = `Welcome, ${account.name}`;
    userInfo.style.display = 'block';
    mainContent.style.display = 'block';
    updateStatus('Ready. Click "Scan OneDrive Photos" to begin.');
    
    // Initialize service worker with auth token
    await initializeServiceWorkerToken();
}

function displayResults(groups) {
    resultsContainer.innerHTML = '<h2>Similar Photo Groups</h2>';
    if (groups.length === 0) {
        resultsContainer.innerHTML += '<p>No significant groups of similar photos found.</p>';
        return;
    }

    groups.forEach((group, groupIdx) => {
        // Remove empty groups
        if (!group.photos || group.photos.length === 0) return;

        const groupElement = document.createElement('div');
        groupElement.className = 'similarity-group';

        const groupDate = new Date(group.timestamp).toLocaleDateString();
        groupElement.innerHTML = `
            <div class="group-header">
                <h3>${group.photos.length} similar photos from ${groupDate}</h3>
                <p>Similarity Score: >${(group.similarity * 100).toFixed(0)}%</p>
                <button class="delete-selected-btn" data-group-idx="${groupIdx}">Delete Selected Photos</button>
            </div>
            <div class="photo-grid"></div>
        `;
        const photoGrid = groupElement.querySelector('.photo-grid');

        group.photos.forEach((p, idx) => {
            const photoItem = document.createElement('div');
            photoItem.className = 'photo-item';
            const recommendedBadge = p.isBest ? '<div class="recommended-badge">⭐ RECOMMENDED</div>' : '';
            
            // Use service worker thumbnail endpoint instead of direct OneDrive URL
            const thumbnailSrc = `/api/thumb/${p.file_id}`;
            
            photoItem.innerHTML = `
                <label class="photo-checkbox-label">
                    <input type="checkbox" class="photo-checkbox" data-group-idx="${groupIdx}" data-photo-idx="${idx}" ${idx === 0 ? '' : 'checked'}>
                    <span class="photo-checkbox-custom"></span>
                    <img src="${thumbnailSrc}" data-file-id="${p.file_id}" alt="${p.name}" loading="lazy">
                    ${recommendedBadge}
                    <div class="photo-score">
                        <div class="photo-path">${p.path ? p.path.replace('/drive/root:', '') || '/' : 'Unknown path'}</div>
                        ${p.quality_score ? `<div class="quality-info">Quality: ${(p.quality_score * 100).toFixed(0)}%</div>` : ''}
                    </div>
                </label>
            `;
            photoGrid.appendChild(photoItem);
        });

        resultsContainer.appendChild(groupElement);
    });

    // Add event listeners for delete buttons
    document.querySelectorAll('.delete-selected-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const groupIdx = parseInt(btn.getAttribute('data-group-idx'));
            const group = groups[groupIdx];
            const checkboxes = resultsContainer.querySelectorAll(`.photo-checkbox[data-group-idx="${groupIdx}"]`);
            const selectedPhotos = [];
            checkboxes.forEach((cb, idx) => {
                if (cb.checked) selectedPhotos.push(group.photos[idx]);
            });
            if (selectedPhotos.length === 0) {
                alert('No photos selected for deletion.');
                return;
            }
            if (!confirm(`Delete ${selectedPhotos.length} selected photo(s)? This cannot be undone.`)) return;
            // Call delete logic (OneDrive API)
            updateStatus('Deleting selected photos...', true);
            try {
                const token = await getAuthToken();
                for (const photo of selectedPhotos) {
                    console.log(`Deleting photo: ${photo.name} (${photo.file_id})`);
                    await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${photo.file_id}`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    console.log(`Successfully deleted photo: ${photo.name} (${photo.file_id})`);
                    // Optionally, remove from local DB
                    await db.deletePhotos([photo.file_id]);
                    console.log(`Deleted photo: ${photo.name} (${photo.file_id})`);
                }
                // Remove deleted photos from group
                group.photos = group.photos.filter((p, idx) => !checkboxes[idx].checked);
                // Remove empty groups
                const filteredGroups = groups.filter(g => g.photos && g.photos.length > 0);
                displayResults(filteredGroups);
                updateStatus('Selected photos deleted.', false);
            } catch (err) {
                updateStatus('Error deleting photos: ' + err.message, false);
            }
        });
    });

    // Add event listeners for image click to show modal
    document.querySelectorAll('.photo-item img').forEach(img => {
        img.addEventListener('click', async (e) => {
            e.stopPropagation(); // Prevent event bubbling
            e.preventDefault(); // Prevent default label/checkbox toggle
            const modal = document.getElementById('image-modal');
            const modalImg = document.getElementById('modal-img');
            
            // Get the file ID and photo data
            const fileId = img.getAttribute('data-file-id');
            const groupIdx = parseInt(img.closest('.photo-item').querySelector('.photo-checkbox').getAttribute('data-group-idx'));
            const photoIdx = parseInt(img.closest('.photo-item').querySelector('.photo-checkbox').getAttribute('data-photo-idx'));
            const photo = groups[groupIdx].photos[photoIdx];
            
            // Populate metadata overlay
            populateImageMetadata(photo);
            
            if (fileId) {
                // Send auth token to service worker for both thumbnail and full-size requests
                if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                    const token = await getAuthToken();
                    navigator.serviceWorker.controller.postMessage({
                        type: 'SET_TOKEN',
                        token: token
                    });
                }
                
                // Step 1: Show modal immediately with thumbnail (already loaded via service worker)
                modalImg.src = img.src; // Use existing thumbnail from service worker
                modal.style.display = 'flex';
                
                // Step 2: Load full-size image in background
                const blobUrl = await loadFullSizeImage(fileId, modalImg, img.src);
                
                // Step 3: Set up cleanup for blob URLs if needed
                if (blobUrl) {
                    const cleanup = () => {
                        // Note: We don't revoke immediately as it might be in our cache
                        // The cache will handle cleanup when it reaches capacity
                        modal.removeEventListener('hide', cleanup);
                    };
                    
                    modal.addEventListener('hide', cleanup);
                }
            } else {
                // Fallback to thumbnail if no file ID
                modalImg.src = img.src;
                modal.style.display = 'flex';
            }
        });
    });

    // Modal close logic (only add once)
    if (!window._modalEventsAdded) {
        window._modalEventsAdded = true;
        const modal = document.getElementById('image-modal');
        const modalImg = document.getElementById('modal-img');
        const closeBtn = document.getElementById('modal-close');
        const metadataToggle = document.getElementById('metadata-toggle');
        const metadataContent = document.getElementById('metadata-content');
        
        // Metadata toggle functionality
        metadataToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            metadataContent.classList.toggle('collapsed');
            metadataToggle.textContent = metadataContent.classList.contains('collapsed') ? '📊' : '📈';
        });
        
        const closeModal = () => {
            // Trigger custom 'hide' event for cleanup
            modal.dispatchEvent(new Event('hide'));
            modal.style.display = 'none';
            modalImg.src = '';
            // Reset metadata overlay
            metadataContent.classList.remove('collapsed');
            metadataToggle.textContent = '📊';
        };
        
        closeBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        });
    }
}

// Render photos for the currently selected folder in the browser panel
async function renderBrowserPhotoGrid(forceReload = false) {
    if (!browserPhotoGrid) return;
    browserPhotoGrid.innerHTML = '<div class="loading">Loading...</div>';

    try {
        // Decide folder path to preview
        const folderId = selectedFolderId || 'root';
        // Fetch folders and photos directly from OneDrive API
        const { folders, photos } = await fetchFolderChildren(folderId);

        // Sort
        const sort = (browserSortSelect && browserSortSelect.value) || 'date-desc';
        const sortedPhotos = [...photos].sort((a, b) => {
            const at = new Date(a.photo_taken_ts || a.last_modified || 0).getTime();
            const bt = new Date(b.photo_taken_ts || b.last_modified || 0).getTime();
            return sort === 'date-asc' ? at - bt : bt - at;
        });

        // Render folders first
        browserPhotoGrid.innerHTML = '';
        folders.forEach(folder => {
            const item = document.createElement('div');
            item.className = 'photo-item';
            item.innerHTML = `
                <div class="folder-thumb">
                    <div class="folder-icon">📁</div>
                    <div class="folder-name">${folder.name}</div>
                </div>
            `;
            item.addEventListener('click', async () => {
                // Navigate into subfolder
                selectedFolderId = folder.id;
                selectedFolderPath = await getFolderPath(folder.id);
                selectedFolderDisplayName = pathToDisplayName(selectedFolderPath);
                updateURLWithPath(selectedFolderPath);
                updateBrowserCurrentPath();
                await renderBrowserPhotoGrid(true);
            });
            browserPhotoGrid.appendChild(item);
        });

        // Render photos (all)
        sortedPhotos.forEach((p) => {
            const item = document.createElement('div');
            item.className = 'photo-item';
            const thumbnailSrc = `/api/thumb/${p.file_id}`;
            item.innerHTML = `
                <label class="photo-checkbox-label">
                    <span class="photo-checkbox-custom"></span>
                    <img src="${thumbnailSrc}" data-file-id="${p.file_id}" alt="${p.name || ''}" loading="lazy">
                    <div class="photo-score">
                        <div class="photo-path">${p.path ? (p.path.replace('/drive/root:', '') || '/') : ''}</div>
                    </div>
                </label>
            `;
            browserPhotoGrid.appendChild(item);
        });
    } catch (e) {
        console.error('Failed to render browser photo grid', e);
        browserPhotoGrid.innerHTML = '<div class="error-message">Failed to load photos.</div>';
    }
}

// Function to populate image metadata overlay
function populateImageMetadata(photo) {
    const photoName = document.getElementById('photo-name');
    const sharpnessValue = document.getElementById('sharpness-value');
    const exposureValue = document.getElementById('exposure-value');
    const qualityScoreValue = document.getElementById('quality-score-value');
    
    // Set photo name
    photoName.textContent = photo.name || 'Unknown Photo';
    
    // Display quality metrics
    if (photo.sharpness !== undefined) {
        sharpnessValue.textContent = `${Math.round(photo.sharpness)}`;
    } else {
        sharpnessValue.textContent = 'N/A';
    }
    
    if (photo.exposure !== undefined) {
        const exposurePercent = Math.round(photo.exposure * 100);
        exposureValue.textContent = `${exposurePercent}%`;
        
        // Color code exposure (green for good, yellow for ok, red for poor)
        if (exposurePercent >= 40 && exposurePercent <= 60) {
            exposureValue.style.color = '#4caf50'; // Good exposure
        } else if (exposurePercent >= 25 && exposurePercent <= 75) {
            exposureValue.style.color = '#ffeb3b'; // OK exposure
        } else {
            exposureValue.style.color = '#f44336'; // Poor exposure
        }
    } else {
        exposureValue.textContent = 'N/A';
        exposureValue.style.color = '#fff';
    }
    
    if (photo.quality_score !== undefined) {
        const qualityPercent = Math.round(photo.quality_score * 100);
        qualityScoreValue.textContent = `${qualityPercent}%`;
        
        // Color code quality score
        if (qualityPercent >= 70) {
            qualityScoreValue.style.color = '#4caf50'; // High quality
        } else if (qualityPercent >= 40) {
            qualityScoreValue.style.color = '#ffeb3b'; // Medium quality
        } else {
            qualityScoreValue.style.color = '#f44336'; // Low quality
        }
    } else {
        qualityScoreValue.textContent = 'N/A';
        qualityScoreValue.style.color = '#fff';
    }
    
    
}

// --- Folder Browser Functions ---

async function showFolderBrowser() {
    folderModal.style.display = 'flex';
    
    // Start from currently selected folder or root if none selected
    const startFolderId = selectedFolderId || 'root';
    currentBrowsingFolderId = startFolderId;
    
    // Build folder history to current location if not root
    folderHistory = [];
    if (selectedFolderId && selectedFolderId !== 'root' && selectedFolderPath) {
        try {
            // Parse the path to build history
            const pathParts = selectedFolderPath.replace('/drive/root:', '').split('/').filter(part => part.length > 0);
            let currentId = 'root';
            
            // Navigate through each path part to build history
            for (let i = 0; i < pathParts.length - 1; i++) {
                const partName = pathParts[i];
                const folders = await fetchFolders(currentId);
                const foundFolder = folders.find(folder => folder.name === partName);
                if (foundFolder) {
                    folderHistory.push({
                        id: currentId,
                        name: currentId === 'root' ? 'root' : partName,
                        path: `/drive/root:/${pathParts.slice(0, i).join('/')}`
                    });
                    currentId = foundFolder.id;
                } else {
                    // If path is invalid, fall back to root
                    folderHistory = [];
                    currentBrowsingFolderId = 'root';
                    break;
                }
            }
        } catch (error) {
            console.error('Error building folder history:', error);
            folderHistory = [];
            currentBrowsingFolderId = 'root';
        }
    }
    
    await loadFolders(currentBrowsingFolderId);
}

function hideFolderBrowser() {
    folderModal.style.display = 'none';
}

async function loadFolders(folderId) {
    folderList.innerHTML = '<div class="loading">Loading folders...</div>';
    
    try {
        // Get current folder info for breadcrumb
        const folderInfo = await getFolderInfo(folderId);
        updateBreadcrumb(folderInfo);
        
        // Fetch subfolders
        const folders = await fetchFolders(folderId);
        
        if (folders.length === 0) {
            folderList.innerHTML = '<div class="loading">No subfolders found</div>';
            return;
        }
        
        folderList.innerHTML = '';
        
        // Add option to select the current folder (including root)
        const currentFolderItem = document.createElement('div');
        currentFolderItem.className = 'folder-item current-folder';
        
        // Highlight if this is the currently selected folder
        if (selectedFolderId === folderId) {
            currentFolderItem.classList.add('selected');
        }
        
        currentFolderItem.innerHTML = `
            <span class="folder-icon">📂</span>
            <span class="folder-name">• Select this folder (${folderInfo.name === 'root' ? 'OneDrive Root' : folderInfo.name})</span>
        `;
        currentFolderItem.addEventListener('click', async () => {
            // Clear previous selection
            document.querySelectorAll('.folder-item').forEach(item => {
                item.classList.remove('selected');
            });
            
            // Select current folder
            currentFolderItem.classList.add('selected');
            selectedFolderId = folderId;
            
            // Get the full path for current folder
            try {
                selectedFolderPath = await getFolderPath(folderId);
                updateURLWithPath(selectedFolderPath);
            } catch (error) {
                console.error('Error getting folder path:', error);
                selectedFolderPath = '/drive/root:';
                updateURLWithPath(selectedFolderPath);
            }
            
            // Build display path for current folder
            const pathParts = folderHistory.map(h => h.name).filter(name => name !== 'root');
            if (folderInfo.name !== 'root') {
                pathParts.push(folderInfo.name);
            }
            selectedFolderDisplayName = 'OneDrive' + (pathParts.length > 0 ? ' / ' + pathParts.join(' / ') : ' (Root)');
        });
        folderList.appendChild(currentFolderItem);
        
        // Add separator if there are subfolders
        if (folders.length > 0) {
            const separator = document.createElement('div');
            separator.style.borderTop = '1px solid var(--border-color)';
            separator.style.margin = '0.5rem 0';
            folderList.appendChild(separator);
        }
        
        folders.forEach(folder => {
            const folderItem = document.createElement('div');
            folderItem.className = 'folder-item';
            folderItem.dataset.folderId = folder.id;
            folderItem.dataset.folderName = folder.name;
            
            // Highlight if this is the currently selected folder
            if (selectedFolderId === folder.id) {
                folderItem.classList.add('selected');
            }
            
            folderItem.innerHTML = `
                <span class="folder-icon">📁</span>
                <span class="folder-name">${folder.name}</span>
            `;
            
            folderItem.addEventListener('click', async () => {
                // Clear previous selection
                document.querySelectorAll('.folder-item').forEach(item => {
                    item.classList.remove('selected');
                });
                
                // Select this folder
                folderItem.classList.add('selected');
                selectedFolderId = folder.id;
                
                // Get the full path for this folder
                try {
                    selectedFolderPath = await getFolderPath(folder.id);
                    updateURLWithPath(selectedFolderPath);
                } catch (error) {
                    console.error('Error getting folder path:', error);
                    selectedFolderPath = '/drive/root:';
                    updateURLWithPath(selectedFolderPath);
                }
                
                // Build display path for the selected folder
                const pathParts = folderHistory.map(h => h.name).filter(name => name !== 'root');
                if (folderInfo.name !== 'root') {
                    pathParts.push(folderInfo.name);
                }
                pathParts.push(folder.name);
                selectedFolderDisplayName = 'OneDrive' + (pathParts.length > 0 ? ' / ' + pathParts.join(' / ') : '');
            });
            
            folderItem.addEventListener('dblclick', () => {
                // Navigate into folder
                folderHistory.push({
                    id: currentBrowsingFolderId,
                    name: folderInfo.name,
                    path: folderInfo.path
                });
                currentBrowsingFolderId = folder.id;
                loadFolders(folder.id);
                updateUpButton();
            });
            
            folderList.appendChild(folderItem);
        });
        
        updateUpButton();
        
    } catch (error) {
        console.error('Error loading folders:', error);
        folderList.innerHTML = '<div class="error-message">Error loading folders. Please try again.</div>';
    }
}

function updateBreadcrumb(folderInfo) {
    let pathText = 'OneDrive';
    if (folderInfo.id !== 'root') {
        // Build path from folder history and current folder
        const pathParts = folderHistory.map(h => h.name).filter(name => name !== 'root');
        pathParts.push(folderInfo.name);
        pathText = 'OneDrive' + (pathParts.length > 0 ? ' / ' + pathParts.join(' / ') : '');
    }
    currentPathElement.textContent = pathText;
}

function updateUpButton() {
    folderUpBtn.disabled = folderHistory.length === 0;
    // Also wire Browser Up to use the same navigation stack
    const browserUp = document.getElementById('folder-up-btn');
}

function navigateUp() {
    if (folderHistory.length > 0) {
        const parentFolder = folderHistory.pop();
        currentBrowsingFolderId = parentFolder.id;
        loadFolders(parentFolder.id);
        updateUpButton();
    }
}

function selectCurrentFolder() {
    // Update the input field and internal state
    // input removed
    updateStatus(`Selected folder: ${selectedFolderDisplayName}`, false);
    hideFolderBrowser();
}

async function runPhotoScan() {
    // Determine folders to scan: use scannedFolders list if present, else current selection
    const scannedList = (await db.getSetting('scannedFolders')) || [];
    const foldersToScan = scannedList.length > 0 ? scannedList : [selectedFolderPath || '/drive/root:'];
    
    startScanButton.disabled = true;
    startEmbeddingButton.disabled = true;

    try {
        // --- STEP 1: Generate a new scan ID ---
        const newScanId = Date.now();
        console.log(`Starting new scan with ID: ${newScanId} for ${foldersToScan.length} folder(s)`);
        updateStatus(`Scanning ${foldersToScan.length} folder(s) for photos...`, true, 0, 100);

        // --- STEP 2: Crawl OneDrive starting from selected folder ---
        // If multiple folders, scan each by id; resolve path -> id
        const scanOne = async (path) => {
            const id = await findFolderIdByPath(path);
            await fetchAllPhotos(newScanId, (progress) => {
                updateStatus(`Scanning... Found ${progress.count} photos so far.`, true, 0, 100);
            }, id || 'root');
        };
        for (const p of foldersToScan) {
            await scanOne(p);
        }
        
        // --- STEP 3: Clean up files that were not touched (i.e., deleted from OneDrive) ---
        updateStatus('Cleaning up deleted files...', true, 0, 100);
        // await db.deletePhotosNotMatchingScanId(newScanId);
        
        const totalPhotos = await db.getPhotoCount();
        updateStatus(`Scan complete. Total photos: ${totalPhotos}. Now generating embeddings for new files...`, true, 0, totalPhotos);
        
        // --- STEP 4: Generate embeddings for only the new files ---
        // generateEmbeddings() will automatically find files with embedding_status = 0
        // Generate embeddings for scanned folders only
        for (const p of foldersToScan) {
            await generateEmbeddings(p, false); // Never force reprocess during scan
        }

    } catch (error) {
        console.error('Scan failed:', error);
        updateStatus(`Error during scan: ${error.message}`, false);
    } finally {
        // Re-enable the buttons regardless of outcome
        startScanButton.disabled = false;
        startEmbeddingButton.disabled = false;
    }
}

// --- Core Logic ---

async function handleLoginClick() {
    try {
        const account = await login();
        if (account) {
            await displayLoggedIn(account);
            await db.init();
            // Initialize analysis settings UI after login
            await initializeAnalysisSettingsWithRetry();
        }
    } catch (error) {
        console.error(error);
        updateStatus('Login failed. Please try again.', false);
    }
}

async function handleScanClick() {
    // Directly run the scan with the currently selected folder
    runPhotoScan();
}

async function runEmbeddingGeneration() {
    startEmbeddingButton.disabled = true;

    try {
        const forceReprocess = forceReprocessCheckbox.checked;
        let photosToProcess;
        
        if (forceReprocess) {
            // Get all photos (regardless of embedding status)
            photosToProcess = await db.getAllPhotos();
            updateStatus('Force reprocessing enabled - will regenerate embeddings for all photos.', false);
        } else {
            // Get only photos that need embeddings (existing behavior)
            photosToProcess = await db.getPhotosWithoutEmbedding();
        }
        
        if (photosToProcess.length === 0) {
            const message = forceReprocess 
                ? 'No photos found to process.' 
                : 'All photos already have embeddings.';
            updateStatus(message, false);
            startEmbeddingButton.disabled = false;
            return;
        }
        
        // Apply filters to determine which photos actually need processing
        const filteredPhotos = applyFilters(photosToProcess);
        
        if (filteredPhotos.length === 0) {
            updateStatus('No photos match the current filters for embedding generation.', false);
            startEmbeddingButton.disabled = false;
            return;
        }
        
        // Show filter summary
        const dateFilter = getDateFilter();
        let filterSummary = `${forceReprocess ? 'Regenerating' : 'Generating'} embeddings for ${filteredPhotos.length} photos`;
        if (selectedFolderPath || dateFilter) {
            filterSummary += ' (filtered';
            if (selectedFolderPath) filterSummary += ` by folder: ${selectedFolderDisplayName}`;
            if (dateFilter) {
                const fromStr = dateFilter.from ? new Date(dateFilter.from).toLocaleDateString() : 'start';
                const toStr = dateFilter.to ? new Date(dateFilter.to).toLocaleDateString() : 'end';
                filterSummary += ` by date: ${fromStr} to ${toStr}`;
            }
            filterSummary += ')';
        }
        if (forceReprocess) {
            filterSummary += ' [FORCE REPROCESS]';
        }
        updateStatus(filterSummary, false);
        
        await generateEmbeddingsForPhotos(filteredPhotos);
        
        // Refresh backup panel to enable export button if embeddings were generated
        await initializeBackupPanel();
    } catch (error) {
        console.error('Embedding generation failed:', error);
        updateStatus(`Error during embedding generation: ${error.message}`, false);
    } finally {
        startEmbeddingButton.disabled = false;
    }
}

async function runEmbeddingGenerationForScope(scope) {
    startEmbeddingButton.disabled = true;
    try {
        const forceReprocess = forceReprocessCheckbox.checked;
        if (scope === 'all') {
            const list = (await db.getSetting('scannedFolders')) || [];
            const targets = list.length > 0 ? list : ['/drive/root:'];
            for (const p of targets) {
                await generateEmbeddings(p, forceReprocess);
            }
            updateStatus(`Embedding generation complete for ${targets.length} folder(s).`, false);
        } else if (scope === 'indexed') {
            // Generate embeddings for all indexed photos regardless of folder
            await generateEmbeddingsForAllIndexedPhotos(forceReprocess);
            updateStatus('Embedding generation complete for all indexed files.', false);
        } else {
            const path = selectedFolderPath || '/drive/root:';
            await generateEmbeddings(path, forceReprocess);
            updateStatus('Embedding generation complete for current folder.', false);
        }
        await initializeBackupPanel();
    } catch (error) {
        console.error('Embedding generation failed:', error);
        updateStatus(`Error during embedding generation: ${error.message}`, false);
    } finally {
        startEmbeddingButton.disabled = false;
    }
}

// Load full-size image using service worker for persistent caching
async function loadFullSizeImage(fileId, modalImg, thumbnailSrc) {
    try {
        const token = await getAuthToken();
        
        // Check if service worker is available and active
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            // Send token to service worker
            navigator.serviceWorker.controller.postMessage({
                type: 'SET_TOKEN',
                token: token
            });
            
            // Use our stable, cacheable URL that the service worker will handle
            const stableImageUrl = `/api/image/${fileId}`;
            
            try {
                console.log('Attempting service worker fetch for:', fileId);
                const response = await fetch(stableImageUrl);
                console.log('Service worker response status:', response.status);
                
                if (response.ok) {
                    const blob = await response.blob();
                    const blobUrl = URL.createObjectURL(blob);
                    modalImg.src = blobUrl;
                    console.log('Successfully loaded image via service worker');
                    return blobUrl; // Return for cleanup
                } else {
                    console.warn('Service worker returned error status:', response.status, response.statusText);
                    throw new Error(`Service worker error: ${response.status}`);
                }
            } catch (swError) {
                console.warn('Service worker fetch failed, falling back to direct fetch:', swError);
            }
        } else {
            console.log('Service worker not available, using direct fetch');
        }
        
        // Fallback: Direct fetch if service worker not available or failed
        console.log('Attempting direct fetch for:', fileId);
        const fullSizeUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`;
        const response = await fetch(fullSizeUrl, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log('Direct fetch response status:', response.status);
        
        if (response.ok) {
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            modalImg.src = blobUrl;
            console.log('Successfully loaded image via direct fetch');
            return blobUrl; // Return for cleanup
        } else {
            console.error('Direct fetch failed with status:', response.status, response.statusText);
            const errorText = await response.text();
            console.error('Error response:', errorText);
            throw new Error(`Direct fetch failed: ${response.status} ${response.statusText}`);
        }
    } catch (error) {
        console.error('Error loading full-size image:', error);
        console.log('Keeping thumbnail as fallback');
        return null;
    }
}

// Core worker management function - processes any array of photos
async function processPhotosWithWorkers(photosToProcess, statusPrefix = 'Preparing to process') {
    // Get configurable number of parallel workers from settings
    const NUM_EMBEDDING_WORKERS = await getWorkerCount();
    
    return new Promise(async (resolve, reject) => {
        const totalToProcess = photosToProcess.length;
        if (totalToProcess === 0) {
            updateStatus('No photos to process.', false);
            resolve();
            return;
        }
        updateStatus(`${statusPrefix} ${totalToProcess} photos...`);
        
        // Send auth token to service worker before starting processing
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            try {
                const token = await getAuthToken();
                
                // Create a promise to wait for confirmation
                const tokenPromise = new Promise((resolve, reject) => {
                    const channel = new MessageChannel();
                    channel.port1.onmessage = (event) => {
                        if (event.data.status === 'token_set') {
                            console.log('Service worker confirmed token receipt');
                            resolve();
                        } else {
                            reject(new Error('Unexpected response from service worker'));
                        }
                    };
                    
                    navigator.serviceWorker.controller.postMessage({
                        type: 'SET_TOKEN',
                        token: token
                    }, [channel.port2]);
                });
                
                // Wait for confirmation with timeout
                await Promise.race([
                    tokenPromise,
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Service worker token timeout')), 5000)
                    )
                ]);
                
                console.log('Auth token successfully sent to service worker for thumbnail processing');
            } catch (error) {
                console.error('Failed to send auth token to service worker:', error);
                // Continue anyway - might still work if token was previously set
            }
        }
        
        updateStatus(`Starting processing of ${totalToProcess} photos...`, true, 0, totalToProcess);
        
        // Worker pool
        const workers = [];
        let processedCount = 0;
        let modelReadyCount = 0;
        let errorOccurred = false;
        // Queue for photos
        const photoQueue = [...photosToProcess];
        // Track which workers are busy
        const workerBusy = Array(NUM_EMBEDDING_WORKERS).fill(false);
        // Store promises for worker ready
        const workerReady = Array(NUM_EMBEDDING_WORKERS).fill(false);
        // Helper to assign next photo to a worker
        async function assignNext(workerIdx) {
            if (photoQueue.length === 0) return;
            const photo = photoQueue.shift();
            if (photo) {
                workers[workerIdx].postMessage({
                    file_id: photo.file_id
                });
                workerBusy[workerIdx] = true;
            } else {
                processedCount++;
                if (processedCount === totalToProcess) {
                    workers.forEach(w => w.terminate());
                    updateStatus('Processing finished with some errors.', false);
                    resolve();
                } else {
                    assignNext(workerIdx);
                }
            }
        }
        // Worker message handler
        function makeOnMessage(workerIdx) {
            return async (event) => {
                // Handle console messages from worker
                if (event.data.type === 'console') {
                    debugConsole.addEntry(event.data.level, event.data.args);
                    return;
                }
                
                const { file_id, embedding, qualityMetrics, status, error } = event.data;
                
                if (status === 'model_loading') {
                    updateStatus('Loading AI Model... (This may take a moment)');
                } else if (status === 'model_ready') {
                    modelReadyCount++;
                    if (modelReadyCount === NUM_EMBEDDING_WORKERS) {
                        updateStatus('Model loaded. Starting photo analysis...', true, processedCount, totalToProcess);
                    }
                    // Start first task for this worker
                    assignNext(workerIdx);
                } else if (status === 'complete') {
                    processedCount++;
                    await db.updatePhotoEmbedding(file_id, embedding, qualityMetrics);
                    
                    // Calculate remaining photos in queue
                    const remainingInQueue = photoQueue.length;
                    const totalProcessed = processedCount;
                    const currentlyProcessing = NUM_EMBEDDING_WORKERS - (photoQueue.length > 0 ? 0 : (NUM_EMBEDDING_WORKERS - Math.max(0, totalToProcess - processedCount)));
                    
                    updateStatus(`Processing photos... ${totalProcessed}/${totalToProcess} complete, ${remainingInQueue} in queue`, true, processedCount, totalToProcess);
                    
                    if (processedCount === totalToProcess) {
                        workers.forEach(w => w.terminate());
                        updateStatus('All photos processed! Ready for analysis.', false);
                        resolve();
                    } else {
                        assignNext(workerIdx);
                    }
                } else if (status === 'error') {
                    console.error(`Worker error for file ${file_id}:`, error);
                    processedCount++;
                    
                    // Calculate remaining photos in queue
                    const remainingInQueue = photoQueue.length;
                    const totalProcessed = processedCount;
                    
                    updateStatus(`Processing photos... ${totalProcessed}/${totalToProcess} complete, ${remainingInQueue} in queue (some errors)`, true, processedCount, totalToProcess);
                    
                    if (processedCount === totalToProcess) {
                        workers.forEach(w => w.terminate());
                        updateStatus('Processing finished with some errors.', false);
                        resolve();
                    } else {
                        assignNext(workerIdx);
                    }
                }
            };
        }
        // Create workers
        for (let i = 0; i < NUM_EMBEDDING_WORKERS; i++) {
            const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
            worker.onmessage = makeOnMessage(i);
            worker.onerror = (err) => {
                console.error(`Worker ${i} error:`, err);
                if (!errorOccurred) {
                    errorOccurred = true;
                    workers.forEach(w => w.terminate());
                    updateStatus(`A critical worker error occurred: ${err.message}`, false);
                    reject(err);
                }
            };
            workers.push(worker);
            
            // Send worker ID to the worker for console prefixing
            worker.postMessage({ type: 'setWorkerId', workerId: i });
        }
        // Start all workers (they will load the model and then call assignNext)
        for (let i = 0; i < NUM_EMBEDDING_WORKERS; i++) {
            workers[i].postMessage({ type: 'init' });
        }
    });
}

// High-level function for processing photos that are already selected/filtered
async function generateEmbeddingsForPhotos(photosToProcess) {
    return await processPhotosWithWorkers(photosToProcess, 'Preparing to process');
}

// High-level function for processing photos from a specific folder
async function generateEmbeddings(folderPath = '/drive/root:', forceReprocess = false) {
    let photosToProcess;
    
    if (forceReprocess) {
        photosToProcess = await db.getAllPhotosFromFolder(folderPath);
    } else {
        photosToProcess = await db.getPhotosWithoutEmbeddingFromFolder(folderPath);
    }
    
    if (photosToProcess.length === 0) {
        const message = forceReprocess 
            ? 'No photos found in selected folder.' 
            : 'All photos in selected folder are already processed.';
        updateStatus(message, false);
        return;
    }
    
    const actionWord = forceReprocess ? 'reprocess' : 'process';
    const statusPrefix = `Preparing to ${actionWord}`;
    
    return await processPhotosWithWorkers(photosToProcess, statusPrefix);
}

// High-level function for processing all indexed photos regardless of folder
async function generateEmbeddingsForAllIndexedPhotos(forceReprocess = false) {
    let photosToProcess;
    
    if (forceReprocess) {
        photosToProcess = await db.getAllPhotos();
    } else {
        // Get all photos that don't have embeddings yet
        const allPhotos = await db.getAllPhotos();
        photosToProcess = allPhotos.filter(photo => !photo.embedding);
    }
    
    if (photosToProcess.length === 0) {
        const message = forceReprocess 
            ? 'No indexed photos found in database.' 
            : 'All indexed photos already have embeddings.';
        updateStatus(message, false);
        return;
    }
    
    const actionWord = forceReprocess ? 'reprocess' : 'process';
    const statusPrefix = `Preparing to ${actionWord}`;
    
    return await processPhotosWithWorkers(photosToProcess, statusPrefix);
}

async function runAnalysis() {
    return await runAnalysisForScope('current');
}

async function runAnalysisForScope(scope) {
    startAnalysisButton.disabled = true;
    updateStatus('Analyzing photos... this may take a few minutes.', true, 0, 100);
    
    // Ensure service worker has auth token (backup in case it wasn't set during login)
    await initializeServiceWorkerToken();
    
    try {
        let allPhotos;
        let scopeDescription;
        
        if (scope === 'all') {
            // Get ALL photos with embeddings from IndexedDB, regardless of scanned folders
            allPhotos = await db.getAllPhotosWithEmbedding();
            scopeDescription = 'all indexed photos';
        } else {
            // Get photos from current folder only
            const currentPath = selectedFolderPath || '/drive/root:';
            allPhotos = await db.getAllPhotosWithEmbeddingFromFolder(currentPath);
            scopeDescription = 'current folder only';
        }
        
        if(allPhotos.length === 0) {
            updateStatus(`No photos with embeddings found in ${scopeDescription}.`, false);
            startAnalysisButton.disabled = false;
            return;
        }

        // Apply filters (date range only, folder filter handled by scope)
        const dateFilter = getDateFilter();
        let filteredPhotos = allPhotos;
        
        if (dateFilter) {
            filteredPhotos = filteredPhotos.filter(photo => {
                const photoDate = photo.photo_taken_ts || photo.last_modified;
                if (!photoDate) return false;
                
                const photoTime = new Date(photoDate).getTime();
                
                if (dateFilter.from && photoTime < dateFilter.from) return false;
                if (dateFilter.to && photoTime > dateFilter.to) return false;
                
                return true;
            });
        }
        
        if(filteredPhotos.length === 0) {
            updateStatus(`No photos match the current filters in ${scopeDescription}.`, false);
            startAnalysisButton.disabled = false;
            return;
        }

        // Show filter summary
        const minGroupSize = await getMinGroupSize();
        let filterSummary = `Analyzing ${filteredPhotos.length} photos from ${scopeDescription}`;
        if (dateFilter) {
            const fromStr = dateFilter.from ? new Date(dateFilter.from).toLocaleDateString() : 'start';
            const toStr = dateFilter.to ? new Date(dateFilter.to).toLocaleDateString() : 'end';
            filterSummary += ` (filtered by date: ${fromStr} to ${toStr})`;
        }
        filterSummary += ` • Min group size: ${minGroupSize} photos`;
        
        updateStatus(filterSummary, true, 25, 100);

        setTimeout(async () => {
            // Get the current analysis settings
            const similarityThreshold = await getSimilarityThreshold();
            const timeSpanHours = await getTimeSpanHours();
            const sortMethod = await getSortMethod();
            const minGroupSize = await getMinGroupSize();
            
            let similarGroups = await findSimilarGroups(filteredPhotos, (progress) => {
                updateStatus(`Finding groups... ${progress.toFixed(0)}% complete.`, true, 25 + (progress * 0.5), 100);
            }, similarityThreshold, timeSpanHours, sortMethod);
            
            // Filter groups by minimum size
            const totalGroupsFound = similarGroups.length;
            similarGroups = similarGroups.filter(group => group.photos.length >= minGroupSize);
            const filteredOutCount = totalGroupsFound - similarGroups.length;

            updateStatus(`Picking best photos...`, true, 75, 100);

            // --- UPDATED: Use stored quality metrics to pick best photos ---
            let processedGroups = 0;
            for (const group of similarGroups) {
                // Find the best photo using stored quality metrics
                const bestPhoto = await pickBestPhotoByQuality(group.photos);
                
                // Mark the best photo and sort by quality score
                group.photos.forEach(photo => {
                    photo.isBest = photo.file_id === bestPhoto.file_id;
                });
                
                group.photos.sort((a, b) => {
                    // First, prioritize the best photo
                    if (a.isBest && !b.isBest) return -1;
                    if (!a.isBest && b.isBest) return 1;
                    // Then sort by quality score (using stored quality_score)
                    return (b.quality_score || 0) - (a.quality_score || 0);
                });
                
                processedGroups++;
                updateStatus(`Picking best photos... ${Math.round((processedGroups / similarGroups.length) * 100)}% complete.`, true, 75 + ((processedGroups / similarGroups.length) * 25), 100);
            }

            // Display results immediately
            displayResults(similarGroups);
            
            // Show final status with filtering info
            let finalStatus = 'Analysis complete!';
            if (filteredOutCount > 0) {
                finalStatus += ` (${filteredOutCount} groups filtered out due to min group size)`;
            }
            updateStatus(finalStatus, false);
            startAnalysisButton.disabled = false;

            // Queue thumbnail refresh for result folders in background
            if (similarGroups.length > 0) {
                // refreshResultFolderThumbnails(similarGroups);
            }
        }, 100);

    } catch (error) {
        console.error('Analysis failed:', error);
        updateStatus(`Error during analysis: ${error.message}`, false);
        startAnalysisButton.disabled = false;
    }
}

// --- Analysis Settings Functions ---
async function initializeAnalysisSettingsWithRetry(maxRetries = 10, delay = 100) {
    for (let i = 0; i < maxRetries; i++) {
        const success = await initializeAnalysisSettings();
        if (success) {
            return;
        }
        console.log(`Retrying initializeAnalysisSettings (attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    console.error('Failed to initialize analysis settings after maximum retries');
}

async function initializeAnalysisSettings() {
    try {
        // Get DOM elements fresh each time to ensure they're available
        const similarityThresholdSlider = document.getElementById('similarity-threshold');
        const thresholdValueDisplay = document.getElementById('threshold-value');
        const timeSpanSlider = document.getElementById('time-span');
        const timeSpanValueDisplay = document.getElementById('time-span-value');
        const minGroupSizeSlider = document.getElementById('min-group-size');
        const minGroupSizeValueDisplay = document.getElementById('min-group-size-value');
        const resultsSortSelect = document.getElementById('results-sort');
        const workerCountSlider = document.getElementById('worker-count');
        const workerCountValueDisplay = document.getElementById('worker-count-value');
        
        // Check if DOM elements are available
        if (!similarityThresholdSlider || !thresholdValueDisplay || !timeSpanSlider || !timeSpanValueDisplay || !minGroupSizeSlider || !minGroupSizeValueDisplay || !workerCountSlider || !workerCountValueDisplay) {
            console.warn('Some DOM elements not found, skipping analysis settings initialization');
            return false;
        }
        
        // Initialize date toggle and restore last range from DB if URL absent
        try {
            const dateEnabledSetting = await db.getSetting('dateEnabled');
            if (dateEnabledSetting !== null) {
                dateEnabledToggle.checked = Boolean(dateEnabledSetting);
            }
            const dateFilters = getDateFiltersFromURL();
            if (!dateFilters.dateFrom && !dateFilters.dateTo) {
                const savedFrom = await db.getSetting('dateFrom');
                const savedTo = await db.getSetting('dateTo');
                if (savedFrom) dateFromInput.value = savedFrom;
                if (savedTo) dateToInput.value = savedTo;
                if (!savedFrom && !savedTo) {
                    setDefaultDateRange();
                }
            }
            applyDateEnabledUI();
        } catch (e) {
            // Non-fatal
        }

        // Initialize similarity threshold
        const savedThreshold = await db.getSetting('similarityThreshold');
        const threshold = savedThreshold !== null ? Number(savedThreshold) : 0.90; // Default to 0.90
        
        // Ensure threshold is a valid number
        const validThreshold = (!isNaN(threshold) && threshold >= 0.5 && threshold <= 0.99) ? threshold : 0.90;
        
        similarityThresholdSlider.value = validThreshold;
        thresholdValueDisplay.textContent = validThreshold.toFixed(2);
        
        // Save default if no setting exists
        if (savedThreshold === null) {
            await db.setSetting('similarityThreshold', validThreshold);
        }
        
        // Initialize time span
        const savedTimeSpan = await db.getSetting('timeSpanHours');
        const timeSpan = savedTimeSpan !== null ? Number(savedTimeSpan) : 8; // Default to 8 hours
        
        // Ensure timeSpan is a valid number
        const validTimeSpan = (!isNaN(timeSpan) && timeSpan >= 1 && timeSpan <= 24) ? timeSpan : 8;
        
        timeSpanSlider.value = validTimeSpan;
        timeSpanValueDisplay.textContent = `${validTimeSpan} hours`;
        
        // Save default if no setting exists
        if (savedTimeSpan === null) {
            await db.setSetting('timeSpanHours', validTimeSpan);
        }
        
        // Initialize min group size
        const savedMinGroupSize = await db.getSetting('minGroupSize');
        const minGroupSize = savedMinGroupSize !== null ? Number(savedMinGroupSize) : 3; // Default to 3 photos
        
        // Ensure minGroupSize is a valid number
        const validMinGroupSize = (!isNaN(minGroupSize) && minGroupSize >= 2 && minGroupSize <= 20) ? minGroupSize : 3;
        
        minGroupSizeSlider.value = validMinGroupSize;
        minGroupSizeValueDisplay.textContent = `${validMinGroupSize} photos`;
        
        // Save default if no setting exists
        if (savedMinGroupSize === null) {
            await db.setSetting('minGroupSize', validMinGroupSize);
        }
        
        // Initialize sort method (moved to Results header)
        const savedResultsSort = await db.getSetting('resultsSort');
        const resultsSort = savedResultsSort !== null ? savedResultsSort : 'group-size'; // Default to group size
        
        if (resultsSortSelect) {
            resultsSortSelect.value = resultsSort;
        }
        
        // Save default if no setting exists
        if (savedResultsSort === null) {
            await db.setSetting('resultsSort', resultsSort);
        }
        
        // Initialize worker count
        const savedWorkerCount = await db.getSetting('workerCount');
        const workerCount = savedWorkerCount !== null ? Number(savedWorkerCount) : 4; // Default to 4 workers
        
        // Ensure workerCount is a valid number
        const validWorkerCount = (!isNaN(workerCount) && workerCount >= 1 && workerCount <= 8) ? workerCount : 4;
        
        // Set both the slider value and display text
        workerCountSlider.value = validWorkerCount;
        workerCountValueDisplay.textContent = `${validWorkerCount} worker${validWorkerCount === 1 ? '' : 's'}`;
        
        // Don't trigger the input event during initialization to avoid overriding
        
        // Save default if no setting exists
        if (savedWorkerCount === null) {
            await db.setSetting('workerCount', validWorkerCount);
        }
        
        console.log(`Worker count initialized to: ${validWorkerCount}`);
        return true;
    } catch (error) {
        console.error('Error initializing analysis settings:', error);
        // Set default values if database fails - get elements again in case they weren't available before
        const similarityThresholdSlider = document.getElementById('similarity-threshold');
        const thresholdValueDisplay = document.getElementById('threshold-value');
        const timeSpanSlider = document.getElementById('time-span');
        const timeSpanValueDisplay = document.getElementById('time-span-value');
        const minGroupSizeSlider = document.getElementById('min-group-size');
        const minGroupSizeValueDisplay = document.getElementById('min-group-size-value');
        const resultsSortSelect = document.getElementById('results-sort');
        const workerCountSlider = document.getElementById('worker-count');
        const workerCountValueDisplay = document.getElementById('worker-count-value');
        
        if (similarityThresholdSlider) similarityThresholdSlider.value = 0.90;
        if (thresholdValueDisplay) thresholdValueDisplay.textContent = '0.90';
        if (timeSpanSlider) timeSpanSlider.value = 8;
        if (timeSpanValueDisplay) timeSpanValueDisplay.textContent = '8 hours';
        if (minGroupSizeSlider) minGroupSizeSlider.value = 3;
        if (minGroupSizeValueDisplay) minGroupSizeValueDisplay.textContent = '3 photos';
        if (resultsSortSelect) resultsSortSelect.value = 'group-size';
        if (workerCountSlider) workerCountSlider.value = 4;
        if (workerCountValueDisplay) workerCountValueDisplay.textContent = '4 workers';
        
        // Also save the default value to database
        try {
            await db.setSetting('workerCount', 4);
        } catch (dbError) {
            console.error('Error saving default worker count:', dbError);
        }
        return false;
    }
}

async function getSimilarityThreshold() {
    try {
        const threshold = await db.getSetting('similarityThreshold');
        return threshold !== null ? threshold : 0.90;
    } catch (error) {
        console.error('Error getting similarity threshold:', error);
        return 0.90;
    }
}

async function getTimeSpanHours() {
    try {
        const timeSpan = await db.getSetting('timeSpanHours');
        return timeSpan !== null ? timeSpan : 8;
    } catch (error) {
        console.error('Error getting time span:', error);
        return 8;
    }
}

async function getSortMethod() {
    try {
        const sortMethod = await db.getSetting('resultsSort');
        return sortMethod !== null ? sortMethod : 'group-size';
    } catch (error) {
        console.error('Error getting sort method:', error);
        return 'group-size';
    }
}

async function getWorkerCount() {
    try {
        const workerCount = await db.getSetting('workerCount');
        return (workerCount != null) ? workerCount : 4; // != null checks for both null and undefined
    } catch (error) {
        console.error('Error getting worker count:', error);
        return 4;
    }
}

async function getMinGroupSize() {
    try {
        const minGroupSize = await db.getSetting('minGroupSize');
        return minGroupSize !== null ? minGroupSize : 3;
    } catch (error) {
        console.error('Error getting min group size:', error);
        return 3;
    }
}

// --- Main Application Startup ---
// NEW: We wrap the startup logic in an async function to use await.
async function main() {
    // STEP 0: Register service worker for image caching
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker registered:', registration);
        } catch (error) {
            console.error('Service Worker registration failed:', error);
        }
    }

    // STEP 1: Initialize MSAL
    await msalInstance.initialize();

    // STEP 2: Handle the redirect promise. This should be done after initialization.
    try {
        const response = await msalInstance.handleRedirectPromise();
        if (response && response.account) {
            msalInstance.setActiveAccount(response.account);
        }
    } catch (error) {
        console.error("Error handling redirect promise:", error);
    }
    
    // STEP 3: Check for an active account
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length > 0) {
        msalInstance.setActiveAccount(accounts[0]);
        await displayLoggedIn(accounts[0]);
        await db.init();
        
        // Initialize analysis settings UI
        await initializeAnalysisSettingsWithRetry();
        
        // Restore folder selection from URL if present
        await restoreFiltersFromURL();
    }

    // STEP 4: Add event listeners now that MSAL is ready
    loginButton.addEventListener('click', handleLoginClick);
    // input removed
    startScanButton.addEventListener('click', handleScanClick);
    // Split button: default main action runs for current folder
    startEmbeddingButton.addEventListener('click', async () => {
        await runEmbeddingGenerationForScope('current');
    });
    if (embeddingMenuBtn) {
        embeddingMenuBtn.addEventListener('click', () => {
            const open = embeddingMenu.classList.toggle('open');
            embeddingMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            embeddingMenu.setAttribute('aria-hidden', open ? 'false' : 'true');
        });
        document.addEventListener('click', (e) => {
            if (!embeddingMenu.contains(e.target) && e.target !== embeddingMenuBtn) {
                embeddingMenu.classList.remove('open');
                embeddingMenuBtn.setAttribute('aria-expanded', 'false');
                embeddingMenu.setAttribute('aria-hidden', 'true');
            }
        });
    }
    if (embeddingCurrentBtn) {
        embeddingCurrentBtn.addEventListener('click', async () => {
            embeddingMenu.classList.remove('open');
            await runEmbeddingGenerationForScope('current');
        });
    }
    if (embeddingAllBtn) {
        embeddingAllBtn.addEventListener('click', async () => {
            embeddingMenu.classList.remove('open');
            await runEmbeddingGenerationForScope('all');
        });
    }
    if (embeddingAllIndexedBtn) {
        embeddingAllIndexedBtn.addEventListener('click', async () => {
            embeddingMenu.classList.remove('open');
            await runEmbeddingGenerationForScope('indexed');
        });
    }
    // Analysis split button: default main action runs for current folder
    startAnalysisButton.addEventListener('click', async () => {
        await runAnalysisForScope('current');
    });
    if (analysisMenuBtn) {
        analysisMenuBtn.addEventListener('click', () => {
            const open = analysisMenu.classList.toggle('open');
            analysisMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            analysisMenu.setAttribute('aria-hidden', open ? 'false' : 'true');
        });
        document.addEventListener('click', (e) => {
            if (!analysisMenu.contains(e.target) && e.target !== analysisMenuBtn) {
                analysisMenu.classList.remove('open');
                analysisMenuBtn.setAttribute('aria-expanded', 'false');
                analysisMenu.setAttribute('aria-hidden', 'true');
            }
        });
    }
    if (analysisCurrentBtn) {
        analysisCurrentBtn.addEventListener('click', async () => {
            analysisMenu.classList.remove('open');
            await runAnalysisForScope('current');
        });
    }
    if (analysisAllBtn) {
        analysisAllBtn.addEventListener('click', async () => {
            analysisMenu.classList.remove('open');
            await runAnalysisForScope('all');
        });
    }
    
    // Filter control event listeners
    // input removed
    dateFromInput.addEventListener('change', async () => {
        await db.setSetting('dateFrom', dateFromInput.value || '');
        updateURLWithFilters();
    });
    dateToInput.addEventListener('change', async () => {
        await db.setSetting('dateTo', dateToInput.value || '');
        updateURLWithFilters();
    });
    dateEnabledToggle.addEventListener('change', async () => {
        await db.setSetting('dateEnabled', isDateFilterEnabled());
        applyDateEnabledUI();
        updateURLWithFilters();
    });
    
    // Similarity threshold control event listeners
    similarityThresholdSlider.addEventListener('input', async (e) => {
        const value = parseFloat(e.target.value);
        thresholdValueDisplay.textContent = value.toFixed(2);
        await db.setSetting('similarityThreshold', value);
    });
    
    // Time span control event listeners
    timeSpanSlider.addEventListener('input', async (e) => {
        const value = parseInt(e.target.value);
        timeSpanValueDisplay.textContent = `${value} hours`;
        await db.setSetting('timeSpanHours', value);
    });
    
    // Min group size control event listeners
    minGroupSizeSlider.addEventListener('input', async (e) => {
        const value = parseInt(e.target.value);
        minGroupSizeValueDisplay.textContent = `${value} photos`;
        await db.setSetting('minGroupSize', value);
    });
    
    // Sort method control event listeners (moved to Results header)
    if (resultsSortSelect) {
        const savedResultsSort = await db.getSetting('resultsSort');
        if (savedResultsSort) resultsSortSelect.value = savedResultsSort;
        resultsSortSelect.addEventListener('change', async (e) => {
            const value = e.target.value;
            await db.setSetting('resultsSort', value);
            // Re-run analysis if results are currently displayed
            if (resultsContainer.children.length > 1) {
                await runAnalysis();
            }
        });
    }
    
    // Worker count control event listeners
    workerCountSlider.addEventListener('input', async (e) => {
        const value = parseInt(e.target.value);
        workerCountValueDisplay.textContent = `${value} worker${value === 1 ? '' : 's'}`;
        try {
            await db.setSetting('workerCount', value);
            updateStatus(`Parallel workers set to: ${value}`, false);
        } catch (error) {
            console.error('Error saving worker count:', error);
        }
    });
    
    // Folder input event listeners
    // input removed
    
    // Folder selector event listeners
    // input removed
    
    // Folder browser event listeners
    folderModalClose.addEventListener('click', hideFolderBrowser);
    cancelFolderBtn.addEventListener('click', hideFolderBrowser);
    selectFolderBtn.addEventListener('click', selectCurrentFolder);
    folderUpBtn.addEventListener('click', navigateUp);
    folderRefreshBtn.addEventListener('click', () => loadFolders(currentBrowsingFolderId));

    // Browser toolbar events
    if (browserSortSelect) {
        const savedBrowserSort = await db.getSetting('browserSort');
        if (savedBrowserSort) browserSortSelect.value = savedBrowserSort;
        browserSortSelect.addEventListener('change', async (e) => {
            await db.setSetting('browserSort', e.target.value);
            await renderBrowserPhotoGrid();
        });
    }
    if (browserRefreshBtn) {
        browserRefreshBtn.addEventListener('click', async () => {
            await renderBrowserPhotoGrid(true);
        });
    }
    if (browserUpBtn) {
        browserUpBtn.addEventListener('click', async () => {
            // Use API to get parent
            try {
                if (!selectedFolderId || selectedFolderId === 'root') return;
                const info = await getFolderInfo(selectedFolderId);
                if (info.parentId) {
                selectedFolderId = info.parentId;
                selectedFolderPath = await getFolderPath(selectedFolderId);
            } else {
                selectedFolderId = 'root';
                selectedFolderPath = '/drive/root:';
            }
            selectedFolderDisplayName = pathToDisplayName(selectedFolderPath);
            updateURLWithPath(selectedFolderPath);
            updateBrowserCurrentPath();
            await renderBrowserPhotoGrid(true);
            } catch (e) {
                console.error('Failed to navigate up', e);
            }
        });
    }
    if (browserAddScannedBtn) {
        browserAddScannedBtn.addEventListener('click', async () => {
            try {
                const path = selectedFolderPath || '/drive/root:';
                const list = (await db.getSetting('scannedFolders')) || [];
                if (!list.includes(path)) {
                    list.push(path);
                    await db.setSetting('scannedFolders', list);
                    await renderScannedFoldersList();
                    updateStatus('Added to scanned folders', false);
                } else {
                    updateStatus('Folder already in scanned list', false);
                }
            } catch (e) {
                console.error('Failed to add scanned folder', e);
            }
        });
    }
    
    // Close folder modal on outside click
    folderModal.addEventListener('click', (e) => {
        if (e.target === folderModal) {
            hideFolderBrowser();
        }
    });
    
    // Close folder modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && folderModal.style.display === 'flex') {
            hideFolderBrowser();
        }
    });
    
    // Backup functionality event listeners
    exportEmbeddingsBtn.addEventListener('click', handleExportEmbeddings);
    importEmbeddingsBtn.addEventListener('click', handleImportEmbeddings);
    
    // Import modal event listeners
    importModalClose.addEventListener('click', closeImportModal);
    cancelImportBtn.addEventListener('click', closeImportModal);
    confirmImportBtn.addEventListener('click', performImport);
    closeImportBtn.addEventListener('click', closeImportModal);
    
    // Close import modal on outside click
    importModal.addEventListener('click', (e) => {
        if (e.target === importModal) {
            closeImportModal();
        }
    });
    
    // Close import modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && importModal.style.display === 'flex') {
            closeImportModal();
        }
    });
    
    // Initialize collapsible panels state and handlers
    initializeCollapsiblePanels();

    // Initialize backup panel
    await initializeBackupPanel();
    // Initial browser photo grid load (if logged in and a folder is selected)
    try { 
        updateBrowserCurrentPath();
        await renderBrowserPhotoGrid(); 
    } catch {}
    // Render scanned folders list
    try { await renderScannedFoldersList(); } catch {}
}

// Backup functionality
async function handleExportEmbeddings() {
    try {
        exportEmbeddingsBtn.disabled = true;
        updateStatus('Preparing embeddings for export...', true);
        
        const result = await exportEmbeddingsToOneDrive();
        
        updateStatus(`Successfully exported ${result.embeddingCount} embeddings (${result.fileSizeMB} MB) to OneDrive`, false);
        
        // Update export info
        exportInfo.textContent = `Last export: ${result.embeddingCount} embeddings (${result.fileSizeMB} MB)`;
        
    } catch (error) {
        console.error('Export failed:', error);
        
        // Check if it's because there are no embeddings
        if (error.message.includes('No embeddings found to export')) {
            updateStatus('No embeddings to export yet. Generate embeddings first, then try exporting again.', false);
        } else {
            updateStatus(`Export failed: ${error.message}`, false);
        }
    } finally {
        exportEmbeddingsBtn.disabled = false;
    }
}

async function handleImportEmbeddings() {
    try {
        importModal.style.display = 'flex';
        showImportSection('loading');
        
        const files = await listAvailableEmbeddingFiles();
        
        if (files.length === 0) {
            showImportSection('file-selection');
            importFileList.innerHTML = '<p>No embedding files found on OneDrive.</p>';
            return;
        }
        
        displayImportFileList(files);
        showImportSection('file-selection');
        
    } catch (error) {
        console.error('Failed to load import files:', error);
        alert(`Failed to load import files: ${error.message}`);
        closeImportModal();
    }
}

function displayImportFileList(files) {
    importFileList.innerHTML = '';
    
    files.forEach(file => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.dataset.fileId = file.id;
        
        const formatDate = (dateStr) => new Date(dateStr).toLocaleString();
        const formatSize = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        
        fileItem.innerHTML = `
            <div class="file-info">
                <div class="file-name">${file.name}</div>
                <div class="file-meta">
                    Click to load details • ${formatSize(file.size)} • ${formatDate(file.createdDateTime)}
                    ${file.hasValidFormat ? '' : ' • ⚠️ Unknown format'}
                </div>
            </div>
            <div class="file-actions">
                <button type="button" onclick="deleteImportFile('${file.id}', this)">Delete</button>
            </div>
        `;
        
        fileItem.addEventListener('click', async (e) => {
            if (e.target.tagName === 'BUTTON') return;
            
            // Clear previous selection
            document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected'));
            
            // Select this item
            fileItem.classList.add('selected');
            
            // Show loading state
            const metaDiv = fileItem.querySelector('.file-meta');
            const originalMeta = metaDiv.innerHTML;
            metaDiv.innerHTML = 'Loading file details...';
            confirmImportBtn.disabled = true;
            
            try {
                // Load metadata on demand
                const metadata = await getEmbeddingFileMetadata(file.id);
                
                if (metadata.valid) {
                    // Update display with actual metadata
                    metaDiv.innerHTML = `
                        ${metadata.embeddingCount} embeddings • ${formatSize(file.size)} • ${formatDate(file.createdDateTime)}
                        ${metadata.hasValidFormat ? '' : ' • ⚠️ Unknown format'}
                        ${metadata.exportDate ? ` • Exported: ${formatDate(metadata.exportDate)}` : ''}
                    `;
                    
                    // Show import options
                    importOptions.style.display = 'block';
                    confirmImportBtn.disabled = false;
                    confirmImportBtn.dataset.fileId = file.id;
                } else {
                    metaDiv.innerHTML = `${originalMeta} • ❌ Invalid file format`;
                    importOptions.style.display = 'none';
                    confirmImportBtn.disabled = true;
                }
            } catch (error) {
                console.error('Error loading file metadata:', error);
                metaDiv.innerHTML = `${originalMeta} • ❌ Error loading details`;
                importOptions.style.display = 'none';
                confirmImportBtn.disabled = true;
            }
        });
        
        importFileList.appendChild(fileItem);
    });
}

async function deleteImportFile(fileId, buttonElement) {
    if (!confirm('Are you sure you want to delete this embedding file?')) {
        return;
    }
    
    try {
        buttonElement.disabled = true;
        buttonElement.textContent = 'Deleting...';
        
        await deleteEmbeddingFileFromOneDrive(fileId);
        
        // Remove from UI
        buttonElement.closest('.file-item').remove();
        
        // Hide options if this was the selected file
        if (confirmImportBtn.dataset.fileId === fileId) {
            importOptions.style.display = 'none';
            confirmImportBtn.disabled = true;
        }
        
    } catch (error) {
        console.error('Delete failed:', error);
        alert(`Failed to delete file: ${error.message}`);
        buttonElement.disabled = false;
        buttonElement.textContent = 'Delete';
    }
}

async function performImport() {
    const fileId = confirmImportBtn.dataset.fileId;
    const conflictStrategy = conflictStrategySelect.value;
    
    if (!fileId) {
        alert('No file selected');
        return;
    }
    
    try {
        showImportSection('progress');
        importStatus.textContent = 'Downloading and processing embeddings...';
        
        const result = await importEmbeddingsFromOneDrive(fileId, conflictStrategy);
        
        // Show results
        importSummary.innerHTML = `
            <div class="summary-item">
                <span class="label">Source Export Date:</span>
                <span class="value">${new Date(result.sourceMetadata.exportDate).toLocaleString()}</span>
            </div>
            <div class="summary-item">
                <span class="label">Total in File:</span>
                <span class="value">${result.sourceMetadata.embeddingCount}</span>
            </div>
            <div class="summary-item">
                <span class="label">Newly Imported:</span>
                <span class="value">${result.imported}</span>
            </div>
            <div class="summary-item">
                <span class="label">Updated Existing:</span>
                <span class="value">${result.updated}</span>
            </div>
            <div class="summary-item">
                <span class="label">Skipped:</span>
                <span class="value">${result.skipped}</span>
            </div>
        `;
        
        showImportSection('results');
        
        // Update import info in main panel
        importInfo.textContent = `Last import: ${result.imported + result.updated} embeddings imported/updated`;
        
    } catch (error) {
        console.error('Import failed:', error);
        alert(`Import failed: ${error.message}`);
        showImportSection('file-selection');
    }
}

function showImportSection(section) {
    // Hide all sections
    importLoading.style.display = 'none';
    importFileSelection.style.display = 'none';
    importProgress.style.display = 'none';
    importResults.style.display = 'none';
    
    // Show selected section
    document.getElementById(`import-${section}`).style.display = 'block';
}

function closeImportModal() {
    importModal.style.display = 'none';
    
    // Reset modal state
    importOptions.style.display = 'none';
    confirmImportBtn.disabled = true;
    confirmImportBtn.removeAttribute('data-file-id');
    
    // Clear selections
    document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected'));
}

async function initializeBackupPanel() {
    try {
        // Always enable the export button - user might have embeddings from previous sessions
        exportEmbeddingsBtn.disabled = false;
        
        // Check if we have embeddings to show accurate info
        const sizeEstimate = await estimateExportSize();
        
        if (sizeEstimate.embeddingCount > 0) {
            exportInfo.textContent = `Ready to export: ${sizeEstimate.embeddingCount} embeddings (~${sizeEstimate.estimatedSizeMB} MB)`;
        } else {
            exportInfo.textContent = 'Export will include any existing embeddings (may be empty if no embeddings generated yet)';
        }
        
        // Show last export info if available
        const lastExport = await getLastExportInfo();
        if (lastExport) {
            const date = new Date(lastExport.date).toLocaleString();
            exportInfo.textContent += ` • Last export: ${date}`;
        }
        
        // Show last import info if available
        const lastImport = await getLastImportInfo();
        if (lastImport) {
            const date = new Date(lastImport.date).toLocaleString();
            importInfo.textContent = `Last import: ${lastImport.imported + lastImport.updated} embeddings • ${date}`;
        }
        
    } catch (error) {
        console.error('Error initializing backup panel:', error);
        // Even on error, keep export button enabled
        exportEmbeddingsBtn.disabled = false;
        exportInfo.textContent = 'Export available (click to check for embeddings)';
    }
}

// Make deleteImportFile available globally for onclick handlers
window.deleteImportFile = deleteImportFile;

// Collapsible Panels: init and persistence
function initializeCollapsiblePanels() {
    const panels = document.querySelectorAll('.panel[data-panel-key]');
    panels.forEach(async (panel) => {
        const key = panel.getAttribute('data-panel-key');
        const toggleBtn = panel.querySelector('.panel-toggle');
        if (!toggleBtn) return;

        // Restore state from DB
        try {
            const stored = await db.getSetting(`ui.panel.${key}.expanded`);
            const isExpanded = stored === null ? true : Boolean(stored);
            applyPanelExpandedState(panel, toggleBtn, isExpanded);
        } catch (e) {
            applyPanelExpandedState(panel, toggleBtn, true);
        }

        // Listener
        toggleBtn.addEventListener('click', async () => {
            const currentlyExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
            const next = !currentlyExpanded;
            applyPanelExpandedState(panel, toggleBtn, next);
            try {
                await db.setSetting(`ui.panel.${key}.expanded`, next);
            } catch (e) {
                console.warn('Failed to persist panel state', key, e);
            }
        });
    });
}

function applyPanelExpandedState(panel, toggleBtn, expanded) {
    if (expanded) {
        panel.classList.remove('collapsed');
        toggleBtn.setAttribute('aria-expanded', 'true');
        toggleBtn.textContent = '▾';
    } else {
        panel.classList.add('collapsed');
        toggleBtn.setAttribute('aria-expanded', 'false');
        toggleBtn.textContent = '▸';
    }
}

// Update browser current path display
function updateBrowserCurrentPath() {
    if (browserCurrentPath) {
        const displayPath = selectedFolderDisplayName || 'OneDrive (Root)';
        browserCurrentPath.textContent = displayPath;
    }
}

// Render scanned folders list in Processing panel
async function renderScannedFoldersList() {
    const container = document.getElementById('scanned-folders-list');
    if (!container) return;
    const list = (await db.getSetting('scannedFolders')) || [];
    container.innerHTML = '';
    if (list.length === 0) {
        container.innerHTML = '<div class="empty-note">No folders added yet. Use the OneDrive Browser to add.</div>';
        return;
    }
    list.forEach((p, idx) => {
        const item = document.createElement('div');
        item.className = 'scanned-folder-item';
        const display = p.replace('/drive/root:', '') || '/';
        item.innerHTML = `
            <div class="scanned-folder-path">${display}</div>
            <div class="scanned-folder-actions">
                <button type="button" data-idx="${idx}" class="secondary-btn remove-btn">Remove</button>
            </div>
        `;
        item.querySelector('.remove-btn').addEventListener('click', async () => {
            const current = (await db.getSetting('scannedFolders')) || [];
            current.splice(idx, 1);
            await db.setSetting('scannedFolders', current);
            await renderScannedFoldersList();
        });
        container.appendChild(item);
    });
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    // DOM is already ready
    main();
}