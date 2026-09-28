# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Start development server (http://localhost:5173)
npm run dev

# Build for production (outputs to dist/)
npm run build

# Preview production build
npm run preview

# Run tests (watch mode)
npm test

# Run tests once (CI / before committing)
npm run test:run
```

## Environment Setup

Create `.env.local` in the project root before running:

```
VITE_AZURE_CLIENT_ID="YOUR_AZURE_APP_CLIENT_ID_HERE"
```

The Azure App Registration must have a SPA redirect URI pointing to `http://localhost:5173` (dev) and `https://photospace.app` (prod).

## Architecture

**Photospace** is a privacy-first, browser-only PWA for culling OneDrive photo libraries. No photos are sent to any third-party server — all processing runs in the browser against the Microsoft Graph API.

### Tech stack

- **Frontend**: Vanilla JS ES modules, Vite build
- **Auth**: MSAL.js v3 (OAuth2 against Microsoft `common` tenant)
- **Storage**: IndexedDB (`PhotoSpaceDB` v7) — two object stores: `photos` (keyed on `file_id`) and `settings`
- **Service Worker** (`src/sw.js`): intercepts `/api/image/` and `/api/thumb/` URLs to transparently proxy, convert (HEIC→JPEG), and cache authenticated Microsoft Graph requests

### Source layout

| Path | Purpose |
|------|---------|
| `src/main.js` | App entry point; orchestrates all modules, owns all DOM refs and `appState` |
| `src/sw.js` | Service Worker — auth-transparent image/thumbnail cache proxy |
| `src/lib/auth.js` | MSAL configuration and token helpers |
| `src/lib/graph.js` | Microsoft Graph API calls (folder children, photos, delete) |
| `src/lib/db.js` | `PhotoDB` class wrapping IndexedDB; upsert-safe photo writes |
| `src/lib/analysis.js` | `findPhotoSeries`, `pickBestPhotoByQuality` |
| `src/lib/calibration.js` | Per-folder calibration (time-gap thresholds derived from shooting patterns) |
| `src/lib/scanQueue.js` | `ScanQueue` — IndexedDB-backed priority queue of pending folder scans; survives page reload |
| `src/lib/scanEngine.js` | `ScanEngine` — dequeues and executes folder scans; supports recursive subfolder scanning |
| `src/lib/folderPanel.js` | `FolderPanel` — left-panel folder tree, lazy expansion, scan status badges, right-click scan menu |
| `src/lib/photoGridPanel.js` | `PhotoGridPanel` — middle panel; series timeline for the selected folder |
| `src/lib/reviewGrid.js` | `ReviewGrid` — right-panel photo grid with fullscreen preview and keep/delete actions |
| `src/lib/reviewManager.js` | Series review state persistence; keep/delete decisions, series classification |
| `src/lib/settingsDrawer.js` | `SettingsDrawer` — advanced settings panel (thresholds, ignored periods) |
| `src/lib/settingsManager.js` | Read/write all user settings from IndexedDB |
| `src/lib/photoDeleteManager.js` | Delete photos via Graph API |

### Key data flows

1. **Auth → Graph → IndexedDB**: `auth.js` gets an MSAL token → `graph.js` fetches folder children → `db.js` upserts photo records.
2. **Scan pipeline**: `ScanEngine` dequeues folders from `ScanQueue`, calls `fetchPhotosFromSingleFolder` (paginated Graph API), runs `calibrateFolder`, and saves `folderMeta` to IndexedDB. Recursive scans enqueue discovered subfolders automatically.
3. **Series detection**: `PhotoGridPanel.loadFolder` reads photos from IndexedDB and runs `findPhotoSeries` entirely in-memory — pure time-based grouping, no AI.
4. **Review**: `ReviewGrid` uses `reviewManager` to preselect keep/delete per photo (by series classification), persisting decisions to IndexedDB. Deletion calls the Graph API.
5. **Image display**: The Service Worker intercepts `/api/image/<fileId>` and `/api/thumb/<fileId>` URLs, attaches the current auth token, fetches from Graph (converting HEIC→JPEG server-side if needed), and caches in the Cache API.

### Vite config notes

- `root` is `src/` (index.html lives there)
- `publicDir` is `../public`
- `envDir` is `..` (reads `.env.local` from project root)
- A custom plugin copies `src/sw.js` to `dist/sw.js` verbatim (bypassing Vite bundling so the SW scope is correct)
- Vitest `include` pattern is `tests/**/*.test.js` (relative to `root: src/`, resolves to `src/tests/`)

## Testing

**Runner:** Vitest (node environment, no browser APIs needed for unit tests)

**Test files:** `src/tests/*.test.js`

**Helpers:** `src/tests/helpers.js` — `makePhoto(id, takenAtMs, qualityScore)` and `makeSeries(photos, overrides)`

### What is tested

Only pure logic functions with no external dependencies:

| File | Functions covered |
|------|------------------|
| `src/lib/analysis.js` | `findPhotoSeries`, `pickBestPhotoByQuality` |
| `src/lib/reviewManager.js` | `classifySeries`, `preselectSeries` |

### What is NOT yet tested

- `graph.js`, `scanEngine.js` — require Graph API mocking (future: MSW)
- `db.js`, `settingsManager.js`, `calibration.js` — require IndexedDB (future: fake-indexeddb)
- UI panel classes — require DOM (future: happy-dom or Playwright)

### Development workflow

- **Write tests before implementation** (TDD) for any function in the testable layer
- **Run `npm run test:run`** before every commit touching `src/lib/analysis.js`, `src/lib/reviewManager.js`, or `src/tests/`
- Tests must pass before merging
