# Step 04: Three-Column UI Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing `src/index.html` and `src/style.css` with the new three-column layout. No logic in this step — just the HTML skeleton and CSS. Panels are empty placeholders with correct IDs.

**Architecture:** Fixed 220px left panel, flex-grow middle panel (min 300px), fixed 310px right panel. Full-height flex row. Header bar across the top.

**Tech Stack:** HTML5, CSS (no framework)

---

### Task 1: Rewrite index.html with three-column skeleton

**Files:**
- Modify: `src/index.html`

- [ ] **Step 1: Read current src/index.html**

Read `src/index.html` to understand existing head/meta tags, script imports, and auth hooks to preserve.

- [ ] **Step 2: Rewrite src/index.html**

Replace the body content entirely. Keep existing `<head>` meta tags, the Vite script tag, and the MSAL CDN script. Replace the `<body>` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Photospace</title>
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <div id="app" class="app-layout">

    <!-- Header bar -->
    <header class="app-header">
      <div class="app-header__brand">📷 Photospace</div>
      <div class="app-header__status" id="header-status"></div>
      <div class="app-header__mode-toggle">
        <button id="btn-quick" class="mode-btn mode-btn--active">Quick cleanup</button>
        <button id="btn-advanced" class="mode-btn">Advanced</button>
      </div>
    </header>

    <!-- Three-column body -->
    <div class="app-columns">

      <!-- Left: Folder tree (220px) -->
      <aside class="panel panel--folders" id="panel-folders">
        <div class="panel__body" id="folder-tree"></div>
        <div class="panel__footer">
          <button id="btn-scan-all" class="btn-text">⬇ Scan all remaining</button>
          <button id="btn-filter-date" class="btn-text">Filter by date…</button>
        </div>
      </aside>

      <!-- Middle: Series list (flex) -->
      <section class="panel panel--series" id="panel-series">
        <div class="panel__header" id="series-header"></div>
        <div class="panel__body" id="series-list"></div>
        <div class="panel__footer">
          <div class="progress-bar-wrap">
            <div class="progress-bar" id="series-progress-bar"></div>
          </div>
          <div class="progress-label" id="series-progress-label"></div>
        </div>
      </section>

      <!-- Right: Review grid (310px) -->
      <aside class="panel panel--review" id="panel-review">
        <div class="panel__header" id="review-header"></div>
        <div class="panel__body" id="review-grid"></div>
        <div class="panel__footer" id="review-footer"></div>
      </aside>

    </div>

    <!-- Advanced settings drawer (hidden by default, overlays right panel) -->
    <div class="settings-drawer" id="settings-drawer" hidden>
      <div class="settings-drawer__content" id="settings-content"></div>
    </div>

    <!-- Full-screen preview overlay (hidden by default) -->
    <div class="fullscreen-overlay" id="fullscreen-overlay" hidden>
      <div class="fullscreen-overlay__photo" id="fullscreen-photo"></div>
      <div class="fullscreen-overlay__sidebar" id="fullscreen-sidebar"></div>
    </div>

    <!-- Login screen (shown when not authenticated) -->
    <div class="login-screen" id="login-screen" hidden>
      <div class="login-card">
        <h1>Photospace</h1>
        <p>Sign in with your Microsoft account to access your OneDrive photos.</p>
        <button id="btn-login" class="btn-primary">Sign in with Microsoft</button>
      </div>
    </div>

  </div>

  <script type="module" src="./main.js"></script>
