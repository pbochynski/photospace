import { describe, it, expect } from 'vitest';
import { preselectSeries } from '../lib/reviewManager.js';
import { makePhoto, makeSeries } from './helpers.js';

const BASE = 1_700_000_000_000;
const MIN = 60_000;

describe('preselectSeries', () => {
    it('keeps 1 photo and marks the rest for deletion', async () => {
        const photos = [
            makePhoto('a', BASE),
            makePhoto('b', BASE + 5_000),
            makePhoto('c', BASE + 10_000),
            makePhoto('d', BASE + 15_000),
        ];
        const series = makeSeries(photos);
        const result = await preselectSeries(series);
        expect(result.keptIds).toHaveLength(1);
        expect(result.deletedIds).toHaveLength(3);
    });

    it('keeps the only photo when series has 1 photo', async () => {
        const photos = [makePhoto('a', BASE)];
        const series = makeSeries(photos);
        const result = await preselectSeries(series);
        expect(result.keptIds).toHaveLength(1);
        expect(result.deletedIds).toHaveLength(0);
    });
});
