# Testing Strategy Design

**Date:** 2026-05-03  
**Scope:** Unit tests for pure logic layer — no browser APIs, no network, no IndexedDB

## Goals

- Catch regressions in algorithmic code during active development
- Document non-obvious parameter behavior as living specification
- Enable CI without OneDrive access or user presence

## Approach: Vitest, Pure Logic Only

Vitest is the test runner. It is Vite-native, supports ES modules without Babel config, and shares `vite.config.js`. Scope is limited to functions with no external dependencies.

## Infrastructure

### Dependencies

Add to `devDependencies`:
```
vitest
```

No other packages needed for this phase.

### vite.config.js change

Add a `test` block:
```js
test: {
  include: ['src/tests/**/*.test.js'],
  environment: 'node',
}
```

### package.json scripts

```json
"test": "vitest",
"test:run": "vitest run"
```

`test` is for local watch mode. `test:run` exits after one pass — use in CI.

## File Layout

```
src/tests/
  helpers.js          — shared makePhoto() factory
  analysis.test.js
  reviewManager.test.js
  calibration.test.js
```

## Test Data Strategy

A single `makePhoto(id, takenAtMs, qualityScore)` helper in `helpers.js` returns a minimal photo object:

```js
export function makePhoto(id, takenAtMs, qualityScore = null) {
  return { file_id: id, photo_taken_ts: takenAtMs, quality_score: qualityScore };
}
```

Timestamps are numeric milliseconds. Series scenarios are built inline as arrays.

## Coverage Plan

### analysis.test.js — `findPhotoSeries`, `pickBestPhotoByQuality`

`findPhotoSeries` branches to cover:
- No photos with valid timestamps → returns `[]`
- All photos at same timestamp → density is treated as infinite, series included
- Time gap ≤ `maxTimeGap` keeps photos in same series
- Time gap > `maxTimeGap` splits into separate series
- Series below `minGroupSize` is filtered out
- Series below `minDensity` is filtered out
- `ignoredPeriods` removes photos in specified time windows
- `sortMethod`: `series-size`, `density`, `date-desc`, `date-asc`

`pickBestPhotoByQuality` cases:
- Single photo in group → returns it directly
- Multiple photos → returns highest `quality_score`
- Missing `quality_score` (null) treated as 0

### reviewManager.test.js — `classifySeries`, `preselectSeries`

`classifySeries`:
- Sparse: `durationMinutes > 10` and `density < 1` → `'sparse'`
- Burst: `density >= burstThreshold` → `'burst'`
- Spread: everything else → `'spread'`
- Missing `calibration` argument → falls back to default `burstThreshold = 5`

`preselectSeries`:
- Burst series → keeps 1 highest-quality photo
- Spread series → keeps 3 highest-quality photos
- Sparse series → keeps all photos, deletes none
- Photos without `quality_score` sort to bottom (treated as 0)

### calibration.test.js — deferred

`calibrateFolder` depends on `db.getPhotosByFolderId` (IndexedDB), so no test file
is created in Phase A. Unblocked by Phase B (fake-indexeddb). The percentile math
(p10/p50/p90 gaps → maxTimeGap/minDensity/burstThreshold) is the primary thing to
verify once the DB stub is available.

## Explicit Out of Scope (This Phase)

| Module | Reason | Future path |
|--------|--------|-------------|
| `graph.js`, `scanEngine.js` | Requires Graph API mocking | Add MSW (Approach C) |
| `db.js`, `settingsManager.js` | Requires IndexedDB | Add fake-indexeddb (Approach B) |
| `calibration.js` full flow | DB-dependent | Unblocked by Approach B |
| UI panel classes | DOM-dependent | Playwright or happy-dom |
| Web Worker (`worker.js`) | Worker API unavailable in node env | vitest-worker or separate test process |
| Service Worker (`sw.js`) | Out of scope for unit testing | — |

## Future Phases

- **Phase B:** Add `fake-indexeddb` to cover `db.js`, `calibration.js` full flow, `reviewManager` DB persistence
- **Phase C:** Add MSW to cover `graph.js` fetch logic with canned Graph API fixtures
- **Phase D:** Add Playwright for end-to-end smoke tests against a mocked auth layer
