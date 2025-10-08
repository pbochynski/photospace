import { msalInstance, login, getAuthToken } from './lib/auth.js';
import { fetchAllPhotos, fetchFolders, getFolderInfo, getFolderPath, fetchFolderChildren } from './lib/graph.js';
import { db } from './lib/db.js';
import { findSimilarGroups, pickBestPhotoByQuality, findPhotoSeries } from './lib/analysis.js';
import { exportEmbeddingsToOneDrive, getLastExportInfo, estimateExportSize } from './lib/embeddingExport.js';
import { importEmbeddingsFromOneDrive, listAvailableEmbeddingFiles, deleteEmbeddingFileFromOneDrive, getLastImportInfo, getEmbeddingFileMetadata } from './lib/embeddingImport.js';

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
const autoStartEmbeddingsCheckbox = document.getElementById('auto-start-embeddings-checkbox');
const pauseResumeEmbeddingsBtn = document.getElementById('pause-resume-embeddings');
const clearDatabaseButton = document.getElementById('clear-database-button');
const startAnalysisButton = document.getElementById('start-analysis-button');
const resultsContainer = document.getElementById('results-container');

// Series analysis elements
const startSeriesAnalysisButton = document.getElementById('start-series-analysis-button');
const seriesMinGroupSizeSlider = document.getElementById('series-min-group-size');
const seriesMinGroupSizeValueDisplay = document.getElementById('series-min-group-size-value');
const seriesMinDensitySlider = document.getElementById('series-min-density');
const seriesMinDensityValueDisplay = document.getElementById('series-min-density-value');
const seriesTimeGapSlider = document.getElementById('series-time-gap');
const seriesTimeGapValueDisplay = document.getElementById('series-time-gap-value');

// Unified results elements
const resultsTypeLabel = document.getElementById('results-type-label');
const browserPhotoGrid = document.getElementById('browser-photo-grid');
const browserSortSelect = document.getElementById('browser-sort');
const browserRefreshBtn = document.getElementById('browser-refresh');
const browserUpBtn = document.getElementById('browser-up');
const browserScanBtn = document.getElementById('browser-scan');
const browserAnalyzeBtn = document.getElementById('browser-analyze');
const browserCurrentPath = document.getElementById('browser-current-path');

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

// Modal action buttons
const modalFindSimilarBtn = document.getElementById('modal-find-similar-btn');
const modalViewInFolderBtn = document.getElementById('modal-view-in-folder-btn');

let embeddingWorker = null;
let selectedFolderId = null; // null means no folder filter (all folders)
let selectedFolderPath = null; // null means no folder filter
let selectedFolderDisplayName = 'All folders'; // Display for no filter
let currentModalPhoto = null; // Track the photo currently displayed in modal
let currentResultsType = null; // Track current results type ('similarity', 'series', or 'similar-to')
let currentReferencePhoto = null; // Track reference photo for similar-to searches
let currentAnalysisResults = null; // Store current analysis results for re-sorting

// Embedding queue management
let embeddingWorkers = []; // Persistent workers
let embeddingQueue = [];
let isEmbeddingPaused = false;
let isProcessingEmbeddings = false;
let currentEmbeddingPromise = null;
let isAutoIndexing = false; // Flag to prevent overlapping auto-indexing operations
let workersInitialized = false; // Track if workers are ready

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

/**
 * Sort analysis results based on the selected sort method
 * @param {string} sortMethod - The sort method to apply
 */
function sortAnalysisResults(sortMethod) {
    if (!currentAnalysisResults || currentAnalysisResults.length === 0) {
        return;
    }
    
    const sortedResults = [...currentAnalysisResults];
    
    // Handle flat lists (similar-to) vs grouped results
    if (currentResultsType === 'similar-to') {
        // Sort flat photo list
        sortedResults.sort((a, b) => {
            switch (sortMethod) {
                case 'group-size': // For similar-to, sort by similarity
                    return b.similarity - a.similarity;
                case 'date-desc':
                    const aTime = a.photo_taken_ts || new Date(a.last_modified).getTime();
                    const bTime = b.photo_taken_ts || new Date(b.last_modified).getTime();
                    return bTime - aTime;
                case 'date-asc':
                    const aTimeAsc = a.photo_taken_ts || new Date(a.last_modified).getTime();
                    const bTimeAsc = b.photo_taken_ts || new Date(b.last_modified).getTime();
                    return aTimeAsc - bTimeAsc;
                default:
                    return 0;
            }
        });
    } else {
        // Sort grouped results (similarity groups or series)
        sortedResults.sort((a, b) => {
            switch (sortMethod) {
                case 'group-size':
                    return (b.photos?.length || b.photoCount || 0) - (a.photos?.length || a.photoCount || 0);
                case 'date-desc':
                    const aTime = a.timestamp || a.startTime;
                    const bTime = b.timestamp || b.startTime;
                    return bTime - aTime;
                case 'date-asc':
                    const aTimeAsc = a.timestamp || a.startTime;
                    const bTimeAsc = b.timestamp || b.startTime;
                    return aTimeAsc - bTimeAsc;
                case 'density':
                    // Only for series
                    return (b.density || 0) - (a.density || 0);
                default:
                    return 0;
            }
        });
    }
    
    // Re-display with sorted results
    displayAnalysisResults(sortedResults, currentResultsType, currentReferencePhoto);
}

// Unified display function for all analysis results
function displayAnalysisResults(groups, type = 'similarity', referencePhoto = null) {
    // Track current results type, reference photo, and results
    currentResultsType = type;
    currentReferencePhoto = referencePhoto;
    currentAnalysisResults = groups; // Store for re-sorting
    
    // Update type label
    if (resultsTypeLabel) {
        let typeText;
        if (type === 'similar-to') {
            typeText = `Photos Similar To: ${referencePhoto?.name || 'Selected Photo'}`;
        } else if (type === 'similarity') {
            typeText = 'Similar Photo Groups';
        } else {
            typeText = 'Large Photo Series';
        }
        resultsTypeLabel.textContent = typeText;
    }
    
    resultsContainer.innerHTML = '';
    
    if (groups.length === 0) {
        resultsContainer.innerHTML = '<p class="placeholder">No results found with current criteria.</p>';
        return;
    }

    // Handle flat list of photos (similar-to) vs grouped results
    if (type === 'similar-to') {
        // Display as a single flat grid with similarity scores
        const groupElement = document.createElement('div');
        groupElement.className = 'similarity-group';
        groupElement.innerHTML = `
            <div class="group-header">
                <div class="group-header-info">
                    <h3>${groups.length} similar photo${groups.length !== 1 ? 's' : ''} found</h3>
                    <p>Showing photos ordered by similarity</p>
                </div>
                <div class="group-header-actions">
                    <button class="toggle-collapse-btn" data-group-idx="0" title="Collapse/Expand results">▾</button>
                    <button class="toggle-select-all-btn" data-group-idx="0" title="Select/Unselect all photos">☑️ Toggle All</button>
                    <button class="delete-selected-btn" data-group-idx="0">🗑️ Delete Selected</button>
                </div>
            </div>
            <div class="photo-grid" data-group-idx="0"></div>
        `;
        
        const photoGrid = groupElement.querySelector('.photo-grid');
        groups.forEach((photo, idx) => {
            const photoItem = document.createElement('div');
            photoItem.className = 'photo-item';
            const thumbnailSrc = `/api/thumb/${photo.file_id}`;
            const similarityPercent = Math.round(photo.similarity * 100);
            
            photoItem.innerHTML = `
                <label class="photo-checkbox-label">
                    <input type="checkbox" class="photo-checkbox" data-group-idx="0" data-photo-idx="${idx}" checked>
                    <span class="photo-checkbox-custom"></span>
                    <img src="${thumbnailSrc}" data-file-id="${photo.file_id}" data-photo-idx="${idx}" alt="${photo.name || ''}" loading="lazy">
                    <div class="photo-score">
                        <div class="similarity-score">Similarity: ${similarityPercent}%</div>
                        <div class="photo-path">${photo.path ? photo.path.replace('/drive/root:', '') || '/' : ''}</div>
                        ${photo.quality_score ? `<div class="quality-info">Quality: ${Math.round(photo.quality_score * 100)}%</div>` : ''}
                    </div>
                </label>
            `;
            photoGrid.appendChild(photoItem);
        });
        
        resultsContainer.appendChild(groupElement);
        attachResultsEventListeners([{ photos: groups }], type);
        return;
    }
    
    // Handle grouped results (similarity groups or series)
    groups.forEach((group, groupIdx) => {
        if (!group.photos || group.photos.length === 0) return;

        const groupElement = document.createElement('div');
        groupElement.className = 'similarity-group';

        // Build header based on type
        let headerHTML = '';
        if (type === 'similarity') {
            const groupDate = new Date(group.timestamp).toLocaleDateString();
            headerHTML = `
                <h3>${group.photos.length} similar photos from ${groupDate}</h3>
                <p>Similarity: >${(group.similarity * 100).toFixed(0)}%</p>
            `;
        } else {
            const startDate = new Date(group.startTime).toLocaleString();
            const endDate = new Date(group.endTime).toLocaleString();
            const durationMinutes = Math.round(group.timeSpanMinutes);
            const durationDisplay = durationMinutes < 60 
                ? `${durationMinutes} min` 
                : `${(group.timeSpanMinutes / 60).toFixed(1)} hours`;
            headerHTML = `
                <h3>${group.photoCount} photos in ${durationDisplay}</h3>
                <p>Density: ${group.density.toFixed(2)} photos/min • Avg: ${group.avgTimeBetweenPhotos.toFixed(2)} min</p>
                <p style="font-size: 0.85rem; color: #aaa;">${startDate} → ${endDate}</p>
            `;
        }
        
        groupElement.innerHTML = `
            <div class="group-header">
                <div class="group-header-info">
                    ${headerHTML}
                </div>
                <div class="group-header-actions">
                    <button class="toggle-collapse-btn" data-group-idx="${groupIdx}" title="Collapse/Expand group">▾</button>
                    <button class="toggle-select-all-btn" data-group-idx="${groupIdx}" title="Select/Unselect all photos">☑️ Toggle All</button>
                    <button class="delete-selected-btn" data-group-idx="${groupIdx}">🗑️ Delete Selected</button>
                </div>
            </div>
            <div class="photo-grid" data-group-idx="${groupIdx}"></div>
        `;
        
        const photoGrid = groupElement.querySelector('.photo-grid');

        group.photos.forEach((p, idx) => {
            const photoItem = document.createElement('div');
            photoItem.className = 'photo-item';
            const thumbnailSrc = `/api/thumb/${p.file_id}`;
            
            // Build photo info based on type
            let photoInfo = `<div class="photo-path">${p.path ? p.path.replace('/drive/root:', '') || '/' : ''}</div>`;
            if (type === 'series') {
                photoInfo += `<div class="photo-time">${new Date(p.photo_taken_ts).toLocaleTimeString()}</div>`;
            }
            if (p.quality_score) {
                photoInfo += `<div class="quality-info">Quality: ${(p.quality_score * 100).toFixed(0)}%</div>`;
            }
            
            photoItem.innerHTML = `
                <label class="photo-checkbox-label">
                    <input type="checkbox" class="photo-checkbox" data-group-idx="${groupIdx}" data-photo-idx="${idx}" ${type === 'similarity' && idx === 0 ? '' : 'checked'}>
                    <span class="photo-checkbox-custom"></span>
                    <img src="${thumbnailSrc}" data-file-id="${p.file_id}" alt="${p.name || ''}" loading="lazy">
                    <div class="photo-score">${photoInfo}</div>
                </label>
            `;
            photoGrid.appendChild(photoItem);
        });

        resultsContainer.appendChild(groupElement);
    });

    // Attach event listeners
    attachResultsEventListeners(groups, type);
}

