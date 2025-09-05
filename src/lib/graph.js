import { getAuthToken } from './auth.js';
import { db } from './db.js';

// The starting point for our recursive scan.
const STARTING_FOLDER_PATH = '/';
// The number of parallel requests to make to the Graph API.
const MAX_CONCURRENCY = 5;

async function fetchWithRetry(url, options) {
    try {
        const response = await fetch(url, options);
        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After') || 2;
            console.warn(`Throttled by Graph API. Retrying in ${retryAfter} seconds.`);
            await new Promise(res => setTimeout(res, retryAfter * 1000));
            return fetchWithRetry(url, options);
        }
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error.message || `HTTP error! status: ${response.status}`);
        }
        return response.json();
    } catch (error) {
        console.error("Fetch failed:", error);
        throw error;
    }
}

// Helper: fetch with auto token refresh on 401/403
async function fetchWithAutoRefresh(url, options, getAuthToken, retry = true) {
    let token = await getAuthToken();
    options = options || {};
    options.headers = options.headers || {};
    options.headers['Authorization'] = `Bearer ${token}`;
    let response = await fetch(url, options);
    if ((response.status === 401 || response.status === 403) && retry) {
        // Token might be expired, try to get a new one and retry once
        token = await getAuthToken(true); // force refresh
        options.headers['Authorization'] = `Bearer ${token}`;
        response = await fetch(url, options);
    }
    return response;
}

export async function fetchAllPhotos(scanId, progressCallback) {
    const token = await getAuthToken();
    if (!token) throw new Error("Authentication token not available.");

    return new Promise(async (resolve, reject) => {
        const foldersToProcess = [STARTING_FOLDER_PATH];
        let activeWorkers = 0;
        let totalPhotoCount = await db.getPhotoCount();
        progressCallback({ count: totalPhotoCount });

        const processFolder = async (folderPath) => {
            try {

                // The API endpoint for getting children of a specific folder by path
                let url = `https://graph.microsoft.com/v1.0/me/drive/root:${encodeURIComponent(folderPath)}:/children?$expand=thumbnails`;
                if (folderPath === '/') {
                    // Special case for root folder, use the root endpoint
                    url = 'https://graph.microsoft.com/v1.0/me/drive/root/children?$expand=thumbnails';
                }
                while (url) {
                    console.log(`Processing url: ${url} for folder: ${folderPath}`);
                    const options = { headers: { Authorization: `Bearer ${token}` } };
                    const response = await fetchWithAutoRefresh(url, options, getAuthToken);
                    
                    const photosInPage = [];
                    for (const item of response.value) {
                        // If it's a folder, add it to the queue for later processing
                        if (item.folder) {
                            // Construct the full path for the new folder
                            const newPath = `${folderPath === '/' ? '' : folderPath}/${item.name}`;
                            foldersToProcess.push(newPath);
                        } 
                        // If it's a photo with a thumbnail, process it
                        else if (item.photo && item.thumbnails && item.thumbnails.length > 0) {
                            photosInPage.push({
                                file_id: item.id,
                                name: item.name,
                                path: item.parentReference?.path,
                                photo_taken_ts: item.photo.takenDateTime ? new Date(item.photo.takenDateTime).getTime() : new Date(item.createdDateTime).getTime(),
                                thumbnail_url: item.thumbnails[0]?.large?.url, 
                                embedding_status: 0,
                                embedding: null,
                                scan_id: scanId
                            });
                        }
                    }

                    // Batch-add photos to the database to improve performance
                    if (photosInPage.length > 0) {
                        await db.addOrUpdatePhotos(photosInPage);
                        totalPhotoCount = await db.getPhotoCount();
                        progressCallback({ count: totalPhotoCount });
                    }
                    
                    url = response['@odata.nextLink'];
                }
            } catch (error) {
                console.error(`Failed to process folder ${folderPath}:`, error);
                // We continue processing other folders even if one fails
            } finally {
                // This worker is now finished
                activeWorkers--;
            }
        };

        // This is the main loop that manages the worker pool
        const mainLoop = async () => {
            while (true) {
                // If there are folders to process and we have free workers, start a new one
                if (foldersToProcess.length > 0 && activeWorkers < MAX_CONCURRENCY) {
                    activeWorkers++;
                    const folderPath = foldersToProcess.shift();
                    console.log(`[Worker starting] Processing: ${folderPath}. Queue size: ${foldersToProcess.length}`);
                    // Start the process but don't wait for it to finish here
                    processFolder(folderPath);
                }
                
                // If the queue is empty and all workers are done, the scan is complete
                if (foldersToProcess.length === 0 && activeWorkers === 0) {
                    console.log("Scan complete. All folders processed.");
                    resolve(await db.getPhotoCount());
                    return;
                }
                
                // Wait a moment before checking again to avoid a busy-loop
                await new Promise(res => setTimeout(res, 100));
            }
        };

        // Start the manager loop
        mainLoop();
    });
}