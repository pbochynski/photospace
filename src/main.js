import { msalInstance, login, getAuthToken } from './lib/auth.js';
import { fetchAllPhotos } from './lib/graph.js';
import { db } from './lib/db.js';
import { findSimilarGroups, getPromptEmbeddings, scorePhotoEmbedding } from './lib/analysis.js';
import { clipTextEncoder } from './lib/clipTextEncoder.js';

// --- DOM Elements ---
const loginButton = document.getElementById('login-button');
const userInfo = document.getElementById('user-info');
const mainContent = document.getElementById('main-content');
const statusText = document.getElementById('status-text');
const progressBar = document.getElementById('progress-bar');
const startScanButton = document.getElementById('start-scan-button');
const startAnalysisButton = document.getElementById('start-analysis-button');
const resultsContainer = document.getElementById('results-container');

let embeddingWorker = null;

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
            photoItem.innerHTML = `
                <label class="photo-checkbox-label">
                    <input type="checkbox" class="photo-checkbox" data-group-idx="${groupIdx}" data-photo-idx="${idx}" ${idx === 0 ? '' : 'checked'}>
                    <span class="photo-checkbox-custom"></span>
                    <img src="${p.thumbnail_url}" alt="${p.name}" loading="lazy">
                    <div class="photo-score">Score: ${typeof p.qualityScore === 'number' ? p.qualityScore.toFixed(2) : 'N/A'}</div>
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
                    await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${photo.file_id}`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    // Optionally, remove from local DB
                    await db.deletePhoto(photo.file_id);
                }
                // Remove deleted photos from UI and group
                group.photos = group.photos.filter((p, idx) => !checkboxes[idx].checked);
                displayResults(groups);
                updateStatus('Selected photos deleted.', false);
            } catch (err) {
                updateStatus('Error deleting photos: ' + err.message, false);
            }
        });
    });
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

async function runPhotoScan() {
    startScanButton.disabled = true;
    startAnalysisButton.disabled = true;

    try {
        // --- STEP 1: Generate a new scan ID ---
        const newScanId = Date.now();
        console.log(`Starting new scan with ID: ${newScanId}`);
        updateStatus('Scanning OneDrive for all photos...', true, 0, 100);

        // --- STEP 2: Crawl OneDrive and "touch" all existing files with the new scan ID ---
        await fetchAllPhotos(newScanId, (progress) => {
            updateStatus(`Scanning... Found ${progress.count} photos so far.`, true, 0, 100);
        });
        
        // --- STEP 3: Clean up files that were not touched (i.e., deleted from OneDrive) ---
        updateStatus('Cleaning up deleted files...', true, 0, 100);
        await db.deletePhotosNotMatchingScanId(newScanId);
        
        const totalPhotos = await db.getPhotoCount();
        updateStatus(`Scan complete. Total photos: ${totalPhotos}. Now generating embeddings for new files...`, true, 0, totalPhotos);
        
        // --- STEP 4: Generate embeddings for only the new files ---
        // generateEmbeddings() will automatically find files with embedding_status = 0
        await generateEmbeddings();

    } catch (error) {
        console.error('Scan failed:', error);
        updateStatus(`Error during scan: ${error.message}`, false);
    } finally {
        // Re-enable the button regardless of outcome
        startScanButton.disabled = false;
    }
}