// Attach event listeners for results (delete buttons and image clicks)
function attachResultsEventListeners(groups, type) {
    // Toggle collapse/expand buttons
    document.querySelectorAll('.toggle-collapse-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const groupIdx = btn.getAttribute('data-group-idx');
            const photoGrid = resultsContainer.querySelector(`.photo-grid[data-group-idx="${groupIdx}"]`);
            const groupElement = btn.closest('.similarity-group');
            
            if (photoGrid) {
                const isCollapsed = photoGrid.style.display === 'none';
                photoGrid.style.display = isCollapsed ? 'grid' : 'none';
                btn.textContent = isCollapsed ? '▾' : '▸';
                btn.title = isCollapsed ? 'Collapse group' : 'Expand group';
                groupElement.classList.toggle('collapsed', !isCollapsed);
            }
        });
    });
    
    // Toggle select all/unselect all buttons
    document.querySelectorAll('.toggle-select-all-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const groupIdx = btn.getAttribute('data-group-idx');
            const checkboxes = resultsContainer.querySelectorAll(`.photo-checkbox[data-group-idx="${groupIdx}"]`);
            
            if (checkboxes.length === 0) return;
            
            // Check if all are selected
            const allSelected = Array.from(checkboxes).every(cb => cb.checked);
            
            // Toggle: if all selected, unselect all; otherwise select all
            checkboxes.forEach(cb => {
                cb.checked = !allSelected;
            });
            
            // Update button text
            btn.textContent = allSelected ? '☑️ Toggle All' : '☐ Toggle All';
        });
    });
    
    // Delete buttons
    document.querySelectorAll('.delete-selected-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
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
            
            updateStatus('Deleting selected photos...', true);
            try {
                const token = await getAuthToken();
                for (const photo of selectedPhotos) {
                    await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${photo.file_id}`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    await db.deletePhotos([photo.file_id]);
                }
                group.photos = group.photos.filter((p, idx) => !checkboxes[idx].checked);
                
                // Handle different result types for re-display after deletion
                if (type === 'similar-to') {
                    // For similar-to, pass the flat array of remaining photos
                    displayAnalysisResults(group.photos, type, currentReferencePhoto);
                } else {
                    // For similarity/series, filter out empty groups
                    const filteredGroups = groups.filter(g => g.photos && g.photos.length > 0);
                    displayAnalysisResults(filteredGroups, type);
                }
                
                updateStatus('Selected photos deleted.', false);
            } catch (err) {
                updateStatus('Error deleting photos: ' + err.message, false);
            }
        });
    });

    // Image clicks for modal
    resultsContainer.querySelectorAll('.photo-item img').forEach(img => {
        img.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            const modal = document.getElementById('image-modal');
            const modalImg = document.getElementById('modal-img');
            const fileId = img.getAttribute('data-file-id');
            
            // Get photo based on type
            let photo;
            if (type === 'similar-to') {
                const photoIdx = parseInt(img.getAttribute('data-photo-idx'));
                photo = groups[0].photos[photoIdx];
            } else {
                const groupIdx = parseInt(img.closest('.photo-item').querySelector('.photo-checkbox').getAttribute('data-group-idx'));
                const photoIdx = parseInt(img.closest('.photo-item').querySelector('.photo-checkbox').getAttribute('data-photo-idx'));
                photo = groups[groupIdx].photos[photoIdx];
            }
            
            currentModalPhoto = photo;
            populateImageMetadata(photo);
            
            if (fileId) {
                if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                    const token = await getAuthToken();
                    navigator.serviceWorker.controller.postMessage({
                        type: 'SET_TOKEN',
                        token: token
                    });
                }
                modalImg.src = img.src;
                modal.style.display = 'flex';
                await loadFullSizeImage(fileId, modalImg, img.src);
            } else {
                modalImg.src = img.src;
                modal.style.display = 'flex';
            }
        });
    });
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

        // Automatically index browsed photos to database
        if (photos.length > 0) {
            if (isAutoIndexing) {
                console.log('⏭️ Skipping auto-indexing - already in progress');
            } else {
                isAutoIndexing = true; // Set flag to prevent overlapping operations
            try {
                // Use current timestamp as scan ID for browsed photos
                const scanId = Date.now();
                
                // First, check which photos already exist in database
                const existingPhotosMap = new Map();
                for (const photo of photos) {
                    try {
                        const existing = await db.getPhotoById(photo.file_id);
                        if (existing) {
                            existingPhotosMap.set(photo.file_id, existing);
                        }
                    } catch (e) {
                        // Photo doesn't exist, that's fine
                    }
                }
                
                // Prepare photos for database with all required fields
                const photosToIndex = photos.map(photo => {
                    // Convert photo_taken_ts to timestamp if it's a string
                    const photoTakenTs = photo.photo_taken_ts 
                        ? (typeof photo.photo_taken_ts === 'string' 
                            ? new Date(photo.photo_taken_ts).getTime() 
                            : photo.photo_taken_ts)
                        : (photo.last_modified 
                            ? new Date(photo.last_modified).getTime() 
                            : Date.now());
                    
                    // Check if photo already exists
                    const existing = existingPhotosMap.get(photo.file_id);
                    
                    return {
                        file_id: photo.file_id,
                        name: photo.name,
                        size: photo.size || 0,
                        path: photo.path || '/drive/root:',
                        last_modified: photo.last_modified || new Date().toISOString(),
                        photo_taken_ts: photoTakenTs,
                        thumbnail_url: photo.thumbnail_url || null,
                        // Keep existing embeddings if photo was already indexed
                        embedding_status: existing ? existing.embedding_status : 0,
                        embedding: existing ? existing.embedding : null,
                        quality_score: existing ? existing.quality_score : null,
                        scan_id: scanId
                    };
                });
                
                // Add or update photos in database
                await db.addOrUpdatePhotos(photosToIndex);
                
                // Count only truly new photos (those that didn't exist before)
                const newPhotosCount = photos.length - existingPhotosMap.size;
                console.log(`✅ Auto-indexed ${photos.length} photos (${newPhotosCount} new, ${existingPhotosMap.size} already indexed)`);
                
                // Clean up photos that no longer exist in OneDrive (deleted photos)
                // Get all photos in IndexedDB for the current folder
                const currentFolderPath = await getFolderPath(folderId);
                const dbPhotosInFolder = await db.getAllPhotosFromFolder(currentFolderPath);
                
                // Filter to only photos directly in this folder (not subfolders)
                const dbPhotosDirectlyInFolder = dbPhotosInFolder.filter(p => p.path === currentFolderPath);
                
                // Find photos that exist in DB but NOT in OneDrive response
                const onedriveFileIds = new Set(photos.map(p => p.file_id));
                const photosToDelete = dbPhotosDirectlyInFolder.filter(p => !onedriveFileIds.has(p.file_id));
                
                let deletedCount = 0;
                if (photosToDelete.length > 0) {
                    const deletedIds = photosToDelete.map(p => p.file_id);
                    await db.deletePhotos(deletedIds);
                    deletedCount = photosToDelete.length;
                    console.log(`🗑️ Removed ${deletedCount} deleted photos from database`);
                }
                
                // Add ALL photos that need embeddings to the queue (both new and existing)
                // Filter: embedding_status === 0 means they need embeddings
                const photosNeedingEmbeddings = photosToIndex.filter(p => p.embedding_status === 0);
                
                if (photosNeedingEmbeddings.length > 0) {
                    const newCount = photosNeedingEmbeddings.filter(p => !existingPhotosMap.has(p.file_id)).length;
                    const existingCount = photosNeedingEmbeddings.length - newCount;
                    console.log(`📥 Adding ${photosNeedingEmbeddings.length} photos to embedding queue (${newCount} new, ${existingCount} already indexed)`);
                    await addPhotosToEmbeddingQueue(photosNeedingEmbeddings, true); // Priority = true
                }
                
                // Show summary
                const totalIndexed = await db.getPhotoCount();
                const allNeedEmbeddings = await db.getPhotosWithoutEmbedding();
                console.log(`📊 Total indexed: ${totalIndexed}, Need embeddings: ${allNeedEmbeddings.length}`);
                
                // If current folder is already processed but there are OTHER photos that need embeddings,
                // start processing them (if auto-start is enabled)
                if (photosNeedingEmbeddings.length === 0 && allNeedEmbeddings.length > 0) {
                    const autoStart = await db.getSetting('autoStartEmbeddings');
                    if (autoStart !== false && !isProcessingEmbeddings && !isEmbeddingPaused) {
                        console.log(`🚀 Current folder already processed, but ${allNeedEmbeddings.length} other photos need embeddings`);
                        await addPhotosToEmbeddingQueue(allNeedEmbeddings, false); // Normal priority
                    }
                }
            
                // Update status briefly
                const oldStatus = statusText.textContent;
                const statusMsg = deletedCount > 0 
                    ? `Auto-indexed ${photos.length} photos (${newPhotosCount} new, ${deletedCount} deleted, ${allNeedEmbeddings.length} need embeddings)`
                    : `Auto-indexed ${photos.length} photos (${newPhotosCount} new, ${allNeedEmbeddings.length} need embeddings)`;
                updateStatus(statusMsg, false);
                setTimeout(() => {
                    if (statusText.textContent.includes('Auto-indexed')) {
                        updateStatus(oldStatus, false);
                    }
                }, 3000);
            } catch (indexError) {
                console.error('❌ Failed to auto-index photos:', indexError);
                // Don't block the UI if indexing fails
            } finally {
                isAutoIndexing = false; // Reset flag
            }
            } // End of else block
        }

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
        
        // Add click event listeners to browser photos for full-size modal
        browserPhotoGrid.querySelectorAll('.photo-item img').forEach((img, idx) => {
            img.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
                
                const modal = document.getElementById('image-modal');
                const modalImg = document.getElementById('modal-img');
                const fileId = img.getAttribute('data-file-id');
                
                // Get photo data from sortedPhotos array
                // Note: idx already corresponds to sortedPhotos because querySelectorAll only finds img elements (not folders)
                const photo = sortedPhotos[idx];
                
                if (!photo) {
                    console.error('Photo data not found for index:', idx);
                    return;
                }
                
                // Try to get full photo data from database (includes quality metrics)
                try {
                    const dbPhoto = await db.getPhotoById(fileId);
                    if (dbPhoto) {
                        currentModalPhoto = dbPhoto; // Store for modal actions
                        populateImageMetadata(dbPhoto);
                    } else {
                        // Fallback to OneDrive photo data
                        currentModalPhoto = photo; // Store for modal actions
                        populateImageMetadata(photo);
                    }
                } catch (error) {
                    console.warn('Could not fetch photo from database:', error);
                    currentModalPhoto = photo; // Store for modal actions
                    populateImageMetadata(photo);
                }
                
                if (fileId) {
                    // Send auth token to service worker
                    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                        const token = await getAuthToken();
                        navigator.serviceWorker.controller.postMessage({
                            type: 'SET_TOKEN',
                            token: token
                        });
                    }
                    
                    // Show modal with thumbnail first
                    modalImg.src = img.src;
                    modal.style.display = 'flex';
                    
                    // Load full-size image in background
                    await loadFullSizeImage(fileId, modalImg, img.src);
                } else {
                    modalImg.src = img.src;
                    modal.style.display = 'flex';
                }
            });
        });
    } catch (e) {
        console.error('Failed to render browser photo grid', e);
        browserPhotoGrid.innerHTML = '<div class="error-message">Failed to load photos.</div>';
    }
}

// Initialize image modal handlers (call once at startup)
function initializeImageModal() {
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-img');
    const closeBtn = document.getElementById('modal-close');
    const metadataToggle = document.getElementById('metadata-toggle');
    const metadataContent = document.getElementById('metadata-content');
    const deleteBtn = document.getElementById('modal-delete-btn');
    
    if (!modal || !closeBtn) {
        console.warn('Image modal elements not found');
        return;
    }
    
    // Metadata toggle functionality
    if (metadataToggle && metadataContent) {
        metadataToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            metadataContent.classList.toggle('collapsed');
            metadataToggle.textContent = metadataContent.classList.contains('collapsed') ? '📊' : '📈';
        });
    }
    
    // Delete photo functionality
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            if (!currentModalPhoto) {
                alert('No photo selected');
                return;
            }
            
            const photoName = currentModalPhoto.name || 'this photo';
            if (!confirm(`Delete "${photoName}"? This cannot be undone.`)) {
                return;
            }
            
            try {
                deleteBtn.disabled = true;
                deleteBtn.textContent = '⏳';
                
                // Delete from OneDrive
                const token = await getAuthToken();
                const response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${currentModalPhoto.file_id}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` }
                });
                
                if (!response.ok) {
                    throw new Error(`Failed to delete: ${response.status} ${response.statusText}`);
                }
                
                console.log(`Successfully deleted photo: ${photoName} (${currentModalPhoto.file_id})`);
                
                // Delete from local database
                await db.deletePhotos([currentModalPhoto.file_id]);
                console.log(`Removed photo from database: ${currentModalPhoto.file_id}`);
                
                // Close modal
                closeModal();
                
                // Show success message
                updateStatus(`Photo "${photoName}" deleted successfully`, false);
                
                // Refresh the current view if applicable
                if (browserPhotoGrid && browserPhotoGrid.children.length > 0) {
                    await renderBrowserPhotoGrid(true);
                }
                
            } catch (error) {
                console.error('Failed to delete photo:', error);
                alert(`Failed to delete photo: ${error.message}`);
                deleteBtn.disabled = false;
                deleteBtn.textContent = '🗑️';
            }
        });
    }
    
    const closeModal = () => {
        // Trigger custom 'hide' event for cleanup
        modal.dispatchEvent(new Event('hide'));
        modal.style.display = 'none';
        if (modalImg) modalImg.src = '';
        currentModalPhoto = null; // Clear current photo reference
        // Reset metadata overlay
        if (metadataContent) metadataContent.classList.remove('collapsed');
        if (metadataToggle) metadataToggle.textContent = '📊';
        // Reset delete button
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.textContent = '🗑️';
        }
    };
    
    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
        }
    });
    
    console.log('Image modal initialized');
}

