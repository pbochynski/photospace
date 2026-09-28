import { db } from './db.js';
import { findPhotoSeries } from './analysis.js';
import { getSeriesSettings } from './settingsManager.js';
import { buildTimeRoute, navigate } from './router.js';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export class TimelinePanel {
    constructor({ scrollEl, scrubberEl, onSeriesClick, onPhotoClick }) {
        this._scrollEl = scrollEl;
        this._scrubberEl = scrubberEl;
        this._onSeriesClick = onSeriesClick;
        this._onPhotoClick = onPhotoClick;
        this._monthIndex = {};
        this._renderedMonths = new Set(); // "YYYY-MM" keys currently in DOM
        this._observer = null;
        this._currentYear = null;
        this._currentMonth = null;
    }

    async show(year, month) {
        this._currentYear = year;
        this._currentMonth = month;
        this._scrollEl.innerHTML = '';
        this._renderedMonths.clear();

        // Load month index for scrubber
        this._monthIndex = (await db.getSetting('monthIndex')) || {};
        this._renderScrubber();

        // Build spacers for all months, then render the target month
        this._buildSpacers(year, month);
        await this._loadAndReplaceMonth(year, month);

        this._setupObserver();
        this._updateScrubberActive(`${year}-${String(month).padStart(2,'0')}`);
    }

    hide() {
        if (this._observer) { this._observer.disconnect(); this._observer = null; }
    }

    async refreshScrubber() {
        this._monthIndex = (await db.getSetting('monthIndex')) || {};
        this._renderScrubber();
    }

    // ── private ──────────────────────────────────────────────────────────────

    _buildSpacers(targetYear, targetMonth) {
        const months = Object.keys(this._monthIndex)
            .filter(k => this._monthIndex[k] > 0)
            .sort()
            .reverse(); // newest first

        for (const key of months) {
            const [y, m] = key.split('-').map(Number);
            const isTarget = y === targetYear && m === targetMonth;
            const el = document.createElement('div');
            el.dataset.month = key;
            el.dataset.spacer = isTarget ? 'false' : 'true';
            if (el.dataset.spacer === 'true') {
                const count = this._monthIndex[key];
                el.className = 'timeline-spacer';
                el.style.height = `${Math.ceil(count / 5) * 130 + 60}px`;
            }
            this._scrollEl.appendChild(el);
        }
    }

    async _loadAndReplaceMonth(year, month) {
        const key = `${year}-${String(month).padStart(2,'0')}`;
        if (this._renderedMonths.has(key)) return;

        const photos = await db.getPhotosByMonth(year, month);
        const settings = await getSeriesSettings();

        // findPhotoSeries mutates photo_taken_ts from ISO string to numeric ms.
        // Work on a shallow copy of each photo to protect the original objects.
        const photosCopy = photos.map(p => ({ ...p }));
        const rawSeries = photosCopy.length > 0
            ? await findPhotoSeries(photosCopy, { minGroupSize: settings.minGroupSize, maxTimeGap: settings.maxTimeGap })
            : [];

        // Re-attach original photo objects (with ISO string timestamps) to each series.
        const origByFileId = new Map(photos.map(p => [p.file_id, p]));
        const seriesWithOrigPhotos = rawSeries.map(s => ({
            ...s,
            photos: s.photos.map(cp => origByFileId.get(cp.file_id) || cp),
        }));

        const dayGroups = this._buildDayGroups(photos, seriesWithOrigPhotos);
        const chunk = this._renderChunk(year, month, dayGroups);

        // Replace the spacer/placeholder for this month
        const existing = this._scrollEl.querySelector(`[data-month="${key}"]`);
        if (existing) {
            this._scrollEl.replaceChild(chunk, existing);
        } else {
            this._scrollEl.appendChild(chunk);
        }
        this._renderedMonths.add(key);

        // Register new sentinels with the observer so virtual scroll keeps working
        // for months loaded after the initial render.
        if (this._observer) {
            for (const s of chunk.querySelectorAll('.timeline-sentinel-top, .timeline-sentinel-bottom')) {
                this._observer.observe(s);
            }
        }
    }

    /**
     * Group photos by calendar day, interleaving series and standalone photos.
     * @param {Photo[]} photos - Original photo objects (with ISO string photo_taken_ts)
     * @param {Object[]} series - Series objects with original photo references
     * @returns {{ day: string, items: Object[] }[]}
     */
    _buildDayGroups(photos, series) {
        const sorted = photos
            .filter(p => p.photo_taken_ts)
            .sort((a, b) => {
                const ta = typeof a.photo_taken_ts === 'number' ? a.photo_taken_ts : new Date(a.photo_taken_ts).getTime();
                const tb = typeof b.photo_taken_ts === 'number' ? b.photo_taken_ts : new Date(b.photo_taken_ts).getTime();
                return ta < tb ? -1 : 1;
            });

        const photoToSeries = new Map();
        for (const s of series) {
            for (const p of s.photos) photoToSeries.set(p.file_id, s);
        }
        const emittedSeries = new Set();

        // Group by day
        const dayMap = new Map(); // "YYYY-MM-DD" → raw items
        for (const photo of sorted) {
            // Handle both ISO string and numeric ms timestamps
            const day = typeof photo.photo_taken_ts === 'string'
                ? photo.photo_taken_ts.slice(0, 10)
                : new Date(photo.photo_taken_ts).toISOString().slice(0, 10);

            if (!dayMap.has(day)) dayMap.set(day, []);
            const s = photoToSeries.get(photo.file_id);
            if (s) {
                if (!emittedSeries.has(s)) {
                    emittedSeries.add(s);
                    dayMap.get(day).push({ type: 'series', series: s });
                }
            } else {
                dayMap.get(day).push({ type: 'photo', photo });
            }
        }

        // Merge consecutive standalone photos within each day
        const result = [];
        for (const [day, rawItems] of dayMap) {
            const items = [];
            let buf = [];
            const flush = () => { if (buf.length) { items.push({ type: 'standalone', photos: [...buf] }); buf = []; } };
            for (const item of rawItems) {
                if (item.type === 'photo') { buf.push(item.photo); }
                else { flush(); items.push(item); }
            }
            flush();
            result.push({ day, items });
        }
        return result;
    }

    _renderChunk(year, month, dayGroups) {
        const key = `${year}-${String(month).padStart(2,'0')}`;
        const chunk = document.createElement('div');
        chunk.dataset.month = key;
        chunk.dataset.spacer = 'false';

        const monthHeader = document.createElement('div');
        monthHeader.className = 'timeline-month-header';
        monthHeader.textContent = `${MONTH_NAMES[month - 1]} ${year}`;
        chunk.appendChild(monthHeader);

        for (const { day, items } of dayGroups) {
            chunk.appendChild(this._renderDayGroup(day, items));
        }

        if (dayGroups.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'padding:16px;color:#888;font-size:12px';
            empty.textContent = 'No photos this month.';
            chunk.appendChild(empty);
        }

        // Sentinels for IntersectionObserver
        const topSentinel = document.createElement('div');
        topSentinel.className = 'timeline-sentinel-top';
        topSentinel.dataset.month = key;
        const bottomSentinel = document.createElement('div');
        bottomSentinel.className = 'timeline-sentinel-bottom';
        bottomSentinel.dataset.month = key;
        chunk.prepend(topSentinel);
        chunk.appendChild(bottomSentinel);

        return chunk;
    }

    _renderDayGroup(day, items) {
        const wrap = document.createElement('div');
        wrap.className = 'timeline-day';

        const header = document.createElement('div');
        header.className = 'timeline-day-header';
        const d = new Date(day + 'T12:00:00Z');
        header.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        wrap.appendChild(header);

        const thumbsRow = document.createElement('div');
        thumbsRow.className = 'standalone-photos'; // reuse existing CSS
        wrap.appendChild(thumbsRow);

        for (const item of items) {
            if (item.type === 'series') {
                thumbsRow.appendChild(this._renderSeriesThumb(item.series));
            } else {
                // item.type === 'standalone'
                for (const photo of item.photos) {
                    thumbsRow.appendChild(this._renderThumb(photo));
                }
            }
        }
        return wrap;
    }

    _renderSeriesThumb(series) {
        const firstPhoto = series.photos[0];
        const wrap = document.createElement('div');
        wrap.className = 'photo-thumb photo-thumb--series';
        const img = document.createElement('img');
        img.src = `/api/thumb/${firstPhoto.file_id}`;
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = function() { this.style.background = '#333'; this.removeAttribute('src'); };
        const badge = document.createElement('span');
        badge.className = 'series-count-badge';
        badge.textContent = series.photos.length;
        wrap.appendChild(img);
        wrap.appendChild(badge);
        wrap.addEventListener('click', () => this._onSeriesClick(series, series.photos[0].folder_id, 0));
        return wrap;
    }

    _renderThumb(photo) {
        const wrap = document.createElement('div');
        wrap.className = 'photo-thumb' + (photo.item_type === 'video' ? ' photo-thumb--video' : '');
        const img = document.createElement('img');
        img.src = `/api/thumb/${photo.file_id}`;
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = function() { this.style.background = '#333'; this.removeAttribute('src'); };
        wrap.appendChild(img);
        wrap.addEventListener('click', () => this._onPhotoClick(photo, null));
        return wrap;
    }

    _renderScrubber() {
        this._scrubberEl.innerHTML = '';
        const months = Object.keys(this._monthIndex)
            .filter(k => this._monthIndex[k] > 0)
            .sort()
            .reverse();

        let lastYear = null;
        for (const key of months) {
            const [y, m] = key.split('-').map(Number);
            if (y !== lastYear) {
                const yearEl = document.createElement('div');
                yearEl.className = 'scrubber-year';
                yearEl.textContent = y;
                this._scrubberEl.appendChild(yearEl);
                lastYear = y;
            }
            const monthEl = document.createElement('div');
            monthEl.className = 'scrubber-month';
            monthEl.dataset.key = key;
            monthEl.textContent = MONTH_NAMES[m - 1];
            monthEl.addEventListener('click', () => {
                navigate(buildTimeRoute(y, m));
                this._jumpToMonth(y, m);
            });
            this._scrubberEl.appendChild(monthEl);
        }
    }

    _updateScrubberActive(key) {
        for (const el of this._scrubberEl.querySelectorAll('.scrubber-month')) {
            el.classList.toggle('scrubber-month--active', el.dataset.key === key);
        }
    }

    async _jumpToMonth(year, month) {
        await this._loadAndReplaceMonth(year, month);
        const key = `${year}-${String(month).padStart(2,'0')}`;
        const target = this._scrollEl.querySelector(`[data-month="${key}"]`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._updateScrubberActive(key);
    }

    _setupObserver() {
        if (this._observer) this._observer.disconnect();
        this._observer = new IntersectionObserver(async (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const el = entry.target;
                const [y, m] = el.dataset.month.split('-').map(Number);
                const key = el.dataset.month;

                if (el.classList.contains('timeline-sentinel-bottom')) {
                    // Load next month (older — lower in sort order)
                    const months = Object.keys(this._monthIndex).filter(k => this._monthIndex[k] > 0).sort();
                    const idx = months.indexOf(key);
                    if (idx > 0) {
                        const [ny, nm] = months[idx - 1].split('-').map(Number);
                        await this._loadAndReplaceMonth(ny, nm);
                    }
                }
                if (el.classList.contains('timeline-sentinel-top')) {
                    // Load prev month (newer — higher in sort order)
                    const months = Object.keys(this._monthIndex).filter(k => this._monthIndex[k] > 0).sort();
                    const idx = months.indexOf(key);
                    if (idx < months.length - 1) {
                        const [ny, nm] = months[idx + 1].split('-').map(Number);
                        await this._loadAndReplaceMonth(ny, nm);
                    }
                    // Update active scrubber month as user scrolls
                    this._updateScrubberActive(key);
                    this._currentYear = y;
                    this._currentMonth = m;
                }
            }
        }, { root: this._scrollEl, threshold: 0.1 });

        for (const sentinel of this._scrollEl.querySelectorAll('.timeline-sentinel-top, .timeline-sentinel-bottom')) {
            this._observer.observe(sentinel);
        }
    }
}
