function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- Photo Quality Analysis via Image Processing ---


/**
 * Pick the best photo from a group based on stored quality metrics.
 * @param {Array} photoGroup - Array of photos with quality_score
 * @returns {Object} - The best photo from the group
 */
export async function pickBestPhotoByQuality(photoGroup) {
    if (photoGroup.length === 1) return photoGroup[0];
    
    // Sort by quality score (highest first)
    // Use stored quality metrics if available, fallback to 0 for photos without quality data
    photoGroup.sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
    
    return photoGroup[0];
}

export async function findSimilarGroups(photos, progressCallback, similarityThreshold = 0.90, timeSpanHours = 8, sortMethod = 'group-size') {
    // Validate embeddings before processing
    console.log(`🔎 findSimilarGroups: Received ${photos.length} photos`);
    const photosWithValidData = photos.filter(p => {
        const hasEmbedding = p.embedding && Array.isArray(p.embedding) && p.embedding.length > 0;
        
        if (!hasEmbedding) {
            console.warn(`⚠️ Photo ${p.file_id} has no embedding:`, {
                hasEmbedding: !!p.embedding
            });
        }
        return hasEmbedding;
    });
    
    console.log(`🔎 Photos with valid embeddings: ${photosWithValidData.length}/${photos.length}`);
    
    if (photosWithValidData.length === 0) {
        console.error('❌ No photos with valid similarity data found!');
        return [];
    }
    
    // 1. Temporal Clustering (Group into sessions)
    // A session is a burst of photos taken close together in time.
    // If timeSpanHours is 0 or negative, treat all photos as one session (disable temporal clustering)
    const TIME_SPAN = timeSpanHours * 60 * 60 * 1000; // Convert hours to milliseconds
    
    // Debug: Check timestamps
    console.log('🕐 Checking photo timestamps...');
    const timestampSample = photosWithValidData.slice(0, 5).map(p => ({
        id: p.file_id?.substring(0, 8),
        photo_taken_ts: p.photo_taken_ts,
        type: typeof p.photo_taken_ts,
        date: p.photo_taken_ts ? new Date(p.photo_taken_ts).toISOString() : 'null/undefined'
    }));
    console.log('🕐 First 5 photo timestamps:', timestampSample);
    
    // Convert string timestamps to numeric timestamps for proper temporal clustering
    photosWithValidData.forEach(photo => {
        if (typeof photo.photo_taken_ts === 'string') {
            const numericTs = new Date(photo.photo_taken_ts).getTime();
            if (!isNaN(numericTs)) {
                photo.photo_taken_ts = numericTs;
            }
        }
    });
    
    // Check for missing/invalid timestamps after conversion
    const missingTimestamps = photosWithValidData.filter(p => !p.photo_taken_ts || isNaN(p.photo_taken_ts));
    if (missingTimestamps.length > 0) {
        console.warn(`⚠️ Warning: ${missingTimestamps.length}/${photosWithValidData.length} photos have invalid timestamps!`);
    }
    
    photosWithValidData.sort((a, b) => a.photo_taken_ts - b.photo_taken_ts);

    const sessions = [];
    if (timeSpanHours <= 0) {
        // Temporal clustering disabled - treat all photos as one session
        sessions.push(photosWithValidData);
        console.log(`🔎 Temporal clustering disabled - treating all ${photosWithValidData.length} photos as one session`);
    } else if (photosWithValidData.length > 0) {
        let currentSession = [photosWithValidData[0]];
        let sessionBreaks = [];
        
        for (let i = 1; i < photosWithValidData.length; i++) {
            const timeDiff = photosWithValidData[i].photo_taken_ts - photosWithValidData[i - 1].photo_taken_ts;
            const timeDiffHours = timeDiff / (60 * 60 * 1000);
            
            if (timeDiff < TIME_SPAN) {
                currentSession.push(photosWithValidData[i]);
            } else {
                // Session break - log details
                sessionBreaks.push({
                    betweenPhotos: `${i-1} → ${i}`,
                    timeDiffMs: timeDiff,
                    timeDiffHours: timeDiffHours.toFixed(2),
                    threshold: timeSpanHours
                });
                sessions.push(currentSession);
                currentSession = [photosWithValidData[i]];
            }
        }
        sessions.push(currentSession);
        console.log(`🔎 Created ${sessions.length} temporal sessions (time span: ${timeSpanHours}h)`);
        
        // Log session breaks if there are many
        if (sessionBreaks.length > 5) {
            console.log(`🕐 First 5 session breaks (out of ${sessionBreaks.length}):`, sessionBreaks.slice(0, 5));
        } else if (sessionBreaks.length > 0) {
            console.log(`🕐 Session breaks:`, sessionBreaks);
        }
        
        // Warn if temporal clustering creates too many single-photo sessions
        const singlePhotoSessions = sessions.filter(s => s.length === 1).length;
        if (singlePhotoSessions > sessions.length * 0.8) {
            console.warn(`⚠️ Warning: ${singlePhotoSessions}/${sessions.length} sessions have only 1 photo. Consider increasing the time window or disabling temporal clustering (set to 0h).`);
            console.warn(`⚠️ This usually means photos have invalid/missing timestamps, or timestamps are far apart in time.`);
        }
    }
    
    // 2. Similarity Clustering (within each session)
    // Use the configurable threshold instead of hardcoded value
    const allSimilarGroups = [];
    let totalComparisons = 0;
    let highSimilarityCount = 0;

    sessions.forEach((session, sessionIndex) => {
        if (session.length < 2) {
            console.log(`🔎 Session ${sessionIndex + 1}: Only ${session.length} photo, skipping`);
            return;
        }
        
        console.log(`🔎 Session ${sessionIndex + 1}: Processing ${session.length} photos (threshold: ${similarityThreshold})`);

        const visited = new Array(session.length).fill(false);
        let sessionGroupCount = 0;
        
        for (let i = 0; i < session.length; i++) {
            if (visited[i]) continue;
            
            const currentGroup = [session[i]];
            visited[i] = true;

            for (let j = i + 1; j < session.length; j++) {
                if (visited[j]) continue;
                
                // Calculate similarity using CLIP embeddings
                const similarity = cosineSimilarity(session[i].embedding, session[j].embedding);
                totalComparisons++;

                if (similarity > similarityThreshold) {
                    currentGroup.push(session[j]);
                    visited[j] = true;
                    highSimilarityCount++;
                    console.log(`   ✓ Similar pair found: ${similarity.toFixed(3)} > ${similarityThreshold}`);
                }
            }

            if (currentGroup.length > 1) {
                allSimilarGroups.push({
                    photos: currentGroup,
                    timestamp: currentGroup[0].photo_taken_ts,
                    similarity: similarityThreshold
                });
                sessionGroupCount++;
            }
        }
        
        console.log(`🔎 Session ${sessionIndex + 1}: Found ${sessionGroupCount} groups`);
        if (progressCallback) progressCallback((sessionIndex / sessions.length) * 100);
    });
    
    console.log(`🔎 Similarity analysis complete: ${totalComparisons} comparisons, ${highSimilarityCount} similar pairs found, ${allSimilarGroups.length} groups created`);

    // 3. Sort groups based on the selected method
    switch (sortMethod) {
        case 'group-size':
            // Sort by reduction potential (largest groups first)
            allSimilarGroups.sort((a, b) => b.photos.length - a.photos.length);
            break;
        case 'date-desc':
            // Sort by date (newest first)
            allSimilarGroups.sort((a, b) => b.timestamp - a.timestamp);
            break;
        case 'date-asc':
            // Sort by date (oldest first)
            allSimilarGroups.sort((a, b) => a.timestamp - b.timestamp);
            break;
        default:
            // Default to group size
            allSimilarGroups.sort((a, b) => b.photos.length - a.photos.length);
    }
    
    return allSimilarGroups;
}

