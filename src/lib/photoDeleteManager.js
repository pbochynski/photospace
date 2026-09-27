import { getAuthToken } from './auth.js';
import { db } from './db.js';

export async function deletePhotoFromOneDrive(fileId) {
    const token = await getAuthToken();
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
    });

    if (response.status === 404) {
        console.log(`Photo ${fileId} already deleted (404), cleaning up from database`);
        await db.deletePhotos([fileId]);
        return { success: true, alreadyDeleted: true, error: null };
    }

    if (!response.ok) {
        const errorMsg = `${response.status} ${response.statusText}`;
        console.error(`Failed to delete photo ${fileId}: ${errorMsg}`);
        return { success: false, alreadyDeleted: false, error: errorMsg };
    }

    await db.deletePhotos([fileId]);
    return { success: true, alreadyDeleted: false, error: null };
}
