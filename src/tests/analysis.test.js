import { describe, it, expect } from 'vitest';
import { pickBestPhotoByQuality, findPhotoSeries } from '../lib/analysis.js';
import { makePhoto } from './helpers.js';

const BASE = 1_700_000_000_000; // fixed epoch reference
const MIN = 60_000;             // 1 minute in ms

describe('pickBestPhotoByQuality', () => {
    it('returns the single photo when group has one item', async () => {
        const photo = makePhoto('a', 1000, 0.9);
        const result = await pickBestPhotoByQuality([photo]);
        expect(result).toBe(photo);
    });

    it('returns the photo with the highest quality_score', async () => {
        const photos = [
            makePhoto('a', 1000, 0.5),
            makePhoto('b', 2000, 0.9),
            makePhoto('c', 3000, 0.1),
        ];
        const result = await pickBestPhotoByQuality(photos);
        expect(result.file_id).toBe('b');
    });

    it('treats null quality_score as 0', async () => {
        const photos = [
            makePhoto('a', 1000, null),
            makePhoto('b', 2000, 0.3),
        ];
        const result = await pickBestPhotoByQuality(photos);
        expect(result.file_id).toBe('b');
    });
});

describe('findPhotoSeries — basic grouping', () => {
    it('returns empty array when no photos have valid timestamps', async () => {
        const photos = [
            { file_id: 'a', photo_taken_ts: null },
            { file_id: 'b', photo_taken_ts: 'not-a-date' },
        ];
        const result = await findPhotoSeries(photos);
        expect(result).toEqual([]);
    });

    it('keeps photos in same series when gap is within maxTimeGap', async () => {
        // 25 photos, 30 seconds apart — well within default 5-min gap
        const photos = Array.from({ length: 25 }, (_, i) =>
            makePhoto(`p${i}`, BASE + i * 30_000)
        );
        const result = await findPhotoSeries(photos, { minGroupSize: 20, minDensity: 1 });
        expect(result).toHaveLength(1);
        expect(result[0].photoCount).toBe(25);
    });

    it('splits into separate series when gap exceeds maxTimeGap', async () => {
        // 20 photos in first cluster, then 6-minute gap, then 20 more
        const cluster1 = Array.from({ length: 20 }, (_, i) =>
            makePhoto(`a${i}`, BASE + i * 30_000)
        );
        const gapStart = BASE + 20 * 30_000 + 6 * MIN; // 6-min gap
        const cluster2 = Array.from({ length: 20 }, (_, i) =>
            makePhoto(`b${i}`, gapStart + i * 30_000)
        );
        const result = await findPhotoSeries([...cluster1, ...cluster2], {
            minGroupSize: 20,
            minDensity: 1,
            maxTimeGap: 5,
        });
        expect(result).toHaveLength(2);
    });

    it('filters out series below minGroupSize', async () => {
        // Only 10 photos — below default minGroupSize of 20
        const photos = Array.from({ length: 10 }, (_, i) =>
            makePhoto(`p${i}`, BASE + i * 30_000)
        );
        const result = await findPhotoSeries(photos, { minGroupSize: 20, minDensity: 0 });
        expect(result).toEqual([]);
    });

    it('filters out series below minDensity', async () => {
        // 20 photos spread over 57 minutes (~0.35 photos/min), below minDensity 1
        const photos = Array.from({ length: 20 }, (_, i) =>
            makePhoto(`p${i}`, BASE + i * 3 * MIN)
        );
        const result = await findPhotoSeries(photos, { minGroupSize: 20, minDensity: 1 });
        expect(result).toEqual([]);
    });
});
