# Timeline View Design

## Overview

Add a full-width timeline view as an alternative to the folder view. Photos are displayed chronologically, grouped first by calendar day, then by series within each day — matching the OneDrive Photos gallery style. The view handles 50–100k scanned photos via month-chunk virtual scrolling: only the current and adjacent months are rendered in the DOM at any time.

## Goals

- Browse all scanned photos chronologically, independent of folder structure
- Navigate directly to any year/month via a scrubber
- Smooth scroll across day/month boundaries within the loaded chunk
- Series tiles open the existing review grid (keep/delete). Single-photo tiles open fullscreen with keep/delete options — same behaviour as the folder view
- Bookmarkable URL: `#/time/2026-09`

## Non-Goals

- Scanning photos from the timeline view (scanning stays folder-driven)
- Infinite scroll across the entire library in one DOM (too expensive at 100k photos)
- Showing photos not yet scanned into IndexedDB

---

## Architecture

### Month-index

A lightweight index `{ "2026-09": 412, "2026-08": 307, … }` mapping `"YYYY-MM"` keys to photo counts. Stored in IndexedDB under the `settings` key `"monthIndex"`. Updated by `ScanEngine` after each folder scan (incremental upsert — it reads existing counts and adds the delta for the scanned folder). Used to:

1. Build the scrubber without loading photo data
2. Pre-calculate approximate scroll heights for months not yet rendered (estimated row height × estimated rows)
3. Jump directly to a month

### Virtual scroll strategy

The timeline viewport holds three rendered "chunks":
- **prev month** (rendered but scrolled above viewport, detached when user scrolls far enough)
- **current month** (visible)
- **next month** (pre-rendered below)

When the user scrolls past the bottom of the current month, current becomes prev, next becomes current, a new next is loaded. Spacer `<div>`s with explicit heights stand in for unrendered months so the scroll position and scrubber remain accurate.

Each month chunk is a single DOM node (`<div data-month="2026-09">`) appended/removed from the scroll container. A sentinel `IntersectionObserver` on the last item of each chunk triggers the next load.

### Within a month: day groups with series

For each loaded month:
1. Load all photos via `db.getPhotosByMonth(year, month)` — uses `IDBKeyRange.bound` on `by_timestamp`
2. Sort by `photo_taken_ts` ascending
3. Run `findPhotoSeries` with the user's current series settings (same logic as folder view)
4. Group by calendar day (local timezone)
5. Within each day, interleave series tiles and standalone photo tiles (same `_buildTimeline` logic already in `PhotoGridPanel`)

### Sticky day/month header

Each day group has a `position: sticky; top: 0` header showing `"Sep 27"`. The month label (`"September 2026"`) is also sticky at a higher `top` value so it stays visible as you scroll through days within the month.

### Right-side scrubber

A fixed right-edge element listing years and months derived from the `monthIndex`. Clicking a year/month calls `navigate(buildTimeRoute(year, month))` and scrolls the corresponding month chunk into view (loading it if not rendered).

---

## New / Modified Files

| File | Change |
|------|--------|
| `src/lib/db.js` | Add `getPhotosByMonth(year, month)` and `updateMonthIndex(photos)` |
| `src/lib/scanEngine.js` | Call `db.updateMonthIndex(newPhotos)` after each folder scan |
| `src/lib/router.js` | Add `buildTimeRoute(year, month)` export |
| `src/lib/timelinePanel.js` | New class `TimelinePanel` — full virtual-scroll timeline |
| `src/main.js` | Add view-toggle buttons; wire `TimelinePanel`; handle `#/time` route in `onAuthenticated` and `popstate` |
| `src/index.html` | Add view-toggle buttons and `#panel-timeline` element |
| `src/style.css` | `app-columns--timeline` layout modifier; timeline-specific styles |

---

## Data Flow

