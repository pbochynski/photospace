import { describe, it, expect } from 'vitest';
import { makePhoto, makeSeries } from './helpers.js';

// reviewManager now only holds persistence helpers (loadSeriesState / saveSeriesState)
// which require IndexedDB — no pure-logic functions remain to unit test here.
// These tests are intentionally empty until fake-indexeddb is wired up.
describe('reviewManager', () => {
    it('has no pure-logic functions to test', () => {
        expect(true).toBe(true);
    });
});
