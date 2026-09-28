import { describe, it, expect } from 'vitest';
import { pickBestPhotoByQuality, findPhotoSeries } from '../lib/analysis.js';
import { makePhoto } from './helpers.js';

const BASE = 1_700_000_000_000; // fixed epoch reference
const MIN = 60_000;             // 1 minute in ms

describe('pickBestPhotoByQuality', () => {
    it('returns the first photo in the group', async () => {
        const photos = [
            makePhoto('a', 1000),
            makePhoto('b', 2000),
        ];
        const result = await pickBestPhotoByQuality(photos);
        expect(result).toBe(photos[0]);
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

    it('groups photos within maxTimeGap into one series', async () => {
        const photos = Array.from({ length: 25 }, (_, i) =>
            makePhoto(`p${i}`, BASE + i * 30_000)
        );
        const result = await findPhotoSeries(photos, { minGroupSize: 20 });
        expect(result).toHaveLength(1);
        expect(result[0].photoCount).toBe(25);
    });

    it('splits into separate series when gap exceeds maxTimeGap', async () => {
        const cluster1 = Array.from({ length: 20 }, (_, i) =>
            makePhoto(`a${i}`, BASE + i * 30_000)
        );
        const gapStart = BASE + 20 * 30_000 + 6 * MIN; // 6-min gap
        const cluster2 = Array.from({ length: 20 }, (_, i) =>
            makePhoto(`b${i}`, gapStart + i * 30_000)
        );
        const result = await findPhotoSeries([...cluster1, ...cluster2], {
            minGroupSize: 20,
            maxTimeGap: 5,
        });
        expect(result).toHaveLength(2);
    });

    it('filters out series below minGroupSize', async () => {
        const photos = Array.from({ length: 10 }, (_, i) =>
            makePhoto(`p${i}`, BASE + i * 30_000)
        );
        const result = await findPhotoSeries(photos, { minGroupSize: 20 });
        expect(result).toEqual([]);
    });
});

describe('findPhotoSeries — ignoredPeriods', () => {
    it('excludes photos that fall within an ignored period', async () => {
        const ignored = Array.from({ length: 20 }, (_, i) =>
            makePhoto(`ignored${i}`, BASE + i * 30_000)
        );
        const outside = Array.from({ length: 25 }, (_, i) =>
            makePhoto(`keep${i}`, BASE + 10 * MIN + 30_000 + i * 30_000)
        );
        const ignoredPeriods = [{ startTime: BASE, endTime: BASE + 20 * 30_000, label: 'test' }];
        const result = await findPhotoSeries([...ignored, ...outside], {
            minGroupSize: 20,
            ignoredPeriods,
        });
        expect(result).toHaveLength(1);
        result[0].photos.forEach(p => expect(p.file_id).toMatch(/^keep/));
    });
});

describe('findPhotoSeries — sortMethod', () => {
    const seriesA = Array.from({ length: 30 }, (_, i) =>
        makePhoto(`a${i}`, BASE + i * 15_000)
    );
    const gapB = BASE + 30 * MIN;
    const seriesB = Array.from({ length: 25 }, (_, i) =>
        makePhoto(`b${i}`, gapB + i * 30_000)
    );
    const allPhotos = [...seriesA, ...seriesB];
    const opts = { minGroupSize: 20 };

    it('sorts by series-size descending by default', async () => {
        const result = await findPhotoSeries(allPhotos, { ...opts, sortMethod: 'series-size' });
        expect(result[0].photoCount).toBeGreaterThanOrEqual(result[1].photoCount);
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
