# Photospace — Architecture

Photospace is a browser-only PWA that helps users cull their OneDrive photo libraries. All processing runs on the client — no photos or data are sent to a server beyond Microsoft Graph API calls made directly from the browser.

---

## High-level overview

```
Browser tab
├── main.js              — app entry point, owns appState + DOM wiring
├── Service Worker       — auth-transparent image cache proxy
└── IndexedDB            — persistent store (photos + settings)

UI panels (all instantiated after login)
├── FolderPanel          — left: OneDrive folder tree
├── PhotoGridPanel       — middle: series timeline for selected folder
└── ReviewGrid           — right: photo-by-photo keep/delete decisions
```

The app has two modes toggled by header buttons:
- **Quick** — standard three-panel view
- **Advanced** — opens `SettingsDrawer` where thresholds and ignored periods can be tuned per-folder

---

## Boot sequence

`main.js → boot()`

1. Register Service Worker at `/sw.js`
2. `db.init()` — open IndexedDB `PhotoSpaceDB` (version 7), run migrations
3. `msalInstance.initialize()` + handle redirect response (OAuth redirect flow)
4. Try `getAuthToken()` silently — if successful, send token to Service Worker and call `onAuthenticated()`; otherwise show login screen

`onAuthenticated()`:
1. Instantiate all three UI panels
2. Wire `scanEngine` events → `folderPanel.setFolderStatus()`
3. `folderPanel.loadRoot()` — fetch top-level OneDrive folders
4. `scanEngine.start()` — resume any scan queue that survived a page reload

---

## Authentication

**File:** `src/lib/auth.js`

Uses MSAL.js v3 (`@azure/msal-browser`) against the Microsoft `common` tenant (any Microsoft/work account). Auth state is kept in `sessionStorage`.

Scopes requested: `User.Read`, `Files.ReadWrite.All`

`getAuthToken()` tries `acquireTokenSilent` first; falls back to a popup on failure. The token is sent to the Service Worker via `postMessage({ type: 'SET_TOKEN', token })` before any image display that requires auth. The Service Worker holds the token in an in-memory `Map` keyed as `'current'`.

---

## IndexedDB schema

**File:** `src/lib/db.js` — `PhotoDB` class, database name `PhotoSpaceDB` version 7

### Object store: `photos`

Key path: `file_id` (OneDrive item ID)

Indexes:
- `by_timestamp` → `photo_taken_ts`
- `by_folder_id` → `folder_id`
- `by_scan_id` → `scan_id`
- `by_item_type` → `item_type`

Photo record shape:
```js
{
  file_id,        // OneDrive item ID (primary key)
  name,           // filename
  size,           // bytes
  path,           // OneDrive path string
  folder_id,      // parent folder ID
  last_modified,  // ISO string from Graph
  photo_taken_ts, // ms timestamp (photo EXIF takenDateTime, or createdDateTime)
  thumbnail_url,  // null — images fetched via service worker
  scan_id,        // UUID assigned per folder scan run
  item_type,      // 'photo' | 'video'
  quality_score,  // 0–100, may be absent
  sharpness,      // 0–100, may be absent
  exposure,       // 0–100, may be absent
  face,           // { detected, score }, may be absent

  // video-only fields:
  video_duration_ms, video_codec, video_bitrate, video_width, video_height
}
```

**Upsert strategy:** `addOrUpdatePhotos` fetches the existing record first. If found, only `scan_id` is updated (quality scores and other enriched fields are preserved). If not found, the new record is inserted. This ensures re-scanning a folder never wipes quality data.

**Stale record pruning:** After each folder scan, `deleteStalePhotosInFolder(folderId, scanId)` removes any record for that folder whose `scan_id` does not match the just-completed scan — i.e. photos that have been deleted from OneDrive since the last scan.

### Object store: `settings`

Key path: `key`. A generic key-value store used by all modules.

Notable keys:

| Key | Type | Purpose |
|-----|------|---------|
| `scanQueue` | array | Persisted scan queue (survives page reload) |
| `folderMeta` | object | `{ [folderId]: { lastScannedAt, photoCount } }` |
| `calibration` | object | `{ [folderId]: { maxTimeGap, minDensity, burstThreshold, computedAt } }` |
| `reviewedSeries` | object | `{ [folderId_startMs]: { keptIds, deletedIds, timestamp } }` |
| `ignoredPeriods` | array | Time ranges excluded from series detection |
| `seriesMinGroupSize` | number | Min photos for a series (default 2) |
| `seriesMinDensity` | number | Min photos/min (default 1) |
| `seriesMaxTimeGap` | number | Max gap in minutes (default 5) |

---

## Folder scanning

### Scan queue — `src/lib/scanQueue.js`

`ScanQueue` is an in-memory array that is persisted to IndexedDB `settings['scanQueue']` after every mutation. This means a pending queue survives page reloads — `scanEngine.start()` resumes it on boot.

Queue entry shape: `{ folderId, folderPath, driveId, priority, recursive }`

