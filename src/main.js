import { db } from './lib/db.js';
import { scanEngine } from './lib/scanEngine.js';
import { FolderPanel } from './lib/folderPanel.js';
import { PhotoGridPanel } from './lib/photoGridPanel.js';
import { ReviewGrid } from './lib/reviewGrid.js';
import { TimelinePanel } from './lib/timelinePanel.js';
import { getAuthToken, login, logout, msalInstance } from './lib/auth.js';
import { buildFolderRoute, navigate, getCurrentRoute } from './lib/router.js';
import { SettingsDrawer } from './lib/settingsDrawer.js';
import { buildFolderRoute, navigate, getCurrentRoute, buildTimeRoute } from './lib/router.js';

const appState = {
    authenticated: false,
    selectedFolderId: null,
    selectedFolderName: null,
    selectedSeries: null,
    selectedFolderIdForSeries: null,
    viewMode: 'folder',       // 'folder' | 'timeline'
    lastTimelineYear: null,
    lastTimelineMonth: null,
};

// DOM refs
const loginScreen   = document.getElementById('login-screen');
const btnLogin      = document.getElementById('btn-login');
const btnLogout     = document.getElementById('btn-logout');
const headerStatus  = document.getElementById('header-status');
const btnQuick      = document.getElementById('btn-quick');
const btnAdvanced   = document.getElementById('btn-advanced');
const settingsDrawerEl = document.getElementById('settings-drawer');
const settingsBackdropEl = document.getElementById('settings-backdrop');
const appColumns    = document.getElementById('app-columns');
const btnFolders    = document.getElementById('btn-folders');
const btnTimeline   = document.getElementById('btn-timeline');
const panelTimeline = document.getElementById('panel-timeline');

// Panel renderers (created after DOM ready)
let folderPanel, photoGridPanel, reviewGrid, timelinePanel;
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

async function switchToTimeline(year, month) {
    if (reviewGrid && appColumns.classList.contains('app-columns--review-open')) {
        closeReviewMode();
    }
    appState.viewMode = 'timeline';
    appState.lastTimelineYear = year;
    appState.lastTimelineMonth = month;
    appColumns.classList.add('app-columns--timeline');
    panelTimeline.hidden = false;
    btnFolders.classList.remove('mode-btn--active');
    btnTimeline.classList.add('mode-btn--active');
    await timelinePanel.show(year, month);
}

function switchToFolders() {
    appState.viewMode = 'folder';
    appColumns.classList.remove('app-columns--timeline');
    panelTimeline.hidden = true;
    btnTimeline.classList.remove('mode-btn--active');
    btnFolders.classList.add('mode-btn--active');
    timelinePanel.hide();
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
    btnLogout?.addEventListener('click', () => logout());

    btnQuick?.addEventListener('click', () => toggleMode('quick').catch(console.error));
    btnAdvanced?.addEventListener('click', () => toggleMode('advanced').catch(console.error));
    document.getElementById('btn-settings-close')?.addEventListener('click', () => toggleMode('quick').catch(console.error));
    settingsBackdropEl?.addEventListener('click', () => toggleMode('quick').catch(console.error));

    btnFolders?.addEventListener('click', () => {
        const route = appState.selectedFolderId
            ? buildFolderRoute(appState.selectedFolderId)
            : '#/';
        navigate(route);
        switchToFolders();
    });
    btnTimeline?.addEventListener('click', () => {
        const now = new Date();
        const y = appState.lastTimelineYear ?? now.getFullYear();
        const m = appState.lastTimelineMonth ?? (now.getMonth() + 1);
        navigate(buildTimeRoute(y, m));
        switchToTimeline(y, m).catch(console.error);
    });
}

async function toggleMode(mode) {
    const isAdvanced = mode === 'advanced';
    btnQuick.classList.toggle('mode-btn--active', !isAdvanced);
    btnAdvanced.classList.toggle('mode-btn--active', isAdvanced);
    settingsDrawerEl.hidden = !isAdvanced;
    settingsBackdropEl.hidden = !isAdvanced;
    if (isAdvanced) {
        if (appState.selectedFolderId) settingsDrawerPanel.setCurrentFolder(appState.selectedFolderId);
        await settingsDrawerPanel.render();
    }
}

