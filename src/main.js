import { msalInstance, login, logout, getAuthToken } from './lib/auth.js';
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
    statusText.textContent = text;
    if (showProgress) {
        progressBar.style.display = 'block';
        progressBar.value = progressValue;
        progressBar.max = progressMax;
    } else {
        progressBar.style.display = 'none';
    }
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

async function handleLogin() {
    try {
        const account = await login();
        if (account) {
            loginButton.style.display = 'none';
            userInfo.textContent = `Welcome, ${account.name}`;
            userInfo.style.display = 'block';
            mainContent.style.display = 'block';
            await db.init();
            updateStatus('Ready. Click "Scan OneDrive Photos" to begin.');
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
        const token = await getAuthToken();
        if (!token) {
            updateStatus('Authentication failed. Please log in again.', false);
            return;
        }

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

        updateStatus(`Processing ${totalToProcess} new photos...`, true, 0, totalToProcess);

        embeddingWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        
        let processedCount = 0;

        embeddingWorker.onmessage = async (event) => {
            const { file_id, embedding, status, error } = event.data;

            if (status === 'ready') {
                // Worker is ready, start sending photos
                photosToProcess.forEach(photo => {
                    embeddingWorker.postMessage({
                        file_id: photo.file_id,
                        thumbnail_url: photo.thumbnail_url
                    });
                });
            } else if (status === 'complete') {
                processedCount++;
                await db.updatePhotoEmbedding(file_id, embedding);
                updateStatus(`Processing photos...`, true, processedCount, totalToProcess);
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
        
        // This can be slow, so we can run it in a non-blocking way if needed,
        // but for V1 we'll do it directly.
        setTimeout(async () => {
            const similarGroups = await findSimilarGroups(allPhotos, (progress) => {
                 updateStatus(`Analyzing... ${progress.toFixed(0)}% complete.`, true, 25 + (progress * 0.75), 100);
            });
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


// --- Event Listeners ---
loginButton.addEventListener('click', handleLogin);
startScanButton.addEventListener('click', runPhotoScan);
startAnalysisButton.addEventListener('click', runAnalysis);

// --- Initial State Check ---
msalInstance.handleRedirectPromise().then((response) => {
    if (response && response.account) {
        msalInstance.setActiveAccount(response.account);
        handleLogin();
    }
});

// Check if user is already logged in
const accounts = msalInstance.getAllAccounts();
if (accounts.length > 0) {
    msalInstance.setActiveAccount(accounts[0]);
    handleLogin();
}