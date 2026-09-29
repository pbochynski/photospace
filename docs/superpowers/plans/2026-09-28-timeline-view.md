# Timeline View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-width timeline view that shows all scanned photos grouped by day (with series within days), supports month-chunk virtual scrolling for 50-100k photos, a right-side scrubber for direct year/month navigation, and integrates with the existing review grid and fullscreen flows.

**Architecture:** A `monthIndex` stored in IDB settings keeps photo counts per `YYYY-MM` key, built by a new `db.rebuildMonthIndex()` called after each scan. `TimelinePanel` loads one month at a time via `db.getPhotosByMonth()`, groups photos into day buckets, runs `findPhotoSeries` per month, and renders chunks with IntersectionObserver-driven adjacent-month pre-loading. Spacer divs hold scroll position for unrendered months. A fixed scrubber on the right drives `navigate(buildTimeRoute(y, m))`. View switching is handled by two new header buttons (Folders / Timeline) that toggle the `app-columns--timeline` CSS modifier and show/hide `#panel-timeline`.

**Tech Stack:** Vanilla JS ES modules, IndexedDB (`by_timestamp` index already exists), IntersectionObserver, CSS sticky headers, existing `findPhotoSeries` / `reviewGrid` / fullscreen flows.

**Spec:** `docs/superpowers/specs/2026-09-28-timeline-view-design.md`

## Global Constraints

- No new npm dependencies — vanilla JS only
- `photo_taken_ts` is an ISO 8601 UTC string (e.g. `"2026-09-27T14:32:10Z"`); string lexicographic comparison is correct for IDB range queries
- Photos with `null` / missing `photo_taken_ts` are excluded from the timeline
- Videos (`item_type: 'video'`) are included; must show a `▶` overlay on their thumbnail
- Series detection uses the same `getSeriesSettings()` settings as the folder view
- `folderId` passed to `onSeriesClick` is `series.photos[0].folder_id`
- URL format: `#/time/2026-09` (zero-padded month)
- Test files: `src/tests/*.test.js`, run with `npm run test:run`
- DB version stays at 7 — no schema change needed (`by_timestamp` index already exists)

## Review Focus

- **Photos with `null` `photo_taken_ts`** — excluded from timeline; must not cause a crash or appear in a wrong month. The `getPhotosByMonth` IDB range naturally excludes nulls (null sorts before any string), but the month-index rebuild must also skip them.
- **Month boundary at midnight** — a photo taken at `2026-09-30T23:59:59Z` must appear in September, not October. The IDB upper bound `"2026-09-31T..."` is safe (no day 31 in Sep; ISO string comparison still works because `"2026-09-31"` > any `"2026-09-30"` string).
- **Empty months in the scrubber** — months with zero photos in `monthIndex` should not appear; the scrubber must be derived only from months with `count > 0`.
- **Scrubber jump to a month not yet rendered** — clicking a distant month must correctly position the scroll container (spacer heights must be set before the jump, not after load).
- **View-toggle while review grid is open** — switching from folder view to timeline while the review panel is open must close the review panel first to avoid CSS state conflict between `app-columns--review-open` and `app-columns--timeline`.

---

## Task 1: DB — `getPhotosByMonth` and `rebuildMonthIndex`

**Files:**
- Modify: `src/lib/db.js`
- Test: `src/tests/db.test.js`

**Interfaces:**
- Produces:
  - `db.getPhotosByMonth(year: number, month: number): Promise<Photo[]>` — returns all photos (photo + video) whose `photo_taken_ts` falls within the given calendar month (UTC)
  - `db.rebuildMonthIndex(): Promise<Object>` — scans all photos in IDB, groups by `YYYY-MM`, returns and saves the index as `{ "2026-09": 412, "2026-08": 307, … }` to `settings` key `"monthIndex"`

- [ ] **Step 1: Write the failing tests**

Add to `src/tests/db.test.js` (after existing tests):

