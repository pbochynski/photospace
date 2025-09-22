import { msalInstance, login, getAuthToken } from './lib/auth.js';
import { fetchAllPhotos, fetchFolders, getFolderInfo, getFolderPath, fetchPhotosFromSingleFolder } from './lib/graph.js';
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
const startAnalysisButton = document.getElementById('start-analysis-button');
const resultsContainer = document.getElementById('results-container');

// Folder selector elements
const selectedFolderInput = document.getElementById('selected-folder');
const browseFolderBtn = document.getElementById('browse-folder-btn');
const clearFolderBtn = document.getElementById('clear-folder-btn');

// Embedding options
const forceReprocessCheckbox = document.getElementById('force-reprocess-checkbox');

// Analysis options
const similarityThresholdSlider = document.getElementById('similarity-threshold');
const thresholdValueDisplay = document.getElementById('threshold-value');
const timeSpanSlider = document.getElementById('time-span');
const timeSpanValueDisplay = document.getElementById('time-span-value');
const sortMethodSelect = document.getElementById('sort-method');
const workerCountSlider = document.getElementById('worker-count');
const workerCountValueDisplay = document.getElementById('worker-count-value');

// Date filter elements
const dateFromInput = document.getElementById('date-from');
const dateToInput = document.getElementById('date-to');
const clearDateBtn = document.getElementById('clear-date-btn');

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
    
    // Update date range
    const dateFrom = dateFromInput.value;
    const dateTo = dateToInput.value;
    
    if (dateFrom) {
        url.searchParams.set('dateFrom', dateFrom);
    } else {
        url.searchParams.delete('dateFrom');
    }
    
    if (dateTo) {
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
    
    if (dateFilters.dateFrom || dateFilters.dateTo) {
        // Restore from URL
        dateFromInput.value = dateFilters.dateFrom || '';
        dateToInput.value = dateFilters.dateTo || '';
    } else {
        // Set default to last month
        setDefaultDateRange();
    }
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
                selectedFolderInput.value = formatPathForUser(pathFromURL) || 'All folders';
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
    selectedFolderInput.value = 'All folders';
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
    const userInput = selectedFolderInput.value;
    
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
                selectedFolderInput.value = selectedFolderPath ? formatPathForUser(selectedFolderPath) : 'All folders';
            }, 100);
        }
    } catch (error) {
        console.error('Error validating folder path:', error);
        updateStatus('Error validating folder path', false);
    }
}

function clearDateFilter() {
    dateFromInput.value = '';
    dateToInput.value = '';
    updateURLWithFilters();
    updateStatus('Date filter cleared', false);
}

