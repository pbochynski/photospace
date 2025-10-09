import { msalInstance, login, logout, getAuthToken } from './lib/auth.js';
import { fetchAllPhotos, fetchFolders, getFolderInfo, getFolderPath, fetchFolderChildren } from './lib/graph.js';
import { db } from './lib/db.js';
import { findSimilarGroups, pickBestPhotoByQuality, findPhotoSeries } from './lib/analysis.js';
import { exportEmbeddingsToOneDrive, getLastExportInfo, estimateExportSize } from './lib/embeddingExport.js';
import { importEmbeddingsFromOneDrive, listAvailableEmbeddingFiles, deleteEmbeddingFileFromOneDrive, getLastImportInfo, getEmbeddingFileMetadata } from './lib/embeddingImport.js';
import { initializeDebugConsole } from './lib/debugConsole.js';
import { EmbeddingProcessor } from './lib/embedding-processor.js';

// Initialize debug console (also sets window.debugConsole for worker access)
const debugConsole = initializeDebugConsole();

// Initialize embedding processor (will be configured after DOM elements are loaded)
let embeddingProcessor = null;

// --- DOM Elements (will be initialized in main()) ---
let loginButton, logoutButton, userInfo, userInfoContainer, mainContent;
let statusText, progressBar, pauseResumeEmbeddingsBtn, clearDatabaseButton;
let startAnalysisButton, resultsContainer;
let startSeriesAnalysisButton, seriesMinGroupSizeSlider, seriesMinGroupSizeValueDisplay;
let seriesMinDensitySlider, seriesMinDensityValueDisplay, seriesTimeGapSlider, seriesTimeGapValueDisplay;
let resultsTypeLabel, browserPhotoGrid, browserSortSelect, browserRefreshBtn, browserUpBtn;
let browserScanBtn, browserAnalyzeBtn, browserCurrentPath, browserToggleSelectBtn, browserDeleteSelectedBtn;
let similarityThresholdSlider, thresholdValueDisplay, timeSpanSlider, timeSpanValueDisplay;
let minGroupSizeSlider, minGroupSizeValueDisplay, resultsSortSelect, workerCountSlider, workerCountValueDisplay;
let scanQueueFoldersSpan, scanQueueDbCountSpan, scanQueueDetailsDiv, scanQueueListDiv;
let dateFromInput, dateToInput, dateEnabledToggle;
let exportEmbeddingsBtn, importEmbeddingsBtn, exportInfo, importInfo, embeddingFilesList, fileListContainer;
let importModal, importModalClose, importLoading, importFileSelection, importFileList, importOptions;
let conflictStrategySelect, confirmImportBtn, cancelImportBtn, importProgress, importProgressBar;
let importStatus, importResults, importSummary, closeImportBtn;
let modalFindSimilarBtn, modalViewInFolderBtn;

let embeddingWorker = null;
let selectedFolderId = null; // null means no folder filter (all folders)
let selectedFolderPath = null; // null means no folder filter
let selectedFolderDisplayName = 'All folders'; // Display for no filter
let currentModalPhoto = null; // Track the photo currently displayed in modal
let currentResultsType = null; // Track current results type ('similarity', 'series', or 'similar-to')
let currentReferencePhoto = null; // Track reference photo for similar-to searches
let currentAnalysisResults = null; // Store current analysis results for re-sorting
let isAutoIndexing = false; // Flag to prevent overlapping auto-indexing operations