```js
import { describe, it, expect, beforeEach } from 'vitest';
// (existing imports already present in the file — add only the new describe blocks)

describe('PhotoDB.getPhotosByMonth', () => {
    it('returns photos whose photo_taken_ts falls within the given month', async () => {
        await db.init();
        await db.addOrUpdatePhotos([
            { file_id: 'sep1', folder_id: 'f1', photo_taken_ts: '2026-09-15T10:00:00Z', scan_id: 's1', item_type: 'photo' },
            { file_id: 'oct1', folder_id: 'f1', photo_taken_ts: '2026-10-01T00:00:00Z', scan_id: 's1', item_type: 'photo' },
            { file_id: 'aug1', folder_id: 'f1', photo_taken_ts: '2026-08-31T23:59:59Z', scan_id: 's1', item_type: 'photo' },
        ]);
        const results = await db.getPhotosByMonth(2026, 9);
        const ids = results.map(p => p.file_id).sort();
        expect(ids).toEqual(['sep1']);
    });

    it('includes videos in results', async () => {
        await db.init();
        await db.addOrUpdatePhotos([
            { file_id: 'vid1', folder_id: 'f1', photo_taken_ts: '2026-09-20T12:00:00Z', scan_id: 's1', item_type: 'video' },
        ]);
        const results = await db.getPhotosByMonth(2026, 9);
        expect(results.some(p => p.file_id === 'vid1')).toBe(true);
    });

    it('excludes photos with null photo_taken_ts', async () => {
        await db.init();
        await db.addOrUpdatePhotos([
            { file_id: 'nodate', folder_id: 'f1', photo_taken_ts: null, scan_id: 's1', item_type: 'photo' },
        ]);
        const results = await db.getPhotosByMonth(2026, 9);
        expect(results.some(p => p.file_id === 'nodate')).toBe(false);
    });
});

describe('PhotoDB.rebuildMonthIndex', () => {
    it('returns a map of YYYY-MM to photo counts', async () => {
        await db.init();
        await db.addOrUpdatePhotos([
            { file_id: 'a', folder_id: 'f1', photo_taken_ts: '2026-09-01T00:00:00Z', scan_id: 's1', item_type: 'photo' },
            { file_id: 'b', folder_id: 'f1', photo_taken_ts: '2026-09-15T00:00:00Z', scan_id: 's1', item_type: 'photo' },
            { file_id: 'c', folder_id: 'f1', photo_taken_ts: '2026-08-10T00:00:00Z', scan_id: 's1', item_type: 'photo' },
        ]);
        const index = await db.rebuildMonthIndex();
        expect(index['2026-09']).toBe(2);
        expect(index['2026-08']).toBe(1);
    });

    it('excludes photos with null photo_taken_ts from the index', async () => {
        await db.init();
        await db.addOrUpdatePhotos([
            { file_id: 'nodate2', folder_id: 'f1', photo_taken_ts: null, scan_id: 's1', item_type: 'photo' },
        ]);
        const index = await db.rebuildMonthIndex();
        // null entries must not appear as keys
        expect(Object.keys(index).some(k => k === 'null' || k === 'undefined')).toBe(false);
    });

    it('saves the index to settings under key "monthIndex"', async () => {
        await db.init();
        await db.rebuildMonthIndex();
        const saved = await db.getSetting('monthIndex');
        expect(typeof saved).toBe('object');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- --reporter=verbose 2>&1 | grep -A3 "getPhotosByMonth\|rebuildMonthIndex"
```

Expected: FAIL — `db.getPhotosByMonth is not a function` / `db.rebuildMonthIndex is not a function`.

- [ ] **Step 3: Implement `getPhotosByMonth` in `src/lib/db.js`**

Add after `getItemsByType` (line ~121):

```js
async getPhotosByMonth(year, month) {
    const pad = (n) => String(n).padStart(2, '0');
    const lower = `${year}-${pad(month)}-01T00:00:00.000Z`;
    const upper = `${year}-${pad(month)}-31T23:59:59.999Z`;
    return new Promise((resolve, reject) => {
        const tx = this.db.transaction('photos', 'readonly');
        const index = tx.objectStore('photos').index('by_timestamp');
        const range = IDBKeyRange.bound(lower, upper);
        const request = index.getAll(range);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}
```

- [ ] **Step 4: Implement `rebuildMonthIndex` in `src/lib/db.js`**

Add after `getPhotosByMonth`:

```js
async rebuildMonthIndex() {
    const index = {};
    const photos = await new Promise((resolve, reject) => {
        const tx = this.db.transaction('photos', 'readonly');
        const request = tx.objectStore('photos').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
    for (const photo of photos) {
        if (!photo.photo_taken_ts) continue;
        const key = photo.photo_taken_ts.slice(0, 7); // "YYYY-MM"
        index[key] = (index[key] || 0) + 1;
    }
    await this.setSetting('monthIndex', index);
    return index;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:run 2>&1 | tail -8
```

