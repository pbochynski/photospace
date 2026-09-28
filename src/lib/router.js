/**
 * Router module for managing navigation in Photospace.
 *
 * Provides route parsing, building, and navigation utilities.
 * Routes use hash-based navigation: #/type/id
 */

/**
 * Parse the current window.location.hash into a route object.
 *
 * @returns {Object|null} Route object with `type` and `id` or `month`, or null if invalid
 *
 * Examples:
 *   #/folder/folder-123 -> { type: 'folder', id: 'folder-123' }
 *   #/time/2026-09 -> { type: 'time', month: '2026-09' }
 *   '' -> null
 */
export function parseRoute() {
    const hash = window.location.hash;
    if (!hash || hash === '#') return null;

    // Remove the leading '#'
    const path = hash.slice(1);
    const parts = path.split('/').filter(p => p.length > 0);

    if (parts.length < 2) return null;

    const type = parts[0];
    const id = parts[1];

    if (type === 'folder') {
        return { type: 'folder', id };
    } else if (type === 'time') {
        return { type: 'time', month: id };
    }

    return null;
}

/**
 * Get the current route without modifying it.
 *
 * @returns {Object|null} The current route object or null
 */
export function getCurrentRoute() {
    return parseRoute();
}

/**
 * Build a folder route hash.
 *
 * @param {string} folderId - The folder ID
 * @returns {string} A hash route string like '#/folder/folder-123'
 */
export function buildFolderRoute(folderId) {
    return `#/folder/${folderId}`;
}

/**
 * Build a time-based route hash.
 *
 * @param {number} year - The year (e.g., 2026)
 * @param {number} month - The month (1-12)
 * @returns {string} A hash route string like '#/time/2026-09'
 */
export function buildTimeRoute(year, month) {
    return `#/time/${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Navigate to a new route.
 *
 * @param {string} hash - A hash route string (e.g., '#/folder/folder-123')
 */
export function navigate(hash) {
    window.location.hash = hash;
}
