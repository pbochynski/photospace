# Hash Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hash-based URL routing so the selected folder is preserved across refreshes and bookmarkable, with a clean extension point for a future time-based view.

**Architecture:** A tiny `src/lib/router.js` module wraps `window.location.hash` and `history.pushState`, parsing the hash into a typed route object. `main.js` reads the initial route after auth succeeds, calls `handleFolderClick` if a folder is encoded, and writes a new route whenever the user selects a folder. The `popstate` event drives Back/Forward. No framework or library required.

**Tech Stack:** Vanilla JS ES modules, Vite, no additional dependencies.

**Spec:** In-chat design — hash routing (`#/folder/:folderId`), future `#/time/:year-:month`).

## Global Constraints

- No router library — keep it vanilla JS
- Hash routing only — no `pushState` path changes (avoids SW and hosting config changes)
- Must survive the MSAL redirect cycle (hash is set on the URL *after* MSAL strips its query params)
- Must not break the existing onboarding flow (empty DB → show onboarding, not a broken folder load)
- Test files live in `src/tests/*.test.js`, run with `npm run test:run`

## Review Focus

- Stale folder ID in hash (folder deleted from OneDrive): loading the hash-encoded folder should fail gracefully rather than spinning forever or showing a blank panel.
- MSAL redirect hash collision: MSAL sets `#state=...&code=...` during its auth redirect; the router must not misparse that as a route (it will look nothing like `#/folder/...` but should be explicitly handled or ignored).
- Back button after opening review grid: pressing Back should restore the folder, not leave the review panel open over a blank grid — `closeReviewMode()` must be called before loading the restored folder.
- Folder name not available from hash alone: `folderId` is encoded in the hash but `folderName` is not — the router-driven load must fetch/reconstruct the name from the folder tree or Graph API rather than passing `undefined`.
- First-run onboarding: if the hash encodes a folder but the DB is empty, the folder load should still work (the scan will populate it), and the onboarding message should not flash before the folder loads.

---

## Task 1: `src/lib/router.js` — parse and write routes

**Files:**
- Create: `src/lib/router.js`
- Test: `src/tests/router.test.js`

**Interfaces:**
- Produces:
  - `parseRoute(hash: string): Route` — `Route` is `{ type: 'folder', folderId: string } | { type: 'time', year: number, month: number } | { type: 'none' }`
  - `buildFolderRoute(folderId: string): string` — returns `#/folder/<folderId>`
  - `navigate(hash: string): void` — calls `history.pushState({}, '', hash)`
  - `getCurrentRoute(): Route` — calls `parseRoute(window.location.hash)`

- [ ] **Step 1: Write the failing tests**

Create `src/tests/router.test.js`:

```js
import { parseRoute, buildFolderRoute } from '../lib/router.js';

describe('parseRoute', () => {
    it('parses a folder route', () => {
        expect(parseRoute('#/folder/01ABC123')).toEqual({ type: 'folder', folderId: '01ABC123' });
    });

    it('returns none for empty hash', () => {
        expect(parseRoute('')).toEqual({ type: 'none' });
    });

    it('returns none for MSAL auth hash', () => {
        expect(parseRoute('#state=abc&code=xyz')).toEqual({ type: 'none' });
    });

    it('returns none for unknown path', () => {
        expect(parseRoute('#/unknown/stuff')).toEqual({ type: 'none' });
    });

    it('parses a time route', () => {
        expect(parseRoute('#/time/2024-06')).toEqual({ type: 'time', year: 2024, month: 6 });
    });
});

describe('buildFolderRoute', () => {
    it('builds the correct hash string', () => {
        expect(buildFolderRoute('01ABC123')).toBe('#/folder/01ABC123');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- --reporter=verbose 2>&1 | grep -A3 "router"
```

Expected: tests not found or import error.

- [ ] **Step 3: Write the implementation**

Create `src/lib/router.js`:

```js
export function parseRoute(hash) {
    if (!hash || !hash.startsWith('#/')) return { type: 'none' };

    const path = hash.slice(2); // strip '#/'
    const [segment, ...rest] = path.split('/');

    if (segment === 'folder' && rest[0]) {
        return { type: 'folder', folderId: rest[0] };
    }

    if (segment === 'time' && rest[0]) {
        const [year, month] = rest[0].split('-').map(Number);
        if (year && month) return { type: 'time', year, month };
    }

    return { type: 'none' };
}

export function buildFolderRoute(folderId) {
    return `#/folder/${folderId}`;
}

export function navigate(hash) {
    history.pushState({}, '', hash);
}

