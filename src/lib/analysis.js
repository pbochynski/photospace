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
 * Estimate sharpness using Laplacian variance (higher = sharper).
 * @param {HTMLImageElement} img
 * @returns {number}
 */
export function estimateSharpness(img) {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    // Convert to grayscale and apply simple Laplacian
    let sum = 0, sumSq = 0, count = 0;
    for (let i = 0; i < imageData.length; i += 4) {
        const gray = 0.299 * imageData[i] + 0.587 * imageData[i+1] + 0.114 * imageData[i+2];
        sum += gray;
        sumSq += gray * gray;
        count++;
    }
    const mean = sum / count;
    return (sumSq / count) - (mean * mean); // variance
}

/**
 * Estimate exposure balance (0 = very dark, 1 = very bright, ~0.5 = good).
 * @param {HTMLImageElement} img
 * @returns {number}
 */
export function estimateExposure(img) {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    let brightnessSum = 0;
    let count = 0;
    for (let i = 0; i < imageData.length; i += 4) {
        const gray = 0.299 * imageData[i] + 0.587 * imageData[i+1] + 0.114 * imageData[i+2];
        brightnessSum += gray;
        count++;
    }
    const meanBrightness = brightnessSum / count;
    return meanBrightness / 255; // normalize [0,1]
}

/**
 * Calculate overall quality score based on sharpness and exposure.
 * @param {number} sharpness - Laplacian variance
 * @param {number} exposure - Normalized brightness [0,1]
 * @returns {number} - Higher is better quality
 */
export function calculateQualityScore(sharpness, exposure) {
    // Normalize sharpness (typical range varies, so we use relative scoring)
    const sharpnessScore = Math.min(sharpness / 1000, 1); // Cap at 1000 for normalization
    
    // Exposure score: penalize very dark (<0.2) and very bright (>0.8)
    let exposureScore;
    if (exposure < 0.2) {
        exposureScore = exposure / 0.2; // Linear scale from 0 to 1
    } else if (exposure > 0.8) {
        exposureScore = (1 - exposure) / 0.2; // Linear scale from 1 to 0
    } else {
        exposureScore = 1; // Perfect exposure range
    }
    
    // Weighted combination: sharpness is more important than exposure
    return (sharpnessScore * 0.7) + (exposureScore * 0.3);
}

/**
 * Analyzes photo quality using image processing techniques.
 * @param {string} fileId - OneDrive file ID
 * @param {function} getAuthToken - Function to get auth token
 * @returns {Promise<{sharpness: number, exposure: number, qualityScore: number}>}
 */
export async function analyzePhotoQuality(fileId, getAuthToken) {
    try {
        // Fetch the image through the Graph API to avoid CORS issues
        const blobUrl = await fetchThumbnailAsBlobURL(fileId, getAuthToken);
        if (!blobUrl) {
            console.error('Failed to fetch image blob for quality analysis');
            return { sharpness: 0, exposure: 0.5, qualityScore: 0 };
        }
        
        return new Promise((resolve, reject) => {
            const img = new Image();
            
            img.onload = () => {
                try {
                    const sharpness = estimateSharpness(img);
                    const exposure = estimateExposure(img);
                    const qualityScore = calculateQualityScore(sharpness, exposure);
                    
                    // Clean up blob URL
                    URL.revokeObjectURL(blobUrl);
                    
                    resolve({ sharpness, exposure, qualityScore });
                } catch (error) {
                    console.error('Error analyzing image quality:', error);
                    URL.revokeObjectURL(blobUrl);
                    resolve({ sharpness: 0, exposure: 0.5, qualityScore: 0 }); // Fallback
                }
            };
            
            img.onerror = () => {
                console.error('Failed to load image for quality analysis:', blobUrl);
                URL.revokeObjectURL(blobUrl);
                resolve({ sharpness: 0, exposure: 0.5, qualityScore: 0 }); // Fallback
            };
            
            img.src = blobUrl;
        });
    } catch (error) {
        console.error('Error in analyzePhotoQuality:', error);
        return { sharpness: 0, exposure: 0.5, qualityScore: 0 };
    }
}

/**
 * Fetch thumbnail as blob URL using Graph API with auth token
 * @param {string} fileId - OneDrive file ID
 * @param {function} getAuthToken - Function to get auth token
 * @returns {Promise<string|null>} - Blob URL or null on failure
 */
async function fetchThumbnailAsBlobURL(fileId, getAuthToken) {
    const url = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/thumbnails/0/large/content`;
    try {
        // For binary content, we need the Response object, not parsed JSON
        let token = await getAuthToken();
        let options = {
            headers: {
                Authorization: `Bearer ${token}`
            }
        };
        let response = await fetch(url, options);
        
        // Handle token refresh for binary content
        if ((response.status === 401 || response.status === 403)) {
            token = await getAuthToken(true); // force refresh
            options.headers['Authorization'] = `Bearer ${token}`;
            response = await fetch(url, options);
        }
        
        if (!response.ok) {
            throw new Error(`Graph API error fetching thumbnail: ${response.statusText}`);
        }
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    } catch (error) {
        console.error(`Failed to fetch thumbnail for ${fileId}:`, error);
        return null; // Return null on failure
    }
}

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