// Folder scan queue management
const MAX_CONCURRENT_FOLDER_SCANS = 5; // Maximum folders to scan in parallel
let folderScanQueue = []; // Queue of folder paths to scan
let activeFolderScans = new Set(); // Currently scanning folders
let isScanQueueProcessorRunning = false; // Track if processor is running

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
    // Status panel was removed - just log to console for debugging
    console.log(`[Status] ${text}`);
    
    // Legacy support for any code still referencing these elements
    if (statusText) statusText.textContent = text;
    if (progressBar) {
        if (showProgress) {
            progressBar.style.display = 'block';
            progressBar.value = progressValue;
            progressBar.max = progressMax;
        } else {
            progressBar.style.display = 'none';
        }
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

/**
 * Display a photo in the modal viewer
 * @param {Object} photo - Photo object with file_id and metadata
 * @param {string} thumbnailSrc - Thumbnail URL for quick display
 */
async function displayPhotoInModal(photo, thumbnailSrc) {
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-img');
    
    currentModalPhoto = photo;
    populateImageMetadata(photo);
    
    if (photo.file_id) {
        await initializeServiceWorkerToken();
        modalImg.src = thumbnailSrc;
        modal.style.display = 'flex';
        await loadFullSizeImage(photo.file_id, modalImg, thumbnailSrc);
    } else {
        modalImg.src = thumbnailSrc;
        modal.style.display = 'flex';
    }
}

/**
 * Delete a photo from OneDrive and local database
 * @param {string} fileId - The file ID to delete
 * @returns {Promise<boolean>} - Success status
 */
async function deletePhotoFromOneDrive(fileId) {
    const token = await getAuthToken();
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!response.ok) {
        throw new Error(`Failed to delete: ${response.status} ${response.statusText}`);
    }
    
    await db.deletePhotos([fileId]);
    return true;
}

/**
 * Delete multiple photos with confirmation
 * @param {Array<Object>} photos - Photos to delete
 * @param {Function} onSuccess - Callback after successful deletion
 * @returns {Promise<void>}
 */
async function deletePhotosWithConfirmation(photos, onSuccess) {
    if (photos.length === 0) {
        alert('No photos selected for deletion.');
        return;
    }
    
    const photoName = photos.length === 1 ? photos[0].name : null;
    const confirmMessage = photos.length === 1 
        ? `Delete "${photoName}"? This cannot be undone.`
        : `Delete ${photos.length} photo(s)? This cannot be undone.`;
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    updateStatus(`Deleting ${photos.length} photo(s)...`, true);
    
    try {
        for (const photo of photos) {
            await deletePhotoFromOneDrive(photo.file_id);
        }
        
        if (onSuccess) {
            onSuccess();
        }
        
        const successMessage = photos.length === 1 
            ? `Photo "${photoName}" deleted successfully`
            : `${photos.length} photos deleted successfully`;
        updateStatus(successMessage, false);
    } catch (err) {
        updateStatus('Error deleting photos: ' + err.message, false);
        throw err;
    }
}

