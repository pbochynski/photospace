import { getAuthToken } from './auth.js';
import { db } from './db.js';

async function fetchWithAutoRefresh(url, options, getAuthToken, retry = true) {
    let token = await getAuthToken();
    options = options || {};
    options.headers = options.headers || {};
    options.headers['Authorization'] = `Bearer ${token}`;
    let response = await fetch(url, options);
    if ((response.status === 401 || response.status === 403) && retry) {
        token = await getAuthToken(true);
        options.headers['Authorization'] = `Bearer ${token}`;
        response = await fetch(url, options);
    }

    if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || 2;
        console.warn(`Throttled by Graph API. Retrying in ${retryAfter} seconds.`);
        await new Promise(res => setTimeout(res, retryAfter * 1000));
        return fetchWithAutoRefresh(url, options, getAuthToken, false);
    }

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error.message || `HTTP error! status: ${response.status}`);
    }

    return response.json();
}

export async function fetchPhotosFromSingleFolder(scanId, folderId = 'root') {
    const token = await getAuthToken();
    if (!token) throw new Error("Authentication token not available.");

    let photoCount = 0;
    let nextPageUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`;

    while (nextPageUrl) {
        const response = await fetchWithAutoRefresh(nextPageUrl, {}, getAuthToken);

        const itemsInPage = [];
        for (const item of response.value) {
            if (item.video) {
                itemsInPage.push({
                    file_id: item.id,
                    name: item.name,
                    size: item.size,
                    path: item.parentReference?.path || '/drive/root:',
                    folder_id: folderId,
                    last_modified: item.lastModifiedDateTime,
                    photo_taken_ts: item.createdDateTime,
                    thumbnail_url: null,
                    scan_id: scanId,
                    item_type: 'video',
                    video_duration_ms: item.video.duration ?? null,
                    video_codec: item.video.fourCC ?? null,
                    video_bitrate: item.video.bitrate ?? null,
                    video_width: item.video.width ?? null,
                    video_height: item.video.height ?? null,
                });
                photoCount++;
            } else if (item.photo) {
                itemsInPage.push({
                    file_id: item.id,
                    name: item.name,
                    size: item.size,
                    path: item.parentReference?.path || '/drive/root:',
                    folder_id: folderId,
                    last_modified: item.lastModifiedDateTime,
                    photo_taken_ts: item.photo.takenDateTime ?? item.createdDateTime,
                    thumbnail_url: null,
                    scan_id: scanId,
                    item_type: 'photo',
                });
                photoCount++;
            }
        }

        if (itemsInPage.length > 0) {
            await db.addOrUpdatePhotos(itemsInPage);
        }

        nextPageUrl = response['@odata.nextLink'] || null;
    }

    console.log(`Processed ${photoCount} photos from folder ${folderId}`);
    return photoCount;
}

export async function getFolderChildren(folderId = 'root') {
    const token = await getAuthToken();
    if (!token) throw new Error('Not authenticated');
    const url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children?$filter=folder ne null&$select=id,name,folder,parentReference`;
    const response = await fetchWithAutoRefresh(url, {}, getAuthToken);
    return response.value || [];
}

export async function getRootFolders() {
    return getFolderChildren('root');
}
