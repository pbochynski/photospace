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

    it('does not mutate the input array', async () => {
        const photos = [makePhoto('a', 1000, 0.5), makePhoto('b', 2000, 0.9)];
        const before = photos.map(p => p.file_id);
        await pickBestPhotoByQuality(photos);
        expect(photos.map(p => p.file_id)).toEqual(before);
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

describe('findPhotoSeries — same-timestamp edge case', () => {
    it('includes series where all photos share the same timestamp', async () => {
        // Density is treated as infinite when timeSpan is 0
        const photos = Array.from({ length: 25 }, (_, i) =>
            makePhoto(`p${i}`, BASE)
        );
        const result = await findPhotoSeries(photos, { minGroupSize: 20, minDensity: 1 });
        expect(result).toHaveLength(1);
        expect(result[0].photoCount).toBe(25);
    });
});

describe('findPhotoSeries — ignoredPeriods', () => {
    it('excludes photos that fall within an ignored period', async () => {
        // 20 photos in ignored window, 25 photos starting one interval after the boundary
        const ignored = Array.from({ length: 20 }, (_, i) =>
            makePhoto(`ignored${i}`, BASE + i * 30_000)
        );
        const outside = Array.from({ length: 25 }, (_, i) =>
            makePhoto(`keep${i}`, BASE + 10 * MIN + 30_000 + i * 30_000)
        );
        const ignoredPeriods = [{ startTime: BASE, endTime: BASE + 20 * 30_000, label: 'test' }];
        const result = await findPhotoSeries([...ignored, ...outside], {
            minGroupSize: 20,
            minDensity: 1,
            ignoredPeriods,
        });
        // Only the 'keep' cluster should remain
        expect(result).toHaveLength(1);
        result[0].photos.forEach(p => expect(p.file_id).toMatch(/^keep/));
    });
});

describe('findPhotoSeries — sortMethod', () => {
    // Two series: A has 30 photos at high density, B has 25 photos at lower density
    // A: 30 photos, 15 seconds apart over ~7.5 min → density ≈ 4 photos/min
    // B: 25 photos, 30 seconds apart over ~12 min  → density ≈ 2 photos/min
    const seriesA = Array.from({ length: 30 }, (_, i) =>
        makePhoto(`a${i}`, BASE + i * 15_000)
    );
    const gapB = BASE + 30 * MIN;
    const seriesB = Array.from({ length: 25 }, (_, i) =>
        makePhoto(`b${i}`, gapB + i * 30_000)
    );
    const allPhotos = [...seriesA, ...seriesB];
    const opts = { minGroupSize: 20, minDensity: 1 };

    it('sorts by series-size descending by default', async () => {
        const result = await findPhotoSeries(allPhotos, { ...opts, sortMethod: 'series-size' });
        expect(result[0].photoCount).toBeGreaterThanOrEqual(result[1].photoCount);
    });

    it('sorts by density descending', async () => {
        const result = await findPhotoSeries(allPhotos, { ...opts, sortMethod: 'density' });
        expect(result[0].density).toBeGreaterThanOrEqual(result[1].density);
    });

    it('sorts by date descending', async () => {
        const result = await findPhotoSeries(allPhotos, { ...opts, sortMethod: 'date-desc' });
        expect(result[0].startTime).toBeGreaterThanOrEqual(result[1].startTime);
    });

    it('sorts by date ascending', async () => {
        const result = await findPhotoSeries(allPhotos, { ...opts, sortMethod: 'date-asc' });
        expect(result[0].startTime).toBeLessThanOrEqual(result[1].startTime);
    });
});