</body>
</html>
```

- [ ] **Step 3: Build to verify HTML parses**

```bash
npm run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/index.html
git commit -m "feat: new three-column HTML skeleton"
```

---

### Task 2: Write three-column CSS layout

**Files:**
- Modify: `src/style.css`

- [ ] **Step 1: Replace src/style.css with new layout styles**

Replace the entire content of `src/style.css` with:

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --color-bg: #1a1a1a;
  --color-surface: #242424;
  --color-border: #333;
  --color-text: #e0e0e0;
  --color-text-muted: #888;
  --color-accent: #4a9eff;
  --color-keep: #2d7a2d;
  --color-delete: #7a2d2d;
  --color-burst: #c0392b;
  --color-medium: #e67e22;
  --color-spread: #27ae60;
  --panel-folders-width: 220px;
  --panel-review-width: 310px;
  --header-height: 48px;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  height: 100vh;
  overflow: hidden;
}

.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

/* Header */
.app-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  height: var(--header-height);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.app-header__brand { font-weight: 600; font-size: 15px; }
.app-header__status { flex: 1; color: var(--color-text-muted); font-size: 12px; }

.mode-btn {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.mode-btn--active {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: #fff;
}

/* Three columns */
.app-columns {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.panel {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--color-border);
  overflow: hidden;
}
.panel:last-child { border-right: none; }

.panel--folders { width: var(--panel-folders-width); flex-shrink: 0; }
.panel--series  { flex: 1; min-width: 300px; }
.panel--review  { width: var(--panel-review-width); flex-shrink: 0; }

.panel__header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: 12px;
}
.panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.panel__footer {
  padding: 8px 12px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

/* Folder tree */
.folder-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  cursor: pointer;
  border-radius: 4px;
  user-select: none;
}
.folder-item:hover { background: rgba(255,255,255,0.05); }
.folder-item--selected { background: rgba(74,158,255,0.15); }
.folder-item__name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder-item__badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255,255,255,0.1);
  color: var(--color-text-muted);
}
.folder-item__badge--scanning { background: rgba(74,158,255,0.2); color: var(--color-accent); }
.folder-item__badge--stale    { background: rgba(230,126,34,0.2); color: #e67e22; }
.folder-item__promote-btn {
  font-size: 10px;
  padding: 1px 5px;
  background: rgba(74,158,255,0.15);
  border: 1px solid var(--color-accent);
  color: var(--color-accent);
  border-radius: 3px;
  cursor: pointer;
}
.folder-children { padding-left: 16px; }

/* Series list */
.series-card {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
}
.series-card:hover { background: rgba(255,255,255,0.03); }
.series-card--selected { background: rgba(74,158,255,0.1); }
.series-card--reviewed { opacity: 0.5; }
.series-card__header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.series-card__date { font-weight: 500; }
.series-card__count { color: var(--color-text-muted); font-size: 12px; }
.series-card__tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
  margin-left: auto;
}
.series-card__tag--burst  { background: rgba(192,57,43,0.3);  color: #e74c3c; }
.series-card__tag--keep1  { background: rgba(192,57,43,0.2);  color: #e74c3c; }
.series-card__tag--keep3  { background: rgba(39,174,96,0.2);  color: #2ecc71; }
.series-card__tag--sparse { background: rgba(255,255,255,0.1); color: var(--color-text-muted); }
.density-bar {
  height: 3px;
  border-radius: 2px;
  margin-top: 4px;
}
.density-bar--burst  { background: var(--color-burst); }
.density-bar--medium { background: var(--color-medium); }
.density-bar--spread { background: var(--color-spread); }

/* Review grid */
.review-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 4px;
  padding: 8px;
}
.thumb-cell {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 4px;
  border: 2px solid transparent;
  cursor: pointer;
}
.thumb-cell--keep   { border-color: var(--color-keep); }
.thumb-cell--delete { border-color: var(--color-delete); opacity: 0.6; }
.thumb-cell img { width: 100%; height: 100%; object-fit: cover; }
.thumb-cell__score {
  position: absolute;
  bottom: 2px;
  right: 4px;
  font-size: 10px;
  background: rgba(0,0,0,0.7);
  color: #fff;
  padding: 1px 3px;
  border-radius: 2px;
}
.thumb-cell__star {
  position: absolute;
  top: 2px;
  left: 3px;
  font-size: 12px;
}
.thumb-cell__overlay {
  display: none;
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.4);
  align-items: center;
  justify-content: center;
}
.thumb-cell:hover .thumb-cell__overlay { display: flex; }

/* Delete button */
.btn-delete {
  width: 100%;
  padding: 10px;
  background: #c0392b;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.btn-delete:hover { background: #e74c3c; }
.btn-delete:disabled { background: #555; cursor: not-allowed; }

/* Full-screen overlay */
.fullscreen-overlay {
  position: fixed;
  inset: 0;
  background: #0d0d0d;
  z-index: 100;
  display: flex;
}
.fullscreen-overlay__photo {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.fullscreen-overlay__sidebar {
  width: 220px;
  flex-shrink: 0;
  border-left: 1px solid var(--color-border);
  overflow-y: auto;
  padding: 12px;
}

/* Settings drawer */
.settings-drawer {
  position: fixed;
  top: var(--header-height);
  right: 0;
  width: var(--panel-review-width);
  bottom: 0;
  background: var(--color-surface);
  border-left: 1px solid var(--color-border);
  z-index: 50;
  overflow-y: auto;
  padding: 16px;
}

/* Login screen */
.login-screen {
  position: fixed;
  inset: 0;
  background: var(--color-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.login-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  max-width: 400px;
}
.login-card h1 { font-size: 28px; margin-bottom: 12px; }
.login-card p  { color: var(--color-text-muted); margin-bottom: 24px; }

/* Buttons */
.btn-primary {
  background: var(--color-accent);
  color: #fff;
  border: none;
  padding: 10px 24px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}
.btn-primary:hover { opacity: 0.9; }
.btn-text {
  background: none;
  border: none;
  color: var(--color-accent);
  cursor: pointer;
  font-size: 12px;
  padding: 4px;
}
.btn-text:hover { text-decoration: underline; }

/* Progress bar */
.progress-bar-wrap {
  background: rgba(255,255,255,0.1);
  border-radius: 3px;
  height: 4px;
  margin-bottom: 4px;
}
.progress-bar {
  height: 100%;
  border-radius: 3px;
  background: var(--color-accent);
  transition: width 0.3s;
  width: 0%;
}

/* Scrollbar styling */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }

/* Onboarding card */
.onboarding-card {
  margin: 24px 16px;
  padding: 20px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
}
.onboarding-card h3 { margin-bottom: 8px; }
.onboarding-card p  { color: var(--color-text-muted); line-height: 1.5; }
```

- [ ] **Step 2: Start dev server and verify layout renders**

```bash
npm run dev &
sleep 3
curl -s http://localhost:5173/ | grep -o 'panel--folders\|panel--series\|panel--review' | wc -l
```

Expected: Output shows 3 (all three panel classes present in HTML).

- [ ] **Step 3: Commit**

```bash
git add src/style.css
git commit -m "feat: new three-column CSS layout"
```
