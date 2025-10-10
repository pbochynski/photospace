import { msalInstance, login, logout, getAuthToken } from './lib/auth.js';
import { fetchAllPhotos, fetchFolders, getFolderInfo, getFolderPath, fetchFolderChildren } from './lib/graph.js';
import { db } from './lib/db.js';
import { findSimilarGroups, pickBestPhotoByQuality, findPhotoSeries } from './lib/analysis.js';
import { exportEmbeddingsToOneDrive, getLastExportInfo, estimateExportSize } from './lib/embeddingExport.js';
import { importEmbeddingsFromOneDrive, listAvailableEmbeddingFiles, deleteEmbeddingFileFromOneDrive, getLastImportInfo, getEmbeddingFileMetadata } from './lib/embeddingImport.js';
import { initializeDebugConsole } from './lib/debugConsole.js';
import { EmbeddingProcessor } from './lib/embedding-processor.js';
import { updateStatus, isDateFilterEnabled, applyDateEnabledUI, getDateFilter, setDefaultDateRange, initializeCollapsiblePanels, applyPanelExpandedState } from './lib/uiUtils.js';
import { updateURLWithFilters, updateURLWithPath, getPathFromURL, getDateFiltersFromURL, restoreDateFiltersFromURL, pathToDisplayName, resetFolderToNoFilter, resetToNoFilter, updateURLWithSimilarPhoto, getSimilarPhotoFromURL, clearSimilarPhotoFromURL } from './lib/urlStateManager.js';
import { initializeAnalysisSettingsWithRetry, getSimilarityThreshold, getTimeSpanHours, getSortMethod, getWorkerCount, getMinGroupSize, getSeriesMinGroupSize, getSeriesMinDensity, getSeriesMaxTimeGap } from './lib/settingsManager.js';
import { deletePhotoFromOneDrive, deletePhotosWithConfirmation } from './lib/photoDeleteManager.js';
import { handleExportEmbeddings as backupHandleExport, handleImportEmbeddings as backupHandleImport, displayImportFileList, deleteImportFile as backupDeleteFile, performImport as backupPerformImport, showImportSection, closeImportModal, initializeBackupPanel as backupInitPanel } from './lib/backupManager.js';
import { cosineSimilarity, findSimilarToPhoto, handleFindSimilarClick as similarHandleFindClick, clearSimilarPhotosSearch as similarClearSearch, restoreSimilarPhotosFromURL as similarRestoreFromURL, viewPhotoInFolder as similarViewInFolder } from './lib/similarPhotosManager.js';

// Initialize debug console (also sets window.debugConsole for worker access)
const debugConsole = initializeDebugConsole();

// Initialize embedding processor (will be configured after DOM elements are loaded)
let embeddingProcessor = null;

// --- DOM Elements (will be initialized in main()) ---
let loginButton, logoutButton, userInfoContainer, mainContent;
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

// Application state object (passed to URL state manager and other modules)
const appState = {
    selectedFolderId: null, // null means no folder filter (all folders)
    selectedFolderPath: null, // null means no folder filter
    selectedFolderDisplayName: 'All folders' // Display for no filter
};

// For backward compatibility, expose as top-level variables
let selectedFolderId = null;
let selectedFolderPath = null;
let selectedFolderDisplayName = 'All folders';

// Sync state object with top-level variables (for backward compatibility)
function syncStateToGlobals() {
    selectedFolderId = appState.selectedFolderId;
    selectedFolderPath = appState.selectedFolderPath;
    selectedFolderDisplayName = appState.selectedFolderDisplayName;
}

function syncGlobalsToState() {
    appState.selectedFolderId = selectedFolderId;
    appState.selectedFolderPath = selectedFolderPath;
    appState.selectedFolderDisplayName = selectedFolderDisplayName;
}