async function displayLoggedIn(account) {
    loginButton.style.display = 'none';
    userInfo.textContent = `Welcome, ${account.name}`;
    userInfoContainer.style.display = 'flex';
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
                </label>
                <img src="${thumbnailSrc}" data-file-id="${photo.file_id}" data-photo-idx="${idx}" alt="${photo.name || ''}" loading="lazy">
                <div class="photo-info">
                    <div class="similarity-score">Similarity: ${similarityPercent}%</div>
                    <div class="photo-path">${photo.path ? photo.path.replace('/drive/root:', '') || '/' : ''}</div>
                    <div class="photo-name">${photo.name || 'Untitled'}</div>
                </div>
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
            photoInfo += `<div class="photo-name">${p.name || 'Untitled'}</div>`;
            if (type === 'series') {
                photoInfo += `<div class="photo-time">${new Date(p.photo_taken_ts).toLocaleTimeString()}</div>`;
            }
            
            photoItem.innerHTML = `
                <label class="photo-checkbox-label">
                    <input type="checkbox" class="photo-checkbox" data-group-idx="${groupIdx}" data-photo-idx="${idx}" ${type === 'similarity' && idx === 0 ? '' : 'checked'}>
                    <span class="photo-checkbox-custom"></span>
                </label>
                <img src="${thumbnailSrc}" data-file-id="${p.file_id}" alt="${p.name || ''}" loading="lazy">
                <div class="photo-info">${photoInfo}</div>
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
            
            await deletePhotosWithConfirmation(selectedPhotos, () => {
                // Update group photos
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
            });
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
            
            await displayPhotoInModal(photo, img.src);
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
                        thumbnail_url: null,
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
                // add them to queue
                if (photosNeedingEmbeddings.length === 0 && allNeedEmbeddings.length > 0) {
                    console.log(`📥 Current folder already processed, adding ${allNeedEmbeddings.length} other photos to queue`);
                    await addPhotosToEmbeddingQueue(allNeedEmbeddings, false); // Normal priority
                }
            
                // Update status briefly (no need to restore since status panel was removed)
                const statusMsg = deletedCount > 0 
                    ? `Auto-indexed ${photos.length} photos (${newPhotosCount} new, ${deletedCount} deleted, ${allNeedEmbeddings.length} need embeddings)`
                    : `Auto-indexed ${photos.length} photos (${newPhotosCount} new, ${allNeedEmbeddings.length} need embeddings)`;
                updateStatus(statusMsg, false);
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
        sortedPhotos.forEach((p, idx) => {
            const item = document.createElement('div');
            item.className = 'photo-item';
            const thumbnailSrc = `/api/thumb/${p.file_id}`;
            item.innerHTML = `
                <label class="photo-checkbox-label">
                    <input type="checkbox" class="photo-checkbox browser-photo-checkbox" data-photo-idx="${idx}">
                    <span class="photo-checkbox-custom"></span>
                </label>
                <img src="${thumbnailSrc}" data-file-id="${p.file_id}" alt="${p.name || ''}" loading="lazy">
                <div class="photo-info">
                    <div class="photo-path">${p.path ? (p.path.replace('/drive/root:', '') || '/') : ''}</div>
                    <div class="photo-name">${p.name || 'Untitled'}</div>
                </div>
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
                let photoToDisplay = photo;
                try {
                    const dbPhoto = await db.getPhotoById(fileId);
                    if (dbPhoto) {
                        photoToDisplay = dbPhoto;
                    }
                } catch (error) {
                    console.warn('Could not fetch photo from database:', error);
                }
                
                // Display photo in modal
                await displayPhotoInModal(photoToDisplay, img.src);
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
            
            try {
                deleteBtn.disabled = true;
                deleteBtn.textContent = '⏳';
                
                await deletePhotosWithConfirmation([currentModalPhoto], async () => {
                    // Close modal
                    closeModal();
                    
                    // Refresh the current view if applicable
                    if (browserPhotoGrid && browserPhotoGrid.children.length > 0) {
                        await renderBrowserPhotoGrid(true);
                    }
                });
                
            } catch (error) {
                console.error('Failed to delete photo:', error);
                alert(`Failed to delete photo: ${error.message}`);
            } finally {
                // Reset delete button
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

/**
 * Add a folder to the scan queue (simple direct comparison)
 */
async function addFolderToScanQueue(folderPath) {
    const pathToScan = folderPath || selectedFolderPath || '/drive/root:';
    
    // Simple check: is this exact folder already in queue or being scanned?
    if (folderScanQueue.includes(pathToScan)) {
        console.log(`📋 Folder already in scan queue: ${pathToScan}`);
        updateStatus(`Folder already in queue`, false);
        return;
    }
    
    if (activeFolderScans.has(pathToScan)) {
        console.log(`⏳ Folder already being scanned: ${pathToScan}`);
        updateStatus(`Folder already being scanned`, false);
        return;
    }
    
    // Add to queue
    folderScanQueue.push(pathToScan);
    console.log(`➕ Added folder to scan queue: ${pathToScan} (Queue size: ${folderScanQueue.length})`);
    
    // Update status
    await updateScanQueueStatus();
    
    // Start queue processor if not already running
    if (!isScanQueueProcessorRunning) {
        processScanQueue();
    }
}

/**
 * Update status to reflect current scan queue state
 */
async function updateScanQueueStatus() {
    const queueSize = folderScanQueue.length;
    const activeScans = activeFolderScans.size;
    const totalScans = queueSize + activeScans;
    
    // Update visual panel
    if (scanQueueFoldersSpan) {
        if (totalScans === 0) {
            scanQueueFoldersSpan.textContent = 'No folders in queue';
            scanQueueFoldersSpan.style.color = '#999';
        } else {
            let folderMsg = '';
            if (activeScans > 0 && queueSize > 0) {
                folderMsg = `⏳ Scanning ${activeScans} | 📋 ${queueSize} queued`;
                scanQueueFoldersSpan.style.color = 'var(--primary-color)';
            } else if (activeScans > 0) {
                folderMsg = `⏳ Scanning ${activeScans} folder${activeScans > 1 ? 's' : ''}`;
                scanQueueFoldersSpan.style.color = 'var(--primary-color)';
            } else if (queueSize > 0) {
                folderMsg = `📋 ${queueSize} folder${queueSize > 1 ? 's' : ''} queued`;
                scanQueueFoldersSpan.style.color = 'var(--primary-color)';
            }
            scanQueueFoldersSpan.textContent = folderMsg;
        }
    }
    
    // Update DB count
    if (scanQueueDbCountSpan) {
        try {
            const totalPhotos = await db.getPhotoCount();
            const needsEmbeddings = await db.getPhotosWithoutEmbedding();
            scanQueueDbCountSpan.textContent = `📊 Total photos in DB: ${totalPhotos} (${needsEmbeddings.length} need embeddings)`;
        } catch (e) {
            scanQueueDbCountSpan.textContent = 'Total photos in DB: Loading...';
        }
    }
    
    // Update folder details list
    if (scanQueueDetailsDiv && scanQueueListDiv) {
        if (totalScans === 0) {
            scanQueueDetailsDiv.style.display = 'none';
        } else {
            scanQueueDetailsDiv.style.display = 'block';
            
            let listHtml = '';
            
            // Show active scans
            if (activeScans > 0) {
                listHtml += '<div class="folder-list-section"><strong>Currently Scanning:</strong><ul>';
                activeFolderScans.forEach(path => {
                    const displayName = pathToDisplayName(path);
                    listHtml += `<li class="scanning-folder">⏳ ${displayName}</li>`;
                });
                listHtml += '</ul></div>';
            }
            
            // Show queued scans (limit to first 20 for performance)
            if (queueSize > 0) {
                const displayLimit = 20;
                const showCount = Math.min(queueSize, displayLimit);
                listHtml += '<div class="folder-list-section"><strong>Queued:</strong>';
                if (queueSize > displayLimit) {
                    listHtml += ` <span style="color: #999; font-size: 0.8rem;">(showing first ${displayLimit} of ${queueSize})</span>`;
                }
                listHtml += '<ul>';
                
                for (let i = 0; i < showCount; i++) {
                    const path = folderScanQueue[i];
                    const displayName = pathToDisplayName(path);
                    listHtml += `<li class="queued-folder">📋 ${displayName}</li>`;
                }
                listHtml += '</ul></div>';
            }
            
            scanQueueListDiv.innerHTML = listHtml;
        }
    }
    
    // Update main status bar if scanning
    if (totalScans > 0) {
        let statusMsg = '';
        if (activeScans > 0 && queueSize > 0) {
            statusMsg = `Scanning ${activeScans} folder${activeScans > 1 ? 's' : ''}, ${queueSize} in queue`;
        } else if (activeScans > 0) {
            statusMsg = `Scanning ${activeScans} folder${activeScans > 1 ? 's' : ''}`;
        } else if (queueSize > 0) {
            statusMsg = `${queueSize} folder${queueSize > 1 ? 's' : ''} queued`;
        }
        updateStatus(statusMsg, false);
    }
}

/**
 * Process the folder scan queue with parallelism
 */
async function processScanQueue() {
    if (isScanQueueProcessorRunning) {
        console.log('Scan queue processor already running');
        return;
    }
    
    isScanQueueProcessorRunning = true;
    console.log('🚀 Starting scan queue processor');
    
    while (folderScanQueue.length > 0 || activeFolderScans.size > 0) {
        // Start new scans if we have capacity
        while (folderScanQueue.length > 0 && activeFolderScans.size < MAX_CONCURRENT_FOLDER_SCANS) {
            const folderPath = folderScanQueue.shift();
            activeFolderScans.add(folderPath);
            
            // Start scanning this folder (don't await - run in parallel)
            scanSingleFolder(folderPath)
                .then(async () => {
                    activeFolderScans.delete(folderPath);
                    await updateScanQueueStatus();
                })
                .catch(async (error) => {
                    console.error(`Error scanning folder ${folderPath}:`, error);
                    activeFolderScans.delete(folderPath);
                    await updateScanQueueStatus();
                });
            
            await updateScanQueueStatus();
        }
        
        // Wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    isScanQueueProcessorRunning = false;
    console.log('✅ Scan queue processor finished');
    
    // Final status update
    await updateScanQueueStatus();
    const totalPhotos = await db.getPhotoCount();
    updateStatus(`All folders scanned. Total photos in database: ${totalPhotos}`, false);
}

/**
 * Scan a single folder level (non-recursive, adds subfolders to queue)
 */
async function scanSingleFolder(folderPath) {
    try {
        console.log(`📁 Scanning folder: ${folderPath}`);
        
        // Generate a new scan ID for this scan operation
        const newScanId = Date.now();
        
        // Get folder ID
        const folderId = await findFolderIdByPath(folderPath);
        
        // Fetch children from this folder only (one level)
        const token = await getAuthToken();
        if (!token) throw new Error("Authentication token not available.");
        
        let nextPageUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId || 'root'}/children`;
        let photosFound = 0;
        let subfoldersFound = 0;
        
        while (nextPageUrl) {
            const response = await fetch(nextPageUrl, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch folder contents: ${response.status}`);
            }
            
            const data = await response.json();
            const photosInPage = [];
            const subfoldersInPage = [];
            
            for (const item of data.value) {
                // If it's a folder, collect it to add to queue
                if (item.folder) {
                    const subfolderPath = await getFolderPath(item.id);
                    subfoldersInPage.push(subfolderPath);
                } 
                // If it's a photo, process it
                else if (item.photo) {
                    photosInPage.push({
                        file_id: item.id,
                        name: item.name,
                        size: item.size,
                        path: item.parentReference?.path || '/drive/root:',
                        last_modified: item.lastModifiedDateTime,
                        photo_taken_ts: item.photo.takenDateTime ? 
                            new Date(item.photo.takenDateTime).getTime() : 
                            new Date(item.createdDateTime).getTime(),
                        thumbnail_url: null,
                        scan_id: newScanId,
                        embedding_status: 0,
                        embedding: null,
                        quality_score: null
                    });
                }
            }
            
            // Save photos to database
            if (photosInPage.length > 0) {
                await db.addOrUpdatePhotos(photosInPage);
                photosFound += photosInPage.length;
            }
            
            // Add subfolders to queue (check for duplicates)
            for (const subfolderPath of subfoldersInPage) {
                // Check if already in queue or being scanned
                if (!folderScanQueue.includes(subfolderPath) && !activeFolderScans.has(subfolderPath)) {
                    folderScanQueue.push(subfolderPath);
                    subfoldersFound++;
                    console.log(`📂 Added subfolder to queue: ${subfolderPath}`);
                }
            }
            
            // Update status with current progress
            await updateScanQueueStatus();
            
            // Check for next page
            nextPageUrl = data['@odata.nextLink'] || null;
        }
        
        // Get updated stats
        const totalPhotos = await db.getPhotoCount();
        const photosNeedingEmbeddings = await db.getPhotosWithoutEmbedding();
        
        console.log(`✅ Folder scan complete: ${folderPath} | Found ${photosFound} photos, ${subfoldersFound} subfolders | Total in DB: ${totalPhotos}`);
        
        // Add photos to embedding queue
        if (photosNeedingEmbeddings.length > 0) {
            await addPhotosToEmbeddingQueue(photosNeedingEmbeddings, false);
        }
        
    } catch (error) {
        console.error(`Scan failed for folder ${folderPath}:`, error);
        throw error;
    }
}

