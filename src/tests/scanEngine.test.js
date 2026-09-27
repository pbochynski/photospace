import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

globalThis.indexedDB = new IDBFactory();
globalThis.IDBKeyRange = IDBKeyRange;

// Mock graph.js and db.js before importing ScanEngine
vi.mock('../lib/graph.js', () => ({
    fetchPhotosFromSingleFolder: vi.fn().mockResolvedValue(0),
    getFolderChildren: vi.fn().mockResolvedValue([]),
}));
vi.mock('../lib/db.js', () => ({
    db: {
        deleteStalePhotosInFolder: vi.fn().mockResolvedValue(0),
        getPhotosByFolderId: vi.fn().mockResolvedValue([]),
        getSetting: vi.fn().mockResolvedValue(null),
        setSetting: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../lib/calibration.js', () => ({
    calibrateFolder: vi.fn().mockResolvedValue(undefined),
}));

import { ScanEngine } from '../lib/scanEngine.js';
import { fetchPhotosFromSingleFolder } from '../lib/graph.js';

describe('ScanEngine.stop()', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('stops processing after the current folder completes', async () => {
        const engine = new ScanEngine();

        let resolveFirst;
        fetchPhotosFromSingleFolder
            .mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }))
            .mockResolvedValue(0);

        engine.enqueueFolder('folder-1', 'Folder1', 'drive1', 'normal', false);
        engine.enqueueFolder('folder-2', 'Folder2', 'drive1', 'normal', false);

        // Let engine start then stop it
        await new Promise(r => setTimeout(r, 0));
        engine.stop();

        // Now let the first scan complete
        resolveFirst(0);

        // Wait for engine to finish its loop
        await new Promise(r => setTimeout(r, 50));

        // folder-1 was already in-flight, folder-2 should never start
        expect(fetchPhotosFromSingleFolder).toHaveBeenCalledWith(expect.any(String), 'folder-1');
        expect(fetchPhotosFromSingleFolder).not.toHaveBeenCalledWith(expect.any(String), 'folder-2');
    });
});
