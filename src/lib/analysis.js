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
    const photosWithValidEmbeddings = photos.filter(p => {
        const hasEmbedding = p.embedding && Array.isArray(p.embedding) && p.embedding.length > 0;
        if (!hasEmbedding) {
            console.warn(`⚠️ Photo ${p.file_id} has invalid embedding:`, {
                hasEmbedding: !!p.embedding,
                isArray: Array.isArray(p.embedding),
                length: p.embedding?.length || 0
            });
        }
        return hasEmbedding;
    });
    
    console.log(`🔎 Photos with valid embeddings: ${photosWithValidEmbeddings.length}/${photos.length}`);
    
    if (photosWithValidEmbeddings.length === 0) {
        console.error('❌ No photos with valid embeddings found!');
        return [];
    }
    
    // 1. Temporal Clustering (Group into sessions)
    // A session is a burst of photos taken close together in time.
    // If timeSpanHours is 0 or negative, treat all photos as one session (disable temporal clustering)
    const TIME_SPAN = timeSpanHours * 60 * 60 * 1000; // Convert hours to milliseconds
    
    // Debug: Check timestamps
    console.log('🕐 Checking photo timestamps...');
    const timestampSample = photosWithValidEmbeddings.slice(0, 5).map(p => ({
        id: p.file_id?.substring(0, 8),
        photo_taken_ts: p.photo_taken_ts,
        type: typeof p.photo_taken_ts,
        date: p.photo_taken_ts ? new Date(p.photo_taken_ts).toISOString() : 'null/undefined'
    }));
    console.log('🕐 First 5 photo timestamps:', timestampSample);
    
    // Convert string timestamps to numeric timestamps for proper temporal clustering
    photosWithValidEmbeddings.forEach(photo => {
        if (typeof photo.photo_taken_ts === 'string') {
            const numericTs = new Date(photo.photo_taken_ts).getTime();
            if (!isNaN(numericTs)) {
                photo.photo_taken_ts = numericTs;
            }
        }
    });
    
    // Check for missing/invalid timestamps after conversion
    const missingTimestamps = photosWithValidEmbeddings.filter(p => !p.photo_taken_ts || isNaN(p.photo_taken_ts));
    if (missingTimestamps.length > 0) {
        console.warn(`⚠️ Warning: ${missingTimestamps.length}/${photosWithValidEmbeddings.length} photos have invalid timestamps!`);
    }
    
    photosWithValidEmbeddings.sort((a, b) => a.photo_taken_ts - b.photo_taken_ts);

    const sessions = [];
    if (timeSpanHours <= 0) {
        // Temporal clustering disabled - treat all photos as one session
        sessions.push(photosWithValidEmbeddings);
        console.log(`🔎 Temporal clustering disabled - treating all ${photosWithValidEmbeddings.length} photos as one session`);
    } else if (photosWithValidEmbeddings.length > 0) {
        let currentSession = [photosWithValidEmbeddings[0]];
        let sessionBreaks = [];
        
        for (let i = 1; i < photosWithValidEmbeddings.length; i++) {
            const timeDiff = photosWithValidEmbeddings[i].photo_taken_ts - photosWithValidEmbeddings[i - 1].photo_taken_ts;
            const timeDiffHours = timeDiff / (60 * 60 * 1000);
            
            if (timeDiff < TIME_SPAN) {
                currentSession.push(photosWithValidEmbeddings[i]);
            } else {
                // Session break - log details
                sessionBreaks.push({
                    betweenPhotos: `${i-1} → ${i}`,
                    timeDiffMs: timeDiff,
                    timeDiffHours: timeDiffHours.toFixed(2),
                    threshold: timeSpanHours
                });
                sessions.push(currentSession);
                currentSession = [photosWithValidEmbeddings[i]];
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