// --- Core Logic ---

/**
 * Initialize the app after successful login
 * This runs all the necessary setup for a logged-in user
 */
async function initializeAfterLogin(account) {
    await displayLoggedIn(account);
    await db.init();
    
    // Initialize analysis settings UI
    await initializeAnalysisSettingsWithRetry();
    
    // Initialize embedding processor with callbacks
    embeddingProcessor = new EmbeddingProcessor({
        updateStatus: updateStatus,
        updateButton: updatePauseResumeButton,
        initializeServiceWorker: initializeServiceWorkerToken
    });
    
    // Initialize embedding queue from database
    const photosNeedingEmbeddings = await db.getPhotosWithoutEmbedding();
    if (photosNeedingEmbeddings.length > 0) {
        await embeddingProcessor.addToQueue(photosNeedingEmbeddings);
        console.log(`📥 Initialized embedding queue with ${photosNeedingEmbeddings.length} photos from database`);
    }
    
    // Initialize pause/resume button state
    updatePauseResumeButton();
    
    // Initialize scan queue status
    await updateScanQueueStatus();
    
    // Start periodic scan queue status updates
    setInterval(async () => {
        await updateScanQueueStatus();
    }, 2000); // Update every 2 seconds
    
    // Restore folder selection from URL if present
    await restoreFiltersFromURL();
    
    // Restore similar photos view from URL if present
    await restoreSimilarPhotosFromURL();
    
    // Initialize backup panel
    await initializeBackupPanel();
    
    // Initialize browser path and render photo grid
    // Use setTimeout to ensure DOM is fully rendered before initializing browser
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
        updateBrowserCurrentPath();
        await renderBrowserPhotoGrid();
    } catch (error) {
        console.warn('Failed to render initial browser view:', error);
        console.error(error);
    }
}

