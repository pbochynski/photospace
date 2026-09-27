import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/auth.js', () => ({ getAuthToken: vi.fn().mockResolvedValue('token') }));
vi.mock('../lib/db.js', () => {
    const saved = [];
    return {
        PhotoDB: class {},
        db: {
            addOrUpdatePhotos: vi.fn(items => { saved.push(...items); return Promise.resolve(); }),
            _saved: saved,
        },
    };
});

import { fetchPhotosFromSingleFolder } from '../lib/graph.js';
import { db } from '../lib/db.js';

function makeGraphItem({ id, name, size, type, takenDateTime, createdDateTime, codec, duration, bitrate, width, height }) {
    const item = {
        id,
        name,
        size,
        createdDateTime: createdDateTime ?? '2022-06-15T10:00:00Z',
        lastModifiedDateTime: '2022-06-15T10:00:00Z',
        parentReference: { path: '/drive/root:/Camera Roll', id: 'folder-x' },
    };
    if (type === 'photo') {
        item.photo = { takenDateTime: takenDateTime ?? null };
    }
    if (type === 'video') {
        item.video = { fourCC: codec ?? 'H264', duration: duration ?? 5000, bitrate: bitrate ?? 4_000_000, width: width ?? 1920, height: height ?? 1080 };
        item.file = {};
    }
    return item;
}

function mockFetch(items) {
    globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve({ value: items }),
    });
}

describe('fetchPhotosFromSingleFolder: video items', () => {
    beforeEach(() => {
        db._saved.length = 0;
        vi.clearAllMocks();
        db.addOrUpdatePhotos.mockImplementation(items => { db._saved.push(...items); return Promise.resolve(); });
    });

    it('stores video items with item_type video and codec from fourCC', async () => {
        mockFetch([
            makeGraphItem({ id: 'v1', name: 'clip.mov', size: 80_000_000, type: 'video', codec: 'H264' }),
        ]);

        await fetchPhotosFromSingleFolder('scan1', 'folder-x');

        const video = db._saved.find(i => i.file_id === 'v1');
        expect(video).toBeDefined();
        expect(video.item_type).toBe('video');
        expect(video.video_codec).toBe('H264');
        expect(video.size).toBe(80_000_000);
    });

    it('stores video duration and resolution', async () => {
        mockFetch([
            makeGraphItem({ id: 'v2', name: 'long.mp4', size: 200_000_000, type: 'video', duration: 120_000, width: 3840, height: 2160 }),
        ]);

        await fetchPhotosFromSingleFolder('scan1', 'folder-x');

        const video = db._saved.find(i => i.file_id === 'v2');
        expect(video.video_duration_ms).toBe(120_000);
        expect(video.video_width).toBe(3840);
        expect(video.video_height).toBe(2160);
    });

    it('uses createdDateTime as photo_taken_ts for videos without takenDateTime', async () => {
        mockFetch([
            makeGraphItem({ id: 'v3', name: 'vid.mov', size: 10_000_000, type: 'video', createdDateTime: '2021-03-10T08:30:00Z' }),
        ]);

        await fetchPhotosFromSingleFolder('scan1', 'folder-x');

        const video = db._saved.find(i => i.file_id === 'v3');
        expect(video.photo_taken_ts).toBe('2021-03-10T08:30:00Z');
    });

    it('still stores photos with item_type photo', async () => {
        mockFetch([
            makeGraphItem({ id: 'p1', name: 'shot.jpg', size: 4_000_000, type: 'photo', takenDateTime: '2020-07-01T12:00:00Z' }),
        ]);

        await fetchPhotosFromSingleFolder('scan1', 'folder-x');

        const photo = db._saved.find(i => i.file_id === 'p1');
        expect(photo.item_type).toBe('photo');
        expect(photo.photo_taken_ts).toBe('2020-07-01T12:00:00Z');
    });

    it('uses createdDateTime as photo_taken_ts for photos without takenDateTime', async () => {
        mockFetch([
            makeGraphItem({ id: 'p2', name: 'noexif.jpg', size: 2_000_000, type: 'photo', takenDateTime: null, createdDateTime: '2019-11-20T09:00:00Z' }),
        ]);

        await fetchPhotosFromSingleFolder('scan1', 'folder-x');

        const photo = db._saved.find(i => i.file_id === 'p2');
        expect(photo.photo_taken_ts).toBe('2019-11-20T09:00:00Z');
    });
});
