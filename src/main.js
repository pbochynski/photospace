import { db } from './lib/db.js';
import { scanEngine } from './lib/scanEngine.js';
import { qualityProcessor } from './lib/qualityProcessor.js';
import { FolderPanel } from './lib/folderPanel.js';
import { SeriesPanel } from './lib/seriesPanel.js';
import { ReviewGrid } from './lib/reviewGrid.js';
import { getAuthToken, login, msalInstance } from './lib/auth.js';
import { SettingsDrawer } from './lib/settingsDrawer.js';

const appState = {
    authenticated: false,
    selectedFolderId: null,
    selectedFolderName: null,
    selectedSeries: null,
    selectedFolderIdForSeries: null,
};

// DOM refs
const loginScreen   = document.getElementById('login-screen');
const btnLogin      = document.getElementById('btn-login');
const headerStatus  = document.getElementById('header-status');
const btnQuick      = document.getElementById('btn-quick');
const btnAdvanced   = document.getElementById('btn-advanced');
const settingsDrawerEl = document.getElementById('settings-drawer');

// Panel renderers (created after DOM ready)
let folderPanel, seriesPanel, reviewGrid;
let settingsDrawerPanel;

async function sendTokenToSW(token) {
    if (!('serviceWorker' in navigator)) return;
    try {
        const reg = await navigator.serviceWorker.ready;
        reg.active?.postMessage({ type: 'SET_TOKEN', token });
    } catch (e) {
        console.warn('Could not send token to service worker:', e);
    }
}

async function boot() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(e => console.warn('SW registration failed:', e));
    }

    await db.init();

    // Initialize MSAL (handles redirect response if present)
    await msalInstance.initialize();
    const redirectResult = await msalInstance.handleRedirectPromise();
    if (redirectResult?.account) {
        msalInstance.setActiveAccount(redirectResult.account);
    }

    let token = null;
    try { token = await getAuthToken(); } catch (_) {}

    if (token) {
        await sendTokenToSW(token);
        await onAuthenticated();
    } else {
        loginScreen.hidden = false;
    }

    btnLogin?.addEventListener('click', () => login().catch(console.error));

    btnQuick?.addEventListener('click', () => toggleMode('quick').catch(console.error));
    btnAdvanced?.addEventListener('click', () => toggleMode('advanced').catch(console.error));
}

async function toggleMode(mode) {
    const isAdvanced = mode === 'advanced';
    btnQuick.classList.toggle('mode-btn--active', !isAdvanced);
    btnAdvanced.classList.toggle('mode-btn--active', isAdvanced);
    settingsDrawerEl.hidden = !isAdvanced;
    if (isAdvanced) {
        if (appState.selectedFolderId) settingsDrawerPanel.setCurrentFolder(appState.selectedFolderId);
        await settingsDrawerPanel.render();
    }
}

async function onAuthenticated() {
    appState.authenticated = true;

    folderPanel = new FolderPanel(document.getElementById('folder-tree'), {
        onFolderClick: handleFolderClick,
        onPromoteClick: handlePromoteClick,
        onRecursiveScanClick: handleRecursiveScanClick,
    });

    seriesPanel = new SeriesPanel({
        headerEl:       document.getElementById('series-header'),
        listEl:         document.getElementById('series-list'),
        progressBarEl:  document.getElementById('series-progress-bar'),
        progressLabelEl: document.getElementById('series-progress-label'),
        onSeriesClick:  handleSeriesClick,
    });

    reviewGrid = new ReviewGrid({
        headerEl: document.getElementById('review-header'),
        gridEl:   document.getElementById('review-grid'),
        footerEl: document.getElementById('review-footer'),
        fullscreenOverlay: document.getElementById('fullscreen-overlay'),
        fullscreenPhoto:   document.getElementById('fullscreen-photo'),
        fullscreenSidebar: document.getElementById('fullscreen-sidebar'),
    });

    settingsDrawerPanel = new SettingsDrawer(document.getElementById('settings-content'), {
        onSettingsChange: async () => {
            if (appState.selectedFolderId) {
                settingsDrawerPanel.setCurrentFolder(appState.selectedFolderId);
                await seriesPanel.loadFolder(appState.selectedFolderId, appState.selectedFolderName);
            }
        }
    });

    // Check if first-run (no photos in db)
    const photoCount = await db.getPhotoCount();
    if (photoCount === 0) {
        seriesPanel.showOnboarding();
    }

    // Wire scan engine events
    scanEngine.addEventListener('folder_status', (e) => {
        const { folderId, status, photoCount } = e.detail;
        folderPanel.setFolderStatus(folderId, status, photoCount);
        if (status === 'scanned' && folderId === appState.selectedFolderId) {
            seriesPanel.loadFolder(folderId, appState.selectedFolderName);
        }
        updateHeaderStatus();
    });

    scanEngine.addEventListener('scan_idle', () => updateHeaderStatus());

    // Wire quality processor events
    qualityProcessor.addEventListener('quality_done', () => updateHeaderStatus());

    // Load folder tree
    await folderPanel.loadRoot();

    // Resume any pending scan queue
    await scanEngine.start();

    await qualityProcessor.init();

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') reviewGrid.closeFullscreen();
        if (e.key === 'ArrowLeft' && reviewGrid._fsIndex !== null && reviewGrid._fsIndex > 0) {
            reviewGrid._renderFullscreen(reviewGrid._fsIndex - 1);
        }
        if (e.key === 'ArrowRight' && reviewGrid._fsIndex !== null && reviewGrid._fsIndex < reviewGrid._photos.length - 1) {
            reviewGrid._renderFullscreen(reviewGrid._fsIndex + 1);
        }
    });
}

async function handleFolderClick(folderId, folderName, driveId) {
    appState.selectedFolderId = folderId;
    appState.selectedFolderName = folderName;
    folderPanel.setSelected(folderId);
    await seriesPanel.loadFolder(folderId, folderName);
    await scanEngine.enqueueFolder(folderId, folderName, driveId, 'high');
}

async function handlePromoteClick(folderId, folderName, driveId) {
    await scanEngine.enqueueFolder(folderId, folderName, driveId, 'high');
}

async function handleRecursiveScanClick(folderId, folderName, driveId) {
    await scanEngine.enqueueFolder(folderId, folderName, driveId, 'high', true);
}

async function handleSeriesClick(series, folderId, index) {
    appState.selectedSeries = series;
    appState.selectedFolderIdForSeries = folderId;
    try {
        const token = await getAuthToken();
        await sendTokenToSW(token);
    } catch (_) {}
    await reviewGrid.loadSeries(series, folderId);
}

function updateHeaderStatus() {
    const pending = qualityProcessor.pendingCount;
    if (pending > 0) {
        headerStatus.textContent = `● Quality scoring ${pending} photos`;
    } else if (scanEngine._running) {
        headerStatus.textContent = '● Scanning…';
    } else {
        headerStatus.textContent = '';
    }
}

boot().catch(console.error);