async function handleLoginClick() {
    try {
        const account = await login();
        if (account) {
            await initializeAfterLogin(account);
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
            await initializeServiceWorkerToken();
            
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
// Wrapper function for adding photos to embedding queue
async function addPhotosToEmbeddingQueue(photos, priority = false) {
    if (embeddingProcessor) {
        await embeddingProcessor.addToQueue(photos, priority);
    }
}

// Update Pause/Resume button state
function updatePauseResumeButton() {
    if (!pauseResumeEmbeddingsBtn || !embeddingProcessor) return;
    
    const state = embeddingProcessor.getState();
    
    // Button is always active
    pauseResumeEmbeddingsBtn.disabled = false;
    
    if (state.isProcessing) {
        pauseResumeEmbeddingsBtn.textContent = '⏸️ Pause Embedding Workers';
    } else if (state.isPaused) {
        pauseResumeEmbeddingsBtn.textContent = '▶️ Resume Embedding Workers';
    } else {
        pauseResumeEmbeddingsBtn.textContent = '▶️ Start Embedding Workers';
    }
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

// --- DOM Element Initialization ---
function initializeDOMElements() {
    loginButton = document.getElementById('login-button');
    logoutButton = document.getElementById('logout-button');
    userInfo = document.getElementById('user-info');
    userInfoContainer = document.getElementById('user-info-container');
    mainContent = document.getElementById('main-content');
    statusText = document.getElementById('status-text');
    progressBar = document.getElementById('progress-bar');
    pauseResumeEmbeddingsBtn = document.getElementById('pause-resume-embeddings');
    clearDatabaseButton = document.getElementById('clear-database-button');
    startAnalysisButton = document.getElementById('start-analysis-button');
    resultsContainer = document.getElementById('results-container');
    
    startSeriesAnalysisButton = document.getElementById('start-series-analysis-button');
    seriesMinGroupSizeSlider = document.getElementById('series-min-group-size');
    seriesMinGroupSizeValueDisplay = document.getElementById('series-min-group-size-value');
    seriesMinDensitySlider = document.getElementById('series-min-density');
    seriesMinDensityValueDisplay = document.getElementById('series-min-density-value');
    seriesTimeGapSlider = document.getElementById('series-time-gap');
    seriesTimeGapValueDisplay = document.getElementById('series-time-gap-value');
    
    resultsTypeLabel = document.getElementById('results-type-label');
    browserPhotoGrid = document.getElementById('browser-photo-grid');
    browserSortSelect = document.getElementById('browser-sort');
    browserRefreshBtn = document.getElementById('browser-refresh');
    browserUpBtn = document.getElementById('browser-up');
    browserScanBtn = document.getElementById('browser-scan');
    browserAnalyzeBtn = document.getElementById('browser-analyze');
    browserCurrentPath = document.getElementById('browser-current-path');
    browserToggleSelectBtn = document.getElementById('browser-toggle-select');
    browserDeleteSelectedBtn = document.getElementById('browser-delete-selected');
    
    similarityThresholdSlider = document.getElementById('similarity-threshold');
    thresholdValueDisplay = document.getElementById('threshold-value');
    timeSpanSlider = document.getElementById('time-span');
    timeSpanValueDisplay = document.getElementById('time-span-value');
    minGroupSizeSlider = document.getElementById('min-group-size');
    minGroupSizeValueDisplay = document.getElementById('min-group-size-value');
    resultsSortSelect = document.getElementById('results-sort');
    workerCountSlider = document.getElementById('worker-count');
    workerCountValueDisplay = document.getElementById('worker-count-value');
    
    scanQueueFoldersSpan = document.getElementById('scan-queue-folders');
    scanQueueDbCountSpan = document.getElementById('scan-queue-db-count');
    scanQueueDetailsDiv = document.getElementById('scan-queue-details');
    scanQueueListDiv = document.getElementById('scan-queue-list');
    
    dateFromInput = document.getElementById('date-from');
    dateToInput = document.getElementById('date-to');
    dateEnabledToggle = document.getElementById('date-enabled-toggle');
    
    exportEmbeddingsBtn = document.getElementById('export-embeddings-btn');
    importEmbeddingsBtn = document.getElementById('import-embeddings-btn');
    exportInfo = document.getElementById('export-info');
    importInfo = document.getElementById('import-info');
    embeddingFilesList = document.getElementById('embedding-files-list');
    fileListContainer = document.getElementById('file-list-container');
    
    importModal = document.getElementById('import-modal');
    importModalClose = document.getElementById('import-modal-close');
    importLoading = document.getElementById('import-loading');
    importFileSelection = document.getElementById('import-file-selection');
    importFileList = document.getElementById('import-file-list');
    importOptions = document.querySelector('.import-options');
    conflictStrategySelect = document.getElementById('conflict-strategy');
    confirmImportBtn = document.getElementById('confirm-import-btn');
    cancelImportBtn = document.getElementById('cancel-import-btn');
    importProgress = document.getElementById('import-progress');
    importProgressBar = document.getElementById('import-progress-bar');
    importStatus = document.getElementById('import-status');
    importResults = document.getElementById('import-results');
    importSummary = document.getElementById('import-summary');
    closeImportBtn = document.getElementById('close-import-btn');
    
    modalFindSimilarBtn = document.getElementById('modal-find-similar-btn');
    modalViewInFolderBtn = document.getElementById('modal-view-in-folder-btn');
    
    console.log('DOM elements initialized');
}

// --- Main Application Startup ---
// NEW: We wrap the startup logic in an async function to use await.
async function main() {
    // STEP 0: Initialize DOM elements first
    initializeDOMElements();
    
    // STEP 1: Register service worker for image caching
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker registered:', registration);
        } catch (error) {
            console.error('Service Worker registration failed:', error);
        }
    }

    // STEP 2: Initialize MSAL
    await msalInstance.initialize();

    // STEP 3: Handle the redirect promise. This should be done after initialization.
    try {
        const response = await msalInstance.handleRedirectPromise();
        if (response && response.account) {
            msalInstance.setActiveAccount(response.account);
        }
    } catch (error) {
        console.error("Error handling redirect promise:", error);
    }
    
    // STEP 4: Check for an active account
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length > 0) {
        msalInstance.setActiveAccount(accounts[0]);
        await initializeAfterLogin(accounts[0]);
    }

    // STEP 5: Add event listeners now that MSAL is ready
    loginButton.addEventListener('click', handleLoginClick);
    
    // Logout button
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            try {
                // Stop any running workers
                if (embeddingProcessor) {
                    embeddingProcessor.pause();
                    embeddingProcessor.terminateWorkers();
                    embeddingProcessor = null;
                }
                
                // Perform logout
                logout();
                
                // Clear UI state
                userInfoContainer.style.display = 'none';
                mainContent.style.display = 'none';
                loginButton.style.display = 'block';
                
                // Clear results
                currentResultsType = null;
                currentAnalysisResults = null;
                currentReferencePhoto = null;
                if (resultsContainer) {
                    resultsContainer.innerHTML = '<p class="placeholder">Run similarity analysis or series analysis to see results here.</p>';
                }
                if (resultsTypeLabel) {
                    resultsTypeLabel.textContent = 'No results yet';
                }
                
                // Clear browser grid
                if (browserPhotoGrid) {
                    browserPhotoGrid.innerHTML = '';
                }
                
                updateStatus('Logged out successfully', false);
                
            } catch (error) {
                console.error('Logout error:', error);
                updateStatus('Logout completed', false);
            }
        });
    }
    
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
                
                // Stop any running workers and clear the queue
                if (embeddingProcessor) {
                    const state = embeddingProcessor.getState();
                    if (state.isProcessing) {
                        embeddingProcessor.pause();
                    }
                    embeddingProcessor.queue = []; // Clear the queue
                    updatePauseResumeButton();
                }
                
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
    
    // Pause/Resume embeddings button
    if (pauseResumeEmbeddingsBtn) {
        pauseResumeEmbeddingsBtn.addEventListener('click', async () => {
            if (!embeddingProcessor) return;
            
            const state = embeddingProcessor.getState();
            if (state.isPaused) {
                await embeddingProcessor.resume();
            } else if (state.isProcessing) {
                embeddingProcessor.pause();
            } else {
                // Start workers
                await embeddingProcessor.start();
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
        // Try to load saved setting (will fail if db not initialized yet, which is fine)
        try {
            const savedResultsSort = await db.getSetting('resultsSort');
            if (savedResultsSort) resultsSortSelect.value = savedResultsSort;
        } catch (e) {
            // Database not initialized yet, will be set later after login
        }
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
        // Try to load saved setting (will fail if db not initialized yet, which is fine)
        try {
            const savedBrowserSort = await db.getSetting('browserSort');
            if (savedBrowserSort) browserSortSelect.value = savedBrowserSort;
        } catch (e) {
            // Database not initialized yet, will be set later after login
        }
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
            const path = selectedFolderPath || '/drive/root:';
            await addFolderToScanQueue(path);
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
    if (browserToggleSelectBtn) {
        browserToggleSelectBtn.addEventListener('click', () => {
            const checkboxes = browserPhotoGrid.querySelectorAll('.browser-photo-checkbox');
            
            if (checkboxes.length === 0) return;
            
            // Check if all are selected
            const allSelected = Array.from(checkboxes).every(cb => cb.checked);
            
            // Toggle: if all selected, unselect all; otherwise select all
            checkboxes.forEach(cb => {
                cb.checked = !allSelected;
            });
            
            // Update button text
            browserToggleSelectBtn.textContent = allSelected ? '☑️ Toggle All' : '☐ Toggle All';
        });
    }
    if (browserDeleteSelectedBtn) {
        browserDeleteSelectedBtn.addEventListener('click', async () => {
            const checkboxes = browserPhotoGrid.querySelectorAll('.browser-photo-checkbox');
            const selectedPhotos = [];
            const photoElements = [];
            
            checkboxes.forEach((cb) => {
                if (cb.checked) {
                    const idx = parseInt(cb.getAttribute('data-photo-idx'));
                    // Get photo from currently displayed photos
                    const img = browserPhotoGrid.querySelectorAll('.photo-item img')[idx];
                    if (img) {
                        const fileId = img.getAttribute('data-file-id');
                        const photoItem = img.closest('.photo-item');
                        // Find photo data from the current folder
                        selectedPhotos.push({
                            file_id: fileId,
                            name: img.getAttribute('alt') || 'photo'
                        });
                        photoElements.push(photoItem);
                    }
                }
            });
            
            await deletePhotosWithConfirmation(selectedPhotos, async () => {
                // Remove deleted photos from the DOM (much faster than reloading entire folder)
                photoElements.forEach(element => {
                    if (element && element.parentNode) {
                        element.remove();
                    }
                });
                
                // Reset toggle button state
                browserToggleSelectBtn.textContent = '☑️ Toggle All';
            });
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

    // Note: Backup panel is initialized in initializeAfterLogin() for logged-in users
    
    // Cleanup workers on page unload
    window.addEventListener('beforeunload', () => {
        if (embeddingProcessor) {
            embeddingProcessor.terminateWorkers();
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