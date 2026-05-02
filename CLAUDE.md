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
| `src/worker.js` | Web Worker for CLIP embedding + quality scoring (sharpness, exposure, faces) |
| `src/lib/auth.js` | MSAL configuration and token helpers |
| `src/lib/graph.js` | Microsoft Graph API calls (drive, folders, photos, upload sessions) |
| `src/lib/db.js` | `PhotoDB` class wrapping IndexedDB; upsert-safe photo writes |
| `src/lib/embedding-processor.js` | `EmbeddingProcessor` class — manages worker pool, queue, pause/resume |
| `src/lib/analysis.js` | `findSimilarGroups`, `findPhotoSeries`, `pickBestPhotoByQuality` |
| `src/lib/settingsManager.js` | Read/write all user settings from IndexedDB |
| `src/lib/urlStateManager.js` | Encode/decode folder path and date filters in the URL |
| `src/lib/backupManager.js` | Export/import embeddings to/from OneDrive |
| `src/lib/photoDeleteManager.js` | Delete photos via Graph API with confirmation |
| `src/lib/similarPhotosManager.js` | "Find similar" cosine-similarity search |
| `src/lib/modalManager.js` | Full-screen photo modal with keyboard navigation |
| `src/lib/uiUtils.js` | Status bar, date-filter UI, collapsible panels |
| `src/lib/debugConsole.js` | Mobile-friendly debug overlay (worker console forwarding) |
| `server/` | Optional Node.js Express server that mirrors the worker's CLIP+Human logic for server-side embedding generation |

### Key data flows

1. **Auth → Graph → IndexedDB**: `auth.js` gets an MSAL token → `graph.js` fetches folder children → `db.js` upserts photo records (preserving existing embeddings).
2. **Embedding pipeline**: `EmbeddingProcessor` pulls unembedded photos from IndexedDB, dispatches them to `worker.js` Web Workers, and writes results back via `db.getSetting`/`db.put`.
3. **Analysis**: `analysis.js` reads all embeddings from IndexedDB and runs cosine similarity or time-based grouping entirely in-memory.
4. **Image display**: The Service Worker intercepts `/api/image/<fileId>` URLs, attaches the current auth token from `authTokens`, fetches from Graph, and caches in `Cache API`.

### Vite config notes

- `root` is `src/` (index.html lives there)
- `publicDir` is `../public`
- `envDir` is `..` (reads `.env.local` from project root)
- A custom plugin copies `src/sw.js` to `dist/sw.js` verbatim (bypassing Vite bundling so the SW scope is correct)
- Workers use `format: 'es'`