1. **Boot**: `db.getSetting('monthIndex')` → scrubber renders immediately (no photo load)
2. **Enter timeline**: `db.getPhotosByMonth(year, month)` → `findPhotoSeries` → render day groups
3. **Scroll**: IntersectionObserver → load adjacent month → prepend/append chunk → remove far chunk
4. **Scrubber click**: `navigate(buildTimeRoute(y, m))` → `popstate` → scroll month into view
5. **Series click**: `onSeriesClick(series, folderId)` → existing `handleSeriesClick` → review grid opens
6. **Single photo click**: `onPhotoClick(photo, null)` → existing `handlePhotoClick` → fullscreen opens
7. **Scan completes**: `scanEngine` emits `folder_status` scanned → `db.updateMonthIndex(photos)` → scrubber re-renders

---

## `db.getPhotosByMonth(year, month)`

```js
// ISO string range: "2026-09-01T00:00:00.000Z" to "2026-09-30T23:59:59.999Z"
// Works because ISO date strings sort lexicographically
const lower = `${year}-${String(month).padStart(2,'0')}-01T00:00:00.000Z`;
const upper = `${year}-${String(month).padStart(2,'0')}-31T23:59:59.999Z`;
IDBKeyRange.bound(lower, upper)
```

**Caveat**: `photo_taken_ts` from Graph API is an ISO string (e.g. `"2026-09-27T14:32:10Z"`). String comparison is lexicographically correct for ISO 8601 dates with a fixed timezone offset. Photos with a `null` or missing `photo_taken_ts` are excluded from the timeline.

---

## `db.updateMonthIndex(photos)`

Called with the array of photos just written for a folder. Reads `monthIndex` from settings, increments counts by `YYYY-MM` key, writes back. Idempotent concern: since scans can re-scan the same folder, the engine passes the **delta** (only newly added photos, not all photos). For simplicity in v1, `updateMonthIndex` rebuilds the full index from scratch using `db.getPhotoCount()` grouped by month — this is a one-time scan of all IDB records, acceptable because it runs in the background after a scan completes (not on the hot path).

---

## URL Routes

- `#/time/2026-09` — timeline view, September 2026 visible at top
- `buildTimeRoute(year, month)` returns `#/time/${year}-${String(month).padStart(2,'0')}`
- `parseRoute` already handles `#/time/:year-:month` → `{ type: 'time', year, month }`

---

## Layout

```
app-columns (normal):           app-columns--timeline:
┌──────────┬───────────┐        ┌──────────────────────────────┬──────┐
│  folders │  series   │        │  timeline (full width)       │scrub │
│  (220px) │  (flex 1) │   →    │                              │ber   │
└──────────┴───────────┘        └──────────────────────────────┴──────┘
```

CSS: `.app-columns--timeline .panel--folders`, `.app-columns--timeline .panel--series` → `display: none`. `.panel--timeline` → `flex: 1; display: flex`.

The scrubber is positioned `position: fixed; right: 0` inside the timeline panel, not a separate layout column.

---

## View Toggle

Two new buttons in the header: **Folders** and **Timeline** (replacing or alongside the existing Quick/Advanced toggle — the Advanced toggle moves into the folders-visible state only).

- Pressing **Timeline** → `navigate(buildTimeRoute(currentYear, currentMonth))` where current = today if no prior timeline route
- Pressing **Folders** → `navigate(buildFolderRoute(lastFolderId))` or `#/` if no prior folder

State tracked in `appState.viewMode: 'folder' | 'timeline'`.

---

## Series in Timeline

`findPhotoSeries` is called per month with the same settings as the folder view. Since series are time-density based (not folder-based), a series that spans midnight would be split across two day groups — acceptable for v1 (rare in practice; burst shoots don't span midnight).

The `folderId` passed to `onSeriesClick` is the series' `photos[0].folder_id` — the folder the first photo belongs to. This is what `reviewManager` uses for per-folder calibration.

---

## Constraints

- `photo_taken_ts` must be an ISO 8601 string with `Z` suffix for range queries to work correctly. Photos stored with local-time strings (no `Z`) may appear in wrong months — accepted limitation; Graph API returns UTC strings.
- Timeline shows both `item_type: 'photo'` and `item_type: 'video'`. Video tiles display a play-icon overlay (▶) on the thumbnail so they are visually distinguishable from photos. Videos are included in day groups and series detection (series are time-density based, not type-based).
- Month index rebuild (on each scan) is O(n) over all IDB records — acceptable for 100k photos (~200ms); can be optimised to incremental later.
