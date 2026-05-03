import { describe, it, expect } from 'vitest';
import { pickBestPhotoByQuality, findPhotoSeries } from '../lib/analysis.js';
import { makePhoto } from './helpers.js';

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
