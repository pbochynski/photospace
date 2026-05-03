# Folder Click — Select + Expand/Collapse

**Date:** 2026-05-03

## Problem

The expand/collapse chevron (▸/▾) in the folder panel is a small click target, making it hard to use. Users have to aim precisely at the chevron to expand or collapse a folder subtree.

## Goal

Clicking anywhere on a folder row should both select the folder (show its photos) and toggle its expand/collapse state, using the same single click.

## Design

### Affected file

`src/lib/folderPanel.js` — the `click` event handler inside `_renderFolders` (lines ~123–133).

### Behavior change

| Interaction | Before | After |
|---|---|---|
| Click chevron | Expand/collapse only | (merged into row click — same result) |
| Click folder name/icon | Select/navigate only | Select + expand/collapse |
| Click promote button (↑) | Trigger scan | Trigger scan (unchanged) |
| Right-click | Context menu | Context menu (unchanged) |

### Implementation

Remove the `else if` branch that exclusively handles chevron clicks. The default `else` branch (navigate) now also calls `_expandFolder(folder.id)`:

```js
item.addEventListener('click', (e) => {
    if (e.target.classList.contains('folder-item__promote-btn')) {
        e.stopPropagation();
        this._onPromoteClick(folder.id, folder.name, folder.parentReference?.driveId);
    } else {
        this._onFolderClick(folder.id, folder.name, folder.parentReference?.driveId);
        this._expandFolder(folder.id);
    }
});
```

### Chevron

The chevron element (`▸`/`▾`) is kept unchanged as a visual indicator of expansion state and whether a folder has children. It is no longer the exclusive trigger for expand/collapse — it is a passive UI element.

## Out of scope

- No changes to the context menu
- No changes to the promote button
- No changes to how children are loaded (lazy, on first expand)
- No changes to any other panel