/**
 * Find large photo series based on time density
 * @param {Array} photos - Array of photos (with or without embeddings)
 * @param {Object} options - Analysis options
 * @param {number} options.minGroupSize - Minimum number of photos in a series (default: 20)
 * @param {number} options.minDensity - Minimum photos per minute (default: 3)
 * @param {number} options.maxTimeGap - Maximum time gap in minutes between photos (default: 5)
 * @param {string} options.sortMethod - How to sort results (default: 'series-size')
 * @param {Function} progressCallback - Optional callback for progress updates
 * @returns {Promise<Array>} - Array of photo series
 */
export async function findPhotoSeries(photos, options = {}, progressCallback = null) {
    const {
        minGroupSize = 20,
        minDensity = 3, // photos per minute
        maxTimeGap = 5, // minutes
        sortMethod = 'series-size'
    } = options;
    
    console.log(`📊 findPhotoSeries: Analyzing ${photos.length} photos`);
    console.log(`📊 Parameters: minGroupSize=${minGroupSize}, minDensity=${minDensity} photos/min, maxTimeGap=${maxTimeGap} min`);
    
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
    
    // Group photos into series based on time gaps
    const maxTimeGapMs = maxTimeGap * 60 * 1000; // Convert minutes to milliseconds
    const series = [];
    let currentSeries = [photosWithTimestamps[0]];
    
    for (let i = 1; i < photosWithTimestamps.length; i++) {
        const timeDiff = photosWithTimestamps[i].photo_taken_ts - photosWithTimestamps[i - 1].photo_taken_ts;
        
        if (timeDiff <= maxTimeGapMs) {
            // Continue current series
            currentSeries.push(photosWithTimestamps[i]);
        } else {
            // End current series and start new one
            if (currentSeries.length > 0) {
                series.push(currentSeries);
            }
            currentSeries = [photosWithTimestamps[i]];
        }
        
        // Progress callback
        if (progressCallback && i % 100 === 0) {
            progressCallback((i / photosWithTimestamps.length) * 50); // First 50% is grouping
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