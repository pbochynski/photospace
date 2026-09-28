import { db } from './db.js';

const REVIEWED_KEY = 'reviewedSeries';

function seriesKey(folderId, seriesStartMs) {
    return `${folderId}_${seriesStartMs}`;
}

export async function loadSeriesState(folderId, seriesStartMs) {
    const key = seriesKey(folderId, seriesStartMs);
    const all = (await db.getSetting(REVIEWED_KEY)) || {};
    return all[key] || null;
}

export async function saveSeriesState(folderId, seriesStartMs, deletedIds) {
    const key = seriesKey(folderId, seriesStartMs);
    const all = (await db.getSetting(REVIEWED_KEY)) || {};
    all[key] = { deletedIds, timestamp: Date.now() };
    await db.setSetting(REVIEWED_KEY, all);
}
