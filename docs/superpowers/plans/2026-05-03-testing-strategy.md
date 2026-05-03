# Testing Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Vitest unit tests for the pure logic layer (`analysis.js`, `reviewManager.js`) with zero external dependencies.

**Architecture:** Vitest is wired into the existing `vite.config.js` via a `test` block. All test files live in `src/tests/`. A shared `helpers.js` provides a `makePhoto` factory. No mocking framework needed — the tested functions accept plain JS objects.

**Tech Stack:** Vitest, ES modules, plain JS objects as test data

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `vite.config.js` | Add `test` block pointing at `src/tests/` |
| Modify | `package.json` | Add `vitest` devDependency and `test`/`test:run` scripts |
| Create | `src/tests/helpers.js` | `makePhoto` and `makeSeries` factory functions |
| Create | `src/tests/analysis.test.js` | Tests for `findPhotoSeries` and `pickBestPhotoByQuality` |
| Create | `src/tests/reviewManager.test.js` | Tests for `classifySeries` and `preselectSeries` |

---

## Task 1: Wire up Vitest

**Files:**
- Modify: `package.json`
- Modify: `vite.config.js`

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest
```

Expected: `vitest` appears in `devDependencies` in `package.json`.

- [ ] **Step 2: Add test scripts to package.json**

In `package.json`, add to the `"scripts"` block:

```json
"test": "vitest",
"test:run": "vitest run"
```

Result after edit:
```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "vitest",
  "test:run": "vitest run"
}
```

- [ ] **Step 3: Add test block to vite.config.js**

In `vite.config.js`, add a `test` key inside `defineConfig({...})`, after the `plugins` array:

```js
export default defineConfig({
  root: 'src',
  publicDir: '../public',
  envDir: '..',

  worker: {
    format: 'es'
  },

  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },

  plugins: [
    {
      name: 'copy-sw',
      writeBundle() {
        copyFileSync('src/sw.js', 'dist/sw.js');
      }
    }
  ],

  test: {
    include: ['src/tests/**/*.test.js'],
    environment: 'node',
  }
});
```

- [ ] **Step 4: Verify Vitest runs with no tests**

```bash
npm run test:run
```

Expected output contains:
```
No test files found
```
(Exit code 0 or 1 depending on vitest version — either is fine at this point.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.js
git commit -m "chore: add vitest test runner"
```

---

## Task 2: Create test helpers

**Files:**
- Create: `src/tests/helpers.js`

- [ ] **Step 1: Create the helpers file**

Create `src/tests/helpers.js` with this content:

```js
/**
 * Create a minimal photo object for test use.
 * @param {string} id
 * @param {number} takenAtMs - Unix timestamp in milliseconds
 * @param {number|null} qualityScore
 */
export function makePhoto(id, takenAtMs, qualityScore = null) {
    return { file_id: id, photo_taken_ts: takenAtMs, quality_score: qualityScore };
}

/**
 * Create a series object as returned by findPhotoSeries.
 * @param {Array} photos - Array of photo objects (use makePhoto)
 * @param {Object} overrides - Optional field overrides
 */
export function makeSeries(photos, overrides = {}) {
    const timestamps = photos.map(p => p.photo_taken_ts).filter(Boolean);
    const startTime = Math.min(...timestamps);
    const endTime = Math.max(...timestamps);
    const timeSpanMs = endTime - startTime;
    const timeSpanMinutes = timeSpanMs / 60000;
    const density = timeSpanMinutes > 0 ? photos.length / timeSpanMinutes : photos.length;
    return {
        photos,
        startTime,
        endTime,
        timeSpanMs,
        timeSpanMinutes,
        photoCount: photos.length,
        density,
        avgTimeBetweenPhotos: timeSpanMinutes > 0 ? timeSpanMinutes / (photos.length - 1) : 0,
        ...overrides,
    };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tests/helpers.js
git commit -m "test: add makePhoto and makeSeries helpers"
```

---

## Task 3: Tests for `pickBestPhotoByQuality`