let currentModalPhoto = null; // Track the photo currently displayed in modal
let currentResultsType = null; // Track current results type ('similarity', 'series', or 'similar-to')
let currentReferencePhoto = null; // Track reference photo for similar-to searches
let currentAnalysisResults = null; // Store current analysis results for re-sorting
let isAutoIndexing = false; // Flag to prevent overlapping auto-indexing operations

// Modal navigation state
let currentModalPhotoList = []; // List of photos in current context
let currentModalPhotoIndex = -1; // Current index in the list
let currentModalContext = null; // 'browser' or 'results' - tracks where modal was opened from

// Folder scan queue management
const MAX_CONCURRENT_FOLDER_SCANS = 5; // Maximum folders to scan in parallel
let folderScanQueue = []; // Queue of folder paths to scan
let activeFolderScans = new Set(); // Currently scanning folders
let isScanQueueProcessorRunning = false; // Track if processor is running

// --- URL Parameter Functions ---
// (Moved to urlStateManager.js)

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
                syncGlobalsToState();
                updateStatus(`Restored folder filter: ${selectedFolderDisplayName}`, false);
            } else {
                console.warn('Could not find folder for path:', pathFromURL);
                // Reset to no filter if folder not found
                resetFolderToNoFilter(appState);
                syncStateToGlobals();
            }
        } catch (error) {
            console.error('Error restoring folder from URL:', error);
            resetFolderToNoFilter(appState);
            syncStateToGlobals();
        }
    } else {
        resetFolderToNoFilter(appState);
        syncStateToGlobals();
    }
}

async function restoreFiltersFromURL() {
    // Restore folder filter
    await restoreFolderFromURL();
    
    // Restore date filters
    restoreDateFiltersFromURL();
    
    // Update URL to ensure consistency
    syncGlobalsToState();
    updateURLWithFilters(appState);
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
// (Moved to uiUtils.js)

// --- UI Update Functions ---
// (Moved to uiUtils.js)

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
 * @param {Array} photoList - Optional list of photos for navigation context
 * @param {number} photoIndex - Optional current index in photoList
 * @param {string} context - Optional context ('browser' or 'results')
 */
async function displayPhotoInModal(photo, thumbnailSrc, photoList = [], photoIndex = -1, context = null) {
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-img');
    
    currentModalPhoto = photo;
    currentModalPhotoList = photoList;
    currentModalPhotoIndex = photoIndex;
    currentModalContext = context;
    
    populateImageMetadata(photo);
    updateModalNavigation();
    updateModalCheckbox();
    
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


async function displayLoggedIn(account) {
    loginButton.style.display = 'none';
    userInfoContainer.style.display = 'flex';
    mainContent.style.display = 'block';
    // Hide landing intro if present
    const landingIntro = document.getElementById('landing-intro');
    if (landingIntro) landingIntro.style.display = 'none';
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
            
            await deletePhotosWithConfirmation(selectedPhotos, updateStatus, () => {
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
            
            // Get photo based on type and build navigation context
            let photo;
            let photoList;
            let photoIndex;
            
            if (type === 'similar-to') {
                photoIndex = parseInt(img.getAttribute('data-photo-idx'));
                // For similar-to, groups is [{ photos: actualPhotosArray }]
                photo = groups[0].photos[photoIndex];
                photoList = groups[0].photos;
            } else {
                const groupIdx = parseInt(img.closest('.photo-item').querySelector('.photo-checkbox').getAttribute('data-group-idx'));
                photoIndex = parseInt(img.closest('.photo-item').querySelector('.photo-checkbox').getAttribute('data-photo-idx'));
                photo = groups[groupIdx].photos[photoIndex];
                photoList = groups[groupIdx].photos; // For groups, use photos within the group
            }
            
            await displayPhotoInModal(photo, img.src, photoList, photoIndex, 'results');
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
                syncGlobalsToState();
                updateURLWithPath(selectedFolderPath, appState);
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
                
                // Display photo in modal with navigation context (from browser)
                await displayPhotoInModal(photoToDisplay, img.src, sortedPhotos, idx, 'browser');
            });
        });
    } catch (e) {
        console.error('Failed to render browser photo grid', e);
        browserPhotoGrid.innerHTML = '<div class="error-message">Failed to load photos.</div>';
    }
}

