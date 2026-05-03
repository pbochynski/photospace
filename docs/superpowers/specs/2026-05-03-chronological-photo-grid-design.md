# Chronological Photo Grid — Middle Panel Redesign

**Date:** 2026-05-03  
**Status:** Approved

## Overview

Replace the current series-card list in the middle panel with a chronological photo grid. All photos in the selected folder are shown as thumbnails, sorted by time. Burst series are visually grouped into blocks with a colored left border. Standalone photos (not part of any series) appear inline between series blocks.

## Current Behavior

`SeriesPanel` loads photos for a folder, runs `findPhotoSeries`, and renders one text card per series (date, photo count, classification tag, density bar). No thumbnails are visible in the middle panel — the user must click a series to see its photos in the right review panel.

## New Behavior

A new `PhotoGridPanel` class replaces `SeriesPanel` in the middle panel. It renders:

1. **Series blocks**: Each series from `findPhotoSeries` is a bordered block containing:
   - A clickable header row: date/time, classification tag (burst/keep-3/sparse), photo count, "▶ open in review →" affordance
   - A thumbnail grid showing up to 12 photos (overflow beyond 12 shown as "+N" chip that opens the series in the review panel)
   - Colored left border: red for burst, lime-green for keep-3, gray for sparse
2. **Standalone photos**: Photos not belonging to any series are rendered as bare thumbnails inline between series blocks, sorted chronologically.

The blocks and standalone photos are interleaved in chronological order by their first timestamp.

## Interactions

| Target | Action |
|--------|--------|
| Series header row | Load series into right review panel (same `onSeriesClick` callback) |
| Any photo thumbnail | Open fullscreen preview overlay (existing overlay) |
| "+N" overflow chip | Load series into right review panel |

Keep/delete status from `reviewManager` is reflected on thumbnails: green border = keep, red border = delete, no border = undecided.

## Architecture

### New file: `src/lib/photoGridPanel.js`

```
PhotoGridPanel
  constructor({ headerEl, listEl, progressBarEl, progressLabelEl, onSeriesClick, onPhotoClick })
  loadFolder(folderId, folderName)   — async, replaces panel content
  showOnboarding()                   — same onboarding card as SeriesPanel
  _render()                          — builds timeline of series blocks + standalone photos
  _buildTimeline(photos, series)     — returns sorted array of { type:'series'|'photo', ... }
  _renderSeriesBlock(series, calibration) — returns DOM element
  _renderPhotoThumb(photo)           — returns DOM element
```

`onPhotoClick(photo)` is a new callback wired from `main.js` to open the fullscreen preview.

### Changes to `main.js`

- Replace `SeriesPanel` instantiation with `PhotoGridPanel`
- Add `onPhotoClick` callback that opens the existing fullscreen preview; extract the fullscreen-open logic from `reviewGrid.js` into a shared helper in `main.js` so both `reviewGrid` and `PhotoGridPanel` can call it
- Remove the `seriesPanel` variable; all existing `seriesPanel.loadFolder()` callsites become `photoGridPanel.loadFolder()`

### `SeriesPanel` (`src/lib/seriesPanel.js`)

Deleted — fully replaced by `PhotoGridPanel`.

### CSS additions (`src/style.css`)

New rules for:
- `.photo-grid-timeline` — container for the interleaved timeline
- `.series-block` — bordered series container
- `.series-block--burst` / `--keep3` / `--sparse` — left-border color variants
- `.series-block__header` — clickable header row
- `.series-block__thumbs` — thumbnail grid inside a block
- `.photo-thumb` — individual thumbnail (used both in series blocks and for standalone photos)
- `.photo-thumb--keep` / `.photo-thumb--delete` — border color overlays

## Data Flow

1. `PhotoGridPanel.loadFolder(folderId)` calls `db.getPhotosByFolderId(folderId)`
2. Runs `findPhotoSeries(photos, { minGroupSize, minDensity, maxTimeGap })` (same calibration logic as today)
3. Builds a Set of all photo `file_id`s that belong to any series
4. `_buildTimeline`: iterates all photos sorted by `photo_taken_ts`; emits `{ type: 'series', series }` when hitting the first photo of a series, skips subsequent photos of that series, emits `{ type: 'photo', photo }` for standalone photos
5. Render loop: for each timeline item, append either a `_renderSeriesBlock` or `_renderPhotoThumb` element
6. For each series block, fetch review status from `reviewManager.isSeriesReviewed` and keep/delete decisions from `reviewManager` for thumb border colors

## Thumbnail Rendering

Thumbnails are rendered as `<img src="/api/thumb/${photo.file_id}">`. The Service Worker intercepts these URLs, attaches the current auth token, and fetches from the Microsoft Graph thumbnail endpoint, caching the result. No special handling is needed in `PhotoGridPanel` — the same pattern used in `reviewGrid.js`.

## Progress Bar

Header and progress bar update identically to today: `N series · X% reviewed`.

## Out of Scope

- Collapsing/expanding series blocks (all thumbnails always visible with overflow cap)
- Virtualized scrolling (folders are expected to have hundreds, not tens of thousands of photos)
- Changing the right review panel behavior
