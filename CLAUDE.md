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
```

### Optional Node.js embedding server (in server/)

```bash
cd server && npm install
npm start        # production
npm run dev      # with --watch reload
```

## Environment Setup

Create `.env.local` in the project root before running:

```
VITE_AZURE_CLIENT_ID="YOUR_AZURE_APP_CLIENT_ID_HERE"
```

The Azure App Registration must have a SPA redirect URI pointing to `http://localhost:5173` (dev) and `https://photospace.app` (prod).

## Architecture

**Photospace** is a privacy-first, browser-only PWA that analyzes OneDrive photo libraries using on-device AI. No photos are ever sent to a third-party server.

### Tech stack

- **Frontend**: Vanilla JS ES modules, Vite build
- **Auth**: MSAL.js v3 (OAuth2 against Microsoft `common` tenant)
- **Storage**: IndexedDB (`PhotoSpaceDB` v5) — two object stores: `photos` (keyed on `file_id`) and `settings`
- **AI**: CLIP ViT-Base-Patch16 via `@xenova/transformers` (ONNX), runs inside Web Workers; face detection via `@vladmandic/human`
- **Service Worker** (`src/sw.js`): intercepts `/api/image/` and `/api/thumb/` URLs to transparently proxy and cache authenticated Microsoft Graph thumbnail/image requests

### Source layout

| Path | Purpose |
|------|---------|
| `src/main.js` | App entry point; orchestrates all modules, owns all DOM refs and `appState` |
| `src/worker.js` | Web Worker for quality scoring (sharpness, exposure, face detection via `@vladmandic/human`) |
| `src/lib/auth.js` | MSAL configuration and token helpers |
| `src/lib/graph.js` | Microsoft Graph API calls (drive, folders, photos, upload sessions) |
| `src/lib/db.js` | `PhotoDB` class wrapping IndexedDB; upsert-safe photo writes |
| `src/lib/analysis.js` | `findSimilarGroups`, `findPhotoSeries`, `pickBestPhotoByQuality` |
| `src/lib/calibration.js` | Per-folder calibration data (similarity thresholds); updated after scans, read by series/review panels |
| `src/lib/scanQueue.js` | `ScanQueue` class — IndexedDB-backed priority queue of pending folder scans; survives page reload |
| `src/lib/scanEngine.js` | `ScanEngine` class — dequeues and executes folder scans; supports recursive subfolder scanning; emits `folder_status`, `folder_scan_complete`, `folder_scan_error` events |
| `src/lib/qualityProcessor.js` | `QualityProcessor` class — pools `worker.js` Web Workers for quality scoring; emits `quality_done` events |
| `src/lib/folderPanel.js` | `FolderPanel` class — left-panel folder tree, lazy subfolder expansion, scan status badges, right-click context menu ("Scan folder" / "Scan with subfolders") |
| `src/lib/seriesPanel.js` | `SeriesPanel` class — middle panel listing photo series for the selected folder |
| `src/lib/reviewGrid.js` | `ReviewGrid` class — right-panel photo grid with fullscreen preview and keep/delete actions |
| `src/lib/reviewManager.js` | Series review state persistence; keep/delete per-photo decisions, series classification |
| `src/lib/settingsDrawer.js` | `SettingsDrawer` class — advanced settings panel (similarity thresholds, date filters, ignored periods) |
| `src/lib/settingsManager.js` | Read/write all user settings from IndexedDB |
| `src/lib/photoDeleteManager.js` | Delete photos via Graph API with confirmation |
| `src/lib/urlStateManager.js` | Encode/decode folder path and date filters in the URL |
| `src/lib/uiUtils.js` | Status bar, date-filter UI, collapsible panels |
| `src/lib/debugConsole.js` | Mobile-friendly debug overlay (worker console forwarding) |
| `server/` | Optional Node.js Express server that mirrors the worker's quality-scoring logic for server-side processing |

### Key data flows

1. **Auth → Graph → IndexedDB**: `auth.js` gets an MSAL token → `graph.js` fetches folder children → `db.js` upserts photo records (preserving existing quality scores).
2. **Scan pipeline**: `ScanEngine` dequeues folders from `ScanQueue`, calls `fetchPhotosFromSingleFolder` (Graph API), runs `calibrateFolder`, and saves `folderMeta` (lastScannedAt, photoCount) to IndexedDB. If the queue entry has `recursive: true`, discovered subfolders are automatically enqueued via `getFolderChildren`.
3. **Quality pipeline**: `QualityProcessor` pools `worker.js` workers, processes unscored photos from IndexedDB (sharpness, exposure, face detection), and writes scores back. Emits `quality_done` when the queue drains.
4. **Analysis**: `seriesPanel.js` calls `analysis.js` for time-based or similarity grouping entirely in-memory; `reviewGrid.js` uses `reviewManager.js` to persist keep/delete decisions per photo.
5. **Image display**: The Service Worker intercepts `/api/image/<fileId>` and `/api/thumb/<fileId>` URLs, attaches the current auth token, fetches from Graph, and caches in the Cache API.

### Vite config notes

- `root` is `src/` (index.html lives there)
- `publicDir` is `../public`
- `envDir` is `..` (reads `.env.local` from project root)
- A custom plugin copies `src/sw.js` to `dist/sw.js` verbatim (bypassing Vite bundling so the SW scope is correct)
- Workers use `format: 'es'`