export function getCurrentRoute() {
    return parseRoute(window.location.hash);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- --reporter=verbose 2>&1 | grep -A3 "router"
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/router.js src/tests/router.test.js
git commit -m "feat: add router module for hash-based URL parsing"
```

---

## Task 2: Write route on folder click

**Files:**
- Modify: `src/main.js` (lines 1–10 imports, lines 170–177 `handleFolderClick`)

**Interfaces:**
- Consumes: `buildFolderRoute(folderId)`, `navigate(hash)` from `src/lib/router.js`

- [ ] **Step 1: Add the import**

In `src/main.js`, add to the import block at the top:

```js
import { buildFolderRoute, navigate, getCurrentRoute, parseRoute } from './lib/router.js';
```

- [ ] **Step 2: Write the route on folder click**

Replace `handleFolderClick` (lines 170–177):

```js
async function handleFolderClick(folderId, folderName, driveId) {
    appState.selectedFolderId = folderId;
    appState.selectedFolderName = folderName;
    folderPanel.setSelected(folderId);
    closeReviewMode();
    navigate(buildFolderRoute(folderId));
    await photoGridPanel.loadFolder(folderId, folderName);
    await scanEngine.enqueueFolder(folderId, folderName, driveId, 'high');
}
```

- [ ] **Step 3: Manually verify in browser**

```bash
npm run dev
```

1. Log in, click a folder — URL should update to `http://localhost:5173/#/folder/<id>`.
2. Click a second folder — URL should update again.
3. Press Back — URL should show the first folder's hash (folder state restore is Task 3).

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: write folder route to URL hash on folder click"
```

---

## Task 3: Restore folder from hash after auth

**Files:**
- Modify: `src/main.js` — `onAuthenticated()` function (lines 87–168)

**Interfaces:**
- Consumes: `getCurrentRoute()` from `src/lib/router.js`
- Consumes: `folderPanel.findFolderById(folderId): { id, name, driveId } | null` — added in this task (see below)
- Consumes: `handleFolderClick(folderId, folderName, driveId)` — already exists

We need `folderPanel` to expose a way to look up a folder's name+driveId by ID. `FolderPanel` already holds `_rootFolders` and `_childFolders` after `loadRoot()`.

- [ ] **Step 1: Add `findFolderById` to `FolderPanel`**

In `src/lib/folderPanel.js`, add a public method after `setSelected`:

```js
findFolderById(folderId) {
    // Search root folders
    for (const f of (this._rootFolders || [])) {
        if (f.id === folderId) return { id: f.id, name: f.name, driveId: f.parentReference?.driveId };
    }
    // Search all loaded children
    for (const children of this._childFolders.values()) {
        for (const f of children) {
            if (f.id === folderId) return { id: f.id, name: f.name, driveId: f.parentReference?.driveId };
        }
    }
    return null;
}
```

- [ ] **Step 2: Restore folder in `onAuthenticated` after `loadRoot`**

In `src/main.js`, after the line `await folderPanel.loadRoot();` (currently line 142), add:

```js
// Restore folder from URL hash if present
const route = getCurrentRoute();
if (route.type === 'folder') {
    const folder = folderPanel.findFolderById(route.folderId);
    if (folder) {
        await handleFolderClick(folder.id, folder.name, folder.driveId);
    }
    // If not found in loaded tree, the folder may be in a collapsed subtree —
    // still load the grid (name unknown), and the tree highlight will be missing.
    else {
        appState.selectedFolderId = route.folderId;
        appState.selectedFolderName = route.folderId; // fallback label
        await photoGridPanel.loadFolder(route.folderId, route.folderId);
    }
}
```

- [ ] **Step 3: Wire `popstate` for Back/Forward**

At the end of `onAuthenticated`, before the closing `}`, add:

```js
window.addEventListener('popstate', async () => {
    const route = getCurrentRoute();
    if (route.type === 'folder') {
        const folder = folderPanel.findFolderById(route.folderId);
        if (folder) {
            appState.selectedFolderId = folder.id;
            appState.selectedFolderName = folder.name;
            folderPanel.setSelected(folder.id);
            closeReviewMode();
            await photoGridPanel.loadFolder(folder.id, folder.name);
        }
    } else if (route.type === 'none') {
        appState.selectedFolderId = null;
        appState.selectedFolderName = null;
        folderPanel.setSelected(null);
        closeReviewMode();
        photoGridPanel.clear();
    }
});
```

`photoGridPanel.clear()` may not exist yet — add a stub in the next step if needed.

- [ ] **Step 4: Add `clear()` to `PhotoGridPanel` if missing**

Check `src/lib/photoGridPanel.js` for an existing clear/reset method. If none exists, add:

```js
clear() {
    this._headerEl.textContent = '';
    this._listEl.innerHTML = '';
}
```

(Check actual property names in that file — `_headerEl` and `_listEl` are the expected names from the constructor in `main.js`.)

- [ ] **Step 5: Manual end-to-end verification**

```bash
npm run dev
```

1. Log in. Select folder A — URL becomes `#/folder/<idA>`.
2. Refresh page — folder A should be selected and loaded automatically.
3. Select folder B — URL becomes `#/folder/<idB>`.
4. Press Back — URL returns to `#/folder/<idA>`, folder A grid loads, review panel closed.
5. Press Forward — URL goes to `#/folder/<idB>`, folder B grid loads.
6. Bookmark `#/folder/<idA>` URL, open in new tab — folder A loads after login.

- [ ] **Step 6: Commit**

```bash
git add src/main.js src/lib/folderPanel.js src/lib/photoGridPanel.js
git commit -m "feat: restore selected folder from URL hash on load and popstate"
```

---

## Review Focus Tests (add to existing tasks)

These pin the edge cases called out in the Review Focus section above.

**Stale/missing folder ID** — covered implicitly by the `else` branch in Task 3 Step 2 (falls back to loading by ID with a placeholder name). No additional test needed beyond the manual check in Step 5 — the folder tree simply won't highlight, and the grid either loads from cache or shows empty.

**MSAL hash collision** — covered by the `parseRoute('#state=abc&code=xyz')` test in Task 1. No `#/` prefix → returns `{ type: 'none' }`.

**Back button + review panel** — covered by the `closeReviewMode()` call in the `popstate` handler (Task 3 Step 3). The manual test in Task 3 Step 5 item 4 exercises this path.

**Folder name from hash only** — covered by the `else` branch fallback in Task 3 Step 2, using the folderId as the label when the folder isn't found in the loaded tree.

**First-run onboarding** — the onboarding check (`photoCount === 0`) runs before `loadRoot()` and the route restore. If the hash encodes a folder, the route restore runs after `loadRoot()` and calls `handleFolderClick`, which will load from cache (empty) and trigger a scan. The onboarding banner calls `photoGridPanel.showOnboarding()` — this will be overwritten by the subsequent `loadFolder` call, which is the correct behavior (the folder view replaces onboarding).
