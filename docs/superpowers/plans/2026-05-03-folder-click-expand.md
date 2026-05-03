# Folder Click Expand/Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clicking anywhere on a folder row both select the folder and toggle its expand/collapse state, removing the need to aim at the small chevron.

**Architecture:** Modify the `click` event handler in `FolderPanel._renderFolders` to call both `_onFolderClick` and `_expandFolder` on any row click (except the promote button). The chevron element stays as a passive visual indicator.

**Tech Stack:** Vanilla JS ES modules, Vitest for tests

---

### Task 1: Write and run the failing test

**Files:**
- Create: `src/tests/folderPanel.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/tests/folderPanel.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal DOM stubs needed by FolderPanel constructor
function setupDom() {
    document.body.innerHTML = `
        <div id="folder-panel"></div>
        <div id="folder-context-menu" hidden>
            <button id="ctx-scan-folder"></button>
            <button id="ctx-scan-recursive"></button>
        </div>
    `;
}

// Minimal folder object matching what Graph API returns
function makeFolder(id, name) {
    return { id, name, parentReference: { driveId: 'drive1' } };
}

describe('FolderPanel click behavior', () => {
    let container, onFolderClick, onPromoteClick, onRecursiveScanClick, panel;

    beforeEach(async () => {
        setupDom();
        onFolderClick = vi.fn();
        onPromoteClick = vi.fn();
        onRecursiveScanClick = vi.fn();

        const { FolderPanel } = await import('../lib/folderPanel.js');
        container = document.getElementById('folder-panel');
        panel = new FolderPanel(container, { onFolderClick, onPromoteClick, onRecursiveScanClick });

        // Inject root folders directly (bypasses Graph API)
        panel._rootFolders = [makeFolder('f1', 'Holidays')];
        panel._rerender();
    });

    it('calls onFolderClick when the folder row is clicked', () => {
        const item = container.querySelector('.folder-item');
        item.click();
        expect(onFolderClick).toHaveBeenCalledWith('f1', 'Holidays', 'drive1');
    });

    it('expands the folder when the folder row is clicked', async () => {
        // Stub _expandFolder so we can assert it was called without hitting Graph API
        const expandSpy = vi.spyOn(panel, '_expandFolder');
        const item = container.querySelector('.folder-item');
        item.click();
        expect(expandSpy).toHaveBeenCalledWith('f1');
    });

    it('does NOT call onFolderClick when the promote button is clicked', () => {
        const btn = container.querySelector('.folder-item__promote-btn');
        if (!btn) return; // folder has no promote button if status is scanned — skip
        btn.click();
        expect(onFolderClick).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/tests/folderPanel.test.js
```

Expected: at least the "expands the folder" test FAILs because clicking the row currently does NOT call `_expandFolder`.

---

### Task 2: Implement the fix

**Files:**
- Modify: `src/lib/folderPanel.js:123-133`

- [ ] **Step 3: Update the click handler**

In `src/lib/folderPanel.js`, replace the `click` listener inside `_renderFolders` (the block starting at `item.addEventListener('click', ...)`):

**Before:**
```js
item.addEventListener('click', (e) => {
    if (e.target.classList.contains('folder-item__promote-btn')) {
        e.stopPropagation();
        this._onPromoteClick(folder.id, folder.name, folder.parentReference?.driveId);
    } else if (e.target.classList.contains('folder-item__chevron') && hasChildren) {
        e.stopPropagation();
        this._expandFolder(folder.id);
    } else {
        this._onFolderClick(folder.id, folder.name, folder.parentReference?.driveId);
    }
});
```

**After:**
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

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/tests/folderPanel.test.js
```

Expected: all three tests PASS.

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/folderPanel.js src/tests/folderPanel.test.js
git commit -m "feat: folder row click now selects and expands/collapses"
```