Expected: all tests pass (previous suite count + 6 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.js src/tests/db.test.js
git commit -m "feat: add getPhotosByMonth and rebuildMonthIndex to PhotoDB"
```

---

## Task 2: Router — `buildTimeRoute`

**Files:**
- Modify: `src/lib/router.js`
- Test: `src/tests/router.test.js`

**Interfaces:**
- Produces: `buildTimeRoute(year: number, month: number): string` — returns `#/time/2026-09`

- [ ] **Step 1: Write the failing test**

Add to `src/tests/router.test.js` inside a new `describe('buildTimeRoute', ...)` block:

```js
import { describe, it, expect, vi, beforeEach, afterEach, buildTimeRoute } from 'vitest';
// NOTE: add buildTimeRoute to the existing import line at the top of the file:
// import { parseRoute, buildFolderRoute, navigate, buildTimeRoute } from '../lib/router.js';

describe('buildTimeRoute', () => {
    it('builds a zero-padded time route hash', () => {
        expect(buildTimeRoute(2026, 9)).toBe('#/time/2026-09');
    });

    it('handles two-digit months without double-padding', () => {
        expect(buildTimeRoute(2026, 11)).toBe('#/time/2026-11');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- --reporter=verbose 2>&1 | grep -A3 "buildTimeRoute"
```

Expected: FAIL — `buildTimeRoute is not a function`.

- [ ] **Step 3: Implement `buildTimeRoute` in `src/lib/router.js`**

Add after `buildFolderRoute`:

```js
export function buildTimeRoute(year, month) {
    return `#/time/${year}-${String(month).padStart(2, '0')}`;
}
```

Also update the import line in `src/tests/router.test.js` to include `buildTimeRoute`:

```js
import { parseRoute, buildFolderRoute, navigate, buildTimeRoute } from '../lib/router.js';
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run 2>&1 | tail -8
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/router.js src/tests/router.test.js
git commit -m "feat: add buildTimeRoute to router"
```

---

## Task 3: ScanEngine — rebuild month index after each scan

**Files:**
- Modify: `src/lib/scanEngine.js`

**Interfaces:**
- Consumes: `db.rebuildMonthIndex(): Promise<Object>` from Task 1
- Produces: `scanEngine` emits existing `folder_status` event with `status: 'scanned'` (unchanged); month index is updated as a side-effect after each successful scan

No new tests needed — `scanEngine` tests already mock IDB; the call is a fire-and-forget background update.

- [ ] **Step 1: Add `rebuildMonthIndex` call after each successful scan**

In `src/lib/scanEngine.js`, after line `this._setFolderStatus(folderId, 'scanned', photos.length);` (currently line 62), add:

```js
// Rebuild month index in background — don't await (non-critical)
db.rebuildMonthIndex().catch(err => console.warn('monthIndex rebuild failed:', err));
```

- [ ] **Step 2: Run tests to verify nothing broke**

```bash
npm run test:run 2>&1 | tail -8
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/scanEngine.js
git commit -m "feat: rebuild month index in background after each folder scan"
```

---

## Task 4: HTML + CSS — timeline panel and view-toggle buttons

**Files:**
- Modify: `src/index.html`
- Modify: `src/style.css`

**Interfaces:**
- Produces:
  - `#btn-folders` and `#btn-timeline` — view toggle buttons in header (same `.mode-btn` class as existing Quick/Advanced buttons)
  - `#panel-timeline` — new `<section>` in `.app-columns` with class `panel panel--timeline`
  - CSS modifier `.app-columns--timeline` — hides `panel--folders` and `panel--series`, makes `panel--timeline` fill remaining width
  - `.timeline-scrubber` — fixed right-edge element (empty for now; populated by JS in Task 5)
  - `.timeline-day-header` — sticky day label style
  - `.timeline-month-header` — sticky month label style (higher `top` than day)
  - `.photo-thumb--video` — video overlay style (▶ icon via `::after` pseudo-element)

- [ ] **Step 1: Add view-toggle buttons to `src/index.html`**

In the header `<div class="app-header__mode-toggle">`, add before the existing buttons (or as a separate group):

```html
<!-- View toggle -->
<div class="app-header__view-toggle">
  <button id="btn-folders" class="mode-btn mode-btn--active">Folders</button>
  <button id="btn-timeline" class="mode-btn">Timeline</button>
</div>
```

- [ ] **Step 2: Add `#panel-timeline` to `.app-columns`**

After the existing `<!-- Right: Review grid -->` aside, add:

```html
<!-- Timeline view (full-width, hidden by default) -->
<section class="panel panel--timeline" id="panel-timeline" hidden>
  <div class="timeline-scroll" id="timeline-scroll"></div>
  <div class="timeline-scrubber" id="timeline-scrubber"></div>
</section>
```

- [ ] **Step 3: Add CSS for timeline layout to `src/style.css`**

Append to `src/style.css`:

```css
/* View toggle */
.app-header__view-toggle { display: flex; gap: 4px; }

/* Timeline layout modifier */
.app-columns--timeline .panel--folders,
.app-columns--timeline .panel--series,
.app-columns--timeline .panel--review { display: none !important; }
.panel--timeline { display: none; flex: 1; position: relative; overflow: hidden; }
.app-columns--timeline .panel--timeline { display: flex; }

/* Timeline scroll container */
.timeline-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 0 64px 0 16px; /* right padding for scrubber */
}

/* Month and day sticky headers */
.timeline-month-header {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--color-bg);
  padding: 8px 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
}
.timeline-day-header {
  position: sticky;
  top: 33px; /* below month header */
  z-index: 1;
  background: var(--color-bg);
  padding: 6px 0 4px;
  font-size: 12px;
  color: var(--color-text-muted);
}

/* Timeline spacers (virtual scroll placeholders) */
.timeline-spacer { background: transparent; }

/* Video overlay on thumbnails */
.photo-thumb--video { position: relative; }
.photo-thumb--video::after {
  content: '▶';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: rgba(255,255,255,0.85);
  background: rgba(0,0,0,0.25);
  pointer-events: none;
}

/* Scrubber */
.timeline-scrubber {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 56px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 8px 4px;
  gap: 2px;
  border-left: 1px solid var(--color-border);
  scrollbar-width: none;
}
.timeline-scrubber::-webkit-scrollbar { display: none; }
.scrubber-year {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
  padding: 4px 2px 2px;
  text-align: center;
}
.scrubber-month {
  font-size: 10px;
  color: var(--color-text-muted);
  padding: 2px 4px;
  border-radius: 3px;
  cursor: pointer;
  text-align: center;
  line-height: 1.4;
}
.scrubber-month:hover,
.scrubber-month--active { background: var(--color-accent); color: #fff; }
```

- [ ] **Step 4: Run tests to verify nothing broke**

```bash
npm run test:run 2>&1 | tail -8
```

