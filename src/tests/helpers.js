export function makePhoto(id, takenAtMs) {
    return { file_id: id, photo_taken_ts: takenAtMs };
}

export function makeSeries(photos, overrides = {}) {
    const timestamps = photos.map(p => p.photo_taken_ts).filter(t => t != null && !isNaN(t));
    const startTime = timestamps.length ? Math.min(...timestamps) : 0;
    const endTime = timestamps.length ? Math.max(...timestamps) : 0;
    const timeSpanMs = endTime - startTime;
    const timeSpanMinutes = timeSpanMs / 60000;
    return {
        photos,
        startTime,
        endTime,
        timeSpanMs,
        timeSpanMinutes,
        photoCount: photos.length,
        avgTimeBetweenPhotos: timeSpanMinutes > 0 ? timeSpanMinutes / Math.max(photos.length - 1, 1) : 0,
        ...overrides,
    };
}
