import { db } from './db.js';
import { setDefaultDateRange } from './uiUtils.js';

/**
 * URL State Manager Module
 * Manages URL parameters and state persistence
 */

/**
 * Update URL with current filters
 * @param {Object} state - Application state object
 */
export function updateURLWithFilters(state) {
    const url = new URL(window.location);
    
    // Update folder path
    if (state.selectedFolderPath) {
        url.searchParams.set('path', state.selectedFolderPath);
    } else {
        url.searchParams.delete('path');
    }
    
    // Update date filter enable flag
    const dateEnabledToggle = document.getElementById('date-enabled-toggle');
    const dateEnabled = dateEnabledToggle ? dateEnabledToggle.checked : true;
    
    if (dateEnabled) {
        url.searchParams.set('dateEnabled', 'true');
    } else {
        url.searchParams.set('dateEnabled', 'false');
    }
    
    // Update date range
    const dateFromInput = document.getElementById('date-from');
    const dateToInput = document.getElementById('date-to');
    const dateFrom = dateFromInput?.value;
    const dateTo = dateToInput?.value;
    
    if (dateEnabled && dateFrom) {
        url.searchParams.set('dateFrom', dateFrom);
    } else {
        url.searchParams.delete('dateFrom');
    }
    
    if (dateEnabled && dateTo) {
        url.searchParams.set('dateTo', dateTo);
    } else {
        url.searchParams.delete('dateTo');
    }
    
    window.history.pushState({}, '', url);
}

/**
 * Update URL with folder path (backward compatibility)
 * @param {string} folderPath - Folder path to set in URL
 * @param {Object} state - Application state object
 */
export function updateURLWithPath(folderPath, state) {
    state.selectedFolderPath = folderPath;
    updateURLWithFilters(state);
}

/**
 * Get folder path from URL
 * @returns {string|null} - Folder path or null
 */
export function getPathFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('path') || null;
}

/**
 * Get date filters from URL
 * @returns {Object} - Date filter configuration
 */
export function getDateFiltersFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    return {
        dateEnabled: urlParams.get('dateEnabled') !== 'false',
        dateFrom: urlParams.get('dateFrom') || null,
        dateTo: urlParams.get('dateTo') || null
    };
}

/**
 * Restore date filters from URL
 */
export function restoreDateFiltersFromURL() {
    const dateFilters = getDateFiltersFromURL();
    const dateEnabledToggle = document.getElementById('date-enabled-toggle');
    const dateFromInput = document.getElementById('date-from');
    const dateToInput = document.getElementById('date-to');
    
    // Restore toggle
    if (dateEnabledToggle) {
        dateEnabledToggle.checked = dateFilters.dateEnabled !== false;
    }
    
    if (dateFilters.dateFrom || dateFilters.dateTo) {
        // Restore from URL
        if (dateFromInput) dateFromInput.value = dateFilters.dateFrom || '';
        if (dateToInput) dateToInput.value = dateFilters.dateTo || '';
    } else {
        // Set default to last month
        setDefaultDateRange();
    }
}

/**
 * Convert path to display name
 * @param {string} path - Folder path
 * @returns {string} - Human-readable display name
 */
export function pathToDisplayName(path) {
    if (!path || path === '/drive/root:') {
        return 'OneDrive (Root)';
    }
    // Convert path like "/drive/root:/Pictures/Camera Roll" to "OneDrive / Pictures / Camera Roll"
    const pathParts = path.replace('/drive/root:', '').split('/').filter(part => part.length > 0);
    return 'OneDrive' + (pathParts.length > 0 ? ' / ' + pathParts.join(' / ') : ' (Root)');
}

/**
 * Reset folder to no filter
 * @param {Object} state - Application state object
 */
export function resetFolderToNoFilter(state) {
    state.selectedFolderId = null;
    state.selectedFolderPath = null;
    state.selectedFolderDisplayName = 'All folders';
}

/**
 * Reset to no filter and update URL
 * @param {Object} state - Application state object
 */
export function resetToNoFilter(state) {
    resetFolderToNoFilter(state);
    updateURLWithFilters(state);
}

/**
 * Update URL with similar photo parameter
 * @param {string} fileId - File ID to search similar photos for
 */
export function updateURLWithSimilarPhoto(fileId) {
    const url = new URL(window.location);
    url.searchParams.set('similar-to', fileId);
    window.history.pushState({}, '', url);
}

/**
 * Get similar photo file ID from URL
 * @returns {string|null} - File ID or null
 */
export function getSimilarPhotoFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('similar-to');
}

/**
 * Clear similar photo parameter from URL
 */
export function clearSimilarPhotoFromURL() {
    const url = new URL(window.location);
    url.searchParams.delete('similar-to');
    window.history.pushState({}, '', url);
}

