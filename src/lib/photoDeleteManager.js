import { getAuthToken } from './auth.js';
import { db } from './db.js';

/**
 * Photo Delete Manager Module
 * Handles photo deletion with confirmation and cleanup
 */

/**
 * Delete a photo from OneDrive and local database
 * @param {string} fileId - The file ID to delete
 * @returns {Promise<boolean>} - Success status
 */
export async function deletePhotoFromOneDrive(fileId) {
    const token = await getAuthToken();
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!response.ok) {
        throw new Error(`Failed to delete: ${response.status} ${response.statusText}`);
    }
    
    await db.deletePhotos([fileId]);
    return true;
}

/**
 * Delete multiple photos with confirmation
 * @param {Array<Object>} photos - Photos to delete
 * @param {Function} updateStatusFn - Function to update status display
 * @param {Function} onSuccess - Callback after successful deletion
 * @returns {Promise<void>}
 */
export async function deletePhotosWithConfirmation(photos, updateStatusFn, onSuccess) {
    if (photos.length === 0) {
        alert('No photos selected for deletion.');
        return;
    }
    
    const photoName = photos.length === 1 ? photos[0].name : null;
    const confirmMessage = photos.length === 1 
        ? `Delete "${photoName}"? This cannot be undone.`
        : `Delete ${photos.length} photo(s)? This cannot be undone.`;
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    if (updateStatusFn) {
        updateStatusFn(`Deleting ${photos.length} photo(s)...`, true);
    }
    
    try {
        for (const photo of photos) {
            await deletePhotoFromOneDrive(photo.file_id);
        }
        
        if (onSuccess) {
            onSuccess();
        }
        
        const successMessage = photos.length === 1 
            ? `Photo "${photoName}" deleted successfully`
            : `${photos.length} photos deleted successfully`;
        
        if (updateStatusFn) {
            updateStatusFn(successMessage, false);
        }
    } catch (err) {
        if (updateStatusFn) {
            updateStatusFn('Error deleting photos: ' + err.message, false);
        }
        throw err;
    }
}

