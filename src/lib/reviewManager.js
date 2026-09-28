import { db } from './db.js';

const REVIEWED_KEY = 'reviewedSeries';

function seriesKey(folderId, seriesStartMs) {
    return `${folderId}_${seriesStartMs}`;
}

export async function preselectSeries(series) {
    const photos = [...series.photos];
    const keepCount = Math.min(1, photos.length);
    return {
        keptIds: photos.slice(0, keepCount).map(p => p.file_id),
        deletedIds: photos.slice(keepCount).map(p => p.file_id),
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
