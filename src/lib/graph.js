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

/**
 * Fetch photos from a single folder only (non-recursive)
 * @param {number} scanId - The scan ID to associate with photos
 * @param {string} folderId - The folder ID to scan
 * @returns {Promise<number>} - Number of photos processed
 */
export async function fetchPhotosFromSingleFolder(scanId, folderId = 'root') {
    const token = await getAuthToken();
    if (!token) throw new Error("Authentication token not available.");

    let photoCount = 0;
    let url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`;
    
    while (url) {
        console.log(`Processing single folder ID: ${folderId}`);
        const response = await fetchWithAutoRefresh(url, {}, getAuthToken);
        
        const photosInPage = [];
        for (const item of response.value) {
            // Only process photos, skip folders completely
            if (item.photo) {
                const folderPath = item.parentReference?.path || '/drive/root:';
                const fullPath = folderPath === '/drive/root:' ? 
                    `/drive/root:/${item.name}` : 
                    `${folderPath}/${item.name}`;

                const photoMetadata = {
                    file_id: item.id,
                    name: item.name,
                    size: item.size,
                    path: fullPath,
                    last_modified: item.lastModifiedDateTime,
                    photo_taken_ts: item.photo.takenDateTime,
                    scan_id: scanId
                };

                photosInPage.push(photoMetadata);
                photoCount++;
            }
        }

        // Save photos to database
        if (photosInPage.length > 0) {
            await db.addOrUpdatePhotos(photosInPage);
        }

        // Check for next page
        url = response['@odata.nextLink'] || null;
    }

    console.log(`Processed ${photoCount} photos from folder ${folderId}`);
    
    // Clean up photos only from the specific folder we scanned
    const folderPath = await getFolderPath(folderId);
    console.log(`Cleaning up deleted photos from scanned folder: ${folderPath}`);
    try {
        const deletedCount = await db.deletePhotosFromScannedFoldersNotMatchingScanId(scanId, [folderPath]);
        console.log(`Cleanup complete. Removed ${deletedCount} photos that were deleted from the scanned folder.`);
    } catch (error) {
        console.error("Error during cleanup:", error);
    }
    
    return photoCount;
}

export async function fetchAllPhotos(scanId, progressCallback, startingFolderId = 'root') {
    const token = await getAuthToken();
    if (!token) throw new Error("Authentication token not available.");

    return new Promise(async (resolve, reject) => {
        const foldersToProcess = [startingFolderId];
        const scannedFolderPaths = []; // Track which folders we actually scanned
        let activeWorkers = 0;
        let totalPhotoCount = await db.getPhotoCount();
        progressCallback({ count: totalPhotoCount });

        const processFolder = async (folderId) => {
            try {
                // Use folder ID instead of path for more reliable access
                let url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`;
                
                // Get the folder path to track what we're scanning
                const folderPath = await getFolderPath(folderId);
                scannedFolderPaths.push(folderPath);
                
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
                        else if (item.photo) {
                            photosInPage.push({
                                file_id: item.id,
                                name: item.name,
                                path: item.parentReference?.path,
                                photo_taken_ts: item.photo.takenDateTime ? new Date(item.photo.takenDateTime).getTime() : new Date(item.createdDateTime).getTime(),
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
                // TODO clean up photos from this folder that were not updated in this scan
                
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
                    
                    // Clean up photos only from the folders we actually scanned
                    console.log(`Cleaning up deleted photos from ${scannedFolderPaths.length} scanned folders...`);
                    try {
                        const deletedCount = await db.deletePhotosFromScannedFoldersNotMatchingScanId(scanId, scannedFolderPaths);
                        console.log(`Cleanup complete. Removed ${deletedCount} photos that were deleted from scanned folders.`);
                    } catch (error) {
                        console.error("Error during cleanup:", error);
                    }
                    
                    const finalPhotoCount = await db.getPhotoCount();
                    resolve(finalPhotoCount);
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

/**
 * Get the full path for a folder ID (including the folder name)
 * @param {string} folderId - The folder ID
 * @returns {Promise<string>} - Full folder path
 */
export async function getFolderPath(folderId = 'root') {
    if (folderId === 'root') {
        return '/drive/root:';
    }
    
    try {
        const folderInfo = await getFolderInfo(folderId);
        // Combine parent path with folder name
        const parentPath = folderInfo.path === '/drive/root:' ? '/drive/root:' : folderInfo.path;
        return `${parentPath}/${folderInfo.name}`;
    } catch (error) {
        console.error('Error getting folder path:', error);
        return '/drive/root:';
    }
}

/**
 * Upload a file to OneDrive in the app-specific folder
 * @param {string} fileName - Name of the file to create
 * @param {string} fileContent - Content of the file (JSON string)
 * @param {string} folderPath - Folder path (default: /Apps/Photospace)
 * @returns {Promise<Object>} - File upload result
 */
export async function uploadFileToOneDrive(fileName, fileContent, folderPath = '/Apps/Photospace') {
    try {
        const token = await getAuthToken();
        
        // First, ensure the folder exists
        await createAppFolder();
        
        // Convert content to blob to get accurate size
        const blob = new Blob([fileContent]);
        const fileSize = blob.size;
        
        console.log(`File size: ${(fileSize / (1024 * 1024)).toFixed(2)} MB`);
        console.log('Using chunked upload for file');
        
        return await chunkedUpload(fileName, blob, folderPath, token);
        
    } catch (error) {
        console.error('Error uploading file to OneDrive:', error);
        throw error;
    }
}

/**
 * Chunked upload for large files using Microsoft Graph upload session
 */
async function chunkedUpload(fileName, blob, folderPath, token) {
    // Step 1: Create upload session
    const uploadSessionUrl = `https://graph.microsoft.com/v1.0/me/drive/root:${folderPath}/${fileName}:/createUploadSession`;
    
    console.log('Creating upload session...');
    const sessionResponse = await fetchWithAutoRefresh(uploadSessionUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            item: {
                "@microsoft.graph.conflictBehavior": "replace",
                name: fileName
            }
        })
    }, getAuthToken);
    
    const uploadUrl = sessionResponse.uploadUrl;
    
    if (!uploadUrl) {
        throw new Error('Failed to create upload session');
    }
    
    console.log('Upload session created, starting chunked upload...');
    
    // Step 2: Upload file in chunks
    const chunkSize = 10 * 1024 * 1024; // 10MB chunks
    const totalSize = blob.size;
    let uploadedBytes = 0;
    
    while (uploadedBytes < totalSize) {
        const chunkStart = uploadedBytes;
        const chunkEnd = Math.min(uploadedBytes + chunkSize, totalSize);
        const chunk = blob.slice(chunkStart, chunkEnd);
        
        console.log(`Uploading chunk: ${chunkStart}-${chunkEnd-1}/${totalSize} (${((chunkEnd/totalSize)*100).toFixed(1)}%)`);
        
        const chunkResponse = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Range': `bytes ${chunkStart}-${chunkEnd-1}/${totalSize}`,
                'Content-Length': chunk.size.toString()
            },
            body: chunk
        });
        
        if (chunkResponse.status === 202) {
            // Chunk uploaded successfully, continue
            uploadedBytes = chunkEnd;
        } else if (chunkResponse.status === 200 || chunkResponse.status === 201) {
            // Upload completed
            console.log('Upload completed successfully');
            return await chunkResponse.json();
        } else {
            const errorText = await chunkResponse.text();
            console.error('Chunk upload failed:', chunkResponse.status, errorText);
            throw new Error(`Chunk upload failed: ${chunkResponse.status} ${errorText}`);
        }
    }
    
    throw new Error('Upload completed but no final response received');
}

