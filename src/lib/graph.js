import { getAuthToken } from './auth.js';
import { db } from './db.js';

const GRAPH_ENDPOINT = 'https://graph.microsoft.com/v1.0/me/drive/special/photos/children?$select=id,name,photo,parentReference,thumbnails,createdDateTime&$top=200';

async function fetchWithRetry(url, options, retries = 3, delay = 1000) {
    try {
        const response = await fetch(url, options);
        if (response.status === 429) { // Throttled
            if (retries > 0) {
                const retryAfter = response.headers.get('Retry-After') || delay / 1000;
                console.warn(`Throttled by Graph API. Retrying in ${retryAfter} seconds.`);
                await new Promise(res => setTimeout(res, retryAfter * 1000));
                return fetchWithRetry(url, options, retries - 1, delay * 2);
            } else {
                throw new Error('Exceeded max retries for Graph API throttling.');
            }
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


export async function fetchAllPhotos(progressCallback) {
    const token = await getAuthToken();
    if (!token) throw new Error("Authentication token not available.");

    let url = GRAPH_ENDPOINT;
    let photoCount = 0;

    while (url) {
        const options = {
            headers: {
                Authorization: `Bearer ${token}`
            }
        };

        const response = await fetchWithRetry(url, options);
        
        const photos = response.value
            .filter(item => item.photo) // Ensure it's a photo
            .map(item => ({
                file_id: item.id,
                name: item.name,
                path: item.parentReference.path,
                photo_taken_ts: item.photo.takenDateTime ? new Date(item.photo.takenDateTime).getTime() : new Date(item.createdDateTime).getTime(),
                thumbnail_url: item.thumbnails[0]?.large?.url, // Use large thumbnail
                embedding_status: 0, // 0 = new, 1 = done
                embedding: null
            }));
            
        await db.addPhotos(photos);
        photoCount += photos.length;
        if (progressCallback) progressCallback({ count: photoCount });

        url = response['@odata.nextLink'];
    }
    
    return photoCount;
}