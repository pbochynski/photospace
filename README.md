# Photospace

A privacy-first PWA for culling OneDrive photo libraries. Browse your OneDrive folders, scan them to index photos, and review burst series to keep the best shots and delete the rest. Everything runs in your browser — no photos are sent to any third-party server.

## What it does

1. **Browse** your OneDrive folder tree
2. **Scan** a folder (or recursively with subfolders) to index its photos via the Microsoft Graph API
3. **Detect series** — groups of photos taken in quick succession, identified by time density
4. **Review** each series: the app pre-selects which photos to keep (best by quality) and which to delete; you can override per photo
5. **Delete** the unwanted photos from OneDrive directly

## Setup

### 1. Azure App Registration

Create a Microsoft Azure App Registration with:
- Platform: **Single-page application (SPA)**
- Redirect URIs: `http://localhost:5173` (dev) and `https://photospace.app` (prod)
- API permissions: `Files.ReadWrite.All`, `User.Read`

### 2. Environment

Create `.env.local` in the project root:

```
VITE_AZURE_CLIENT_ID="YOUR_AZURE_APP_CLIENT_ID_HERE"
```

### 3. Install and run

```bash
npm install
npm run dev      # http://localhost:5173
```

### Build for production

```bash
npm run build    # outputs to dist/
npm run preview  # preview the production build
```

## Architecture

See [architecture.md](architecture.md) for a detailed description of how folder scanning, series detection, image caching, and the review flow work internally.

## Browser requirements

- Chrome 88+, Firefox 78+, Safari 14+, Edge 88+
- IndexedDB and Service Workers required
