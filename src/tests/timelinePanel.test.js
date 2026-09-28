/**
 * TimelinePanel — unit tests for pure logic helpers.
 *
 * TimelinePanel itself requires DOM and IDB, so only its pure helper
 * _buildDayGroups is tested here by extracting the logic directly.
 * The constructor smoke test is skipped in the node environment because
 * IntersectionObserver and document are not available.
 */
import { describe, it, expect } from 'vitest';
import { makePhoto, makeSeries } from './helpers.js';

// ── inline copy of _buildDayGroups logic for unit testing ─────────────────
// This mirrors the implementation in timelinePanel.js without DOM dependencies.
function buildDayGroups(photos, series) {
    const sorted = photos
        .filter(p => p.photo_taken_ts)
        .sort((a, b) => {
            const ta = typeof a.photo_taken_ts === 'number' ? a.photo_taken_ts : new Date(a.photo_taken_ts).getTime();
            const tb = typeof b.photo_taken_ts === 'number' ? b.photo_taken_ts : new Date(b.photo_taken_ts).getTime();
            return ta < tb ? -1 : 1;
        });

    const photoToSeries = new Map();
    for (const s of series) {
        for (const p of s.photos) photoToSeries.set(p.file_id, s);
    }
    const emittedSeries = new Set();

    const dayMap = new Map();
    for (const photo of sorted) {
        const day = typeof photo.photo_taken_ts === 'string'
            ? photo.photo_taken_ts.slice(0, 10)
            : new Date(photo.photo_taken_ts).toISOString().slice(0, 10);

        if (!dayMap.has(day)) dayMap.set(day, []);
        const s = photoToSeries.get(photo.file_id);
        if (s) {
            if (!emittedSeries.has(s)) {
                emittedSeries.add(s);
                dayMap.get(day).push({ type: 'series', series: s });
            }
        } else {
            dayMap.get(day).push({ type: 'photo', photo });
        }
    }

    const result = [];
    for (const [day, rawItems] of dayMap) {
        const items = [];
        let buf = [];
        const flush = () => { if (buf.length) { items.push({ type: 'standalone', photos: [...buf] }); buf = []; } };
        for (const item of rawItems) {
            if (item.type === 'photo') { buf.push(item.photo); }
            else { flush(); items.push(item); }
        }
        flush();
        result.push({ day, items });
    }
    return result;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Make a photo with an ISO string timestamp (like IDB returns). */
function makePhotoISO(id, isoDay, hourMs = 0) {
    return { file_id: id, photo_taken_ts: `${isoDay}T${String(Math.floor(hourMs / 3_600_000)).padStart(2,'0')}:00:00.000Z` };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('buildDayGroups — basic grouping', () => {
    it('returns empty array when photos list is empty', () => {
        const result = buildDayGroups([], []);
        expect(result).toEqual([]);
    });

    it('groups photos by calendar day', () => {
        const photos = [
            makePhotoISO('a', '2026-09-01'),
            makePhotoISO('b', '2026-09-01'),
            makePhotoISO('c', '2026-09-02'),
        ];
        const result = buildDayGroups(photos, []);
        expect(result).toHaveLength(2);
        expect(result[0].day).toBe('2026-09-01');
        expect(result[1].day).toBe('2026-09-02');
    });

    it('merges consecutive standalone photos within a day into one standalone item', () => {
        const photos = [
            makePhotoISO('a', '2026-09-01'),
            makePhotoISO('b', '2026-09-01'),
            makePhotoISO('c', '2026-09-01'),
        ];
        const result = buildDayGroups(photos, []);
        expect(result).toHaveLength(1);
        expect(result[0].items).toHaveLength(1);
        expect(result[0].items[0].type).toBe('standalone');
        expect(result[0].items[0].photos).toHaveLength(3);
    });

    it('filters out photos with falsy photo_taken_ts', () => {
        const photos = [
            { file_id: 'x', photo_taken_ts: null },
            makePhotoISO('a', '2026-09-01'),
        ];
        const result = buildDayGroups(photos, []);
        expect(result).toHaveLength(1);
        expect(result[0].items[0].photos[0].file_id).toBe('a');
    });
});

describe('buildDayGroups — series interleaving', () => {
    it('emits a series item for photos belonging to a series', () => {
        const photo1 = makePhotoISO('s1', '2026-09-01', 0);
        const photo2 = makePhotoISO('s2', '2026-09-01', 3_600_000); // 1 hour later
        const series = makeSeries([photo1, photo2]);
        const result = buildDayGroups([photo1, photo2], [series]);
        expect(result).toHaveLength(1);
        expect(result[0].items).toHaveLength(1);
        expect(result[0].items[0].type).toBe('series');
        expect(result[0].items[0].series).toBe(series);
    });

    it('emits a series only once even when multiple photos in the same day', () => {
        const photos = Array.from({ length: 3 }, (_, i) =>
            makePhotoISO(`s${i}`, '2026-09-03', i * 60_000)
        );
        const series = makeSeries(photos);
        const result = buildDayGroups(photos, [series]);
        const seriesItems = result[0].items.filter(i => i.type === 'series');
        expect(seriesItems).toHaveLength(1);
    });

    it('separates series and standalone items within the same day', () => {
        const seriesPhotos = [makePhotoISO('s0', '2026-09-05'), makePhotoISO('s1', '2026-09-05')];
        const standalone = makePhotoISO('lone', '2026-09-05');
        const series = makeSeries(seriesPhotos);
        const result = buildDayGroups([...seriesPhotos, standalone], [series]);
        expect(result).toHaveLength(1);
        // Should have one series item and one standalone item
        const types = result[0].items.map(i => i.type);
        expect(types).toContain('series');
        expect(types).toContain('standalone');
    });

    it('handles numeric timestamps (after findPhotoSeries mutation)', () => {
        // findPhotoSeries mutates photo_taken_ts from ISO string to ms number
        const photos = [
            { file_id: 'n1', photo_taken_ts: new Date('2026-09-10T08:00:00Z').getTime() },
            { file_id: 'n2', photo_taken_ts: new Date('2026-09-10T09:00:00Z').getTime() },
        ];
        const result = buildDayGroups(photos, []);
        expect(result).toHaveLength(1);
        expect(result[0].day).toBe('2026-09-10');
    });
});
