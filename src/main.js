import { msalInstance, login, getAuthToken } from './lib/auth.js';
import { fetchAllPhotos } from './lib/graph.js';
import { db } from './lib/db.js';
import { findSimilarGroups } from './lib/analysis.js';

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
    const statusText = document.getElementById('status-text');
    const progressBar = document.getElementById('progress-bar');
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
    resultsContainer.innerHTML = '<h2>Similar Photo Groups</h2>'; // Clear placeholder
    if (groups.length === 0) {
        resultsContainer.innerHTML += '<p>No significant groups of similar photos found.</p>';
        return;
    }

    groups.forEach(group => {
        const groupElement = document.createElement('div');
        groupElement.className = 'similarity-group';

        const groupDate = new Date(group.timestamp).toLocaleDateString();
        groupElement.innerHTML = `
            <div class="group-header">
                <h3>${group.photos.length} similar photos from ${groupDate}</h3>
                <p>Similarity Score: >${(group.similarity * 100).toFixed(0)}%</p>
            </div>
            <div class="photo-grid">
                ${group.photos.map(p => `<div class="photo-item"><img src="${p.thumbnail_url}" alt="${p.name}" loading="lazy"></div>`).join('')}
            </div>
        `;
        resultsContainer.appendChild(groupElement);
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
    updateStatus('Starting scan... Authenticating...', true, 0, 100);
    try {
        await fetchAllPhotos((progress) => {
            updateStatus(`Found ${progress.count} photos...`, true, 0, 100);
        });
        
        const totalPhotos = await db.getPhotoCount();
        updateStatus(`Scan complete. Found ${totalPhotos} photos. Now generating embeddings...`, true, 0, totalPhotos);
        
        await generateEmbeddings();

    } catch (error) {
        console.error('Scan failed:', error);
        updateStatus(`Error during scan: ${error.message}`, false);
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
            break; // Break here to avoid sending all photos at once
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
        
        setTimeout(async () => {
            const similarGroups = await findSimilarGroups(allPhotos, (progress) => {
                 updateStatus(`Analyzing... ${progress.toFixed(0)}% complete.`, true, 25 + (progress * 0.75), 100);
            });
            displayResults(similarGroups);
            updateStatus('Analysis complete!', false);
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