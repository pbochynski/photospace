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

// Prompts for ranking photo quality
const POSITIVE_PROMPTS = [
    "professional photo",
    "good composition",
    "sharp focus",
    "well exposed",
    "vivid colors",
    "photo art",
    "high quality",
    "aesthetic photo",
    "clear subject",
    "well lit"
];
const NEGATIVE_PROMPTS = [
    "blurry photo",
    "out of focus",
    "bad exposure",
    "overexposed",
    "underexposed",
    "poor composition",
    "low quality",
    "noisy photo",
    "dark photo",
    "unintentional photo"
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
    return posScore - negScore;
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
    const SIMILARITY_THRESHOLD = 0.90; // High threshold for near-duplicates
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