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
    
    // Handle throttling
    if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || 2;
        console.warn(`Throttled by Graph API. Retrying in ${retryAfter} seconds.`);
        await new Promise(res => setTimeout(res, retryAfter * 1000));
        return fetchWithAutoRefresh(url, options, getAuthToken, false); // Don't retry auth again
    }
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error.message || `HTTP error! status: ${response.status}`);
    }
    
    return response.json();
}

export async function fetchAllPhotos(scanId, progressCallback, startingFolderId = 'root') {
    const token = await getAuthToken();
    if (!token) throw new Error("Authentication token not available.");

    return new Promise(async (resolve, reject) => {
        const foldersToProcess = [startingFolderId];
        let activeWorkers = 0;
        let totalPhotoCount = await db.getPhotoCount();
        progressCallback({ count: totalPhotoCount });

        const processFolder = async (folderId) => {
            try {
                // Use folder ID instead of path for more reliable access
                let url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children?$expand=thumbnails`;
                
                while (url) {
                    console.log(`Processing folder ID: ${folderId}`);
                    const response = await fetchWithAutoRefresh(url, {}, getAuthToken);
                    
                    const photosInPage = [];
                    for (const item of response.value) {
                        // If it's a folder, add it to the queue for later processing
                        if (item.folder) {
                            foldersToProcess.push(item.id);
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
                console.error(`Failed to process folder ${folderId}:`, error);
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

/**
 * Fetch folders from OneDrive for the folder browser
 * @param {string} folderId - The folder ID to browse (or 'root' for OneDrive root)
 * @returns {Promise<Array>} - Array of folder objects
 */
export async function fetchFolders(folderId = 'root') {
    try {
        const token = await getAuthToken();
        const url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children?$filter=folder ne null&$select=id,name,folder,parentReference&$orderby=name`;
        
        const response = await fetchWithAutoRefresh(url, {}, getAuthToken);
        
        const folders = response.value.map(item => ({
            id: item.id,
            name: item.name,
            isFolder: true,
            parentId: item.parentReference?.id || null,
            path: item.parentReference?.path || ''
        }));

        return folders;
    } catch (error) {
        console.error('Error fetching folders:', error);
        throw error;
    }
}

/**
 * Get folder information by ID
 * @param {string} folderId - The folder ID
 * @returns {Promise<Object>} - Folder information
 */
export async function getFolderInfo(folderId = 'root') {
    try {
        const token = await getAuthToken();
        const url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}`;
        
        const response = await fetchWithAutoRefresh(url, {}, getAuthToken);
        
        return {
            id: response.id,
            name: response.name,
            path: response.parentReference?.path || '/drive/root:',
            parentId: response.parentReference?.id || null
        };
    } catch (error) {
        console.error('Error fetching folder info:', error);
        throw error;
    }
}