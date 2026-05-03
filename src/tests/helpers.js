/**
 * Create a minimal photo object for test use.
 * @param {string} id
 * @param {number} takenAtMs - Unix timestamp in milliseconds
 * @param {number|null} qualityScore
 */
export function makePhoto(id, takenAtMs, qualityScore = null) {
    return { file_id: id, photo_taken_ts: takenAtMs, quality_score: qualityScore };
}

/**
 * Create a series object as returned by findPhotoSeries.
 * @param {Array} photos - Array of photo objects (use makePhoto)
 * @param {Object} overrides - Optional field overrides
 */
export function makeSeries(photos, overrides = {}) {
    const timestamps = photos.map(p => p.photo_taken_ts).filter(Boolean);
    const startTime = Math.min(...timestamps);
    const endTime = Math.max(...timestamps);
    const timeSpanMs = endTime - startTime;
    const timeSpanMinutes = timeSpanMs / 60000;
    const density = timeSpanMinutes > 0 ? photos.length / timeSpanMinutes : photos.length;
    return {
        photos,
        startTime,
        endTime,
        timeSpanMs,
        timeSpanMinutes,
        photoCount: photos.length,
        density,
        avgTimeBetweenPhotos: timeSpanMinutes > 0 ? timeSpanMinutes / (photos.length - 1) : 0,
        ...overrides,
    };
}
