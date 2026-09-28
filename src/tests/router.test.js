// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseRoute, buildFolderRoute, navigate, buildTimeRoute } from '../lib/router.js';

describe('buildFolderRoute', () => {
    it('builds a folder route hash', () => {
        expect(buildFolderRoute('folder-123')).toBe('#/folder/folder-123');
    });
});

describe('parseRoute', () => {
    beforeEach(() => {
        window.location.hash = '';
    });

    it('parses a folder route', () => {
        window.location.hash = '#/folder/folder-123';
        expect(parseRoute()).toEqual({ type: 'folder', id: 'folder-123' });
    });

    it('parses a time route', () => {
        window.location.hash = '#/time/2026-09';
        expect(parseRoute()).toEqual({ type: 'time', month: '2026-09' });
    });

    it('returns null for empty hash', () => {
        window.location.hash = '';
        expect(parseRoute()).toBeNull();
    });
});

describe('getCurrentRoute', () => {
    beforeEach(() => {
        window.location.hash = '';
    });

    it('returns the current route', () => {
        window.location.hash = '#/folder/folder-123';
        const { getCurrentRoute } = require('../lib/router.js');
        expect(getCurrentRoute()).toEqual({ type: 'folder', id: 'folder-123' });
    });
});

describe('navigate', () => {
    it('navigates to a route', (done) => {
        navigate('#/folder/folder-123');
        setTimeout(() => {
            expect(window.location.hash).toBe('#/folder/folder-123');
            done();
        }, 10);
    });
});

describe('buildTimeRoute', () => {
    it('builds a zero-padded time route hash', () => {
        expect(buildTimeRoute(2026, 9)).toBe('#/time/2026-09');
    });

    it('handles two-digit months without double-padding', () => {
        expect(buildTimeRoute(2026, 11)).toBe('#/time/2026-11');
    });
});