Expected: all tests pass (HTML/CSS changes don't affect unit tests).

- [ ] **Step 5: Commit**

```bash
git add src/index.html src/style.css
git commit -m "feat: add timeline panel HTML and CSS, view-toggle buttons"
```

---

## Task 5: `TimelinePanel` class

**Files:**
- Create: `src/lib/timelinePanel.js`

**Interfaces:**
- Consumes:
  - `db.getPhotosByMonth(year, month)` from Task 1
  - `db.getSetting('monthIndex')` — existing
  - `findPhotoSeries(photos, options)` — existing
  - `getSeriesSettings()` — existing
  - `buildTimeRoute(year, month)` from Task 2
  - `navigate(hash)` — existing
- Produces:
  - `new TimelinePanel({ scrollEl, scrubberEl, onSeriesClick, onPhotoClick })` — constructor
  - `timelinePanel.show(year, month): Promise<void>` — enter timeline mode, load initial month
  - `timelinePanel.hide(): void` — teardown observers
  - `timelinePanel.refreshScrubber(): Promise<void>` — reload `monthIndex` and re-render scrubber (called after scan completes)

```js
// Skeleton — implement each method per the steps below
export class TimelinePanel {
    constructor({ scrollEl, scrubberEl, onSeriesClick, onPhotoClick }) { }
    async show(year, month) { }
    hide() { }
    async refreshScrubber() { }

    // private
    async _loadMonth(year, month) { }         // fetch, group, render → returns chunk el
    _buildDayGroups(photos, series) { }        // returns [{ dateLabel, items: [{type,…}] }]
    _renderChunk(year, month, dayGroups) { }   // returns <div data-month="YYYY-MM">
    _renderDayGroup(dateLabel, items) { }      // returns <div class="timeline-day">
    _renderSeriesBlock(series) { }             // returns series tile el (reuses photoGridPanel logic)
    _renderThumb(photo) { }                    // returns .photo-thumb el, adds --video class if needed
    _updateScrubberActive(month) { }           // highlights current month in scrubber
    _setupObserver() { }                       // IntersectionObserver on sentinel divs
}
```

- [ ] **Step 1: Implement constructor and `show`/`hide`**

Create `src/lib/timelinePanel.js`:

```js
import { db } from './db.js';
import { findPhotoSeries } from './analysis.js';
import { getSeriesSettings } from './settingsManager.js';
import { buildTimeRoute, navigate } from './router.js';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export class TimelinePanel {
    constructor({ scrollEl, scrubberEl, onSeriesClick, onPhotoClick }) {
        this._scrollEl = scrollEl;
        this._scrubberEl = scrubberEl;
        this._onSeriesClick = onSeriesClick;
        this._onPhotoClick = onPhotoClick;
        this._monthIndex = {};
        this._renderedMonths = new Set(); // "YYYY-MM" keys currently in DOM
        this._observer = null;
        this._currentYear = null;
        this._currentMonth = null;
    }

    async show(year, month) {
        this._currentYear = year;
        this._currentMonth = month;
        this._scrollEl.innerHTML = '';
        this._renderedMonths.clear();

        // Load month index for scrubber
        this._monthIndex = (await db.getSetting('monthIndex')) || {};
        this._renderScrubber();

        // Build spacers for all months, then render the target month
        this._buildSpacers(year, month);
        await this._loadAndReplaceMonth(year, month);

        this._setupObserver();
        this._updateScrubberActive(`${year}-${String(month).padStart(2,'0')}`);
    }

    hide() {
        if (this._observer) { this._observer.disconnect(); this._observer = null; }
    }

    async refreshScrubber() {
        this._monthIndex = (await db.getSetting('monthIndex')) || {};
        this._renderScrubber();
    }
```

- [ ] **Step 2: Implement `_buildSpacers`**

Spacers occupy scroll space for months not yet rendered. Estimate height as `Math.ceil(count / 5) * 130 + 60` px (5 thumbs per row, ~120px thumb + 10px gap, 60px for day header). Append into `_scrollEl` in reverse-chronological order (newest at top).

```js
    _buildSpacers(targetYear, targetMonth) {
        const months = Object.keys(this._monthIndex)
            .filter(k => this._monthIndex[k] > 0)
            .sort()
            .reverse(); // newest first

        for (const key of months) {
            const [y, m] = key.split('-').map(Number);
            const isTarget = y === targetYear && m === targetMonth;
            const el = document.createElement('div');
            el.dataset.month = key;
            el.dataset.spacer = isTarget ? 'false' : 'true';
            if (el.dataset.spacer === 'true') {
                const count = this._monthIndex[key];
                el.className = 'timeline-spacer';
                el.style.height = `${Math.ceil(count / 5) * 130 + 60}px`;
            }
            this._scrollEl.appendChild(el);
        }
    }
```

- [ ] **Step 3: Implement `_loadAndReplaceMonth`**

Fetches photos for a month, groups them, renders, replaces the spacer.

```js
    async _loadAndReplaceMonth(year, month) {
        const key = `${year}-${String(month).padStart(2,'0')}`;
        if (this._renderedMonths.has(key)) return;

        const photos = await db.getPhotosByMonth(year, month);
        const settings = await getSeriesSettings();
        const series = photos.length > 0
            ? await findPhotoSeries(photos, { minGroupSize: settings.minGroupSize, maxTimeGap: settings.maxTimeGap })
            : [];

        const dayGroups = this._buildDayGroups(photos, series);
        const chunk = this._renderChunk(year, month, dayGroups);

        // Replace the spacer/placeholder for this month
        const existing = this._scrollEl.querySelector(`[data-month="${key}"]`);
        if (existing) {
            this._scrollEl.replaceChild(chunk, existing);
        } else {
            this._scrollEl.appendChild(chunk);
        }
        this._renderedMonths.add(key);
    }
```

- [ ] **Step 4: Implement `_buildDayGroups`**

Groups photos by calendar day (UTC date string `YYYY-MM-DD`), interleaves series and standalones using the same logic as `PhotoGridPanel._buildTimeline`.

```js
    _buildDayGroups(photos, series) {
        const sorted = photos
            .filter(p => p.photo_taken_ts)
            .sort((a, b) => a.photo_taken_ts < b.photo_taken_ts ? -1 : 1);

        const photoToSeries = new Map();
        for (const s of series) {
            for (const p of s.photos) photoToSeries.set(p.file_id, s);
        }
        const emittedSeries = new Set();

        // Group by day
        const dayMap = new Map(); // "YYYY-MM-DD" → raw items
        for (const photo of sorted) {
            const day = photo.photo_taken_ts.slice(0, 10);
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

        // Merge consecutive standalone photos within each day
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
```

- [ ] **Step 5: Implement `_renderChunk`, `_renderDayGroup`, `_renderSeriesBlock`, `_renderThumb`**

```js
    _renderChunk(year, month, dayGroups) {
        const key = `${year}-${String(month).padStart(2,'0')}`;
        const chunk = document.createElement('div');
        chunk.dataset.month = key;
        chunk.dataset.spacer = 'false';

        const monthHeader = document.createElement('div');
        monthHeader.className = 'timeline-month-header';
        monthHeader.textContent = `${MONTH_NAMES[month - 1]} ${year}`;
        chunk.appendChild(monthHeader);

        for (const { day, items } of dayGroups) {
            chunk.appendChild(this._renderDayGroup(day, items));
        }

        if (dayGroups.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'padding:16px;color:#888;font-size:12px';
            empty.textContent = 'No photos this month.';
            chunk.appendChild(empty);
        }

        // Sentinels for IntersectionObserver
        const topSentinel = document.createElement('div');
        topSentinel.className = 'timeline-sentinel-top';
        topSentinel.dataset.month = key;
        const bottomSentinel = document.createElement('div');
        bottomSentinel.className = 'timeline-sentinel-bottom';
        bottomSentinel.dataset.month = key;
        chunk.prepend(topSentinel);
        chunk.appendChild(bottomSentinel);

        return chunk;
    }

    _renderDayGroup(day, items) {
        const wrap = document.createElement('div');
        wrap.className = 'timeline-day';

        const header = document.createElement('div');
        header.className = 'timeline-day-header';
        const d = new Date(day + 'T12:00:00Z');
        header.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        wrap.appendChild(header);

        const thumbsRow = document.createElement('div');
        thumbsRow.className = 'standalone-photos'; // reuse existing CSS
        wrap.appendChild(thumbsRow);

        for (const item of items) {
            if (item.type === 'series') {
                thumbsRow.appendChild(this._renderSeriesThumb(item.series));
            } else {
                for (const photo of item.photos) {
                    thumbsRow.appendChild(this._renderThumb(photo));
                }
            }
        }
        return wrap;
    }

    _renderSeriesThumb(series) {
        const firstPhoto = series.photos[0];
        const wrap = document.createElement('div');
        wrap.className = 'photo-thumb photo-thumb--series';
        const img = document.createElement('img');
        img.src = `/api/thumb/${firstPhoto.file_id}`;
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = function() { this.style.background = '#333'; this.removeAttribute('src'); };
        const badge = document.createElement('span');
        badge.className = 'series-count-badge';
        badge.textContent = series.photos.length;
        wrap.appendChild(img);
        wrap.appendChild(badge);
        wrap.addEventListener('click', () => this._onSeriesClick(series, series.photos[0].folder_id, 0));
        return wrap;
    }

    _renderThumb(photo) {
        const wrap = document.createElement('div');
        wrap.className = 'photo-thumb' + (photo.item_type === 'video' ? ' photo-thumb--video' : '');
        const img = document.createElement('img');
        img.src = `/api/thumb/${photo.file_id}`;
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = function() { this.style.background = '#333'; this.removeAttribute('src'); };
        wrap.appendChild(img);
        wrap.addEventListener('click', () => this._onPhotoClick(photo, null));
        return wrap;
    }
```

- [ ] **Step 6: Implement `_renderScrubber` and `_updateScrubberActive`**

```js
    _renderScrubber() {
        this._scrubberEl.innerHTML = '';
        const months = Object.keys(this._monthIndex)
            .filter(k => this._monthIndex[k] > 0)
            .sort()
            .reverse();

        let lastYear = null;
        for (const key of months) {
            const [y, m] = key.split('-').map(Number);
            if (y !== lastYear) {
                const yearEl = document.createElement('div');
                yearEl.className = 'scrubber-year';
                yearEl.textContent = y;
                this._scrubberEl.appendChild(yearEl);
                lastYear = y;
            }
            const monthEl = document.createElement('div');
            monthEl.className = 'scrubber-month';
            monthEl.dataset.key = key;
            monthEl.textContent = MONTH_NAMES[m - 1];
            monthEl.addEventListener('click', () => {
                navigate(buildTimeRoute(y, m));
                this._jumpToMonth(y, m);
            });
            this._scrubberEl.appendChild(monthEl);
        }
    }

    _updateScrubberActive(key) {
        for (const el of this._scrubberEl.querySelectorAll('.scrubber-month')) {
            el.classList.toggle('scrubber-month--active', el.dataset.key === key);
        }
    }

    async _jumpToMonth(year, month) {
        await this._loadAndReplaceMonth(year, month);
        const key = `${year}-${String(month).padStart(2,'0')}`;
        const target = this._scrollEl.querySelector(`[data-month="${key}"]`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._updateScrubberActive(key);
    }
```

- [ ] **Step 7: Implement `_setupObserver`**

```js
    _setupObserver() {
        if (this._observer) this._observer.disconnect();
        this._observer = new IntersectionObserver(async (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const el = entry.target;
                const [y, m] = el.dataset.month.split('-').map(Number);
                const key = el.dataset.month;

                if (el.classList.contains('timeline-sentinel-bottom')) {
                    // Load next month (older — lower in sort order)
                    const months = Object.keys(this._monthIndex).filter(k => this._monthIndex[k] > 0).sort();
                    const idx = months.indexOf(key);
                    if (idx > 0) {
                        const [ny, nm] = months[idx - 1].split('-').map(Number);
                        await this._loadAndReplaceMonth(ny, nm);
                    }
                }
                if (el.classList.contains('timeline-sentinel-top')) {
                    // Load prev month (newer — higher in sort order)
                    const months = Object.keys(this._monthIndex).filter(k => this._monthIndex[k] > 0).sort();
                    const idx = months.indexOf(key);
                    if (idx < months.length - 1) {
                        const [ny, nm] = months[idx + 1].split('-').map(Number);
                        await this._loadAndReplaceMonth(ny, nm);
                    }
                    // Update active scrubber month as user scrolls
                    this._updateScrubberActive(key);
                    this._currentYear = y;
                    this._currentMonth = m;
                }
            }
        }, { root: this._scrollEl, threshold: 0.1 });

        for (const sentinel of this._scrollEl.querySelectorAll('.timeline-sentinel-top, .timeline-sentinel-bottom')) {
            this._observer.observe(sentinel);
        }
    }
}
```

- [ ] **Step 8: Run tests to verify nothing broke**

```bash
npm run test:run 2>&1 | tail -8
```

Expected: all tests pass (TimelinePanel has no unit-testable pure functions; existing suite stays green).

- [ ] **Step 9: Add series count badge CSS to `src/style.css`**

```css
.photo-thumb--series { position: relative; }
.series-count-badge {
  position: absolute;
  bottom: 4px;
  right: 4px;
  background: rgba(0,0,0,0.7);
  color: #fff;
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  pointer-events: none;
}
```

- [ ] **Step 10: Commit**

```bash
git add src/lib/timelinePanel.js src/style.css
git commit -m "feat: implement TimelinePanel with virtual scroll, day groups, series, scrubber"
```

---

## Task 6: Wire timeline into `main.js`

**Files:**
- Modify: `src/main.js`

**Interfaces:**
- Consumes:
  - `TimelinePanel` from Task 5
  - `buildTimeRoute(year, month)` from Task 2
  - `getCurrentRoute()`, `navigate()`, `buildFolderRoute()` — existing
  - `closeReviewMode()` — existing
  - `#btn-folders`, `#btn-timeline`, `#panel-timeline`, `#timeline-scroll`, `#timeline-scrubber` — from Task 4
- Produces: full view-switching behaviour; `#/time/:year-:month` route handled on boot and `popstate`

- [ ] **Step 1: Import `TimelinePanel` and `buildTimeRoute`**

In `src/main.js`, add to imports:

```js
import { TimelinePanel } from './lib/timelinePanel.js';
import { buildFolderRoute, navigate, getCurrentRoute, buildTimeRoute } from './lib/router.js';
```

(Replace the existing router import line.)

- [ ] **Step 2: Add timeline DOM refs and `appState.viewMode`**

In `src/main.js`, after the existing DOM ref declarations, add:

```js
const btnFolders    = document.getElementById('btn-folders');
const btnTimeline   = document.getElementById('btn-timeline');
const panelTimeline = document.getElementById('panel-timeline');
```

In `appState`, add:

```js
viewMode: 'folder',       // 'folder' | 'timeline'
lastTimelineYear: null,
lastTimelineMonth: null,
```

- [ ] **Step 3: Add `switchToTimeline` and `switchToFolders` helpers**

```js
async function switchToTimeline(year, month) {
    if (reviewGrid && appColumns.classList.contains('app-columns--review-open')) {
        closeReviewMode();
    }
    appState.viewMode = 'timeline';
    appState.lastTimelineYear = year;
    appState.lastTimelineMonth = month;
    appColumns.classList.add('app-columns--timeline');
    panelTimeline.hidden = false;
    btnFolders.classList.remove('mode-btn--active');
    btnTimeline.classList.add('mode-btn--active');
    await timelinePanel.show(year, month);
}

function switchToFolders() {
    appState.viewMode = 'folder';
    appColumns.classList.remove('app-columns--timeline');
    panelTimeline.hidden = true;
    btnTimeline.classList.remove('mode-btn--active');
    btnFolders.classList.add('mode-btn--active');
    timelinePanel.hide();
}
```

- [ ] **Step 4: Instantiate `TimelinePanel` in `onAuthenticated`**

After `reviewGrid = new ReviewGrid(...)`, add:

```js
let timelinePanel;
// (move the let declaration to module scope alongside folderPanel etc.)
```

In module scope, add `let timelinePanel;` alongside the other panel declarations (line ~29).

Then inside `onAuthenticated`, after `reviewGrid` instantiation:

```js
timelinePanel = new TimelinePanel({
    scrollEl:   document.getElementById('timeline-scroll'),
    scrubberEl: document.getElementById('timeline-scrubber'),
    onSeriesClick: handleSeriesClick,
    onPhotoClick:  handlePhotoClick,
});
```

- [ ] **Step 5: Wire view-toggle buttons**

In `boot()`, after the existing button event listeners:

```js
btnFolders?.addEventListener('click', () => {
    const route = appState.selectedFolderId
        ? buildFolderRoute(appState.selectedFolderId)
        : '#/';
    navigate(route);
    switchToFolders();
});
btnTimeline?.addEventListener('click', () => {
    const now = new Date();
    const y = appState.lastTimelineYear ?? now.getFullYear();
    const m = appState.lastTimelineMonth ?? (now.getMonth() + 1);
    navigate(buildTimeRoute(y, m));
    switchToTimeline(y, m).catch(console.error);
});
```

- [ ] **Step 6: Handle `#/time` route on boot and in `popstate`**

In `onAuthenticated`, after the existing hash-restore block, update it to also handle time routes:

```js
const route = getCurrentRoute();
if (route.type === 'folder') {
    // ... existing folder restore code (unchanged) ...
} else if (route.type === 'time') {
    await switchToTimeline(route.year, route.month);
}
```

In the `popstate` handler, add the `time` branch:

```js
window.addEventListener('popstate', async () => {
    const popRoute = getCurrentRoute();
    if (popRoute.type === 'folder') {
        switchToFolders();
        // ... existing folder restore code (unchanged) ...
    } else if (popRoute.type === 'time') {
        await switchToTimeline(popRoute.year, popRoute.month);
    } else if (popRoute.type === 'none') {
        switchToFolders();
        appState.selectedFolderId = null;
        appState.selectedFolderName = null;
        folderPanel.setSelected(null);
        closeReviewMode();
        photoGridPanel.clear();
    }
});
```

- [ ] **Step 7: Refresh scrubber on scan complete**

In the `folder_status` event listener in `onAuthenticated`, add:

```js
if (status === 'scanned' && appState.viewMode === 'timeline') {
    timelinePanel.refreshScrubber().catch(console.error);
}
```

- [ ] **Step 8: Run tests to verify nothing broke**

```bash
npm run test:run 2>&1 | tail -8
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/main.js
git commit -m "feat: wire TimelinePanel and view-toggle into main.js"
```

---

## Review Focus Tests (add to existing tasks)

**Null `photo_taken_ts`** — covered by `db.test.js` tests in Task 1 (excluded from `getPhotosByMonth`, excluded from `rebuildMonthIndex`).

**Month boundary** — covered by Task 1 `getPhotosByMonth` test: `aug1` (`"2026-08-31T23:59:59Z"`) must NOT appear in September results.

**Empty months in scrubber** — `_renderScrubber` filters `this._monthIndex[k] > 0`; no dedicated test (scrubber is DOM-only). Manual verification in Task 6 browser test.

**Scrubber jump to unrendered month** — `_jumpToMonth` calls `_loadAndReplaceMonth` before `scrollIntoView`; the spacer is replaced with real content before the scroll. Manual verification in Task 6 browser test.

**View-toggle while review grid open** — `switchToTimeline` calls `closeReviewMode()` first; covered by Task 6 Step 3 code path. Manual verification: open review grid, click Timeline — review panel must close cleanly.
