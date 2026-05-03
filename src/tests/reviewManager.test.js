import { describe, it, expect } from 'vitest';
import { classifySeries, preselectSeries } from '../lib/reviewManager.js';
import { makePhoto, makeSeries } from './helpers.js';

const BASE = 1_700_000_000_000;
const MIN = 60_000;

describe('classifySeries', () => {
    it('returns sparse for long-duration low-density series', () => {
        // 15 minutes, density 0.5 — matches durationMinutes > 10 && density < 1
        const series = makeSeries([], { timeSpanMinutes: 15, density: 0.5 });
        expect(classifySeries(series, null)).toBe('sparse');
    });

    it('returns burst when density exceeds burstThreshold', () => {
        // density 8, default burstThreshold 5
        const series = makeSeries([], { timeSpanMinutes: 2, density: 8 });
        expect(classifySeries(series, null)).toBe('burst');
    });

    it('returns burst using calibration burstThreshold', () => {
        const series = makeSeries([], { timeSpanMinutes: 2, density: 4 });
        expect(classifySeries(series, { burstThreshold: 3 })).toBe('burst');
    });

    it('returns spread for moderate density and short duration', () => {
        // density 3, duration 3 min — not sparse, not above default burst threshold
        const series = makeSeries([], { timeSpanMinutes: 3, density: 3 });
        expect(classifySeries(series, null)).toBe('spread');
    });

    it('uses default burstThreshold 5 when calibration is undefined', () => {
        // density 4 is below default 5 → spread
        const series = makeSeries([], { timeSpanMinutes: 3, density: 4 });
        expect(classifySeries(series, undefined)).toBe('spread');
    });
});

describe('preselectSeries', () => {
    it('keeps all photos for sparse series', async () => {
        const photos = Array.from({ length: 5 }, (_, i) =>
            makePhoto(`p${i}`, BASE + i * MIN, 0.5)
        );
        const series = makeSeries(photos, { timeSpanMinutes: 15, density: 0.3 });
        const result = await preselectSeries(series, 'folder1', null);
        expect(result.classification).toBe('sparse');
        expect(result.keptIds).toHaveLength(5);
        expect(result.deletedIds).toHaveLength(0);
    });

    it('keeps 1 best photo for burst series', async () => {
        const photos = [
            makePhoto('a', BASE, 0.2),
            makePhoto('b', BASE + 5_000, 0.9),
            makePhoto('c', BASE + 10_000, 0.4),
            makePhoto('d', BASE + 15_000, 0.6),
        ];
        const series = makeSeries(photos, { timeSpanMinutes: 0.5, density: 8 });
        const result = await preselectSeries(series, 'folder1', null);
        expect(result.classification).toBe('burst');
        expect(result.keptIds).toEqual(['b']);
        expect(result.deletedIds).toHaveLength(3);
    });

    it('keeps 3 best photos for spread series', async () => {
        const photos = [
            makePhoto('a', BASE, 0.1),
            makePhoto('b', BASE + MIN, 0.9),
            makePhoto('c', BASE + 2 * MIN, 0.7),
            makePhoto('d', BASE + 3 * MIN, 0.5),
            makePhoto('e', BASE + 4 * MIN, 0.3),
        ];
        const series = makeSeries(photos, { timeSpanMinutes: 4, density: 3 });
        const result = await preselectSeries(series, 'folder1', null);
        expect(result.classification).toBe('spread');
        expect(result.keptIds).toHaveLength(3);
        expect(result.keptIds).toEqual(expect.arrayContaining(['b', 'c', 'd']));
        expect(result.deletedIds).toHaveLength(2);
    });

    it('treats null quality_score as 0 when sorting', async () => {
        const photos = [
            makePhoto('a', BASE, null),
            makePhoto('b', BASE + MIN, 0.5),
            makePhoto('c', BASE + 2 * MIN, null),
            makePhoto('d', BASE + 3 * MIN, 0.8),
        ];
        const series = makeSeries(photos, { timeSpanMinutes: 3, density: 3 });
        const result = await preselectSeries(series, 'folder1', null);
        // Spread: keep top 3 — d(0.8), b(0.5), then a or c (both 0)
        expect(result.keptIds[0]).toBe('d');
        expect(result.keptIds[1]).toBe('b');
        expect(result.keptIds).toHaveLength(3);
        expect(result.deletedIds).toHaveLength(1);
    });
});
