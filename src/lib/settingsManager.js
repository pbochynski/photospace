import { db } from './db.js';

export async function getSetting(key, defaultValue) {
    const val = await db.getSetting(key);
    return val !== null && val !== undefined ? val : defaultValue;
}

export async function setSetting(key, value) {
    await db.setSetting(key, value);
}

// Series analysis settings
export async function getSeriesSettings() {
    const [minGroupSize, minDensity, maxTimeGap, workerCount] = await Promise.all([
        getSetting('seriesMinGroupSize', 2),
        getSetting('seriesMinDensity', 1),
        getSetting('seriesMaxTimeGap', 5),
        getSetting('workerCount', 2),
    ]);
    return { minGroupSize, minDensity, maxTimeGap, workerCount };
}

export async function getDateFilter() {
    const [enabled, from, to] = await Promise.all([
        getSetting('dateEnabled', false),
        getSetting('dateFrom', null),
        getSetting('dateTo', null),
    ]);
    return { enabled, from, to };
}

export async function getIgnoredPeriods() {
    const val = await db.getSetting('ignoredPeriods');
    return Array.isArray(val) ? val : [];
}

export async function addIgnoredPeriod(startTime, endTime, label = '') {
    const periods = await getIgnoredPeriods();
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const newPeriod = {
        id: Date.now(),
        startTime,
        endTime,
        label: label || `${fmt(startDate)} → ${fmt(endDate)}`
    };
    periods.push(newPeriod);
    await db.setSetting('ignoredPeriods', periods);
    return periods;
}

export async function removeIgnoredPeriod(periodId) {
    const periods = await getIgnoredPeriods();
    const filtered = periods.filter(p => p.id !== periodId);
    await db.setSetting('ignoredPeriods', filtered);
    return filtered;
}