Priority rules:
- **high** priority entries are inserted before the first `normal` entry (FIFO within the same priority)
- If a `high`-priority entry for an already-queued folder arrives, the existing entry is removed and replaced at the head of the normal-priority section
- Duplicate `normal` entries for the same folder are silently dropped

### Scan engine — `src/lib/scanEngine.js`

`ScanEngine extends EventTarget`. A singleton `scanEngine` is shared across the app.

`start()` runs a sequential `while` loop that:

1. Dequeues the next entry
2. Emits `folder_status: 'scanning'`
3. Generates a fresh `crypto.randomUUID()` as `scanId` for this run
4. Calls `fetchPhotosFromSingleFolder(scanId, folderId)` (Graph API, paginated)
5. Calls `db.deleteStalePhotosInFolder(folderId, scanId)` to prune removed photos
6. Calls `calibrateFolder(folderId)` if the folder has ≥50 photos
7. Saves `folderMeta[folderId] = { lastScannedAt, photoCount }` to settings
8. Emits `folder_status: 'scanned'` and `folder_scan_complete`
9. If `entry.recursive`, fetches subfolder children via `getFolderChildren` and enqueues each with `priority: 'normal', recursive: true`

On error: emits `folder_status: 'error'` and `folder_scan_error`, then continues to the next entry.

`main.js` listens to `folder_status`:
- Updates the folder tree badge via `folderPanel.setFolderStatus()`
- If the completed folder is currently selected, refreshes `photoGridPanel.loadFolder()`

### Graph API calls — `src/lib/graph.js`

`fetchPhotosFromSingleFolder(scanId, folderId)` paginates through `/me/drive/items/{folderId}/children`, following `@odata.nextLink` until exhausted. Items with a `photo` facet become `item_type: 'photo'`; items with a `video` facet become `item_type: 'video'`; folders and other items are skipped. Each page is written to IndexedDB immediately via `db.addOrUpdatePhotos()`.

`fetchWithAutoRefresh` handles token expiry (401/403 → force-refresh token and retry) and rate-limiting (429 → respect `Retry-After` header).

---

## Series detection

**File:** `src/lib/analysis.js` — `findPhotoSeries(photos, options)`

Series are detected purely by time proximity — no visual similarity is used. The algorithm:

1. **Filter** photos to those with valid `photo_taken_ts`. Normalise string timestamps to numeric milliseconds.
2. **Sort** by `photo_taken_ts` ascending.
3. **Filter out** any photos whose timestamp falls within a user-defined ignored period.
4. **Group into candidate series** using a sliding-window scan: a photo joins the current series if the gap to the previous photo is ≤ `maxTimeGap` minutes (default 5). When a gap exceeds the threshold, the current series ends and a new one begins.
5. **Filter candidates** by:
   - `photoCount >= minGroupSize` (default 2)
   - `density >= minDensity` photos/min (default 1). If all photos share the same timestamp, density is treated as infinite (count = density).
6. **Attach metadata** to each surviving series: `startTime`, `endTime`, `timeSpanMs`, `timeSpanMinutes`, `density`, `avgTimeBetweenPhotos`.
7. **Sort** by the selected method: `series-size` (default), `density`, `date-desc`, `date-asc`.

Parameters come from user settings (`getSeriesSettings()`) and can be tuned via the Advanced panel. Calibrated per-folder values can also override the defaults (see Calibration below).

---

## Calibration

**File:** `src/lib/calibration.js`

`calibrateFolder(folderId)` is called automatically after every successful folder scan of ≥50 photos. It computes per-folder analysis parameters by studying the actual distribution of inter-photo time gaps:

- Computes all consecutive time gaps (in minutes) from the folder's sorted timestamps
- Derives three percentiles: p10, p50, p90
- Maps them to parameters:
  - `maxTimeGap = clamp(p90, 2, 30)` — the natural "series boundary" for this folder
  - `minDensity = 1 / max(0.1, p50)` — photos per minute at the typical shooting pace
  - `burstThreshold = 1 / max(0.01, p10)` — photos per minute that indicates burst mode
- Results are stored in `settings['calibration'][folderId]`

These calibrated values are used by `classifySeries` in `reviewManager.js` to classify each series without any manual intervention.

---

## Series classification and preselection

**File:** `src/lib/reviewManager.js`

`classifySeries(series, calibration)` classifies a series into one of three types:

| Type | Condition | Default keep strategy |
|------|-----------|----------------------|
| `sparse` | duration > 10 min AND density < 1 photo/min | Keep all |
| `burst` | density ≥ `burstThreshold` (calibrated, default 5/min) | Keep 1 best |
| `spread` | everything else | Keep 3 best |

`preselectSeries(series, folderId, calibration)` is called when a series is opened for the first time. It:
1. Classifies the series
2. Sorts photos by `quality_score` descending
3. Returns `{ keptIds, deletedIds, classification }` — `keptIds` contains the top N by quality, the rest go into `deletedIds`

The preselection is immediately persisted to `settings['reviewedSeries']` so that returning to a series shows the same state. Users can toggle individual photos and override the preselection.

---

