import { msalInstance, login, getAuthToken } from './lib/auth.js';
import { fetchAllPhotos, fetchFolders, getFolderInfo, getFolderPath } from './lib/graph.js';
import { db } from './lib/db.js';
import { findSimilarGroups, pickBestPhotoByQuality } from './lib/analysis.js';

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

// Date filter elements
const dateFromInput = document.getElementById('date-from');
const dateToInput = document.getElementById('date-to');
const clearDateBtn = document.getElementById('clear-date-btn');

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
function updateURLWithPath(folderPath) {
    const url = new URL(window.location);
    if (!folderPath) {
        url.searchParams.delete('path');
    } else {
        url.searchParams.set('path', folderPath);
    }
    window.history.pushState({}, '', url);
}

function getPathFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('path') || null; // null means no folder filter
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
                selectedFolderInput.value = selectedFolderDisplayName;
                updateStatus(`Restored folder filter: ${selectedFolderDisplayName}`, false);
            } else {
                console.warn('Could not find folder for path:', pathFromURL);
                // Reset to no filter if folder not found
                resetToNoFilter();
            }
        } catch (error) {
            console.error('Error restoring folder from URL:', error);
            resetToNoFilter();
        }
    } else {
        resetToNoFilter();
    }
}

function resetToNoFilter() {
    selectedFolderId = null;
    selectedFolderPath = null;
    selectedFolderDisplayName = 'All folders';
    selectedFolderInput.value = selectedFolderDisplayName;
    updateURLWithPath(null);
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

function clearDateFilter() {
    dateFromInput.value = '';
    dateToInput.value = '';
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
            photoItem.innerHTML = `
                <label class="photo-checkbox-label">
                    <input type="checkbox" class="photo-checkbox" data-group-idx="${groupIdx}" data-photo-idx="${idx}" ${idx === 0 ? '' : 'checked'}>
                    <span class="photo-checkbox-custom"></span>
                    <img src="${p.thumbnail_url}" data-file-id="${p.file_id}" alt="${p.name}" loading="lazy">
                    ${recommendedBadge}
                    <div class="photo-score">
                        ${p.path ? p.path.replace('/drive/root:', '') || '/' : 'Unknown path'}
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
            
            // Get the file ID
            const fileId = img.getAttribute('data-file-id');
            
            if (fileId) {
                // Step 1: Show modal immediately with thumbnail (already loaded)
                modalImg.src = img.src; // Use existing thumbnail
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
        
        const closeModal = () => {
            // Trigger custom 'hide' event for cleanup
            modal.dispatchEvent(new Event('hide'));
            modal.style.display = 'none';
            modalImg.src = '';
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

// --- Folder Browser Functions ---

function showFolderBrowser() {
    folderModal.style.display = 'flex';
    currentBrowsingFolderId = 'root';
    folderHistory = [];
    loadFolders('root');
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
    selectedFolderInput.value = selectedFolderDisplayName;
    updateStatus(`Selected folder: ${selectedFolderDisplayName}`, false);
    hideFolderBrowser();
}

async function runPhotoScan() {
    // For scanning, a folder must be selected
    if (!selectedFolderId) {
        alert('Please select a folder to scan first.');
        return;
    }
    
    startScanButton.disabled = true;
    startEmbeddingButton.disabled = true;
    startAnalysisButton.disabled = true;

    try {
        // --- STEP 1: Generate a new scan ID ---
        const newScanId = Date.now();
        console.log(`Starting new scan with ID: ${newScanId} in folder: ${selectedFolderDisplayName}`);
        updateStatus(`Scanning ${selectedFolderDisplayName} for photos...`, true, 0, 100);

        // --- STEP 2: Crawl OneDrive starting from selected folder ---
        await fetchAllPhotos(newScanId, (progress) => {
            updateStatus(`Scanning... Found ${progress.count} photos so far.`, true, 0, 100);
        }, selectedFolderId);
        
        // --- STEP 3: Clean up files that were not touched (i.e., deleted from OneDrive) ---
        updateStatus('Cleaning up deleted files...', true, 0, 100);
        // await db.deletePhotosNotMatchingScanId(newScanId);
        
        const totalPhotos = await db.getPhotoCount();
        updateStatus(`Scan complete. Total photos: ${totalPhotos}. Now generating embeddings for new files...`, true, 0, totalPhotos);
        
        // --- STEP 4: Generate embeddings for only the new files ---
        // generateEmbeddings() will automatically find files with embedding_status = 0
        await generateEmbeddings(selectedFolderPath);

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
    startAnalysisButton.disabled = true;

    try {
        await generateEmbeddings(selectedFolderPath);
    } catch (error) {
        console.error('Embedding generation failed:', error);
        updateStatus(`Error during embedding generation: ${error.message}`, false);
    } finally {
        startEmbeddingButton.disabled = false;
    }
}

async function fetchThumbnailAsBlobURL(fileId, getAuthToken) {
    const url = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/thumbnails/0/large/content`;
    try {
        // For binary content, we need the Response object, not parsed JSON
        let token = await getAuthToken();
        let options = {
            headers: {
                Authorization: `Bearer ${token}`
            }
        };
        let response = await fetch(url, options);
        
        // Handle token refresh for binary content
        if ((response.status === 401 || response.status === 403)) {
            token = await getAuthToken(true); // force refresh
            options.headers['Authorization'] = `Bearer ${token}`;
            response = await fetch(url, options);
        }
        
        if (!response.ok) {
            throw new Error(`Graph API error fetching thumbnail: ${response.statusText}`);
        }
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    } catch (error) {
        console.error(`Failed to fetch thumbnail for ${fileId}:`, error);
        return null; // Return null on failure
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
                const response = await fetch(stableImageUrl);
                if (response.ok) {
                    const blob = await response.blob();
                    const blobUrl = URL.createObjectURL(blob);
                    modalImg.src = blobUrl;
                    return blobUrl; // Return for cleanup
                }
            } catch (swError) {
                console.warn('Service worker fetch failed, falling back to direct fetch:', swError);
            }
        }
        
        // Fallback: Direct fetch if service worker not available
        const fullSizeUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`;
        const response = await fetch(fullSizeUrl, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            modalImg.src = blobUrl;
            return blobUrl; // Return for cleanup
        } else {
            console.warn('Failed to load full-size image, keeping thumbnail');
            return null;
        }
    } catch (error) {
        console.error('Error loading full-size image:', error);
        return null;
    }
}

async function generateEmbeddings(folderPath = '/drive/root:') {
    // Configurable number of parallel workers
    const NUM_EMBEDDING_WORKERS = 4;
    return new Promise(async (resolve, reject) => {
        const photosToProcess = await db.getPhotosWithoutEmbeddingFromFolder(folderPath);
        const totalToProcess = photosToProcess.length;
        if (totalToProcess === 0) {
            updateStatus('All photos in selected folder are already processed.', false);
            startAnalysisButton.disabled = false;
            resolve();
            return;
        }
        updateStatus(`Preparing to process ${totalToProcess} new photos from selected folder...`);
        // Worker pool
        const workers = [];
        let processedCount = 0;
        let modelReadyCount = 0;
        const objectUrlMap = new Map();
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
            const blobUrl = await fetchThumbnailAsBlobURL(photo.file_id, getAuthToken);
            if (blobUrl) {
                objectUrlMap.set(photo.file_id, blobUrl);
                workers[workerIdx].postMessage({
                    file_id: photo.file_id,
                    thumbnail_url: blobUrl
                });
                workerBusy[workerIdx] = true;
            } else {
                processedCount++;
                if (processedCount === totalToProcess) {
                    workers.forEach(w => w.terminate());
                    updateStatus('Processing finished with some errors.', false);
                    startAnalysisButton.disabled = false;
                    resolve();
                } else {
                    assignNext(workerIdx);
                }
            }
        }
        // Worker message handler
        function makeOnMessage(workerIdx) {
            return async (event) => {
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
                    // Revoke blob URL
                    const objectUrl = objectUrlMap.get(file_id);
                    if (objectUrl) {
                        URL.revokeObjectURL(objectUrl);
                        objectUrlMap.delete(file_id);
                    }
                    updateStatus(`Processing photos...`, true, processedCount, totalToProcess);
                    if (processedCount === totalToProcess) {
                        workers.forEach(w => w.terminate());
                        updateStatus('All photos processed! Ready for analysis.', false);
                        startAnalysisButton.disabled = false;
                        resolve();
                    } else {
                        assignNext(workerIdx);
                    }
                } else if (status === 'error') {
                    console.error(`Worker error for file ${file_id}:`, error);
                    processedCount++;
                    // Revoke blob URL
                    const objectUrl = objectUrlMap.get(file_id);
                    if (objectUrl) {
                        URL.revokeObjectURL(objectUrl);
                        objectUrlMap.delete(file_id);
                    }
                    if (processedCount === totalToProcess) {
                        workers.forEach(w => w.terminate());
                        updateStatus('Processing finished with some errors.', false);
                        startAnalysisButton.disabled = false;
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
                if (!errorOccurred) {
                    errorOccurred = true;
                    workers.forEach(w => w.terminate());
                    updateStatus(`A critical worker error occurred: ${err.message}`, false);
                    reject(err);
                }
            };
            workers.push(worker);
        }
        // Start all workers (they will load the model and then call assignNext)
        for (let i = 0; i < NUM_EMBEDDING_WORKERS; i++) {
            workers[i].postMessage({ type: 'init' });
        }
    });
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
            let similarGroups = await findSimilarGroups(filteredPhotos, (progress) => {
                updateStatus(`Finding groups... ${progress.toFixed(0)}% complete.`, true, 25 + (progress * 0.5), 100);
            });

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

            displayResults(similarGroups);
            updateStatus('Analysis complete!', false);
            startAnalysisButton.disabled = false;
        }, 100);

    } catch (error) {
        console.error('Analysis failed:', error);
        updateStatus(`Error during analysis: ${error.message}`, false);
        startAnalysisButton.disabled = false;
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
        
        // Restore folder selection from URL if present
        await restoreFolderFromURL();
    }

    // STEP 4: Add event listeners now that MSAL is ready
    loginButton.addEventListener('click', handleLoginClick);
    browseFolderBtn.addEventListener('click', showFolderBrowser);
    startScanButton.addEventListener('click', handleScanClick);
    startEmbeddingButton.addEventListener('click', runEmbeddingGeneration);
    startAnalysisButton.addEventListener('click', runAnalysis);
    
    // Filter control event listeners
    clearFolderBtn.addEventListener('click', clearFolderFilter);
    clearDateBtn.addEventListener('click', clearDateFilter);
    
    // Folder selector event listeners
    browseFolderBtn.addEventListener('click', showFolderBrowser);
    
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
}

// Start the application
main();