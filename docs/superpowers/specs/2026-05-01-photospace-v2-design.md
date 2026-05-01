# Photospace v2 — Design Spec

**Date:** 2026-05-01  
**Status:** Approved  
**Goal:** Simplify the app into a fast, user-friendly cleanup tool for selecting the best photos from burst series and deleting the rest. Remove the CLIP AI pipeline. Redesign the UI around a folder-first, guided workflow.

---

## 1. Problem Statement

The current app has ~8,000 lines of vanilla JS accumulated through incremental feature additions. It is developer-oriented, exposes too many knobs, and requires understanding of CLIP embeddings, cosine similarity thresholds, and worker count tuning. The CLIP model is 50MB, takes 30–60 seconds to load, and provides semantic similarity that is not useful for cleanup (similar photos from different times/places aren't cleanup candidates). The app also has a gap where photos deleted or moved on OneDrive are not reliably cleaned up from IndexedDB after large scans.

The user has ~1TB of OneDrive photos and needs a practical, fast tool to find burst series and delete all but the best shots.

---

## 2. Core Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| CLIP embeddings | Remove entirely | Not useful for cleanup; adds 50MB + 30–60s load time |
| Quality scoring | Keep (sharpness, exposure, face) | Useful for picking best shot; worker becomes lean |
| Navigation model | Hybrid: folder tree + series list | Folder tree drives scan priority; series list shows what's ready |
| Review mode | Grid + full-screen on click | All photos visible at once; full-screen for detail |
| Keep selection | Adaptive by density | Tight burst → keep 1; spread series → keep top 3 |
| Parameter tuning | Quick/Advanced toggle | Quick = auto-calibrated; Advanced = all sliders exposed |
| Onboarding | Single card, no wizard | Disappears as soon as scanning starts |

---

## 3. Architecture Changes

### Deleted

- `src/lib/embedding-processor.js` — CLIP worker pool and queue
- `src/lib/backupManager.js` — embeddings backup/sync to OneDrive
- `src/lib/similarPhotosManager.js` — cosine similarity search
- `src/lib/modalManager.js` — superseded by new review UI
- CLIP model code in `src/worker.js` — ONNX model loading, 512-D embedding generation, normalization
- `public/models/` — 50MB CLIP model files
- `@xenova/transformers` npm dependency
- `findSimilarGroups()` in `src/lib/analysis.js`

### Kept (mostly unchanged)

- `src/lib/auth.js`, `src/lib/graph.js` — OneDrive auth and API
- `src/lib/db.js` — IndexedDB wrapper (minor additions: `scan_id` per folder, `reviewed` flag per series result)
- `src/lib/analysis.js` — `findPhotoSeries()` and `pickBestPhotoByQuality()` kept; `findSimilarGroups()` removed
- `src/lib/settingsManager.js` — extended for Quick/Advanced toggle and calibration data storage
- `src/lib/urlStateManager.js` — kept as-is
- `src/lib/uiUtils.js` — kept, trimmed
- `src/worker.js` — kept as pure quality-scoring worker (sharpness, exposure, face detection); CLIP code removed

### New

| File | Purpose |
|------|---------|
| `src/lib/scanQueue.js` | Folder priority queue with per-folder cleanup trigger |
| `src/lib/calibration.js` | Samples folder timestamps to auto-set time gap and density thresholds |
| `src/lib/reviewManager.js` | Manages keep/delete state per series across the review session |

`src/main.js` and `src/index.html` are fully rewritten with the new three-column layout.

### IndexedDB

No schema migration needed. Two new fields on photo records:
- `folder_path` — already present
- `scan_id` — already present (used for cleanup)

New: series review progress stored in `settings` as `reviewedSeries: { [seriesKey]: { keptIds, deletedIds, timestamp } }`. The `seriesKey` is `{folderId}_{seriesStartTimestampMs}` — stable across sessions as long as the folder ID and first photo timestamp don't change.

---

## 4. Scanning & Indexing

### Folder Priority Queue (`scanQueue.js`)

Queue entries: `{ folderId, folderPath, driveId, priority: 'high' | 'normal' }`.

- **High priority**: user clicked a folder or pressed "↑ next" on a subfolder button
- **Normal priority**: subfolder discovered during scan, or added via "Scan all remaining"
- High-priority entries always go to the front; within the same priority, FIFO

Queue is persisted in `settings` (IndexedDB) and survives page reloads. On startup, scanning resumes from the queue.

### Per-Folder Scan Cycle

Each folder goes through a scan cycle with two logical stages:

1. **Paginated fetch+upsert** — for each `@odata.nextLink` page: fetch the page, immediately upsert all photos from it into IndexedDB (preserving existing quality scores), stamp each record with the current `scan_id` (a UUID generated per scan run of that folder). Rate-limit handling (HTTP 429 + `Retry-After`) unchanged from current implementation. Continues until no more pages.
2. **Cleanup** — after all pages are fetched (folder complete), call `db.deletePhotosFromScannedFoldersNotMatchingScanId(folderId, scanId)`. Removes records for files deleted or moved out of the folder since the last scan. Only runs when the full folder is done — not mid-pagination. If scanning is interrupted, cleanup is deferred until the folder completes in a future session.

### Quality Scoring During Scan

The quality worker runs in parallel with scanning. Since there is no CLIP model to load, the worker initializes in under a second (only `@vladmandic/human` for face detection). Quality scores are available much faster than in v1. Worker count default is 2 (reduced from 4; no CLIP parallelism benefit).

### Folder Tree Status Labels

| Status | Meaning |
|--------|---------|
| `not scanned` | Never scanned |
| `scanning…` | Currently in progress |
| `scanned (N photos)` | Complete, scanned within the last 7 days |
| `stale` | Last scanned >7 days ago |

---

## 5. UI Structure — Three-Column Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📷 Photospace    ● Quality scoring 12/47    [Quick cleanup|Advanced] │
├───────────────┬──────────────────────────┬──────────────────────────┤
│  Folders      │  Series in 2024/         │  Feb 20 · 31 photos      │
│               │  4 series · 25% reviewed │  Keep top 3 · 28 to del  │
│  📁 Photos    │  ──────────────────────  │  ┌──┐┌──┐┌──┐            │
│  ▶ 📂 2024 ●  │  ✓ Jan 5 · 47ph · burst │  │★ ││★ ││★ │            │
│    📁 Beach ↑ │  → Feb 20 · 31ph · keep3│  └──┘└──┘└──┘            │
│    📁 Party ↑ │    Mar 8 · 36ph · keep3 │  ┌──┐┌──┐┌──┐            │
│    2023 stale │    Apr 14 · 24ph · burst│  │✗ ││✗ ││✗ │            │
│    2022       │                          │  └──┘└──┘└──┘            │
│               │  ░░░░░░░░░░░░░░░░░░░░░  │  [🗑 Delete 28 photos]   │
│  ⬇ Scan all  │  25% · 1/4 reviewed     │  click thumb to preview   │
└───────────────┴──────────────────────────┴──────────────────────────┘
```

**Left panel — Folder tree (220px fixed)**
- Shows OneDrive folder hierarchy
- Clicking a folder: moves it to front of scan queue, loads its series into the middle panel
- Subfolders discovered during scan appear with "↑ next" button (promotes to high priority)
- Scan status badge on each folder
- Footer: "Scan all remaining" button, "Filter by date…" button

**Middle panel — Series list (flex, min 300px)**
- Scoped to the selected folder (or all folders if root selected)
- Progress bar: X of N series reviewed, estimated photos freed
- Each series card shows: date/time, photo count, duration, density (color bar: red=burst, orange=medium, green=low), adaptive keep tag (burst/keep 1/keep 3), reviewed state
- Clicking a series opens it in the right review panel and selects it in the list
- Reviewed series stay in the list at reduced opacity (can be re-opened)

**Right panel — Review grid (310px fixed)**
- Header: series date, photo count, keep rule ("Keep top 3 · 28 pre-selected for deletion")
- Grid: thumbnails sorted by quality score (highest first). Green border + ★ = kept; red border + dimmed = pre-selected for deletion; grey border = unscored
- Score badge on every thumbnail (number, or `…` if not yet scored)
- Clicking a thumbnail: opens full-screen preview
- Hovering a thumbnail: shows toggle checkbox overlay (keep/delete toggle without opening full-screen)
- Footer: "Delete X photos" button (X updates live); "Select all / Deselect all" links

---

## 6. Full-Screen Preview

Triggered by clicking any thumbnail in the review grid. Covers the full app viewport.

**Layout:**
- Large photo area (center, full height) with ‹ › navigation arrows
- Right sidebar (220px): quality score bars, file info (date, size, format), series strip (mini-thumbnails of all photos in series, current highlighted)
- Top bar: "Photo N of M", filename, Esc / ✕ button

**Interactions:**
- `←` / `→` arrow keys or clicking arrows: navigate to prev/next photo in series
- `Esc` or ✕: return to grid
- Clicking the photo itself: toggle keep/delete for the current photo
- Keep/Delete buttons in sidebar: same as clicking the photo, but explicit
- Changes made in full-screen are immediately reflected in the grid (badge updates)

**Quality score sidebar:**
- Overall score (0–100) with bar
- Sharpness, Exposure, Face quality — each with bar
- Face quality shown only if faces detected; otherwise "Face quality — n/a"
- Scores shown as `…` if worker hasn't processed yet

---

## 7. Adaptive Keep Logic

Implemented in `reviewManager.js`, called when a series is first opened.

**Inputs:**
- Series photo count and time span
- Calibration data for the folder (density distribution)

**Rules:**
- **Burst** (density ≥ calibrated burst threshold, typically ≥ 5 photos/min): keep 1 (highest quality score)
- **Spread** (density < burst threshold): keep top 3
- **Very sparse** (< 1 photo/min, series spans > 10 min): keep all (no pre-selection — these are probably intentionally different shots)

These are the pre-selections shown when the review panel opens. The user can override any keep/delete decision before hitting the delete button.

The keep count (1 or 3) is shown as a tag on the series card in the middle panel before the user opens it, so they know what to expect.

---

## 8. Quick/Advanced Mode

**Quick mode (default):**
- Calibration runs automatically after a folder with 50+ photos finishes scanning
- Samples timestamp gaps to derive `maxTimeGap`, `minDensity`, and burst threshold
- Results stored in `settings` as `calibration: { [folderId]: { maxTimeGap, minDensity, burstThreshold, computedAt } }`
- Series list header shows "auto-configured"
- No sliders visible in the UI

**Advanced mode:**
- Toggling the header button slides in a settings drawer from the right (overlays the review panel)
- Contains: time gap slider, min group size, min density, max time gap, worker count (1–4), date range filter, ignored periods list
- Shows a "Calibration result" card with the auto-computed values and a "Reset to recommended" link
- Advanced settings apply globally and persist across sessions
- Switching back to Quick mode does not reset advanced settings — Quick mode ignores them and uses calibration instead
- Warning shown in Quick mode if advanced settings differ from calibration: "Quick mode active — advanced settings ignored"

---

## 9. First-Run Onboarding

Shown when a user logs in for the first time (IndexedDB has zero photos).

The middle panel shows a single card:

> **Start by picking a folder to scan**
> Navigate to a folder in the left panel. Photospace will scan it and find burst series — groups of photos taken in quick succession. Then pick the best shots and delete the rest.

The folder tree is pre-expanded to the root. Clicking any folder dismisses the card and starts scanning immediately. No wizard, no multi-step flow.

---

## 10. Video Handling

Videos remain excluded from scanning and quality analysis (unchanged from v1). Video files are visible in the folder tree's photo count as "N photos, M videos" but are not shown in the review grid or series list. No video-specific features are added in this release.

---

## 11. What Is Not in This Release

- Text search (by filename, location, metadata)
- GPS/location-based grouping
- Export selected photos to a new OneDrive folder
- Undo / trash for deletions (still permanent via Graph API)
- Mobile-optimized touch UI
- Face recognition / face-based grouping
- Progress sync across devices (backup/sync removed with CLIP)