## Review panel

**File:** `src/lib/reviewGrid.js` — `ReviewGrid` class

`loadSeries(series, folderId)`:
1. Sorts series photos by `quality_score` descending
2. Loads persisted state from `settings['reviewedSeries']`; if none exists, runs `preselectSeries` and saves the result
3. Renders the photo grid with kept/deleted visual state

User interactions:
- Click photo thumbnail → open fullscreen viewer (uses `/api/image/{fileId}` via Service Worker)
- Click toggle button / right-click → `togglePhotoKeep()` — moves the photo between kept/deleted and persists the new state
- "Delete N photos" button → iterates `deletedIds`, calls `deletePhotoFromOneDrive()` for each, removes successfully deleted photos from the series in memory and from `reviewedSeries` in IndexedDB

Fullscreen viewer:
- Shows full-resolution image via `/api/image/{fileId}`
- Sidebar displays quality score bars (overall, sharpness, exposure, face score if detected)
- Keyboard: `←`/`→` navigate photos, `Escape` closes

---

## Image caching — Service Worker

**File:** `src/sw.js` — cache name `photospace-images-v1`

The Service Worker intercepts two URL patterns:

### `/api/thumb/{fileId}`
Proxies to `GET /me/drive/items/{fileId}/thumbnails/0/large/content`. Cache-first: if the response is already in the Cache API, it is served immediately without any network request.

### `/api/image/{fileId}`
Proxies to `GET /me/drive/items/{fileId}/content`. Also cache-first, with HEIC/HEIF handling:

1. If `Content-Type` is `application/octet-stream` (or explicitly `image/heic`/`image/heif`), Microsoft is serving a format the browser cannot display
2. Falls back to the Graph thumbnail endpoint `thumbnails/0/c1920x1920/content` — this triggers server-side HEIC→JPEG conversion by Microsoft
3. If that also fails, retries with the smaller `large` thumbnail
4. The converted JPEG is cached, not the original HEIC blob

**Token management:** The main thread calls `postMessage({ type: 'SET_TOKEN', token })` whenever it acquires or refreshes an MSAL token. The Service Worker stores it in an in-memory `Map`. The token is never persisted to disk.

**Cache headers:** Cached responses are served with `Cache-Control: public, max-age=86400` (24 hours).

---

## UI panels

### FolderPanel — `src/lib/folderPanel.js`

Renders the left-panel folder tree. Folders are loaded lazily — clicking a folder that has children fetches them on demand. Each folder shows a status badge reflecting the last known `folder_status` event from `ScanEngine`. Right-click context menu offers "Scan folder" (enqueues with `priority: high`) and "Scan with subfolders" (enqueues with `recursive: true`).

### PhotoGridPanel — `src/lib/photoGridPanel.js`

Renders the middle panel for the currently selected folder. `loadFolder()`:
1. Reads all photos for the folder from IndexedDB
2. Runs `findPhotoSeries()` with current settings
3. Builds a **timeline**: photos are sorted by timestamp; series are represented as a single block at their chronological position; non-series photos are grouped into standalone strips between the series blocks
4. Each series block shows date, classification tag (burst/spread/sparse), photo count, a strip of up to 12 thumbnails with kept/deleted overlays, and an "open in review" button
5. Header shows total photo count, series count, and percentage of series reviewed

### ReviewGrid — `src/lib/reviewGrid.js`

See "Review panel" section above.

### SettingsDrawer — `src/lib/settingsDrawer.js`

Slide-in drawer opened by the Advanced mode button. Reads and writes settings via `settingsManager.js`. Shows per-folder calibration values and allows overriding global thresholds and managing ignored time periods.

---

## Data flow summary

```
User clicks folder
  → FolderPanel.onFolderClick
  → scanEngine.enqueueFolder(priority: 'high')
  → photoGridPanel.loadFolder (immediate, from existing IndexedDB data)

ScanEngine loop (runs until queue empty)
  → fetchPhotosFromSingleFolder → db.addOrUpdatePhotos (per page)
  → db.deleteStalePhotosInFolder
  → calibrateFolder
  → emits folder_status: 'scanned'
    → main.js refreshes photoGridPanel.loadFolder

photoGridPanel.loadFolder
  → db.getPhotosByFolderId
  → getCalibration, getSeriesSettings
  → findPhotoSeries (in-memory, synchronous)
  → renders timeline

User clicks series
  → reviewGrid.loadSeries
  → loadSeriesState or preselectSeries
  → renders grid with /api/thumb/{fileId} URLs

User clicks thumbnail
  → Service Worker intercepts /api/thumb/{fileId}
  → cache hit → serve from Cache API
  → cache miss → fetch Graph thumbnails/0/large/content → cache → return

User opens fullscreen
  → /api/image/{fileId}
  → Service Worker: cache hit or fetch /content (with HEIC fallback) → cache

User clicks Delete
  → deletePhotoFromOneDrive → Graph DELETE /me/drive/items/{fileId}
  → db.deletePhotos([fileId])
  → reviewedSeries updated in IndexedDB
```
