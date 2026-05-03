// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/graph.js', () => ({
    getRootFolders: vi.fn().mockResolvedValue([]),
    getFolderChildren: vi.fn().mockResolvedValue([]),
}));
vi.mock('../lib/db.js', () => ({
    db: { getSetting: vi.fn().mockResolvedValue(null) },
}));

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
        expect(btn).toBeTruthy(); // not_scanned status guarantees promote button is rendered
        btn.click();
        expect(onFolderClick).not.toHaveBeenCalled();
    });
});