// Function to populate image metadata overlay
function populateImageMetadata(photo) {
    const photoName = document.getElementById('photo-name');
    const sharpnessValue = document.getElementById('sharpness-value');
    const exposureValue = document.getElementById('exposure-value');
    const qualityScoreValue = document.getElementById('quality-score-value');
    
    // Set photo name
    photoName.textContent = photo.name || 'Unknown Photo';
    
    // Display sharpness metric
    if (photo.sharpness !== undefined && isFinite(photo.sharpness)) {
        const sharpness = typeof photo.sharpness === 'number' ? photo.sharpness : 0;
        sharpnessValue.textContent = `${sharpness.toFixed(2)}`;
        
        // Color code sharpness (sharp images: 15-40+, blurry: <10)
        if (sharpness >= 15) {
            sharpnessValue.style.color = '#4caf50'; // Sharp
        } else if (sharpness >= 10) {
            sharpnessValue.style.color = '#ffeb3b'; // OK
        } else {
            sharpnessValue.style.color = '#f44336'; // Blurry
        }
    } else {
        sharpnessValue.textContent = 'N/A';
        sharpnessValue.style.color = '#fff';
    }
    
    // Display exposure metrics (now with detailed breakdown)
    if (photo.exposure !== undefined) {
        // Check if it's the new object format or old number format
        if (typeof photo.exposure === 'object') {
            const exp = photo.exposure;
            const brightness = Math.round((exp.meanBrightness || 0) * 100);
            const clipping = Math.round((exp.clipping || 0) * 100);
            const dynamicRange = Math.round((exp.dynamicRange || 0) * 100);
            const entropy = Math.round((exp.entropy || 0) * 100);
            
            exposureValue.innerHTML = `
                <div style="margin-bottom: 4px;">Brightness: ${brightness}%</div>
                <div style="font-size: 0.85em; opacity: 0.9;">
                    Clipping: ${clipping}% | Dynamic Range: ${dynamicRange}% | Entropy: ${entropy}%
                </div>
            `;
            
            // Color code based on overall exposure quality
            if (brightness >= 40 && brightness <= 60 && clipping < 5) {
                exposureValue.style.color = '#4caf50'; // Good exposure
            } else if (brightness >= 25 && brightness <= 75 && clipping < 10) {
                exposureValue.style.color = '#ffeb3b'; // OK exposure
            } else {
                exposureValue.style.color = '#f44336'; // Poor exposure
            }
        } else {
            // Legacy format (single number)
            const exposurePercent = Math.round(photo.exposure * 100);
            exposureValue.textContent = `${exposurePercent}%`;
            
            if (exposurePercent >= 40 && exposurePercent <= 60) {
                exposureValue.style.color = '#4caf50';
            } else if (exposurePercent >= 25 && exposurePercent <= 75) {
                exposureValue.style.color = '#ffeb3b';
            } else {
                exposureValue.style.color = '#f44336';
            }
        }
    } else {
        exposureValue.textContent = 'N/A';
        exposureValue.style.color = '#fff';
    }
    
    // Display quality score with face metrics if available
    if (photo.quality_score !== undefined && isFinite(photo.quality_score)) {
        const qualityPercent = Math.round(photo.quality_score * 100);
        
        // Build quality score display with face info if available
        let qualityHtml = `<div style="margin-bottom: 4px;">${qualityPercent}%</div>`;
        
        // Add face metrics if available
        if (photo.face && photo.face.faceCount > 0 && isFinite(photo.face.faceScore)) {
            const faceScore = Math.round(photo.face.faceScore * 100);
            qualityHtml += `<div style="font-size: 0.85em; opacity: 0.9;">
                ${photo.face.faceCount} face${photo.face.faceCount > 1 ? 's' : ''} detected | Face Quality: ${faceScore}%
            </div>`;
            
            // Show detailed face metrics if available
            if (photo.face.details && photo.face.details.length > 0) {
                const detail = photo.face.details[0]; // Show first face details
                const metrics = [];
                if (detail.eyesOpen !== undefined && isFinite(detail.eyesOpen)) {
                    metrics.push(`Eyes: ${Math.round(detail.eyesOpen * 100)}%`);
                }
                if (detail.smile !== undefined && isFinite(detail.smile)) {
                    metrics.push(`Smile: ${Math.round(detail.smile * 100)}%`);
                }
                if (detail.naturalExpression !== undefined && isFinite(detail.naturalExpression)) {
                    metrics.push(`Natural: ${Math.round(detail.naturalExpression * 100)}%`);
                }
                
                if (metrics.length > 0) {
                    qualityHtml += `<div style="font-size: 0.8em; opacity: 0.85; margin-top: 2px;">
                        ${metrics.join(' | ')}
                    </div>`;
                }
            }
        }
        
        qualityScoreValue.innerHTML = qualityHtml;
        
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

// --- Folder Browser Functions (Modal) - REMOVED ---
// The folder browser modal was never opened (showFolderBrowser never called)
// Folder navigation now done through the main browser with clickable breadcrumbs

async function runPhotoScan(folderPath = null) {
    // Use provided folder path or current selection
    const pathToScan = folderPath || selectedFolderPath || '/drive/root:';
    
    try {
        // --- STEP 1: Generate a new scan ID ---
        const newScanId = Date.now();
        console.log(`Starting new scan with ID: ${newScanId} for folder: ${pathToScan}`);
        updateStatus(`Scanning folder and subfolders for photos...`, true, 0, 100);

        // --- STEP 2: Crawl OneDrive starting from selected folder (with subfolders) ---
        const folderId = await findFolderIdByPath(pathToScan);
        await fetchAllPhotos(newScanId, (progress) => {
            updateStatus(`Scanning... Found ${progress.count} photos so far.`, true, 0, 100);
        }, folderId || 'root');
        
        // --- STEP 3: Clean up files that were not touched (i.e., deleted from OneDrive) ---
        updateStatus('Cleaning up deleted files...', true, 0, 100);
        // await db.deletePhotosNotMatchingScanId(newScanId);
        
        const totalPhotos = await db.getPhotoCount();
        const photosNeedingEmbeddings = await db.getPhotosWithoutEmbedding();
        
        updateStatus(`Scan complete. Total photos: ${totalPhotos}`, false);
        console.log(`📊 Scan complete: ${totalPhotos} total photos, ${photosNeedingEmbeddings.length} need embeddings`);
        
        // --- STEP 4: Add photos to embedding queue (auto-starts if enabled) ---
        if (photosNeedingEmbeddings.length > 0) {
            await addPhotosToEmbeddingQueue(photosNeedingEmbeddings, false); // priority = false for scanned photos
        }

    } catch (error) {
        console.error('Scan failed:', error);
        updateStatus(`Error during scan: ${error.message}`, false);
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

// Old embedding generation functions removed - now using queue-based system with addPhotosToEmbeddingQueue()

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

// --- Similar Photos Functions ---

/**
 * Calculate cosine similarity between two embedding vectors
 * @param {Array<number>} embedding1 - First embedding vector
 * @param {Array<number>} embedding2 - Second embedding vector
 * @returns {number} - Similarity score between 0 and 1
 */
function cosineSimilarity(embedding1, embedding2) {
    if (!embedding1 || !embedding2 || embedding1.length !== embedding2.length) {
        return 0;
    }
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < embedding1.length; i++) {
        dotProduct += embedding1[i] * embedding2[i];
        norm1 += embedding1[i] * embedding1[i];
        norm2 += embedding2[i] * embedding2[i];
    }
    
    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Find photos similar to a reference photo
 * @param {string} referenceFileId - File ID of the reference photo
 * @param {number} maxResults - Maximum number of similar photos to return
 * @returns {Promise<Array>} - Array of similar photos with similarity scores
 */
async function findSimilarToPhoto(referenceFileId, maxResults = 20) {
    try {
        // Get the reference photo with its embedding
        const referencePhoto = await db.getPhotoById(referenceFileId);
        
        if (!referencePhoto || !referencePhoto.embedding) {
            throw new Error('Reference photo not found or has no embedding');
        }
        
        // Get all photos with embeddings (excluding the reference photo itself)
        const allPhotos = await db.getAllPhotosWithEmbedding();
        const otherPhotos = allPhotos.filter(p => p.file_id !== referenceFileId);
        
        if (otherPhotos.length === 0) {
            return [];
        }
        
        // Calculate similarity for each photo using CLIP embeddings
        const photosWithScores = otherPhotos.map(photo => {
            const similarity = cosineSimilarity(referencePhoto.embedding, photo.embedding);
            
            return {
                ...photo,
                similarity
            };
        });
        
        // Sort by similarity (highest first) and take top results
        photosWithScores.sort((a, b) => b.similarity - a.similarity);
        
        return photosWithScores.slice(0, maxResults);
    } catch (error) {
        console.error('Error finding similar photos:', error);
        throw error;
    }
}


/**
 * Handle "Find Similar Photos" button click
 */
async function handleFindSimilarClick() {
    if (!currentModalPhoto || !currentModalPhoto.file_id) {
        alert('No photo selected');
        return;
    }
    
    // Check if photo has embedding
    if (!currentModalPhoto.embedding) {
        alert('This photo needs to be processed first (no embedding available)');
        return;
    }
    
    try {
        // Disable button during search
        if (modalFindSimilarBtn) {
            modalFindSimilarBtn.disabled = true;
            modalFindSimilarBtn.textContent = '🔍 Searching...';
        }
        
        updateStatus('Finding similar photos...', false);
        
        // Find similar photos (default 50 results)
        const similarPhotos = await findSimilarToPhoto(currentModalPhoto.file_id, 50);
        
        // Update URL with query parameter
        updateURLWithSimilarPhoto(currentModalPhoto.file_id);
        
        // Display results using unified function
        displayAnalysisResults(similarPhotos, 'similar-to', currentModalPhoto);
        
        // Close the modal
        const modal = document.getElementById('image-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        
        // Scroll to results panel
        const resultsPanel = document.querySelector('[data-panel-key="results"]');
        if (resultsPanel) {
            resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        updateStatus(`Found ${similarPhotos.length} similar photos`, false);
        
    } catch (error) {
        console.error('Error finding similar photos:', error);
        alert(`Failed to find similar photos: ${error.message}`);
        updateStatus('Error finding similar photos', false);
    } finally {
        // Re-enable button
        if (modalFindSimilarBtn) {
            modalFindSimilarBtn.disabled = false;
            modalFindSimilarBtn.textContent = '🔍 Find Similar Photos';
        }
    }
}

/**
 * Clear similar photos search
 */
function clearSimilarPhotosSearch() {
    // Clear results
    currentResultsType = null;
    currentReferencePhoto = null;
    currentAnalysisResults = null;
    if (resultsTypeLabel) {
        resultsTypeLabel.textContent = 'No results yet';
    }
    resultsContainer.innerHTML = '<p class="placeholder">Run similarity analysis or series analysis to see results here.</p>';
    
    // Remove URL parameter
    const url = new URL(window.location);
    url.searchParams.delete('similar-to');
    window.history.pushState({}, '', url);
    
    updateStatus('Similar photos search cleared', false);
}

/**
 * Update URL with similar photo parameter
 */
function updateURLWithSimilarPhoto(fileId) {
    const url = new URL(window.location);
    url.searchParams.set('similar-to', fileId);
    window.history.pushState({}, '', url);
}

/**
 * Get similar photo file ID from URL
 */
function getSimilarPhotoFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('similar-to');
}

/**
 * Restore similar photos view from URL parameter
 */
async function restoreSimilarPhotosFromURL() {
    const fileId = getSimilarPhotoFromURL();
    if (!fileId) return;
    
    try {
        updateStatus('Restoring similar photos view...', false);
        
        // Get reference photo
        const referencePhoto = await db.getPhotoById(fileId);
        if (!referencePhoto || !referencePhoto.embedding) {
            console.warn('Reference photo not found or has no embedding:', fileId);
            // Clear invalid URL parameter
            clearSimilarPhotosSearch();
            return;
        }
        
        // Find similar photos (50 results)
        const similarPhotos = await findSimilarToPhoto(fileId, 50);
        
        // Display results using unified function
        displayAnalysisResults(similarPhotos, 'similar-to', referencePhoto);
        
        updateStatus(`Restored similar photos view (${similarPhotos.length} photos)`, false);
        
    } catch (error) {
        console.error('Error restoring similar photos from URL:', error);
        clearSimilarPhotosSearch();
    }
}

/**
 * Navigate to photo's folder in browser and scroll to the photo
 */
async function viewPhotoInFolder() {
    if (!currentModalPhoto || !currentModalPhoto.file_id) {
        alert('No photo selected');
        return;
    }
    
    try {
        // Disable button during navigation
        if (modalViewInFolderBtn) {
            modalViewInFolderBtn.disabled = true;
            modalViewInFolderBtn.textContent = '📁 Loading...';
        }
        
        updateStatus('Navigating to folder...', false);
        
        // Get photo's folder path
        const photoPath = currentModalPhoto.path || '/drive/root:';
        
        // Find folder ID for the path
        const folderId = await findFolderIdByPath(photoPath);
        if (!folderId) {
            throw new Error('Could not find folder for path: ' + photoPath);
        }
        
        // Update browser state to this folder
        selectedFolderId = folderId;
        selectedFolderPath = photoPath;
        selectedFolderDisplayName = pathToDisplayName(photoPath);
        updateURLWithPath(photoPath);
        updateBrowserCurrentPath();
        
        // Close the modal
        const modal = document.getElementById('image-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        
        // Render the browser grid
        await renderBrowserPhotoGrid(true);
        
        // Scroll to browser panel
        const browserPanel = document.querySelector('[data-panel-key="browser"]');
        if (browserPanel) {
            browserPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        // Wait a bit for the grid to render, then scroll to and highlight the photo
        setTimeout(() => {
            const photoElements = browserPhotoGrid.querySelectorAll('.photo-item img');
            let targetPhotoElement = null;
            
            // Find the photo element with matching file_id
            photoElements.forEach((img) => {
                if (img.getAttribute('data-file-id') === currentModalPhoto.file_id) {
                    targetPhotoElement = img.closest('.photo-item');
                }
            });
            
            if (targetPhotoElement) {
                // Scroll to the photo
                targetPhotoElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // Add highlight animation
                targetPhotoElement.classList.add('highlight');
                
                // Remove highlight after animation completes
                setTimeout(() => {
                    targetPhotoElement.classList.remove('highlight');
                }, 2000);
                
                updateStatus('Photo found in folder', false);
            } else {
                console.warn('Photo not found in rendered grid');
                updateStatus('Folder opened (photo not visible)', false);
            }
        }, 500);
        
    } catch (error) {
        console.error('Error viewing photo in folder:', error);
        alert(`Failed to open folder: ${error.message}`);
        updateStatus('Error opening folder', false);
    } finally {
        // Re-enable button
        if (modalViewInFolderBtn) {
            modalViewInFolderBtn.disabled = false;
            modalViewInFolderBtn.textContent = '📁 View in Folder';
        }
    }
}

// Add photos to embedding queue (at beginning if workers are running)
async function addPhotosToEmbeddingQueue(photos, priority = false) {
    if (!photos || photos.length === 0) return;
    
    // Filter out photos that are already in the queue
    const queuedFileIds = new Set(embeddingQueue.map(p => p.file_id));
    const newPhotos = photos.filter(p => !queuedFileIds.has(p.file_id));
    
    if (newPhotos.length === 0) {
        console.log(`⏭️ Skipped adding photos - all ${photos.length} already in queue`);
        return;
    }
    
    if (priority && isProcessingEmbeddings) {
        // Add to beginning of queue if workers are running
        embeddingQueue.unshift(...newPhotos);
        console.log(`✨ Added ${newPhotos.length} photos to beginning of embedding queue (priority)`);
    } else {
        // Add to end of queue
        embeddingQueue.push(...newPhotos);
        console.log(`📥 Added ${newPhotos.length} photos to embedding queue`);
    }
    
    // Update button state
    updatePauseResumeButton();
    
    // Auto-start if enabled and not currently processing
    const autoStart = await db.getSetting('autoStartEmbeddings');
    if (autoStart !== false && !isProcessingEmbeddings && !isEmbeddingPaused) {
        console.log('🚀 Auto-starting embedding generation');
        
        // Also check for OTHER photos in database that need embeddings
        // Add them to the queue (at lower priority) so all photos get processed
        const allPhotosNeedingEmbeddings = await db.getPhotosWithoutEmbedding();
        const currentQueueIds = new Set(embeddingQueue.map(p => p.file_id));
        const remainingPhotos = allPhotosNeedingEmbeddings.filter(p => !currentQueueIds.has(p.file_id));
        
        if (remainingPhotos.length > 0) {
            console.log(`📥 Adding ${remainingPhotos.length} more photos from database to queue (lower priority)`);
            embeddingQueue.push(...remainingPhotos); // Add to END (lower priority)
        }
        
        startEmbeddingWorkers();
    }
}

// Initialize persistent workers (call once)
async function initializeWorkers() {
    if (workersInitialized) {
        console.log('Workers already initialized');
        return;
    }
    
    const NUM_EMBEDDING_WORKERS = await getWorkerCount();
    console.log(`🚀 Initializing ${NUM_EMBEDDING_WORKERS} persistent workers...`);
    
    // Create workers with event listeners attached immediately
    const readyPromises = [];
    
    for (let i = 0; i < NUM_EMBEDDING_WORKERS; i++) {
        const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        
        const workerInfo = {
            worker,
            id: i,
            busy: false,
            ready: false
        };
        
        // Create promise that resolves when this worker is ready
        const readyPromise = new Promise((resolve) => {
            const handleInit = (event) => {
                if (event.data.status === 'model_ready') {
                    workerInfo.ready = true;
                    console.log(`✅ Worker ${i} ready (models loaded)`);
                    worker.removeEventListener('message', handleInit);
                    resolve();
                } else if (event.data.status === 'model_loading') {
                    console.log(`⏳ Worker ${i} loading models...`);
                }
            };
            worker.addEventListener('message', handleInit);
        });
        
        readyPromises.push(readyPromise);
        
        worker.onerror = (err) => {
            console.error(`Worker ${i} error:`, err);
        };
        
        embeddingWorkers.push(workerInfo);
        
        // Send worker ID
        worker.postMessage({ type: 'setWorkerId', workerId: i });
        
        // Initialize worker (load models)
        worker.postMessage({ type: 'init' });
    }
    
    workersInitialized = true;
    console.log(`✅ ${NUM_EMBEDDING_WORKERS} workers initialized, waiting for models to load...`);
    
    // Wait for all workers to finish loading models
    await Promise.all(readyPromises);
    console.log(`🎉 All ${NUM_EMBEDDING_WORKERS} workers ready!`);
}

// Terminate all workers (cleanup)
function terminateWorkers() {
    console.log('🛑 Terminating all workers...');
    embeddingWorkers.forEach(w => w.worker.terminate());
    embeddingWorkers = [];
    workersInitialized = false;
}

// Start embedding workers to process the queue
async function startEmbeddingWorkers() {
    if (isProcessingEmbeddings) {
        console.log('Embedding workers already running');
        return;
    }
    
    if (embeddingQueue.length === 0) {
        // Check for photos without embeddings
        const photosWithoutEmbeddings = await db.getPhotosWithoutEmbedding();
        if (photosWithoutEmbeddings.length > 0) {
            embeddingQueue.push(...photosWithoutEmbeddings);
            console.log(`📥 Added ${photosWithoutEmbeddings.length} photos without embeddings to queue`);
        } else {
            updateStatus('No photos need embeddings', false);
            return;
        }
    }
    
    // Initialize workers if not already done
    if (!workersInitialized) {
        await initializeWorkers();
    }
    
    isProcessingEmbeddings = true;
    isEmbeddingPaused = false;
    updatePauseResumeButton();
    
    currentEmbeddingPromise = processEmbeddingQueue();
}

// Pause embedding workers (workers stay alive, just stop processing queue)
function pauseEmbeddingWorkers() {
    isEmbeddingPaused = true;
    updatePauseResumeButton();
    updateStatus('Embedding generation paused', false);
    console.log('⏸️ Embedding generation paused (workers still alive)');
}

// Resume embedding workers
async function resumeEmbeddingWorkers() {
    if (!isProcessingEmbeddings && embeddingQueue.length > 0) {
        startEmbeddingWorkers();
    } else {
        isEmbeddingPaused = false;
        updatePauseResumeButton();
        updateStatus('Embedding generation resumed', false);
        console.log('▶️ Embedding generation resumed');
    }
}

// Update Pause/Resume button state
function updatePauseResumeButton() {
    if (!pauseResumeEmbeddingsBtn) return;
    
    if (!isProcessingEmbeddings && embeddingQueue.length === 0) {
        pauseResumeEmbeddingsBtn.textContent = '⏹️ No Photos to Process';
        pauseResumeEmbeddingsBtn.disabled = true;
    } else if (isEmbeddingPaused) {
        pauseResumeEmbeddingsBtn.textContent = '▶️ Resume Embedding Workers';
        pauseResumeEmbeddingsBtn.disabled = false;
    } else if (isProcessingEmbeddings) {
        pauseResumeEmbeddingsBtn.textContent = '⏸️ Pause Embedding Workers';
        pauseResumeEmbeddingsBtn.disabled = false;
    } else {
        pauseResumeEmbeddingsBtn.textContent = '▶️ Start Embedding Workers';
        pauseResumeEmbeddingsBtn.disabled = false;
    }
}

// Process the embedding queue using persistent workers
async function processEmbeddingQueue() {
    console.log(`📊 Starting queue processing: ${embeddingQueue.length} photos`);
    
    // Workers are already ready after initializeWorkers()
    updateStatus(`Processing ${embeddingQueue.length} photos...`, true, 0, embeddingQueue.length);
    
    let processedCount = 0;
    const totalToProcess = embeddingQueue.length;
    
    console.log(`💻 Using client-side processing for ${totalToProcess} photos`);
    
    // Send auth token to service worker
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        try {
            const token = await getAuthToken();
            navigator.serviceWorker.controller.postMessage({
                type: 'SET_TOKEN',
                token: token
            });
        } catch (error) {
            console.error('Failed to send auth token to service worker:', error);
        }
    }
    
    // Process photos using persistent workers (client-side only)
    while (embeddingQueue.length > 0 && !isEmbeddingPaused) {
        // Find an available worker
        const availableWorker = embeddingWorkers.find(w => w.ready && !w.busy);
        
        if (!availableWorker) {
            // All workers busy, wait a bit
            await new Promise(resolve => setTimeout(resolve, 50));
            continue;
        }
        
        // Get next photo from queue
        const photo = embeddingQueue.shift();
        availableWorker.busy = true;
        
        // Process this photo
        const promise = new Promise((resolve) => {
            const handleMessage = async (event) => {
                // Handle console messages from worker
                if (event.data.type === 'console') {
                    debugConsole.addEntry(event.data.level, event.data.args);
                    return;
                }
                
                const { file_id, status, embedding, qualityMetrics, error } = event.data;
                
                if (file_id !== photo.file_id) return; // Not for this photo
                
                if (status === 'complete') {
                    await db.updatePhotoEmbedding(file_id, embedding, qualityMetrics);
                    processedCount++;
                    updateStatus(`Processing photos... ${processedCount}/${totalToProcess} complete, ${embeddingQueue.length} in queue`, true, processedCount, totalToProcess);
                    availableWorker.busy = false;
                    availableWorker.worker.removeEventListener('message', handleMessage);
                    resolve();
                } else if (status === 'error') {
                    console.error(`Worker error for file ${file_id}:`, error);
                    processedCount++;
                    updateStatus(`Processing photos... ${processedCount}/${totalToProcess} complete, ${embeddingQueue.length} in queue (some errors)`, true, processedCount, totalToProcess);
                    availableWorker.busy = false;
                    availableWorker.worker.removeEventListener('message', handleMessage);
                    resolve();
                }
            };
            
            availableWorker.worker.addEventListener('message', handleMessage);
            // Send photo data to worker (client-side processing only)
            availableWorker.worker.postMessage(photo);
        });
        
        // Don't wait for this promise, continue sending work to other workers
        promise.catch(err => console.error('Error processing photo:', err));
    }
    
    // Wait for all workers to finish
    console.log('⏳ Waiting for all workers to finish...');
    while (embeddingWorkers.some(w => w.busy)) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    isProcessingEmbeddings = false;
    updatePauseResumeButton();
    
    if (embeddingQueue.length === 0) {
        updateStatus('All photos processed!', false);
        console.log('✅ Embedding queue empty - all photos processed');
    } else if (isEmbeddingPaused) {
        updateStatus(`Paused - ${embeddingQueue.length} photos remaining in queue`, false);
        console.log('⏸️ Paused - photos remain in queue:', embeddingQueue.length);
    }
}

// Old processPhotosWithWorkers function removed - now using persistent workers

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
            scopeDescription = `current folder: ${pathToDisplayName(currentPath)}`;
        }
        
        console.log(`📊 Analysis scope: ${scopeDescription}, found ${allPhotos.length} photos with embeddings`);
        
        if(allPhotos.length === 0) {
            const totalIndexed = await db.getPhotoCount();
            const needEmbeddings = await db.getPhotosWithoutEmbedding();
            updateStatus(`No photos with embeddings found in ${scopeDescription}. Total indexed: ${totalIndexed}, Need embeddings: ${needEmbeddings.length}`, false);
            console.warn(`⚠️ No photos with embeddings. Total photos: ${totalIndexed}, Without embeddings: ${needEmbeddings.length}`);
            startAnalysisButton.disabled = false;
            return;
        }

        // Apply filters (date range only, folder filter handled by scope)
        const dateFilter = getDateFilter();
        let filteredPhotos = allPhotos;
        
        if (dateFilter) {
            console.log(`📅 Date filter active: ${new Date(dateFilter.from).toLocaleDateString()} to ${new Date(dateFilter.to).toLocaleDateString()}`);
            const beforeFilter = filteredPhotos.length;
            filteredPhotos = filteredPhotos.filter(photo => {
                const photoDate = photo.photo_taken_ts || photo.last_modified;
                if (!photoDate) return false;
                
                const photoTime = new Date(photoDate).getTime();
                
                if (dateFilter.from && photoTime < dateFilter.from) return false;
                if (dateFilter.to && photoTime > dateFilter.to) return false;
                
                return true;
            });
            console.log(`📅 Date filter: ${beforeFilter} photos → ${filteredPhotos.length} photos (filtered out ${beforeFilter - filteredPhotos.length})`);
        } else {
            console.log(`📅 No date filter applied`);
        }
        
        if(filteredPhotos.length === 0) {
            updateStatus(`No photos match the current filters in ${scopeDescription}. Try disabling date filter or adjusting date range.`, false);
            console.warn(`⚠️ All photos filtered out! Check date filter settings.`);
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
            
            console.log(`🔍 Found ${similarGroups.length} similar groups (before min size filter)`);
            
            // Filter groups by minimum size
            const totalGroupsFound = similarGroups.length;
            similarGroups = similarGroups.filter(group => group.photos.length >= minGroupSize);
            const filteredOutCount = totalGroupsFound - similarGroups.length;
            
            console.log(`🔍 After min size filter (≥${minGroupSize}): ${similarGroups.length} groups (filtered out ${filteredOutCount} small groups)`);

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
            displayAnalysisResults(similarGroups, 'similarity');
            
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

async function runSeriesAnalysisForScope(scope) {
    startSeriesAnalysisButton.disabled = true;
    updateStatus('Analyzing photos for large series... this may take a moment.', true, 0, 100);
    
    try {
        let allPhotos;
        let scopeDescription;
        
        if (scope === 'all') {
            // Get ALL photos from IndexedDB (embeddings not required!)
            allPhotos = await db.getAllPhotos();
            scopeDescription = 'all indexed photos';
        } else {
            // Get photos from current folder only
            const currentPath = selectedFolderPath || '/drive/root:';
            allPhotos = await db.getAllPhotosFromFolder(currentPath);
            scopeDescription = `current folder: ${pathToDisplayName(currentPath)}`;
        }
        
        console.log(`📊 Series analysis scope: ${scopeDescription}, found ${allPhotos.length} photos`);
        
        if(allPhotos.length === 0) {
            updateStatus(`No photos found in ${scopeDescription}. Please scan photos first.`, false);
            startSeriesAnalysisButton.disabled = false;
            return;
        }

        // Apply date filter
        const dateFilter = getDateFilter();
        let filteredPhotos = allPhotos;
        
        if (dateFilter) {
            console.log(`📅 Date filter active: ${new Date(dateFilter.from).toLocaleDateString()} to ${new Date(dateFilter.to).toLocaleDateString()}`);
            const beforeFilter = filteredPhotos.length;
            filteredPhotos = filteredPhotos.filter(photo => {
                const photoDate = photo.photo_taken_ts || photo.last_modified;
                if (!photoDate) return false;
                
                const photoTime = new Date(photoDate).getTime();
                
                if (dateFilter.from && photoTime < dateFilter.from) return false;
                if (dateFilter.to && photoTime > dateFilter.to) return false;
                
                return true;
            });
            console.log(`📅 Date filter: ${beforeFilter} photos → ${filteredPhotos.length} photos (filtered out ${beforeFilter - filteredPhotos.length})`);
        }
        
        if(filteredPhotos.length === 0) {
            updateStatus(`No photos match the current date filter in ${scopeDescription}. Try adjusting the date range.`, false);
            startSeriesAnalysisButton.disabled = false;
            return;
        }

        // Get analysis settings
        const minGroupSize = await getSeriesMinGroupSize();
        const minDensity = await getSeriesMinDensity();
        const maxTimeGap = await getSeriesMaxTimeGap();
        const sortMethod = await getSortMethod();
        
        // Show filter summary
        let filterSummary = `Analyzing ${filteredPhotos.length} photos from ${scopeDescription}`;
        if (dateFilter) {
            const fromStr = dateFilter.from ? new Date(dateFilter.from).toLocaleDateString() : 'start';
            const toStr = dateFilter.to ? new Date(dateFilter.to).toLocaleDateString() : 'end';
            filterSummary += ` (filtered by date: ${fromStr} to ${toStr})`;
        }
        filterSummary += ` • Min size: ${minGroupSize}, Min density: ${minDensity} photos/min`;
        
        updateStatus(filterSummary, true, 25, 100);

        // Run series analysis
        const seriesGroups = await findPhotoSeries(filteredPhotos, {
            minGroupSize,
            minDensity,
            maxTimeGap,
            sortMethod
        }, (progress) => {
            updateStatus(`Finding series... ${progress.toFixed(0)}% complete.`, true, 25 + (progress * 0.75), 100);
        });
        
        console.log(`📊 Found ${seriesGroups.length} large photo series`);

        // Display results immediately
        displayAnalysisResults(seriesGroups, 'series');
        
        // Show final status
        updateStatus(`Series analysis complete! Found ${seriesGroups.length} large photo series.`, false);
        startSeriesAnalysisButton.disabled = false;

        // Scroll to results
        const resultsPanel = document.querySelector('[data-panel-key="results"]');
        if (resultsPanel) {
            resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

    } catch (error) {
        console.error('Series analysis failed:', error);
        updateStatus(`Error during series analysis: ${error.message}`, false);
        startSeriesAnalysisButton.disabled = false;
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
        
        // Ensure timeSpan is a valid number (0 = disabled, 1-24 = hours)
        const validTimeSpan = (!isNaN(timeSpan) && timeSpan >= 0 && timeSpan <= 24) ? timeSpan : 8;
        
        timeSpanSlider.value = validTimeSpan;
        timeSpanValueDisplay.textContent = validTimeSpan === 0 ? 'Disabled (compare all)' : `${validTimeSpan} hours`;
        
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
        
        // Initialize series analysis settings
        if (seriesMinGroupSizeSlider && seriesMinGroupSizeValueDisplay) {
            const savedSeriesMinGroupSize = await db.getSetting('seriesMinGroupSize');
            const seriesMinGroupSize = savedSeriesMinGroupSize !== null ? Number(savedSeriesMinGroupSize) : 20;
            const validSeriesMinGroupSize = (!isNaN(seriesMinGroupSize) && seriesMinGroupSize >= 5 && seriesMinGroupSize <= 100) ? seriesMinGroupSize : 20;
            
            seriesMinGroupSizeSlider.value = validSeriesMinGroupSize;
            seriesMinGroupSizeValueDisplay.textContent = `${validSeriesMinGroupSize} photos`;
            
            if (savedSeriesMinGroupSize === null) {
                await db.setSetting('seriesMinGroupSize', validSeriesMinGroupSize);
            }
        }
        
        if (seriesMinDensitySlider && seriesMinDensityValueDisplay) {
            const savedSeriesMinDensity = await db.getSetting('seriesMinDensity');
            const seriesMinDensity = savedSeriesMinDensity !== null ? Number(savedSeriesMinDensity) : 3;
            const validSeriesMinDensity = (!isNaN(seriesMinDensity) && seriesMinDensity >= 0.5 && seriesMinDensity <= 10) ? seriesMinDensity : 3;
            
            seriesMinDensitySlider.value = validSeriesMinDensity;
            seriesMinDensityValueDisplay.textContent = `${validSeriesMinDensity.toFixed(1)} photos/min`;
            
            if (savedSeriesMinDensity === null) {
                await db.setSetting('seriesMinDensity', validSeriesMinDensity);
            }
        }
        
        if (seriesTimeGapSlider && seriesTimeGapValueDisplay) {
            const savedSeriesTimeGap = await db.getSetting('seriesMaxTimeGap');
            const seriesTimeGap = savedSeriesTimeGap !== null ? Number(savedSeriesTimeGap) : 5;
            const validSeriesTimeGap = (!isNaN(seriesTimeGap) && seriesTimeGap >= 1 && seriesTimeGap <= 60) ? seriesTimeGap : 5;
            
            seriesTimeGapSlider.value = validSeriesTimeGap;
            seriesTimeGapValueDisplay.textContent = `${validSeriesTimeGap} minutes`;
            
            if (savedSeriesTimeGap === null) {
                await db.setSetting('seriesMaxTimeGap', validSeriesTimeGap);
            }
        }
        
        console.log('Series analysis settings initialized');
        
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

// Series analysis settings getters
async function getSeriesMinGroupSize() {
    try {
        const minGroupSize = await db.getSetting('seriesMinGroupSize');
        return minGroupSize !== null ? minGroupSize : 20;
    } catch (error) {
        console.error('Error getting series min group size:', error);
        return 20;
    }
}

async function getSeriesMinDensity() {
    try {
        const minDensity = await db.getSetting('seriesMinDensity');
        return minDensity !== null ? minDensity : 3;
    } catch (error) {
        console.error('Error getting series min density:', error);
        return 3;
    }
}

async function getSeriesMaxTimeGap() {
    try {
        const maxTimeGap = await db.getSetting('seriesMaxTimeGap');
        return maxTimeGap !== null ? maxTimeGap : 5;
    } catch (error) {
        console.error('Error getting series max time gap:', error);
        return 5;
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
        
        // Initialize auto-start embeddings setting
        const autoStartSetting = await db.getSetting('autoStartEmbeddings');
        if (autoStartEmbeddingsCheckbox) {
            autoStartEmbeddingsCheckbox.checked = autoStartSetting !== false; // Default to true
        }
        
        // Initialize pause/resume button state
        updatePauseResumeButton();
        
        // Restore folder selection from URL if present
        await restoreFiltersFromURL();
        
        // Restore similar photos view from URL if present
        await restoreSimilarPhotosFromURL();
    }

    // STEP 4: Add event listeners now that MSAL is ready
    loginButton.addEventListener('click', handleLoginClick);
    
    // Clear database button
    if (clearDatabaseButton) {
        clearDatabaseButton.addEventListener('click', async () => {
            const photoCount = await db.getPhotoCount();
            
            if (photoCount === 0) {
                alert('Database is already empty.');
                return;
            }
            
            const confirmation = confirm(
                `⚠️ WARNING: This will permanently delete all ${photoCount} indexed photos and embeddings from your local database.\n\n` +
                `Your photos on OneDrive will NOT be affected.\n\n` +
                `Are you sure you want to continue?`
            );
            
            if (!confirmation) return;
            
            // Double confirmation for safety
            const doubleConfirmation = confirm(
                `Are you absolutely sure? This action cannot be undone.\n\n` +
                `Type "yes" in the next prompt to confirm.`
            );
            
            if (!doubleConfirmation) return;
            
            const finalConfirm = prompt('Type "yes" to confirm database clear:');
            
            if (finalConfirm !== 'yes') {
                alert('Database clear cancelled.');
                return;
            }
            
            try {
                clearDatabaseButton.disabled = true;
                clearDatabaseButton.textContent = '⏳ Clearing...';
                updateStatus('Clearing database...', false);
                
                // Stop any running workers
                if (isProcessingEmbeddings) {
                    pauseEmbeddingWorkers();
                }
                
                // Clear the queue
                embeddingQueue = [];
                updatePauseResumeButton();
                
                // Clear all photos from database
                await db.clearAllPhotos();
                
                // Clear results display
                currentResultsType = null;
                currentAnalysisResults = null;
                if (resultsTypeLabel) {
                    resultsTypeLabel.textContent = 'No results yet';
                }
                resultsContainer.innerHTML = '<p class="placeholder">Run similarity analysis or series analysis to see results here.</p>';
                
                // Clear similar photos panel
                clearSimilarPhotosSearch();
                
                // Clear browser grid
                if (browserPhotoGrid) {
                    browserPhotoGrid.innerHTML = '<div class="empty-note">Database cleared. Browse folders to re-index photos.</div>';
                }
                
                updateStatus(`Database cleared successfully. ${photoCount} photos removed.`, false);
                alert(`Database cleared successfully!\n\n${photoCount} photos and embeddings removed from local database.`);
                
            } catch (error) {
                console.error('Failed to clear database:', error);
                updateStatus(`Error clearing database: ${error.message}`, false);
                alert(`Failed to clear database: ${error.message}`);
            } finally {
                clearDatabaseButton.disabled = false;
                clearDatabaseButton.textContent = '🗑️ Clear All Photos from Database';
            }
        });
    }
    
    // Auto-start embeddings checkbox
    if (autoStartEmbeddingsCheckbox) {
        autoStartEmbeddingsCheckbox.addEventListener('change', async () => {
            const enabled = autoStartEmbeddingsCheckbox.checked;
            await db.setSetting('autoStartEmbeddings', enabled);
            console.log(`Auto-start embeddings: ${enabled ? 'enabled' : 'disabled'}`);
        });
    }
    
    // Pause/Resume embeddings button
    if (pauseResumeEmbeddingsBtn) {
        pauseResumeEmbeddingsBtn.addEventListener('click', async () => {
            if (isEmbeddingPaused) {
                await resumeEmbeddingWorkers();
            } else if (isProcessingEmbeddings) {
                pauseEmbeddingWorkers();
            } else {
                // Start workers
                await startEmbeddingWorkers();
            }
        });
    }
    
    // Analysis button: analyze all indexed photos
    startAnalysisButton.addEventListener('click', async () => {
        await runAnalysisForScope('all');
        // Scroll to results section
        const resultsPanel = document.querySelector('[data-panel-key="results"]');
        if (resultsPanel) {
            resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
    
    // Filter control event listeners
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
        timeSpanValueDisplay.textContent = value === 0 ? 'Disabled (compare all)' : `${value} hours`;
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
            // Re-sort existing results if available
            if (currentAnalysisResults && currentAnalysisResults.length > 0) {
                sortAnalysisResults(value);
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
    
    // Series analysis event listeners
    if (startSeriesAnalysisButton) {
        startSeriesAnalysisButton.addEventListener('click', async () => {
            await runSeriesAnalysisForScope('all');
            // Scroll to results section
            const seriesResultsPanel = document.querySelector('[data-panel-key="series-results"]');
            if (seriesResultsPanel) {
                seriesResultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }
    
    if (seriesMinGroupSizeSlider) {
        seriesMinGroupSizeSlider.addEventListener('input', async (e) => {
            const value = parseInt(e.target.value);
            seriesMinGroupSizeValueDisplay.textContent = `${value} photos`;
            await db.setSetting('seriesMinGroupSize', value);
        });
    }
    
    if (seriesMinDensitySlider) {
        seriesMinDensitySlider.addEventListener('input', async (e) => {
            const value = parseFloat(e.target.value);
            seriesMinDensityValueDisplay.textContent = `${value.toFixed(1)} photos/min`;
            await db.setSetting('seriesMinDensity', value);
        });
    }
    
    if (seriesTimeGapSlider) {
        seriesTimeGapSlider.addEventListener('input', async (e) => {
            const value = parseInt(e.target.value);
            seriesTimeGapValueDisplay.textContent = `${value} minutes`;
            await db.setSetting('seriesMaxTimeGap', value);
        });
    }
    
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
    if (browserScanBtn) {
        browserScanBtn.addEventListener('click', async () => {
            try {
                const path = selectedFolderPath || '/drive/root:';
                browserScanBtn.disabled = true;
                browserScanBtn.textContent = '⏳ Scanning...';
                
                await runPhotoScan(path);
                
                browserScanBtn.disabled = false;
                browserScanBtn.textContent = '🔍 Scan This Folder';
            } catch (e) {
                console.error('Failed to scan folder', e);
                browserScanBtn.disabled = false;
                browserScanBtn.textContent = '🔍 Scan This Folder';
            }
        });
    }
    if (browserAnalyzeBtn) {
        browserAnalyzeBtn.addEventListener('click', async () => {
            await runAnalysisForScope('current');
            // Scroll to results section
            const resultsPanel = document.querySelector('[data-panel-key="results"]');
            if (resultsPanel) {
                resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }
    
    // Similar photos functionality event listeners
    if (modalFindSimilarBtn) {
        modalFindSimilarBtn.addEventListener('click', handleFindSimilarClick);
    }
    if (modalViewInFolderBtn) {
        modalViewInFolderBtn.addEventListener('click', viewPhotoInFolder);
    }
    
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
    
    // Initialize image modal handlers
    initializeImageModal();

    // Initialize backup panel
    await initializeBackupPanel();
    // Initial browser photo grid load (if logged in and a folder is selected)
    try { 
        updateBrowserCurrentPath();
        await renderBrowserPhotoGrid(); 
    } catch {}
    
    // Cleanup workers on page unload
    window.addEventListener('beforeunload', () => {
        if (workersInitialized) {
            terminateWorkers();
        }
    });
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

// Update browser current path display with clickable breadcrumbs
function updateBrowserCurrentPath() {
    if (!browserCurrentPath) return;
    
    // Clear current content
    browserCurrentPath.innerHTML = '';
    
    // Parse the current path
    const path = selectedFolderPath || '/drive/root:';
    const pathParts = path.replace('/drive/root:', '').split('/').filter(part => part.length > 0);
    
    // Create clickable breadcrumb for root
    const rootLink = document.createElement('span');
    rootLink.className = 'breadcrumb-item';
    rootLink.textContent = 'OneDrive';
    rootLink.style.cursor = 'pointer';
    rootLink.style.color = 'var(--primary-color, #0078d4)';
    rootLink.addEventListener('click', async () => {
        selectedFolderId = 'root';
        selectedFolderPath = '/drive/root:';
        selectedFolderDisplayName = 'OneDrive (Root)';
        updateURLWithPath(selectedFolderPath);
        updateBrowserCurrentPath();
        await renderBrowserPhotoGrid(true);
    });
    browserCurrentPath.appendChild(rootLink);
    
    // Add each path segment as clickable breadcrumb
    for (let i = 0; i < pathParts.length; i++) {
        // Add separator
        const separator = document.createElement('span');
        separator.textContent = ' / ';
        separator.style.color = '#666';
        browserCurrentPath.appendChild(separator);
        
        // Add breadcrumb item
        const breadcrumbItem = document.createElement('span');
        breadcrumbItem.className = 'breadcrumb-item';
        breadcrumbItem.textContent = pathParts[i];
        
        // Last item is current folder (not clickable)
        if (i === pathParts.length - 1) {
            breadcrumbItem.style.color = '#fff';
            breadcrumbItem.style.fontWeight = 'bold';
        } else {
            // Parent folders are clickable
            breadcrumbItem.style.cursor = 'pointer';
            breadcrumbItem.style.color = 'var(--primary-color, #0078d4)';
            
            // Create click handler with closure to capture correct path
            const targetPath = '/drive/root:/' + pathParts.slice(0, i + 1).join('/');
            breadcrumbItem.addEventListener('click', async () => {
                try {
                    // Find folder ID for this path
                    const folderId = await findFolderIdByPath(targetPath);
                    if (folderId) {
                        selectedFolderId = folderId;
                        selectedFolderPath = targetPath;
                        selectedFolderDisplayName = pathToDisplayName(targetPath);
                        updateURLWithPath(selectedFolderPath);
                        updateBrowserCurrentPath();
                        await renderBrowserPhotoGrid(true);
                    }
                } catch (error) {
                    console.error('Error navigating to breadcrumb:', error);
                }
            });
            
            // Add hover effect
            breadcrumbItem.addEventListener('mouseenter', () => {
                breadcrumbItem.style.textDecoration = 'underline';
            });
            breadcrumbItem.addEventListener('mouseleave', () => {
                breadcrumbItem.style.textDecoration = 'none';
            });
        }
        
        browserCurrentPath.appendChild(breadcrumbItem);
    }
    
    // If at root with no subfolders, show "(Root)"
    if (pathParts.length === 0) {
        const rootLabel = document.createElement('span');
        rootLabel.textContent = ' (Root)';
        rootLabel.style.color = '#999';
        browserCurrentPath.appendChild(rootLabel);
    }
}


// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    // DOM is already ready
    main();
}