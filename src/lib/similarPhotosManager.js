import { db } from './db.js';
import { getFolderPath } from './graph.js';
import { updateURLWithSimilarPhoto, clearSimilarPhotoFromURL, pathToDisplayName } from './urlStateManager.js';

/**
 * Similar Photos Manager Module
 * Handles finding and displaying similar photos
 */

/**
 * Calculate cosine similarity between two embedding vectors
 * @param {Array<number>} embedding1 - First embedding vector
 * @param {Array<number>} embedding2 - Second embedding vector
 * @returns {number} - Similarity score between 0 and 1
 */
export function cosineSimilarity(embedding1, embedding2) {
    if (!embedding1 || !embedding2 || embedding1.length !== embedding2.length) {
        return 0;
    }
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < embedding1.length; i++) {
        dotProduct += embedding1[i] * embedding2[i];
        norm1 += embedding1[i] * embedding1[i];
        norm2 += embedding2[i] * embedding2[i];
    }
    
    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Find photos similar to a reference photo
 * @param {string} referenceFileId - File ID of the reference photo
 * @param {number} maxResults - Maximum number of similar photos to return
 * @returns {Promise<Array>} - Array of similar photos with similarity scores
 */
export async function findSimilarToPhoto(referenceFileId, maxResults = 20) {
    try {
        // Get the reference photo with its embedding
        const referencePhoto = await db.getPhotoById(referenceFileId);
        
        if (!referencePhoto || !referencePhoto.embedding) {
            throw new Error('Reference photo not found or has no embedding');
        }
        
        // Get all photos with embeddings (excluding the reference photo itself)
        const allPhotos = await db.getAllPhotosWithEmbedding();
        const otherPhotos = allPhotos.filter(p => p.file_id !== referenceFileId);
        
        if (otherPhotos.length === 0) {
            return [];
        }
        
        // Calculate similarity for each photo using CLIP embeddings
        const photosWithScores = otherPhotos.map(photo => {
            const similarity = cosineSimilarity(referencePhoto.embedding, photo.embedding);
            
            return {
                ...photo,
                similarity
            };
        });
        
        // Sort by similarity (highest first) and take top results
        photosWithScores.sort((a, b) => b.similarity - a.similarity);
        
        return photosWithScores.slice(0, maxResults);
    } catch (error) {
        console.error('Error finding similar photos:', error);
        throw error;
    }
}

/**
 * Handle "Find Similar Photos" button click
 * @param {Object} currentPhoto - Current photo in modal
 * @param {HTMLElement} findSimilarBtn - Find similar button element
 * @param {Function} updateStatusFn - Function to update status
 * @param {Function} displayResultsFn - Function to display results
 * @param {Function} closeModalFn - Function to close modal
 * @param {Function} scrollToResultsFn - Function to scroll to results panel
 * @returns {Promise<void>}
 */
export async function handleFindSimilarClick(
    currentPhoto,
    findSimilarBtn,
    updateStatusFn,
    displayResultsFn,
    closeModalFn,
    scrollToResultsFn
) {
    if (!currentPhoto || !currentPhoto.file_id) {
        alert('No photo selected');
        return;
    }
    
    // Check if photo has embedding
    if (!currentPhoto.embedding) {
        alert('This photo needs to be processed first (no embedding available)');
        return;
    }
    
    try {
        // Disable button during search
        if (findSimilarBtn) {
            findSimilarBtn.disabled = true;
            findSimilarBtn.textContent = '🔍 Searching...';
        }
        
        updateStatusFn('Finding similar photos...', false);
        
        // Find similar photos (default 50 results)
        const similarPhotos = await findSimilarToPhoto(currentPhoto.file_id, 50);
        
        // Update URL with query parameter
        updateURLWithSimilarPhoto(currentPhoto.file_id);
        
        // Display results
        displayResultsFn(similarPhotos, 'similar-to', currentPhoto);
        
        // Close the modal
        closeModalFn();
        
        // Scroll to results panel
        scrollToResultsFn();
        
        updateStatusFn(`Found ${similarPhotos.length} similar photos`, false);
        
    } catch (error) {
        console.error('Error finding similar photos:', error);
        alert(`Failed to find similar photos: ${error.message}`);
        updateStatusFn('Error finding similar photos', false);
    } finally {
        // Re-enable button
        if (findSimilarBtn) {
            findSimilarBtn.disabled = false;
            findSimilarBtn.textContent = '🔍 Find Similar Photos';
        }
    }
}

