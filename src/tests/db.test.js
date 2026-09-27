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