/**
 * Find the grid checkbox for the current modal photo
 */
function findGridCheckboxForCurrentPhoto() {
    if (!currentModalPhoto || currentModalPhotoIndex < 0) return null;
    
    // If we know the context, search only in that section
    if (currentModalContext === 'browser') {
        // Only search in browser grid
        const browserCheckboxes = browserPhotoGrid?.querySelectorAll('.browser-photo-checkbox');
        console.log('Finding browser checkbox:', {
            gridExists: !!browserPhotoGrid,
            checkboxCount: browserCheckboxes?.length,
            lookingFor: currentModalPhoto.file_id
        });
        
        if (browserCheckboxes) {
            for (const checkbox of browserCheckboxes) {
                const photoItem = checkbox.closest('.photo-item');
                const img = photoItem?.querySelector('img');
                const fileId = img?.getAttribute('data-file-id');
                
                console.log('  Checking checkbox:', { fileId, matches: fileId === currentModalPhoto.file_id });
                
                if (fileId === currentModalPhoto.file_id) {
                    console.log('  ✓ Found matching checkbox!');
                    return checkbox;
                }
            }
        }
        console.log('  ✗ No matching checkbox found');
        return null;
    } else if (currentModalContext === 'results') {
        // Only search in results container
        const resultsCheckboxes = resultsContainer.querySelectorAll('.photo-checkbox');
        for (const checkbox of resultsCheckboxes) {
            const photoItem = checkbox.closest('.photo-item');
            const img = photoItem?.querySelector('img');
            const fileId = img?.getAttribute('data-file-id');
            
            if (fileId === currentModalPhoto.file_id) {
                return checkbox;
            }
        }
        return null;
    }
    
    // Fallback: no context specified, search both (results first for backward compatibility)
    const resultsCheckboxes = resultsContainer.querySelectorAll('.photo-checkbox');
    for (const checkbox of resultsCheckboxes) {
        const photoItem = checkbox.closest('.photo-item');
        const img = photoItem?.querySelector('img');
        const fileId = img?.getAttribute('data-file-id');
        
        if (fileId === currentModalPhoto.file_id) {
            return checkbox;
        }
    }
    
    // Try to find checkbox in browser grid
    const browserCheckboxes = browserPhotoGrid?.querySelectorAll('.browser-photo-checkbox');
    if (browserCheckboxes) {
        for (const checkbox of browserCheckboxes) {
            const photoItem = checkbox.closest('.photo-item');
            const img = photoItem?.querySelector('img');
            const fileId = img?.getAttribute('data-file-id');
            
            if (fileId === currentModalPhoto.file_id) {
                return checkbox;
            }
        }
    }
    
    return null;
}

/**
 * Sync checkbox state from modal to grid
 */
function syncCheckboxToGrid(checked) {
    const gridCheckbox = findGridCheckboxForCurrentPhoto();
    if (gridCheckbox) {
        gridCheckbox.checked = checked;
    }
}

/**
 * Update modal checkbox state from grid
 */
function updateModalCheckbox() {
    const modalCheckbox = document.getElementById('modal-photo-checkbox');
    if (!modalCheckbox) return;
    
    const gridCheckbox = findGridCheckboxForCurrentPhoto();
    
    if (gridCheckbox) {
        // Sync checkbox state from grid
        modalCheckbox.checked = gridCheckbox.checked;
        modalCheckbox.parentElement.style.display = 'flex';
    } else {
        // No grid checkbox found, hide modal checkbox
        modalCheckbox.parentElement.style.display = 'none';
    }
}

/**
 * Update modal navigation buttons visibility and state
 */
