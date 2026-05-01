import { getAuthToken } from './auth.js';
import { db } from './db.js';

/**
 * Photo Delete Manager Module
 * Handles photo deletion with confirmation and cleanup
 */

/**
 * Delete a photo from OneDrive and local database
 * @param {string} fileId - The file ID to delete
 * @returns {Promise<{success: boolean, alreadyDeleted: boolean, error: string|null}>} - Deletion result
 */
export async function deletePhotoFromOneDrive(fileId) {
    const token = await getAuthToken();
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
    });
    
    // 404 means already deleted - treat as success
    if (response.status === 404) {
        console.log(`Photo ${fileId} already deleted (404), cleaning up from database`);
        await db.deletePhotos([fileId]);
        return { success: true, alreadyDeleted: true, error: null };
    }
    
    // Other errors should be reported
    if (!response.ok) {
        const errorMsg = `${response.status} ${response.statusText}`;
        console.error(`Failed to delete photo ${fileId}: ${errorMsg}`);
        return { success: false, alreadyDeleted: false, error: errorMsg };
    }
    
    // Success - remove from database
    await db.deletePhotos([fileId]);
    return { success: true, alreadyDeleted: false, error: null };
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
    
    // Track results
    let deletedCount = 0;
    let alreadyDeletedCount = 0;
    let failedCount = 0;
    const failures = [];
    
    for (const photo of photos) {
        const result = await deletePhotoFromOneDrive(photo.file_id);
        
        if (result.success) {
            if (result.alreadyDeleted) {
                alreadyDeletedCount++;
            } else {
                deletedCount++;
            }
        } else {
            failedCount++;
            failures.push({ name: photo.name, error: result.error });
        }
    }
    
    // Call onSuccess if any photos were removed (deleted or already deleted)
    if ((deletedCount + alreadyDeletedCount) > 0 && onSuccess) {
        onSuccess();
    }
    
    // Build status message
    let statusParts = [];
    if (deletedCount > 0) {
        statusParts.push(`${deletedCount} deleted`);
    }
    if (alreadyDeletedCount > 0) {
        statusParts.push(`${alreadyDeletedCount} already gone`);
    }
    if (failedCount > 0) {
        statusParts.push(`${failedCount} failed`);
    }
    
    const statusMessage = photos.length === 1 
        ? (deletedCount > 0 ? `Photo "${photoName}" deleted successfully` : 
           alreadyDeletedCount > 0 ? `Photo "${photoName}" was already deleted` :
           `Failed to delete photo "${photoName}"`)
        : `${photos.length} photos processed: ${statusParts.join(', ')}`;
    
    if (updateStatusFn) {
        updateStatusFn(statusMessage, false);
    }
    
    // Show detailed error info if there were failures
    if (failedCount > 0) {
        console.error('Failed deletions:', failures);
        const errorDetails = failures.map(f => `${f.name}: ${f.error}`).join('\n');
        alert(`Some photos could not be deleted:\n\n${errorDetails}`);
    }
}