async function fetchThumbnailAsBlobURL(fileId, token) {
    const url = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/thumbnails/0/large/content`;
    const options = {
        headers: {
            Authorization: `Bearer ${token}`
        }
    };
    try {
        const response = await fetch(url, options);
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

async function generateEmbeddings() {
    return new Promise(async (resolve, reject) => {
        const photosToProcess = await db.getPhotosWithoutEmbedding();
        const totalToProcess = photosToProcess.length;

        if (totalToProcess === 0) {
            updateStatus('All photos are already processed.', false);
            startAnalysisButton.disabled = false;
            resolve();
            return;
        }

        updateStatus(`Preparing to process ${totalToProcess} new photos...`);

        embeddingWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        
        let processedCount = 0;
        let modelIsReady = false;
        // --- NEW: Map to track blob URLs for memory cleanup ---
        const objectUrlMap = new Map();

        embeddingWorker.onmessage = async (event) => {
            const { file_id, embedding, status, error } = event.data;
            
            // --- NEW: Revoke the blob URL after use to prevent memory leaks ---
            const objectUrl = objectUrlMap.get(file_id);
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
                objectUrlMap.delete(file_id);
            }

            if (status === 'model_loading') {
                updateStatus('Loading AI Model... (This may take a moment)');
            } else if (status === 'model_ready') {
                modelIsReady = true;
                updateStatus('Model loaded. Starting photo analysis...', true, processedCount, totalToProcess);
            } else if (status === 'complete') {
                processedCount++;
                await db.updatePhotoEmbedding(file_id, embedding);
                if (modelIsReady) {
                    updateStatus(`Processing photos...`, true, processedCount, totalToProcess);
                }
                
                if (processedCount === totalToProcess) {
                    embeddingWorker.terminate();
                    updateStatus('All photos processed! Ready for analysis.', false);
                    startAnalysisButton.disabled = false;
                    resolve();
                }
            } else if (status === 'error') {
                console.error(`Worker error for file ${file_id}:`, error);
                processedCount++; // Skip this one
                 if (processedCount === totalToProcess) {
                    embeddingWorker.terminate();
                    updateStatus('Processing finished with some errors.', false);
                    startAnalysisButton.disabled = false;
                    resolve();
                }
            }
        };

        embeddingWorker.onerror = (err) => {
            console.error('Worker failed:', err);
            updateStatus(`A critical worker error occurred: ${err.message}`, false);
            reject(err);
        };
        
        // --- NEW: Processing loop that fetches blobs ---
        const token = await getAuthToken(); // Get token once before the loop
        for (const photo of photosToProcess) {
            const blobUrl = await fetchThumbnailAsBlobURL(photo.file_id, token);
            if (blobUrl) {
                // Store the blob URL so we can revoke it later
                objectUrlMap.set(photo.file_id, blobUrl);
                
                // Send the local blob URL to the worker
                embeddingWorker.postMessage({
                    file_id: photo.file_id,
                    thumbnail_url: blobUrl 
                });
            } else {
                // If fetching a thumbnail fails, we still need to advance the counter
                // so the process can complete.
                processedCount++;
                console.warn(`Skipping photo ${photo.file_id} due to thumbnail fetch failure.`);
                 if (processedCount === totalToProcess) {
                    embeddingWorker.terminate();
                    updateStatus('Processing finished with some errors.', false);
                    startAnalysisButton.disabled = false;
                    resolve();
                }
            }
        }
    });
}

async function runAnalysis() {
    startAnalysisButton.disabled = true;
    updateStatus('Analyzing photos... this may take a few minutes.', true, 0, 100);
    try {
        const allPhotos = await db.getAllPhotosWithEmbedding();
        if(allPhotos.length === 0) {
            updateStatus('No photos with embeddings found to analyze.', false);
            startAnalysisButton.disabled = false;
            return;
        }

        updateStatus(`Analyzing ${allPhotos.length} photos...`, true, 25, 100);

        // --- NEW: Prepare prompt embeddings for scoring ---
        const promptEmbeddings = await getPromptEmbeddings(clipTextEncoder);

        setTimeout(async () => {
            let similarGroups = await findSimilarGroups(allPhotos, (progress) => {
                updateStatus(`Analyzing... ${progress.toFixed(0)}% complete.`, true, 25 + (progress * 0.75), 100);
            });

            // --- NEW: Score and sort each group ---
            for (const group of similarGroups) {
                group.photos.forEach(photo => {
                    photo.qualityScore = scorePhotoEmbedding(photo.embedding, promptEmbeddings);
                });
                group.photos.sort((a, b) => b.qualityScore - a.qualityScore);
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
    }

    // STEP 4: Add event listeners now that MSAL is ready
    loginButton.addEventListener('click', handleLoginClick);
    startScanButton.addEventListener('click', runPhotoScan);
    startAnalysisButton.addEventListener('click', runAnalysis);
}

// Start the application
main();