function updateModalNavigation() {
    const prevBtn = document.getElementById('modal-prev-btn');
    const nextBtn = document.getElementById('modal-next-btn');
    
    if (!prevBtn || !nextBtn) return;
    
    const hasNavigation = currentModalPhotoList.length > 0 && currentModalPhotoIndex >= 0;
    
    if (hasNavigation) {
        // Show buttons and enable/disable based on position
        prevBtn.style.display = 'flex';
        nextBtn.style.display = 'flex';
        prevBtn.disabled = currentModalPhotoIndex <= 0;
        nextBtn.disabled = currentModalPhotoIndex >= currentModalPhotoList.length - 1;
        
        // Update counter
        const counter = document.getElementById('modal-photo-counter');
        if (counter) {
            counter.textContent = `${currentModalPhotoIndex + 1} / ${currentModalPhotoList.length}`;
            counter.style.display = 'block';
        }
    } else {
        // Hide navigation if no context
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        
        const counter = document.getElementById('modal-photo-counter');
        if (counter) {
            counter.style.display = 'none';
        }
    }
}

/**
 * Navigate to previous/next photo in modal
 */
async function navigateModalPhoto(direction) {
    if (currentModalPhotoList.length === 0 || currentModalPhotoIndex < 0) return;
    
    const newIndex = currentModalPhotoIndex + direction;
    
    if (newIndex < 0 || newIndex >= currentModalPhotoList.length) return;
    
    const photo = currentModalPhotoList[newIndex];
    const thumbnailSrc = `/api/thumb/${photo.file_id}`;
    
    // Display the new photo while maintaining the context
    await displayPhotoInModal(photo, thumbnailSrc, currentModalPhotoList, newIndex, currentModalContext);
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
    
    // Create navigation buttons if they don't exist
    let prevBtn = document.getElementById('modal-prev-btn');
    let nextBtn = document.getElementById('modal-next-btn');
    let counter = document.getElementById('modal-photo-counter');
    
    if (!prevBtn) {
        prevBtn = document.createElement('button');
        prevBtn.id = 'modal-prev-btn';
        prevBtn.className = 'modal-nav-btn modal-prev-btn';
        prevBtn.innerHTML = '◀';
        prevBtn.title = 'Previous photo (Left arrow)';
        modal.appendChild(prevBtn);
    }
    
    if (!nextBtn) {
        nextBtn = document.createElement('button');
        nextBtn.id = 'modal-next-btn';
        nextBtn.className = 'modal-nav-btn modal-next-btn';
        nextBtn.innerHTML = '▶';
        nextBtn.title = 'Next photo (Right arrow)';
        modal.appendChild(nextBtn);
    }
    
    if (!counter) {
        counter = document.createElement('div');
        counter.id = 'modal-photo-counter';
        counter.className = 'modal-photo-counter';
        modal.appendChild(counter);
    }
    
    // Create checkbox for photo selection
    let modalCheckbox = document.getElementById('modal-photo-checkbox');
    if (!modalCheckbox) {
        const checkboxContainer = document.createElement('label');
        checkboxContainer.className = 'modal-photo-checkbox-container';
        checkboxContainer.title = 'Select/deselect photo';
        
        modalCheckbox = document.createElement('input');
        modalCheckbox.type = 'checkbox';
        modalCheckbox.id = 'modal-photo-checkbox';
        modalCheckbox.className = 'modal-photo-checkbox';
        
        const checkboxCustom = document.createElement('span');
        checkboxCustom.className = 'modal-photo-checkbox-custom';
        
        checkboxContainer.appendChild(modalCheckbox);
        checkboxContainer.appendChild(checkboxCustom);
        modal.appendChild(checkboxContainer);
        
        // Checkbox change handler
        modalCheckbox.addEventListener('change', (e) => {
            e.stopPropagation();
            syncCheckboxToGrid(modalCheckbox.checked);
        });
    }
    
    // Navigation button handlers
    prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateModalPhoto(-1);
    });
    
    nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateModalPhoto(1);
    });
    
    // Keyboard navigation (arrow keys)
    const handleModalKeydown = (e) => {
        if (modal.style.display !== 'flex') return;
        
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            navigateModalPhoto(-1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            navigateModalPhoto(1);
        }
    };
    
    document.addEventListener('keydown', handleModalKeydown);
    
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
                
                const deletedPhotoId = currentModalPhoto.file_id;
                const deletedPhotoIndex = currentModalPhotoIndex;
                
                await deletePhotosWithConfirmation([currentModalPhoto], updateStatus, async () => {
                    // Remove from current photo list if we have navigation context
                    if (currentModalPhotoList.length > 0 && deletedPhotoIndex >= 0) {
                        currentModalPhotoList.splice(deletedPhotoIndex, 1);
                        
                        // If there are more photos, navigate to the next one (or previous if at end)
                        if (currentModalPhotoList.length > 0) {
                            // If we deleted the last photo, go to the new last photo
                            const newIndex = deletedPhotoIndex >= currentModalPhotoList.length 
                                ? currentModalPhotoList.length - 1 
                                : deletedPhotoIndex;
                            
                            const nextPhoto = currentModalPhotoList[newIndex];
                            const thumbnailSrc = `/api/thumb/${nextPhoto.file_id}`;
                            
                            // Display the next photo
                            await displayPhotoInModal(nextPhoto, thumbnailSrc, currentModalPhotoList, newIndex, currentModalContext);
                        } else {
                            // No more photos in list, close modal
                            closeModal();
                        }
                    } else {
                        // No navigation context, just close modal
                        closeModal();
                    }
                    
                    // Remove the deleted photo from the browser grid DOM (if in browser context)
                    if (currentModalContext === 'browser' && browserPhotoGrid) {
                        const photoElements = browserPhotoGrid.querySelectorAll('.photo-item');
                        photoElements.forEach((photoItem) => {
                            const img = photoItem.querySelector('img');
                            if (img && img.getAttribute('data-file-id') === deletedPhotoId) {
                                photoItem.remove();
                            }
                        });
                    }
                    
                    // Remove from results grid DOM (if in results context)
                    if (currentModalContext === 'results' && resultsContainer) {
                        const photoElements = resultsContainer.querySelectorAll('.photo-item');
                        photoElements.forEach((photoItem) => {
                            const img = photoItem.querySelector('img');
                            if (img && img.getAttribute('data-file-id') === deletedPhotoId) {
                                photoItem.remove();
                            }
                        });
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
        currentModalPhotoList = []; // Clear navigation context
        currentModalPhotoIndex = -1;
        currentModalContext = null; // Clear context
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
    await backupInitPanel(exportEmbeddingsBtn, exportInfo, importInfo);
    
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
// (Moved to similarPhotosManager.js)

// Wrapper functions to maintain compatibility with current code structure
async function handleFindSimilarClick() {
    const closeModal = () => {
        const modal = document.getElementById('image-modal');
        if (modal) modal.style.display = 'none';
    };
    
    const scrollToResults = () => {
        const resultsPanel = document.querySelector('[data-panel-key="results"]');
        if (resultsPanel) {
            resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };
    
    await similarHandleFindClick(
        currentModalPhoto,
        modalFindSimilarBtn,
        updateStatus,
        displayAnalysisResults,
        closeModal,
        scrollToResults
    );
}

function clearSimilarPhotosSearch() {
    const refs = {
        currentResultsType,
        currentReferencePhoto,
        currentAnalysisResults,
        resultsTypeLabel,
        resultsContainer
    };
    similarClearSearch(refs, updateStatus);
    // Update global refs
    currentResultsType = refs.currentResultsType;
    currentReferencePhoto = refs.currentReferencePhoto;
    currentAnalysisResults = refs.currentAnalysisResults;
}

async function restoreSimilarPhotosFromURL() {
    await similarRestoreFromURL(updateStatus, displayAnalysisResults);
}

async function viewPhotoInFolder() {
    const updateBrowserState = (folderId, folderPath, displayName) => {
        selectedFolderId = folderId;
        selectedFolderPath = folderPath;
        selectedFolderDisplayName = displayName;
        syncGlobalsToState();
        updateURLWithPath(folderPath, appState);
        updateBrowserCurrentPath();
    };
    
    const closeModal = () => {
        const modal = document.getElementById('image-modal');
        if (modal) modal.style.display = 'none';
    };
    
    const scrollToPhoto = async (fileId) => {
        setTimeout(() => {
            const photoElements = browserPhotoGrid.querySelectorAll('.photo-item img');
            let targetPhotoElement = null;
            
            photoElements.forEach((img) => {
                if (img.getAttribute('data-file-id') === fileId) {
                    targetPhotoElement = img.closest('.photo-item');
                }
            });
            
            if (targetPhotoElement) {
                targetPhotoElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                targetPhotoElement.classList.add('highlight');
                setTimeout(() => targetPhotoElement.classList.remove('highlight'), 2000);
                updateStatus('Photo found in folder', false);
            } else {
                console.warn('Photo not found in rendered grid');
                updateStatus('Folder opened (photo not visible)', false);
            }
        }, 500);
    };
    
    await similarViewInFolder(
        currentModalPhoto,
        findFolderIdByPath,
        updateBrowserState,
        closeModal,
        renderBrowserPhotoGrid,
        scrollToPhoto,
        updateStatus,
        modalViewInFolderBtn
    );
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
// (Moved to settingsManager.js)

// --- DOM Element Initialization ---
function initializeDOMElements() {
    loginButton = document.getElementById('login-button');
    logoutButton = document.getElementById('logout-button');
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
    
    // Hero login button (if present)
    const heroLoginBtn = document.getElementById('hero-login-btn');
    if (heroLoginBtn) {
        heroLoginBtn.addEventListener('click', handleLoginClick);
    }
    
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
                // Show landing intro again
                const landingIntro = document.getElementById('landing-intro');
                if (landingIntro) landingIntro.style.display = '';
                
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
        syncGlobalsToState();
        updateURLWithFilters(appState);
    });
    dateToInput.addEventListener('change', async () => {
        await db.setSetting('dateTo', dateToInput.value || '');
        syncGlobalsToState();
        updateURLWithFilters(appState);
    });
    dateEnabledToggle.addEventListener('change', async () => {
        await db.setSetting('dateEnabled', isDateFilterEnabled());
        applyDateEnabledUI();
        syncGlobalsToState();
        updateURLWithFilters(appState);
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
            syncGlobalsToState();
            updateURLWithPath(selectedFolderPath, appState);
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
            
            await deletePhotosWithConfirmation(selectedPhotos, updateStatus, async () => {
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
    exportEmbeddingsBtn.addEventListener('click', () => backupHandleExport(updateStatus, exportEmbeddingsBtn, exportInfo));
    importEmbeddingsBtn.addEventListener('click', () => backupHandleImport(importModal, showImportSection, (files) => displayImportFileList(files, backupDeleteFile)));
    
    // Import modal event listeners
    importModalClose.addEventListener('click', closeImportModal);
    cancelImportBtn.addEventListener('click', closeImportModal);
    confirmImportBtn.addEventListener('click', () => backupPerformImport(showImportSection, importInfo));
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

// Backup functionality (moved to backupManager.js)

// Make deleteImportFile available globally for onclick handlers
window.deleteImportFile = backupDeleteFile;

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
        syncGlobalsToState();
        updateURLWithPath(selectedFolderPath, appState);
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
                        syncGlobalsToState();
                        updateURLWithPath(selectedFolderPath, appState);
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