import { db } from './db.js';

const REVIEWED_KEY = 'reviewedSeries';

function seriesKey(folderId, seriesStartMs) {
    return `${folderId}_${seriesStartMs}`;
}

export function classifySeries(series, calibration) {
    const durationMinutes = series.timeSpanMinutes || 0;
    const density = series.density || 0;
    const burstThreshold = calibration?.burstThreshold ?? 5;
    if (durationMinutes > 10 && density < 1) return 'sparse';
    if (density >= burstThreshold) return 'burst';
    return 'spread';
}

export async function preselectSeries(series, folderId, calibration) {
    const classification = classifySeries(series, calibration);
    const photos = [...series.photos];

    if (classification === 'sparse') {
        return { keptIds: photos.map(p => p.file_id), deletedIds: [], classification };
    }

    const keepCount = classification === 'burst' ? 1 : 3;
    const sorted = [...photos].sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
    return {
        keptIds: sorted.slice(0, keepCount).map(p => p.file_id),
        deletedIds: sorted.slice(keepCount).map(p => p.file_id),
        classification
    };
}

export async function loadSeriesState(folderId, seriesStartMs) {
    const key = seriesKey(folderId, seriesStartMs);
    const all = (await db.getSetting(REVIEWED_KEY)) || {};
    return all[key] || null;
}

export async function saveSeriesState(folderId, seriesStartMs, keptIds, deletedIds) {
    const key = seriesKey(folderId, seriesStartMs);
    const all = (await db.getSetting(REVIEWED_KEY)) || {};
    all[key] = { keptIds, deletedIds, timestamp: Date.now() };
    await db.setSetting(REVIEWED_KEY, all);
}

export async function togglePhotoKeep(folderId, seriesStartMs, fileId, currentKeptIds, currentDeletedIds) {
    let keptIds = [...currentKeptIds];
    let deletedIds = [...currentDeletedIds];
    if (keptIds.includes(fileId)) {
        keptIds = keptIds.filter(id => id !== fileId);
        deletedIds.push(fileId);
    } else {
        deletedIds = deletedIds.filter(id => id !== fileId);
        keptIds.push(fileId);
    }
    await saveSeriesState(folderId, seriesStartMs, keptIds, deletedIds);
    return { keptIds, deletedIds };
}

export async function isSeriesReviewed(folderId, seriesStartMs) {
    return (await loadSeriesState(folderId, seriesStartMs)) !== null;
}
