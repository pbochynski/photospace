// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseRoute, buildFolderRoute, navigate } from '../lib/router.js';

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

describe('navigate', () => {
    let pushStateSpy;

    beforeEach(() => {
        pushStateSpy = vi.spyOn(history, 'pushState');
    });

    afterEach(() => {
        pushStateSpy.mockRestore();
    });

    it('calls pushState when hash differs from current location', () => {
        window.location.hash = '#/folder/OLD';
        navigate('#/folder/NEW');
        expect(pushStateSpy).toHaveBeenCalledTimes(1);
    });

    it('does not call pushState when hash already matches current location', () => {
        window.location.hash = '#/folder/01ABC123';
        navigate('#/folder/01ABC123');
        expect(pushStateSpy).not.toHaveBeenCalled();
    });
});
