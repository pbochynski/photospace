export function parseRoute(hash) {
    if (!hash || !hash.startsWith('#/')) return { type: 'none' };

    const path = hash.slice(2);
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

export function buildTimeRoute(year, month) {
    return `#/time/${year}-${String(month).padStart(2, '0')}`;
}

export function navigate(hash) {
    if (window.location.hash === hash) return;
    history.pushState({}, '', hash);
}

export function getCurrentRoute() {
    return parseRoute(window.location.hash);
}