async function onAuthenticated() {
    appState.authenticated = true;
    btnLogout.hidden = false;

    folderPanel = new FolderPanel(document.getElementById('folder-tree'), {
        onFolderClick: handleFolderClick,
        onPromoteClick: handlePromoteClick,
        onRecursiveScanClick: handleRecursiveScanClick,
    });

    photoGridPanel = new PhotoGridPanel({
        headerEl:        document.getElementById('series-header'),
        listEl:          document.getElementById('series-list'),
        onSeriesClick:   handleSeriesClick,
        onPhotoClick:    handlePhotoClick,
    });

    reviewGrid = new ReviewGrid({
        headerEl: document.getElementById('review-header'),
        gridEl:   document.getElementById('review-grid'),
        footerEl: document.getElementById('review-footer'),
        fullscreenOverlay: document.getElementById('fullscreen-overlay'),
        fullscreenPhoto:   document.getElementById('fullscreen-photo'),
        fullscreenSidebar: document.getElementById('fullscreen-sidebar'),
        onClose: () => closeReviewMode(),
    });

    timelinePanel = new TimelinePanel({
        scrollEl:   document.getElementById('timeline-scroll'),
        scrubberEl: document.getElementById('timeline-scrubber'),
        onSeriesClick: handleSeriesClick,
        onPhotoClick:  handlePhotoClick,
    });

    settingsDrawerPanel = new SettingsDrawer(document.getElementById('settings-content'), {
        onSettingsChange: async () => {
            if (appState.selectedFolderId) {
                settingsDrawerPanel.setCurrentFolder(appState.selectedFolderId);
                await photoGridPanel.loadFolder(appState.selectedFolderId, appState.selectedFolderName);
            }
        }
    });

    // Check if first-run (no photos in db)
    const photoCount = await db.getPhotoCount();
    if (photoCount === 0) {
        photoGridPanel.showOnboarding();
    }

    // Wire scan engine events
    scanEngine.addEventListener('folder_status', (e) => {
        const { folderId, status, photoCount } = e.detail;
        folderPanel.setFolderStatus(folderId, status, photoCount);
        if (status === 'scanned' && folderId === appState.selectedFolderId) {
            photoGridPanel.loadFolder(folderId, appState.selectedFolderName);
        }
        if (status === 'scanned' && appState.viewMode === 'timeline') {
            timelinePanel.refreshScrubber().catch(console.error);
        }
        updateHeaderStatus();
    });

    scanEngine.addEventListener('scan_idle', () => updateHeaderStatus());

    // Load folder tree
    await folderPanel.loadRoot();

    // Restore view from URL hash if present
    const route = getCurrentRoute();
    if (route.type === 'folder') {
        const folder = folderPanel.findFolderById(route.folderId);
        if (folder) {
            await handleFolderClick(folder.id, folder.name, folder.driveId);
        } else {
            // Folder not found in the loaded root tree (e.g. lives in a not-yet-expanded subtree).
            // We can restore cached photos but cannot enqueue a scan without a driveId.
            // The user can navigate to the folder in the tree to trigger a scan.
            appState.selectedFolderId = route.folderId;
            appState.selectedFolderName = route.folderId;
            await photoGridPanel.loadFolder(route.folderId, route.folderId);
        }
    } else if (route.type === 'time') {
        await switchToTimeline(route.year, route.month);
    }

    // Resume any pending scan queue
    await scanEngine.start();

    // Wire popstate for Back/Forward
    window.addEventListener('popstate', async () => {
        const popRoute = getCurrentRoute();
        if (popRoute.type === 'folder') {
            switchToFolders();
            const folder = folderPanel.findFolderById(popRoute.folderId);
            if (folder) {
                appState.selectedFolderId = folder.id;
                appState.selectedFolderName = folder.name;
                folderPanel.setSelected(folder.id);
                closeReviewMode();
                await photoGridPanel.loadFolder(folder.id, folder.name);
            }
        } else if (popRoute.type === 'time') {
            await switchToTimeline(popRoute.year, popRoute.month);
        } else if (popRoute.type === 'none') {
            switchToFolders();
            appState.selectedFolderId = null;
            appState.selectedFolderName = null;
            folderPanel.setSelected(null);
            closeReviewMode();
            photoGridPanel.clear();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (reviewGrid._fsIndex !== null) {
                reviewGrid.closeFullscreen();
            } else {
                closeReviewMode();
            }
        }
        if (reviewGrid._fsIndex !== null) {
            if (e.key === 'ArrowLeft' && reviewGrid._fsIndex > 0) {
                reviewGrid._renderFullscreen(reviewGrid._fsIndex - 1);
            }
            if (e.key === 'ArrowRight' && reviewGrid._fsIndex < reviewGrid._photos.length - 1) {
                reviewGrid._renderFullscreen(reviewGrid._fsIndex + 1);
            }
            if (e.key === ' ') {
                e.preventDefault();
                reviewGrid.toggleCurrentFullscreenSelection();
            }
        }
    });
}

async function handleFolderClick(folderId, folderName, driveId) {
    appState.selectedFolderId = folderId;
    appState.selectedFolderName = folderName;
    folderPanel.setSelected(folderId);
    closeReviewMode();
    navigate(buildFolderRoute(folderId));
    await photoGridPanel.loadFolder(folderId, folderName);
    await scanEngine.enqueueFolder(folderId, folderName, driveId, 'high');
}

async function handlePromoteClick(folderId, folderName, driveId) {
    await scanEngine.enqueueFolder(folderId, folderName, driveId, 'high');
}

async function handleRecursiveScanClick(folderId, folderName, driveId) {
    await scanEngine.enqueueFolder(folderId, folderName, driveId, 'high', true);
}

function openReviewMode() {
    appColumns.classList.add('app-columns--review-open');
}

function closeReviewMode() {
    appColumns.classList.remove('app-columns--review-open');
}

async function handleSeriesClick(series, folderId, index) {
    appState.selectedSeries = series;
    appState.selectedFolderIdForSeries = folderId;
    try {
        const token = await getAuthToken();
        await sendTokenToSW(token);
    } catch (_) {}
    await reviewGrid.loadSeries(series, folderId);
    openReviewMode();
}

async function handlePhotoClick(photo, series) {
    try {
        const token = await getAuthToken();
        await sendTokenToSW(token);
    } catch (_) {}
    if (series) {
        appState.selectedSeries = series;
        appState.selectedFolderIdForSeries = appState.selectedFolderId;
        await reviewGrid.loadSeries(series, appState.selectedFolderId);
        openReviewMode();
        reviewGrid.openPhotoById(photo.file_id);
    } else {
        appState.selectedSeries = null;
        appState.selectedFolderIdForSeries = null;
        // TODO: pass timeline month photos as neighbor list (photoGridPanel.getPhotos() is empty/stale in timeline mode)
        reviewGrid.openSinglePhoto(photo, photoGridPanel.getPhotos());
    }
}

function updateHeaderStatus() {
    if (scanEngine._running) {
        headerStatus.textContent = '● Scanning…';
    } else {
        headerStatus.textContent = '';
    }
}

boot().catch(console.error);
