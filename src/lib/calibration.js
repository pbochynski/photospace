import { db } from './db.js';

const CALIBRATION_KEY = 'calibration';

export async function calibrateFolder(folderId) {
    const photos = await db.getPhotosByFolderId(folderId);
    if (photos.length < 50) return null;

    const timestamps = photos
        .map(p => typeof p.photo_taken_ts === 'string' ? new Date(p.photo_taken_ts).getTime() : p.photo_taken_ts)
        .filter(ts => ts && !isNaN(ts))
        .sort((a, b) => a - b);

    if (timestamps.length < 10) return null;

    const gaps = [];
    for (let i = 1; i < timestamps.length; i++) gaps.push((timestamps[i] - timestamps[i-1]) / 60000);
    gaps.sort((a, b) => a - b);

    const p90 = gaps[Math.floor(gaps.length * 0.9)];
    const maxTimeGap = Math.max(2, Math.min(30, p90));

    const result = {
        maxTimeGap: Math.round(maxTimeGap * 10) / 10,
        computedAt: Date.now()
    };

    const all = (await db.getSetting(CALIBRATION_KEY)) || {};
    all[folderId] = result;
    await db.setSetting(CALIBRATION_KEY, all);
    return result;
}

export async function getCalibration(folderId) {
    const all = (await db.getSetting(CALIBRATION_KEY)) || {};
    return all[folderId] || null;
}