/**
 * Clear similar photos search
 * @param {Object} refs - References to UI elements and state
 * @param {Function} updateStatusFn - Function to update status
 * @returns {void}
 */
export function clearSimilarPhotosSearch(refs, updateStatusFn) {
    // Clear results
    refs.currentResultsType = null;
    refs.currentReferencePhoto = null;
    refs.currentAnalysisResults = null;
    
    if (refs.resultsTypeLabel) {
        refs.resultsTypeLabel.textContent = 'No results yet';
    }
    
    if (refs.resultsContainer) {
        refs.resultsContainer.innerHTML = '<p class="placeholder">Run similarity analysis or series analysis to see results here.</p>';
    }
    
    // Remove URL parameter
    clearSimilarPhotoFromURL();
    
    updateStatusFn('Similar photos search cleared', false);
}

/**
 * Restore similar photos view from URL parameter
 * @param {Function} updateStatusFn - Function to update status
 * @param {Function} displayResultsFn - Function to display results
 * @returns {Promise<void>}
 */
export async function restoreSimilarPhotosFromURL(updateStatusFn, displayResultsFn) {
    const urlParams = new URLSearchParams(window.location.search);
    const fileId = urlParams.get('similar-to');
    
    if (!fileId) return;
    
    try {
        updateStatusFn('Restoring similar photos view...', false);
        
        // Get reference photo
        const referencePhoto = await db.getPhotoById(fileId);
        if (!referencePhoto || !referencePhoto.embedding) {
            console.warn('Reference photo not found or has no embedding:', fileId);
            // Clear invalid URL parameter
            clearSimilarPhotoFromURL();
            return;
        }
        
        // Find similar photos (50 results)
        const similarPhotos = await findSimilarToPhoto(fileId, 50);
        
        // Display results
        displayResultsFn(similarPhotos, 'similar-to', referencePhoto);
        
        updateStatusFn(`Restored similar photos view (${similarPhotos.length} photos)`, false);
        
    } catch (error) {
        console.error('Error restoring similar photos from URL:', error);
        clearSimilarPhotoFromURL();
    }
}

/**
 * Navigate to photo's folder in browser and scroll to the photo
 * @param {Object} currentPhoto - Current photo to view in folder
 * @param {Function} findFolderIdByPathFn - Function to find folder ID by path
 * @param {Function} updateBrowserStateFn - Function to update browser state
 * @param {Function} closeModalFn - Function to close modal
 * @param {Function} renderBrowserFn - Function to render browser grid
 * @param {Function} scrollToPhotoFn - Function to scroll to and highlight photo
 * @param {Function} updateStatusFn - Function to update status
 * @param {HTMLElement} viewInFolderBtn - View in folder button element
 * @returns {Promise<void>}
 */
export async function viewPhotoInFolder(
    currentPhoto,
    findFolderIdByPathFn,
    updateBrowserStateFn,
    closeModalFn,
    renderBrowserFn,
    scrollToPhotoFn,
    updateStatusFn,
    viewInFolderBtn
) {
    if (!currentPhoto || !currentPhoto.file_id) {
        alert('No photo selected');
        return;
    }
    
    try {
        // Disable button during navigation
        if (viewInFolderBtn) {
            viewInFolderBtn.disabled = true;
            viewInFolderBtn.textContent = '📁 Loading...';
        }
        
        updateStatusFn('Navigating to folder...', false);
        
        // Get photo's folder path
        const photoPath = currentPhoto.path || '/drive/root:';
        
        // Find folder ID for the path
        const folderId = await findFolderIdByPathFn(photoPath);
        if (!folderId) {
            throw new Error('Could not find folder for path: ' + photoPath);
        }
        
        // Update browser state to this folder
        updateBrowserStateFn(folderId, photoPath, pathToDisplayName(photoPath));
        
        // Close the modal
        closeModalFn();
        
        // Render the browser grid
        await renderBrowserFn(true);
        
        // Scroll to browser panel
        const browserPanel = document.querySelector('[data-panel-key="browser"]');
        if (browserPanel) {
            browserPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        // Wait for grid to render, then scroll to and highlight the photo
        await scrollToPhotoFn(currentPhoto.file_id);
        
    } catch (error) {
        console.error('Error viewing photo in folder:', error);
        alert(`Failed to open folder: ${error.message}`);
        updateStatusFn('Error opening folder', false);
    } finally {
        // Re-enable button
        if (viewInFolderBtn) {
            viewInFolderBtn.disabled = false;
            viewInFolderBtn.textContent = '📁 View in Folder';
        }
    }
}

