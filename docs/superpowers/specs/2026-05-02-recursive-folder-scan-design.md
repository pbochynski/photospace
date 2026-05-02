# Recursive Folder Scan via Context Menu

**Date:** 2026-05-02  
**Status:** Approved

## Problem

Scanning a folder only scans photos in that folder. To scan subfolders, the user must click each one individually in the folder tree panel.

## Solution

Add a right-click context menu to folder items in the folder tree panel. The menu offers two actions: "Scan folder" (current behavior) and "Scan with subfolders" (recursive). Recursive scanning is implemented lazily: after each folder scan completes, its children are discovered and enqueued, propagating the recursive flag depth-first through the entire tree.

## Architecture

### 1. `src/lib/scanQueue.js`

Queue entries gain an optional `recursive` boolean (default `false`). No other changes to queue behavior.

### 2. `src/lib/scanEngine.js`

`enqueueFolder(folderId, folderPath, driveId, priority, recursive = false)` — adds the `recursive` parameter and passes it into the queue entry.

In the `start()` loop, after a successful scan and `folder_scan_complete` fires, if `entry.recursive` is true:
- Call `getFolderChildren(folderId)` to get direct child folders
- Enqueue each child with `recursive: true` and `priority: 'normal'`
- `driveId` is taken from `entry.driveId` (already present in queue entries)

Children inherit `recursive: true`, so the walk continues until leaf folders are reached (folders with no children).

### 3. `src/lib/folderPanel.js`

Right-click (`contextmenu` event) on any folder item triggers a shared context menu. The menu is positioned at the cursor and contains:
- **Scan folder** — calls `handlePromoteClick(folderId, folderName, driveId)` (existing behavior, no view change)
- **Scan with subfolders** — calls `handleRecursiveScanClick(folderId, folderName, driveId)`

The menu is dismissed on click-outside or `Escape` keypress.

### 4. `src/main.js`

New `handleRecursiveScanClick(folderId, folderName, driveId)` function:
```js
async function handleRecursiveScanClick(folderId, folderName, driveId) {
    await scanEngine.enqueueFolder(folderId, folderName, driveId, 'high', true);
}
```

### 5. Context menu HTML/CSS

A `<div id="folder-context-menu">` in `src/index.html`, hidden by default (`display: none`). Styled to match existing panel dropdowns. Positioned absolutely at `event.clientX / event.clientY`.

## Data Flow

```
right-click folder
  → context menu appears
  → "Scan with subfolders" clicked
  → handleRecursiveScanClick(folderId, folderName, driveId)
  → scanEngine.enqueueFolder(..., 'high', recursive=true)
  → scanEngine.start() processes queue
  → folder scan completes
  → if recursive: getFolderChildren(folderId)
  → enqueue each child with recursive=true, priority='normal'
  → repeat until no more children
  → folder_status events update the folder tree as each completes
```

## Status Feedback

No new UI needed. Existing `folder_status` events emitted by `scanEngine` update each folder's status badge in the tree as it completes. Subfolders already loaded via chevron expansion show their status update in real time.

## Error Handling

If `getFolderChildren()` fails during recursive expansion, log the error and continue processing the remaining queue (don't abort the entire recursive job). Existing per-folder error handling in `scanEngine` already covers scan failures.

## Out of Scope

- Depth limiting (scan all levels always)
- Progress count / total folders display
- Cancellation of in-progress recursive scans (existing `stop()` covers this)