**Files:**
- Create: `src/tests/analysis.test.js`
- Reference: `src/lib/analysis.js` (imports `pickBestPhotoByQuality`)

- [ ] **Step 1: Write the failing tests**

Create `src/tests/analysis.test.js` with:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail (not yet — file just created, should pass immediately)**

```bash
npm run test:run -- src/tests/analysis.test.js
```

Expected: all 3 `pickBestPhotoByQuality` tests PASS (the function already exists).

- [ ] **Step 3: Commit**

```bash
git add src/tests/analysis.test.js
git commit -m "test: add pickBestPhotoByQuality tests"
```

---

## Task 4: Tests for `findPhotoSeries` — basic grouping

**Files:**
- Modify: `src/tests/analysis.test.js`

Base timestamp for all tests in this task: `const BASE = 1_700_000_000_000` (a fixed epoch ms, ~Nov 2023).

- [ ] **Step 1: Add the grouping tests**

Append to the `describe` blocks in `src/tests/analysis.test.js`:

```js
const BASE = 1_700_000_000_000; // fixed epoch reference
const MIN = 60_000;             // 1 minute in ms

describe('findPhotoSeries — basic grouping', () => {
    it('returns empty array when no photos have valid timestamps', async () => {
        const photos = [
            { file_id: 'a', photo_taken_ts: null },
            { file_id: 'b', photo_taken_ts: 'not-a-date' },
        ];
        const result = await findPhotoSeries(photos);
        expect(result).toEqual([]);
    });

    it('keeps photos in same series when gap is within maxTimeGap', async () => {
        // 25 photos, 30 seconds apart — well within default 5-min gap
        const photos = Array.from({ length: 25 }, (_, i) =>
            makePhoto(`p${i}`, BASE + i * 30_000)
        );
        const result = await findPhotoSeries(photos, { minGroupSize: 20, minDensity: 1 });
        expect(result).toHaveLength(1);
        expect(result[0].photoCount).toBe(25);
    });

    it('splits into separate series when gap exceeds maxTimeGap', async () => {
        // 20 photos in first cluster, then 6-minute gap, then 20 more
        const cluster1 = Array.from({ length: 20 }, (_, i) =>
            makePhoto(`a${i}`, BASE + i * 30_000)
        );
        const gapStart = BASE + 20 * 30_000 + 6 * MIN; // 6-min gap
        const cluster2 = Array.from({ length: 20 }, (_, i) =>
            makePhoto(`b${i}`, gapStart + i * 30_000)
        );
        const result = await findPhotoSeries([...cluster1, ...cluster2], {
            minGroupSize: 20,
            minDensity: 1,
            maxTimeGap: 5,
        });
        expect(result).toHaveLength(2);
    });

    it('filters out series below minGroupSize', async () => {
        // Only 10 photos — below default minGroupSize of 20
        const photos = Array.from({ length: 10 }, (_, i) =>
            makePhoto(`p${i}`, BASE + i * 30_000)
        );
        const result = await findPhotoSeries(photos, { minGroupSize: 20 });
        expect(result).toEqual([]);
    });

    it('filters out series below minDensity', async () => {
        // 20 photos spread over 60 minutes = 0.33 photos/min, below minDensity 1
        const photos = Array.from({ length: 20 }, (_, i) =>
            makePhoto(`p${i}`, BASE + i * 3 * MIN)
        );
        const result = await findPhotoSeries(photos, { minGroupSize: 20, minDensity: 1 });
        expect(result).toEqual([]);
    });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test:run -- src/tests/analysis.test.js
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/tests/analysis.test.js
git commit -m "test: add findPhotoSeries basic grouping tests"
```

---

## Task 5: Tests for `findPhotoSeries` — edge cases and sorting

**Files:**
- Modify: `src/tests/analysis.test.js`

- [ ] **Step 1: Add edge case and sort tests**

Append to `src/tests/analysis.test.js`:

```js
describe('findPhotoSeries — same-timestamp edge case', () => {
    it('includes series where all photos share the same timestamp', async () => {
        // Density is treated as infinite when timeSpan is 0
        const photos = Array.from({ length: 25 }, (_, i) =>
            makePhoto(`p${i}`, BASE)
        );
        const result = await findPhotoSeries(photos, { minGroupSize: 20, minDensity: 1 });
        expect(result).toHaveLength(1);
        expect(result[0].photoCount).toBe(25);
    });
});

describe('findPhotoSeries — ignoredPeriods', () => {
    it('excludes photos that fall within an ignored period', async () => {
        // 30 photos: first 20 in ignored window, last 10 outside
        const ignored = Array.from({ length: 20 }, (_, i) =>
            makePhoto(`ignored${i}`, BASE + i * 30_000)
        );
        const outside = Array.from({ length: 25 }, (_, i) =>
            makePhoto(`keep${i}`, BASE + 10 * MIN + i * 30_000)
        );
        const ignoredPeriods = [{ startTime: BASE, endTime: BASE + 20 * 30_000, label: 'test' }];
        const result = await findPhotoSeries([...ignored, ...outside], {
            minGroupSize: 20,
            minDensity: 1,
            ignoredPeriods,
        });
        // Only the 'keep' cluster should remain
        expect(result).toHaveLength(1);
        result[0].photos.forEach(p => expect(p.file_id).toMatch(/^keep/));
    });
});

describe('findPhotoSeries — sortMethod', () => {
    // Two series: A has 30 photos at high density, B has 25 photos at lower density
    // A: 30 photos, 15 seconds apart over ~7.5 min → density ≈ 4 photos/min
    // B: 25 photos, 30 seconds apart over ~12 min  → density ≈ 2 photos/min
    const seriesA = Array.from({ length: 30 }, (_, i) =>
        makePhoto(`a${i}`, BASE + i * 15_000)
    );
    const gapB = BASE + 30 * MIN;
    const seriesB = Array.from({ length: 25 }, (_, i) =>
        makePhoto(`b${i}`, gapB + i * 30_000)
    );
    const allPhotos = [...seriesA, ...seriesB];
    const opts = { minGroupSize: 20, minDensity: 1 };

    it('sorts by series-size descending by default', async () => {
        const result = await findPhotoSeries(allPhotos, { ...opts, sortMethod: 'series-size' });
        expect(result[0].photoCount).toBeGreaterThanOrEqual(result[1].photoCount);
    });

    it('sorts by density descending', async () => {
        const result = await findPhotoSeries(allPhotos, { ...opts, sortMethod: 'density' });
        expect(result[0].density).toBeGreaterThanOrEqual(result[1].density);
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
```

- [ ] **Step 2: Run tests**

```bash
npm run test:run -- src/tests/analysis.test.js
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/tests/analysis.test.js
git commit -m "test: add findPhotoSeries edge case and sort tests"
```

---

## Task 6: Tests for `classifySeries` and `preselectSeries`

**Files:**
- Create: `src/tests/reviewManager.test.js`

- [ ] **Step 1: Create the test file**

Create `src/tests/reviewManager.test.js`:

```js
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
        expect(result.keptIds).toEqual(['b', 'c', 'd']);
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
```

- [ ] **Step 2: Run tests**

```bash
npm run test:run -- src/tests/reviewManager.test.js
```

Expected: all tests PASS.

- [ ] **Step 3: Run the full suite**

```bash
npm run test:run
```

Expected output: all tests pass, no failures.

- [ ] **Step 4: Commit**

```bash
git add src/tests/reviewManager.test.js
git commit -m "test: add classifySeries and preselectSeries tests"
```

---

## Done

At this point the test suite covers:

| Function | Tests |
|----------|-------|
| `pickBestPhotoByQuality` | 3 |
| `findPhotoSeries` — basic grouping | 5 |
| `findPhotoSeries` — same-timestamp | 1 |
| `findPhotoSeries` — ignoredPeriods | 1 |
| `findPhotoSeries` — sortMethod | 4 |
| `classifySeries` | 5 |
| `preselectSeries` | 4 |
| **Total** | **23** |

Run `npm test` locally for watch mode during development. Run `npm run test:run` in CI.