function getDateFilter() {
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

function displayLoggedIn(account) {
    loginButton.style.display = 'none';
    userInfo.textContent = `Welcome, ${account.name}`;
    userInfo.style.display = 'block';
    mainContent.style.display = 'block';
    updateStatus('Ready. Click "Scan OneDrive Photos" to begin.');
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
    selectedFolderInput.value = formatPathForUser(selectedFolderPath) || 'All folders';
    updateStatus(`Selected folder: ${selectedFolderDisplayName}`, false);
    hideFolderBrowser();
}

async function runPhotoScan() {
    // For scanning, use selected folder or default to root
    const scanFolderId = selectedFolderId || 'root';
    const scanFolderPath = selectedFolderPath || '/drive/root:';
    const scanFolderDisplayName = selectedFolderDisplayName || 'OneDrive (Root)';
    
    startScanButton.disabled = true;
    startEmbeddingButton.disabled = true;

    try {
        // --- STEP 1: Generate a new scan ID ---
        const newScanId = Date.now();
        console.log(`Starting new scan with ID: ${newScanId} in folder: ${scanFolderDisplayName}`);
        updateStatus(`Scanning ${scanFolderDisplayName} for photos...`, true, 0, 100);

        // --- STEP 2: Crawl OneDrive starting from selected folder ---
        await fetchAllPhotos(newScanId, (progress) => {
            updateStatus(`Scanning... Found ${progress.count} photos so far.`, true, 0, 100);
        }, scanFolderId);
        
        // --- STEP 3: Clean up files that were not touched (i.e., deleted from OneDrive) ---
        updateStatus('Cleaning up deleted files...', true, 0, 100);
        // await db.deletePhotosNotMatchingScanId(newScanId);
        
        const totalPhotos = await db.getPhotoCount();
        updateStatus(`Scan complete. Total photos: ${totalPhotos}. Now generating embeddings for new files...`, true, 0, totalPhotos);
        
        // --- STEP 4: Generate embeddings for only the new files ---
        // generateEmbeddings() will automatically find files with embedding_status = 0
        await generateEmbeddings(scanFolderPath, false); // Never force reprocess during scan

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
            displayLoggedIn(account);
            await db.init();
            // Initialize analysis settings UI after login
            await initializeAnalysisSettings();
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

async function runAnalysis() {
    startAnalysisButton.disabled = true;
    updateStatus('Analyzing photos... this may take a few minutes.', true, 0, 100);
    try {
        // Get all photos from database (no folder filter here)
        const allPhotos = await db.getAllPhotosWithEmbedding();
        
        if(allPhotos.length === 0) {
            updateStatus('No photos with embeddings found to analyze.', false);
            startAnalysisButton.disabled = false;
            return;
        }

        // Apply filters (folder and date range)
        const filteredPhotos = applyFilters(allPhotos);
        
        if(filteredPhotos.length === 0) {
            updateStatus('No photos match the current filters.', false);
            startAnalysisButton.disabled = false;
            return;
        }

        // Show filter summary
        const dateFilter = getDateFilter();
        let filterSummary = `Analyzing ${filteredPhotos.length} photos`;
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
        
        updateStatus(filterSummary, true, 25, 100);

        setTimeout(async () => {
            // Get the current analysis settings
            const similarityThreshold = await getSimilarityThreshold();
            const timeSpanHours = await getTimeSpanHours();
            const sortMethod = await getSortMethod();
            
            let similarGroups = await findSimilarGroups(filteredPhotos, (progress) => {
                updateStatus(`Finding groups... ${progress.toFixed(0)}% complete.`, true, 25 + (progress * 0.5), 100);
            }, similarityThreshold, timeSpanHours, sortMethod);

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
            updateStatus('Analysis complete!', false);
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
async function initializeAnalysisSettings() {
    try {
        // Check if DOM elements are available
        if (!similarityThresholdSlider || !thresholdValueDisplay || !timeSpanSlider || !timeSpanValueDisplay || !sortMethodSelect || !workerCountSlider || !workerCountValueDisplay) {
            console.warn('Some DOM elements not found, skipping analysis settings initialization');
            return;
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
        
        // Initialize sort method
        const savedSortMethod = await db.getSetting('sortMethod');
        const sortMethod = savedSortMethod !== null ? savedSortMethod : 'group-size'; // Default to group size
        
        sortMethodSelect.value = sortMethod;
        
        // Save default if no setting exists
        if (savedSortMethod === null) {
            await db.setSetting('sortMethod', sortMethod);
        }
        
        // Initialize worker count
        const savedWorkerCount = await db.getSetting('workerCount');
        const workerCount = savedWorkerCount !== null ? Number(savedWorkerCount) : 4; // Default to 4 workers
        
        // Ensure workerCount is a valid number
        const validWorkerCount = (!isNaN(workerCount) && workerCount >= 1 && workerCount <= 8) ? workerCount : 4;
        
        workerCountSlider.value = validWorkerCount;
        workerCountValueDisplay.textContent = `${validWorkerCount} worker${validWorkerCount === 1 ? '' : 's'}`;
        
        // Save default if no setting exists
        if (savedWorkerCount === null) {
            await db.setSetting('workerCount', validWorkerCount);
        }
    } catch (error) {
        console.error('Error initializing analysis settings:', error);
        // Set default values if database fails
        similarityThresholdSlider.value = 0.90;
        thresholdValueDisplay.textContent = '0.90';
        timeSpanSlider.value = 8;
        timeSpanValueDisplay.textContent = '8 hours';
        sortMethodSelect.value = 'group-size';
        workerCountSlider.value = 4;
        workerCountValueDisplay.textContent = '4 workers';
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
        const sortMethod = await db.getSetting('sortMethod');
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
        displayLoggedIn(accounts[0]);
        await db.init();
        
        // Initialize analysis settings UI
        await initializeAnalysisSettings();
        
        // Restore folder selection from URL if present
        await restoreFiltersFromURL();
    }

    // STEP 4: Add event listeners now that MSAL is ready
    loginButton.addEventListener('click', handleLoginClick);
    browseFolderBtn.addEventListener('click', () => showFolderBrowser());
    startScanButton.addEventListener('click', handleScanClick);
    startEmbeddingButton.addEventListener('click', runEmbeddingGeneration);
    startAnalysisButton.addEventListener('click', runAnalysis);
    
    // Filter control event listeners
    clearFolderBtn.addEventListener('click', clearFolderFilter);
    clearDateBtn.addEventListener('click', clearDateFilter);
    dateFromInput.addEventListener('change', updateURLWithFilters);
    dateToInput.addEventListener('change', updateURLWithFilters);
    
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
    
    // Sort method control event listeners
    sortMethodSelect.addEventListener('change', async (e) => {
        const value = e.target.value;
        await db.setSetting('sortMethod', value);
    });
    
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
    selectedFolderInput.addEventListener('blur', handleFolderInputChange);
    selectedFolderInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleFolderInputChange();
        }
    });
    
    // Folder selector event listeners
    browseFolderBtn.addEventListener('click', () => showFolderBrowser());
    
    // Folder browser event listeners
    folderModalClose.addEventListener('click', hideFolderBrowser);
    cancelFolderBtn.addEventListener('click', hideFolderBrowser);
    selectFolderBtn.addEventListener('click', selectCurrentFolder);
    folderUpBtn.addEventListener('click', navigateUp);
    folderRefreshBtn.addEventListener('click', () => loadFolders(currentBrowsingFolderId));
    
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
    
    // Initialize backup panel
    await initializeBackupPanel();
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

// Start the application
main();