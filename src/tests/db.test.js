import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

globalThis.indexedDB = new IDBFactory();
globalThis.IDBKeyRange = IDBKeyRange;

// Re-import PhotoDB freshly for each test suite using a local class copy
// We import the class, not the singleton, to get a fresh instance per test
import { PhotoDB } from '../lib/db.js';

function makeRawPhoto(id, folderId, scanId = 'scan1') {
    return {
        file_id: id,
        folder_id: folderId,
        name: `${id}.jpg`,
        size: 1000,
        path: `/drive/root:/Photos/${folderId}`,
        last_modified: new Date().toISOString(),
        photo_taken_ts: new Date().toISOString(),
        scan_id: scanId,
        item_type: 'photo',
    };
}

function makeRawVideo(id, folderId, scanId = 'scan1') {
    return {
        file_id: id,
        folder_id: folderId,
        name: `${id}.mov`,
        size: 50_000_000,
        path: `/drive/root:/Videos/${folderId}`,
        last_modified: new Date().toISOString(),
        photo_taken_ts: new Date().toISOString(),
        scan_id: scanId,
        item_type: 'video',
        video_codec: 'H264',
        video_duration_ms: 30000,
        video_bitrate: 8_000_000,
        video_width: 1920,
        video_height: 1080,
    };
}

describe('PhotoDB.getItemsByType', () => {
    let db;
    beforeEach(async () => {
        globalThis.indexedDB = new IDBFactory();
        db = new PhotoDB();
        await db.init();
    });

    it('returns only videos when queried for video', async () => {
        await db.addOrUpdatePhotos([
            makeRawPhoto('p1', 'folder-A'),
            makeRawVideo('v1', 'folder-A'),
            makeRawVideo('v2', 'folder-B'),
        ]);

        const videos = await db.getItemsByType('video');

        expect(videos.map(v => v.file_id).sort()).toEqual(['v1', 'v2']);
    });

    it('returns only photos when queried for photo', async () => {
        await db.addOrUpdatePhotos([
            makeRawPhoto('p1', 'folder-A'),
            makeRawPhoto('p2', 'folder-B'),
            makeRawVideo('v1', 'folder-A'),
        ]);

        const photos = await db.getItemsByType('photo');

        expect(photos.map(p => p.file_id).sort()).toEqual(['p1', 'p2']);
    });
});

describe('PhotoDB.getPhotosByFolderId', () => {
    let db;
    beforeEach(async () => {
        globalThis.indexedDB = new IDBFactory();
        db = new PhotoDB();
        await db.init();
    });

    it('returns only photos belonging to the requested folder', async () => {
        await db.addOrUpdatePhotos([
            makeRawPhoto('a1', 'folder-A'),
            makeRawPhoto('a2', 'folder-A'),
            makeRawPhoto('b1', 'folder-B'),
        ]);

        const result = await db.getPhotosByFolderId('folder-A');

        expect(result.map(p => p.file_id).sort()).toEqual(['a1', 'a2']);
    });

    it('returns empty array when folder has no photos', async () => {
        await db.addOrUpdatePhotos([makeRawPhoto('x1', 'folder-X')]);

        const result = await db.getPhotosByFolderId('folder-Z');

        expect(result).toEqual([]);
    });
});

describe('PhotoDB.deleteStalePhotosInFolder', () => {
    let db;
    beforeEach(async () => {
        globalThis.indexedDB = new IDBFactory();
        db = new PhotoDB();
        await db.init();
    });

    it('deletes photos in the folder whose scan_id does not match', async () => {
        await db.addOrUpdatePhotos([
            makeRawPhoto('old1', 'folder-A', 'scan-old'),
            makeRawPhoto('old2', 'folder-A', 'scan-old'),
            makeRawPhoto('current1', 'folder-A', 'scan-new'),
        ]);

        await db.deleteStalePhotosInFolder('folder-A', 'scan-new');

        const remaining = await db.getPhotosByFolderId('folder-A');
        expect(remaining.map(p => p.file_id)).toEqual(['current1']);
    });

    it('does not delete photos from other folders', async () => {
        await db.addOrUpdatePhotos([
            makeRawPhoto('a-old', 'folder-A', 'scan-old'),
            makeRawPhoto('b-old', 'folder-B', 'scan-old'),
        ]);

        await db.deleteStalePhotosInFolder('folder-A', 'scan-new');

        const remainingB = await db.getPhotosByFolderId('folder-B');
        expect(remainingB.map(p => p.file_id)).toEqual(['b-old']);
    });

    it('returns the count of deleted photos', async () => {
        await db.addOrUpdatePhotos([
            makeRawPhoto('stale1', 'folder-A', 'scan-old'),
            makeRawPhoto('stale2', 'folder-A', 'scan-old'),
            makeRawPhoto('fresh1', 'folder-A', 'scan-new'),
        ]);

        const count = await db.deleteStalePhotosInFolder('folder-A', 'scan-new');

        expect(count).toBe(2);
    });
});