/**
 * Download a file from OneDrive by file ID
 * @param {string} fileId - The OneDrive file ID
 * @returns {Promise<string>} - File content as string
 */
export async function downloadFileFromOneDrive(fileId) {
    try {
        const token = await getAuthToken();
        const downloadUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`;
        
        const response = await fetch(downloadUrl, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to download file: ${response.statusText}`);
        }
        
        return await response.text();
    } catch (error) {
        console.error('Error downloading file from OneDrive:', error);
        throw error;
    }
}

/**
 * List embedding files in the app folder
 * @returns {Promise<Array>} - Array of embedding files
 */
export async function listEmbeddingFiles() {
    try {
        const token = await getAuthToken();
        const listUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/Apps/Photospace:/children?$filter=startswith(name,'photospace_embeddings_')`;
        
        const response = await fetchWithAutoRefresh(listUrl, {}, getAuthToken);
        
        return response.value.map(file => ({
            id: file.id,
            name: file.name,
            size: file.size,
            createdDateTime: file.createdDateTime,
            lastModifiedDateTime: file.lastModifiedDateTime
        }));
    } catch (error) {
        // If folder doesn't exist, return empty array
        if (error.message.includes('404')) {
            return [];
        }
        console.error('Error listing embedding files:', error);
        throw error;
    }
}

/**
 * Delete an embedding file from OneDrive
 * @param {string} fileId - The file ID to delete
 * @returns {Promise<void>}
 */
export async function deleteEmbeddingFile(fileId) {
    try {
        const token = await getAuthToken();
        const deleteUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`;
        
        await fetchWithAutoRefresh(deleteUrl, {
            method: 'DELETE'
        }, getAuthToken);
    } catch (error) {
        console.error('Error deleting embedding file:', error);
        throw error;
    }
}

/**
 * Create the app-specific folder if it doesn't exist
 * @returns {Promise<void>}
 */
async function createAppFolder() {
    try {
        const token = await getAuthToken();
        
        // Try to get the Photospace folder first
        try {
            const checkUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/Apps/Photospace`;
            await fetchWithAutoRefresh(checkUrl, {}, getAuthToken);
            return; // Folder exists
        } catch (error) {
            // Folder doesn't exist, we need to create it
            console.log('Apps/Photospace folder does not exist, creating it...');
        }
        
        // First, try to create or ensure Apps folder exists
        let appsFolder;
        try {
            // Try to get existing Apps folder
            const appsUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/Apps`;
            appsFolder = await fetchWithAutoRefresh(appsUrl, {}, getAuthToken);
        } catch (error) {
            // Apps folder doesn't exist, create it
            console.log('Apps folder does not exist, creating it...');
            const createAppsUrl = `https://graph.microsoft.com/v1.0/me/drive/root/children`;
            
            appsFolder = await fetchWithAutoRefresh(createAppsUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: 'Apps',
                    folder: {},
                    '@microsoft.graph.conflictBehavior': 'replace'
                })
            }, getAuthToken);
        }
        
        // Now create Photospace subfolder inside Apps
        const createPhotospaceUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${appsFolder.id}/children`;
        
        await fetchWithAutoRefresh(createPhotospaceUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: 'Photospace',
                folder: {},
                '@microsoft.graph.conflictBehavior': 'replace'
            })
        }, getAuthToken);
        
        console.log('Successfully created Apps/Photospace folder structure');
        
    } catch (error) {
        // Check if it's a conflict error (folder already exists)
        if (error.message.includes('nameAlreadyExists') || error.message.includes('already exists')) {
            console.log('Folder already exists, continuing...');
            return;
        }
        
        console.error('Error creating app folder:', error);
        throw error;
    }
}