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

export async function findSimilarGroups(photos, progressCallback) {
    // 1. Temporal Clustering (Group into sessions)
    // A session is a burst of photos taken close together in time.
    const ONE_HOUR = 60 * 60 * 1000;
    photos.sort((a, b) => a.photo_taken_ts - b.photo_taken_ts);

    const sessions = [];
    if (photos.length > 0) {
        let currentSession = [photos[0]];
        for (let i = 1; i < photos.length; i++) {
            if (photos[i].photo_taken_ts - photos[i - 1].photo_taken_ts < ONE_HOUR) {
                currentSession.push(photos[i]);
            } else {
                sessions.push(currentSession);
                currentSession = [photos[i]];
            }
        }
        sessions.push(currentSession);
    }
    
    // 2. Similarity Clustering (within each session)
    const SIMILARITY_THRESHOLD = 0.97; // High threshold for near-duplicates
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

                if (similarity > SIMILARITY_THRESHOLD) {
                    currentGroup.push(session[j]);
                    visited[j] = true;
                }
            }

            if (currentGroup.length > 1) {
                allSimilarGroups.push({
                    photos: currentGroup,
                    timestamp: currentGroup[0].photo_taken_ts,
                    similarity: SIMILARITY_THRESHOLD
                });
            }
        }
        if (progressCallback) progressCallback((index / sessions.length) * 100);
    });

    // 3. Rank groups by reduction potential
    allSimilarGroups.sort((a, b) => b.photos.length - a.photos.length);
    
    return allSimilarGroups;
}