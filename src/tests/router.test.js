import { describe, it, expect } from 'vitest';
import { parseRoute, buildFolderRoute } from '../lib/router.js';

describe('parseRoute', () => {
    it('parses a folder route', () => {
        expect(parseRoute('#/folder/01ABC123')).toEqual({ type: 'folder', folderId: '01ABC123' });
    });

    it('returns none for empty hash', () => {
        expect(parseRoute('')).toEqual({ type: 'none' });
    });

    it('returns none for MSAL auth hash', () => {
        expect(parseRoute('#state=abc&code=xyz')).toEqual({ type: 'none' });
    });

    it('returns none for unknown path', () => {
        expect(parseRoute('#/unknown/stuff')).toEqual({ type: 'none' });
    });

    it('parses a time route', () => {
        expect(parseRoute('#/time/2024-06')).toEqual({ type: 'time', year: 2024, month: 6 });
    });
});

describe('buildFolderRoute', () => {
    it('builds the correct hash string', () => {
        expect(buildFolderRoute('01ABC123')).toBe('#/folder/01ABC123');
    });
});