describe('PhotoDB.getPhotosByMonth', () => {
    let db;
    beforeEach(async () => {
        globalThis.indexedDB = new IDBFactory();
        db = new PhotoDB();
        await db.init();
    });

    it('returns photos whose photo_taken_ts falls within the given month', async () => {
        await db.addOrUpdatePhotos([
            { file_id: 'sep1', folder_id: 'f1', photo_taken_ts: '2026-09-15T10:00:00Z', scan_id: 's1', item_type: 'photo' },
            { file_id: 'oct1', folder_id: 'f1', photo_taken_ts: '2026-10-01T00:00:00Z', scan_id: 's1', item_type: 'photo' },
            { file_id: 'aug1', folder_id: 'f1', photo_taken_ts: '2026-08-31T23:59:59Z', scan_id: 's1', item_type: 'photo' },
        ]);
        const results = await db.getPhotosByMonth(2026, 9);
        const ids = results.map(p => p.file_id).sort();
        expect(ids).toEqual(['sep1']);
    });

    it('includes videos in results', async () => {
        await db.addOrUpdatePhotos([
            { file_id: 'vid1', folder_id: 'f1', photo_taken_ts: '2026-09-20T12:00:00Z', scan_id: 's1', item_type: 'video' },
        ]);
        const results = await db.getPhotosByMonth(2026, 9);
        expect(results.some(p => p.file_id === 'vid1')).toBe(true);
    });

    it('excludes photos with null photo_taken_ts', async () => {
        await db.addOrUpdatePhotos([
            { file_id: 'nodate', folder_id: 'f1', photo_taken_ts: null, scan_id: 's1', item_type: 'photo' },
        ]);
        const results = await db.getPhotosByMonth(2026, 9);
        expect(results.some(p => p.file_id === 'nodate')).toBe(false);
    });
});

describe('PhotoDB.rebuildMonthIndex', () => {
    let db;
    beforeEach(async () => {
        globalThis.indexedDB = new IDBFactory();
        db = new PhotoDB();
        await db.init();
    });

    it('returns a map of YYYY-MM to photo counts', async () => {
        await db.addOrUpdatePhotos([
            { file_id: 'a', folder_id: 'f1', photo_taken_ts: '2026-09-01T00:00:00Z', scan_id: 's1', item_type: 'photo' },
            { file_id: 'b', folder_id: 'f1', photo_taken_ts: '2026-09-15T00:00:00Z', scan_id: 's1', item_type: 'photo' },
            { file_id: 'c', folder_id: 'f1', photo_taken_ts: '2026-08-10T00:00:00Z', scan_id: 's1', item_type: 'photo' },
        ]);
        const index = await db.rebuildMonthIndex();
        expect(index['2026-09']).toBe(2);
        expect(index['2026-08']).toBe(1);
    });

    it('excludes photos with null photo_taken_ts from the index', async () => {
        await db.addOrUpdatePhotos([
            { file_id: 'nodate2', folder_id: 'f1', photo_taken_ts: null, scan_id: 's1', item_type: 'photo' },
        ]);
        const index = await db.rebuildMonthIndex();
        // null entries must not appear as keys
        expect(Object.keys(index).some(k => k === 'null' || k === 'undefined')).toBe(false);
    });

    it('saves the index to settings under key "monthIndex"', async () => {
        await db.init();
        await db.rebuildMonthIndex();
        const saved = await db.getSetting('monthIndex');
        expect(typeof saved).toBe('object');
    });
});
