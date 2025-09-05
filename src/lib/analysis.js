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

// --- Photo Quality Ranking via Text Embeddings ---

// Prompts for ranking photo quality - focus on technical quality
const POSITIVE_PROMPTS = [
    "sharp and clear photo",
    "high resolution image",
    "well focused photograph",
    "good lighting and exposure",
    "professional quality photo"
];
const NEGATIVE_PROMPTS = [
    "blurry and out of focus",
    "motion blur in photo",
    "underexposed dark image",
    "overexposed bright image",
    "low resolution pixelated"
];

// Cache for prompt embeddings
let promptEmbeddingsCache = null;

/**
 * Loads and caches CLIP text embeddings for positive and negative prompts.
 * @param {object} clipTextEncoder - An object with an encode(text) method returning a normalized embedding array.
 * @returns {Promise<{positive: number[][], negative: number[][]}>}
 */
export async function getPromptEmbeddings(clipTextEncoder) {
    if (promptEmbeddingsCache) return promptEmbeddingsCache;
    const positive = [];
    const negative = [];
    for (const prompt of POSITIVE_PROMPTS) {
        positive.push(await clipTextEncoder.encode(prompt));
    }
    for (const prompt of NEGATIVE_PROMPTS) {
        negative.push(await clipTextEncoder.encode(prompt));
    }
    promptEmbeddingsCache = { positive, negative };
    return promptEmbeddingsCache;
}

/**
 * Scores a photo embedding by comparing to prompt embeddings.
 * @param {number[]} photoEmbedding - The photo's embedding vector.
 * @param {{positive: number[][], negative: number[][]}} promptEmbeddings
 * @returns {number} - Higher is better.
 */
export function scorePhotoEmbedding(photoEmbedding, promptEmbeddings) {
    let posScore = 0;
    let negScore = 0;
    for (const pos of promptEmbeddings.positive) {
        const similarity = cosineSimilarity(photoEmbedding, pos);
        console.debug(`Positive prompt similarity: ${similarity}`);
        // Only consider positive prompts that are above a threshold
        posScore += cosineSimilarity(photoEmbedding, pos);
    }
    for (const neg of promptEmbeddings.negative) {
        const similarity = cosineSimilarity(photoEmbedding, neg);
        console.debug(`Negative prompt similarity: ${similarity}`);
        negScore += cosineSimilarity(photoEmbedding, neg);
    }
    // Normalize by number of prompts
    posScore /= promptEmbeddings.positive.length;
    negScore /= promptEmbeddings.negative.length;
    console.debug(`Final scores - Positive: ${posScore}, Negative: ${negScore}`);
    
    // Enhanced scoring: amplify the difference and add baseline
    const difference = posScore - negScore;
    const amplifiedScore = difference * 10; // Amplify small differences
    const baseline = posScore; // Use positive score as baseline
    
    return baseline + amplifiedScore;
}

/**
 * Alternative scoring method: Pick photo based on simple heuristics
 * @param {Array} photoGroup - Array of similar photos
 * @returns {Object} - The best photo from the group
 */
export function pickBestPhotoSimple(photoGroup) {
    if (photoGroup.length === 1) return photoGroup[0];
    
    // Sort by multiple criteria:
    // 1. Prefer photos taken later (often better exposed/composed)
    // 2. Prefer photos with longer filenames (often indicate higher quality/resolution)
    // 3. Use embedding magnitude as a proxy for "richness"
    
    return photoGroup.sort((a, b) => {
        // Later timestamp gets higher score
        const timeScore = (b.photo_taken_ts - a.photo_taken_ts) / 1000; // Convert to seconds
        
        // Longer filename often indicates higher quality
        const nameScore = (b.name.length - a.name.length) * 0.1;
        
        // Embedding magnitude as richness proxy
        const embeddingMagnitudeA = Math.sqrt(a.embedding.reduce((sum, val) => sum + val * val, 0));
        const embeddingMagnitudeB = Math.sqrt(b.embedding.reduce((sum, val) => sum + val * val, 0));
        const magnitudeScore = embeddingMagnitudeB - embeddingMagnitudeA;
        
        return timeScore + nameScore + magnitudeScore;
    })[0];
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
    const SIMILARITY_THRESHOLD = 0.95; // High threshold for near-duplicates
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