export async function pickBestPhotoByQuality(photoGroup) {
    if (photoGroup.length === 1) return photoGroup[0];
    photoGroup.sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
    return photoGroup[0];
}

/**
 * Find large photo series based on time density
 * @param {Array} photos - Array of photos (with or without embeddings)
 * @param {Object} options - Analysis options
 * @param {number} options.minGroupSize - Minimum number of photos in a series (default: 20)
 * @param {number} options.minDensity - Minimum photos per minute (default: 3)
 * @param {number} options.maxTimeGap - Maximum time gap in minutes between photos (default: 5)
 * @param {string} options.sortMethod - How to sort results (default: 'series-size')
 * @param {Array} options.ignoredPeriods - Array of time periods to ignore (default: [])
 * @param {Function} progressCallback - Optional callback for progress updates
 * @returns {Promise<Array>} - Array of photo series
 */
export async function findPhotoSeries(photos, options = {}, progressCallback = null) {
    const {
        minGroupSize = 20,
        minDensity = 3, // photos per minute
        maxTimeGap = 5, // minutes
        sortMethod = 'series-size',
        ignoredPeriods = []
    } = options;

    console.log(`📊 findPhotoSeries: Analyzing ${photos.length} photos`);
    console.log(`📊 Parameters: minGroupSize=${minGroupSize}, minDensity=${minDensity} photos/min, maxTimeGap=${maxTimeGap} min`);
    if (ignoredPeriods.length > 0) {
        console.log(`📊 Ignored periods: ${ignoredPeriods.length}`);
        const formatDateTime = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const seconds = String(date.getSeconds()).padStart(2, '0');
            return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        };
        ignoredPeriods.forEach(period => {
            const startStr = formatDateTime(new Date(period.startTime));
            const endStr = formatDateTime(new Date(period.endTime));
            console.log(`   - ${period.label}`);
            console.log(`     ${startStr} → ${endStr}`);
        });
    }

    // Filter photos with valid timestamps
    const photosWithTimestamps = photos.filter(p => {
        const hasTimestamp = p.photo_taken_ts && !isNaN(new Date(p.photo_taken_ts).getTime());
        if (!hasTimestamp) {
            console.warn(`⚠️ Photo ${p.file_id} has invalid timestamp:`, p.photo_taken_ts);
        }
        return hasTimestamp;
    });

    console.log(`📊 Photos with valid timestamps: ${photosWithTimestamps.length}/${photos.length}`);

    if (photosWithTimestamps.length === 0) {
        console.error('❌ No photos with valid timestamps found!');
        return [];
    }

    // Convert timestamps to numeric if needed and sort by time
    photosWithTimestamps.forEach(photo => {
        if (typeof photo.photo_taken_ts === 'string') {
            const numericTs = new Date(photo.photo_taken_ts).getTime();
            if (!isNaN(numericTs)) {
                photo.photo_taken_ts = numericTs;
            }
        }
    });

    photosWithTimestamps.sort((a, b) => a.photo_taken_ts - b.photo_taken_ts);

    // Filter out photos in ignored periods
    let photosToAnalyze = photosWithTimestamps;
    if (ignoredPeriods.length > 0) {
        const beforeFilterCount = photosWithTimestamps.length;
        photosToAnalyze = photosWithTimestamps.filter(photo => {
            const timestamp = photo.photo_taken_ts;
            const isIgnored = ignoredPeriods.some(period =>
                timestamp >= period.startTime && timestamp <= period.endTime
            );
            return !isIgnored;
        });
        const filteredCount = beforeFilterCount - photosToAnalyze.length;
        console.log(`📊 Filtered out ${filteredCount} photos in ignored periods (${photosToAnalyze.length} remaining)`);
    }

    // Check if we have photos to analyze after filtering
    if (photosToAnalyze.length === 0) {
        console.warn('⚠️ No photos remaining after filtering ignored periods');
        return [];
    }

    // Group photos into series based on time gaps
    const maxTimeGapMs = maxTimeGap * 60 * 1000; // Convert minutes to milliseconds
    const series = [];
    let currentSeries = [photosToAnalyze[0]];

    for (let i = 1; i < photosToAnalyze.length; i++) {
        const timeDiff = photosToAnalyze[i].photo_taken_ts - photosToAnalyze[i - 1].photo_taken_ts;

        if (timeDiff <= maxTimeGapMs) {
            // Continue current series
            currentSeries.push(photosToAnalyze[i]);
        } else {
            // End current series and start new one
            if (currentSeries.length > 0) {
                series.push(currentSeries);
            }
            currentSeries = [photosToAnalyze[i]];
        }

        // Progress callback
        if (progressCallback && i % 100 === 0) {
            progressCallback((i / photosToAnalyze.length) * 50); // First 50% is grouping
        }
    }

    // Add the last series
    if (currentSeries.length > 0) {
        series.push(currentSeries);
    }

    console.log(`📊 Created ${series.length} initial series (before filtering)`);

    // Filter series by minimum size and calculate density
    const filteredSeries = [];

    for (let i = 0; i < series.length; i++) {
        const seriesPhotos = series[i];

        // Skip if too small
        if (seriesPhotos.length < minGroupSize) {
            continue;
        }

        // Calculate time span and density
        const firstPhotoTime = seriesPhotos[0].photo_taken_ts;
        const lastPhotoTime = seriesPhotos[seriesPhotos.length - 1].photo_taken_ts;
        const timeSpanMs = lastPhotoTime - firstPhotoTime;
        const timeSpanMinutes = timeSpanMs / (60 * 1000);

        // Handle edge case: all photos at same time (or very close)
        const density = timeSpanMinutes > 0
            ? seriesPhotos.length / timeSpanMinutes
            : seriesPhotos.length; // If timeSpan is 0, density is infinite (use photo count)

        // Skip if density too low
        if (density < minDensity) {
            continue;
        }

        // Calculate additional statistics
        const avgTimeBetweenPhotos = timeSpanMinutes > 0
            ? timeSpanMinutes / (seriesPhotos.length - 1)
            : 0;

        filteredSeries.push({
            photos: seriesPhotos,
            startTime: firstPhotoTime,
            endTime: lastPhotoTime,
            timeSpanMs: timeSpanMs,
            timeSpanMinutes: timeSpanMinutes,
            photoCount: seriesPhotos.length,
            density: density, // photos per minute
            avgTimeBetweenPhotos: avgTimeBetweenPhotos // minutes between photos
        });

        // Progress callback
        if (progressCallback) {
            progressCallback(50 + (i / series.length) * 50); // Second 50% is filtering
        }
    }

    console.log(`📊 After filtering: ${filteredSeries.length} series (minSize: ${minGroupSize}, minDensity: ${minDensity})`);

    // Sort results based on selected method
    switch (sortMethod) {
        case 'series-size':
            filteredSeries.sort((a, b) => b.photoCount - a.photoCount);
            break;
        case 'density':
            filteredSeries.sort((a, b) => b.density - a.density);
            break;
        case 'date-desc':
            filteredSeries.sort((a, b) => b.startTime - a.startTime);
            break;
        case 'date-asc':
            filteredSeries.sort((a, b) => a.startTime - b.startTime);
            break;
        default:
            filteredSeries.sort((a, b) => b.photoCount - a.photoCount);
    }

    // Log summary
    if (filteredSeries.length > 0) {
        console.log(`📊 Series analysis complete:`);
        console.log(`   - Total series found: ${filteredSeries.length}`);
        console.log(`   - Largest series: ${filteredSeries[0].photoCount} photos`);
        console.log(`   - Highest density: ${Math.max(...filteredSeries.map(s => s.density)).toFixed(2)} photos/min`);
    }

    return filteredSeries;
}
