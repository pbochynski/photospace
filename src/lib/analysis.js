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
    // 1. Temporal Clustering (Group into sessions)
    // A session is a burst of photos taken close together in time.
    const TIME_SPAN = timeSpanHours * 60 * 60 * 1000; // Convert hours to milliseconds
    photos.sort((a, b) => a.photo_taken_ts - b.photo_taken_ts);

    const sessions = [];
    if (photos.length > 0) {
        let currentSession = [photos[0]];
        for (let i = 1; i < photos.length; i++) {
            if (photos[i].photo_taken_ts - photos[i - 1].photo_taken_ts < TIME_SPAN) {
                currentSession.push(photos[i]);
            } else {
                sessions.push(currentSession);
                currentSession = [photos[i]];
            }
        }
        sessions.push(currentSession);
    }
    
    // 2. Similarity Clustering (within each session)
    // Use the configurable threshold instead of hardcoded value
    const allSimilarGroups = [];

    sessions.forEach((session, index) => {
        if (session.length < 2) return;

        const visited = new Array(session.length).fill(false);
        for (let i = 0; i < session.length; i++) {
            if (visited[i]) continue;
            
            const currentGroup = [session[i]];
            visited[i] = true;

            for (let j = i + 1; j < session.length; j++) {
                if (visited[j]) continue;
                
                const similarity = cosineSimilarity(session[i].embedding, session[j].embedding);

                if (similarity > similarityThreshold) {
                    currentGroup.push(session[j]);
                    visited[j] = true;
                }
            }

            if (currentGroup.length > 1) {
                allSimilarGroups.push({
                    photos: currentGroup,
                    timestamp: currentGroup[0].photo_taken_ts,
                    similarity: similarityThreshold
                });
            }
        }
        if (progressCallback) progressCallback((index / sessions.length) * 100);
    });

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