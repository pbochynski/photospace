import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from '@huggingface/transformers';
import HumanModule from '@vladmandic/human';

// Handle Human library default export in ESM
const Human = HumanModule.default || HumanModule;

// Configure transformers.js for Node.js environment
env.allowLocalModels = true;
env.allowRemoteModels = true; // Allow downloading models from Hugging Face
env.useBrowserCache = false;
env.backends.onnx.wasm.numThreads = 4; // Use multiple CPU threads

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Model instances (singleton pattern)
let clipModel = null;
let clipProcessor = null;
let humanInstance = null;
let modelsLoaded = false;

// --- Photo Quality Analysis Functions (from worker.js) ---

/**
 * Estimate sharpness using Laplacian operator for edge detection
 */
function estimateSharpness(rawImage) {
    const { data, width, height, channels } = rawImage;
    
    // Convert to grayscale array
    const gray = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * channels;
            gray[y * width + x] = channels >= 3 
                ? 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
                : data[idx];
        }
    }
    
    // Apply Laplacian kernel
    let laplacianSum = 0;
    let edgePixels = 0;
    const threshold = 10;
    
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const laplacian = Math.abs(
                -4 * gray[idx] +
                gray[idx - 1] +
                gray[idx + 1] +
                gray[idx - width] +
                gray[idx + width]
            );
            
            laplacianSum += laplacian;
            if (laplacian > threshold) {
                edgePixels++;
            }
        }
    }
    
    const totalPixels = (width - 2) * (height - 2);
    const meanLaplacian = laplacianSum / totalPixels;
    const edgeDensity = edgePixels / totalPixels;
    
    return meanLaplacian * (0.3 + 0.7 * edgeDensity);
}

/**
 * Estimate exposure quality using histogram analysis
 */
function estimateExposure(rawImage) {
    const { data, width, height, channels } = rawImage;
    
    const histogram = new Array(256).fill(0);
    let brightnessSum = 0;
    let count = 0;
    
    for (let i = 0; i < data.length; i += channels) {
        const gray = channels >= 3 
            ? Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2])
            : Math.round(data[i]);
            
        histogram[Math.min(255, Math.max(0, gray))]++;
        brightnessSum += gray;
        count++;
    }
    
    const meanBrightness = brightnessSum / count / 255;
    
    // Calculate clipping
    const clippingThreshold = count * 0.01;
    const shadowClipping = (histogram[0] + histogram[1] + histogram[2]) / count;
    const highlightClipping = (histogram[255] + histogram[254] + histogram[253]) / count;
    const totalClipping = shadowClipping + highlightClipping;
    
    // Calculate dynamic range
    let firstNonZero = 0, lastNonZero = 255;
    for (let i = 0; i < 256; i++) {
        if (histogram[i] > clippingThreshold) {
            firstNonZero = i;
            break;
        }
    }
    for (let i = 255; i >= 0; i--) {
        if (histogram[i] > clippingThreshold) {
            lastNonZero = i;
            break;
        }
    }
    const dynamicRange = (lastNonZero - firstNonZero) / 255;
    
    // Calculate entropy
    let entropy = 0;
    for (let i = 0; i < 256; i++) {
        if (histogram[i] > 0) {
            const p = histogram[i] / count;
            entropy -= p * Math.log2(p);
        }
    }
    const normalizedEntropy = entropy / 8;
    
    return {
        meanBrightness,
        clipping: totalClipping,
        dynamicRange,
        entropy: normalizedEntropy
    };
}

/**
 * Analyze face quality using Human library
 */
async function analyzeFaceQuality(tensor, humanInstance) {
    try {
        // Human library in Node.js requires TensorFlow tensor as input
        const result = await humanInstance.detect(tensor);
        
        console.log(`Face detection: ${result.face ? result.face.length : 0} faces found`);
        
        if (!result.face || result.face.length === 0) {
            return { faceScore: 0, faceCount: 0, details: null };
        }
        
        let totalFaceScore = 0;
        const faceDetails = [];
        
        for (const face of result.face) {
            let faceScore = 0;
            let factorsCount = 0;
            const details = {};
            
            // Eyes open score
            if (face.annotations?.leftEye && face.annotations?.rightEye) {
                const leftEyeOpen = face.annotations.leftEye.length > 0 ? 1 : 0;
                const rightEyeOpen = face.annotations.rightEye.length > 0 ? 1 : 0;
                const eyesScore = (leftEyeOpen + rightEyeOpen) / 2;
                const validEyesScore = isFinite(eyesScore) ? eyesScore : 0.5;
                details.eyesOpen = validEyesScore;
                faceScore += validEyesScore;
                factorsCount++;
            }
            
            // Smile detection
            if (face.emotion) {
                const smileScore = face.emotion.find(e => e.emotion === 'happy')?.score || 0;
                const validSmileScore = isFinite(smileScore) ? Math.min(Math.max(0, smileScore), 1) : 0;
                details.smile = validSmileScore;
                faceScore += validSmileScore;
                factorsCount++;
            }
            
            // Natural expression
            if (face.emotion) {
                const negativeEmotions = ['angry', 'disgusted', 'fearful', 'sad'];
                let negativeScore = 0;
                negativeEmotions.forEach(emotion => {
                    const score = face.emotion.find(e => e.emotion === emotion)?.score || 0;
                    negativeScore += isFinite(score) ? score : 0;
                });
                
                const naturalScore = Math.max(0, Math.min(1, 1 - negativeScore));
                const validNaturalScore = isFinite(naturalScore) ? naturalScore : 0.5;
                details.naturalExpression = validNaturalScore;
                faceScore += validNaturalScore;
                factorsCount++;
            }
            
            // Face detection confidence
            if (face.score !== undefined && isFinite(face.score)) {
                const validConfidence = Math.min(Math.max(0, face.score), 1);
                details.confidence = validConfidence;
                faceScore += validConfidence;
                factorsCount++;
            }
            
            // Face size
            if (face.box && isFinite(face.box.width) && isFinite(face.box.height)) {
                const faceArea = face.box.width * face.box.height;
                const normalizedSize = Math.min(1, faceArea / (224 * 224 * 0.1));
                const validNormalizedSize = isFinite(normalizedSize) ? normalizedSize : 0.5;
                details.faceSize = validNormalizedSize;
                faceScore += validNormalizedSize;
                factorsCount++;
            }
            
            const avgFaceScore = factorsCount > 0 ? faceScore / factorsCount : 0;
            const validFaceScore = isFinite(avgFaceScore) ? avgFaceScore : 0;
            totalFaceScore += validFaceScore;
            faceDetails.push(details);
        }
        
        const avgFaceScore = result.face.length > 0 ? totalFaceScore / result.face.length : 0;
        const validAvgFaceScore = Math.min(Math.max(0, isFinite(avgFaceScore) ? avgFaceScore : 0), 1);
        
        return {
            faceScore: validAvgFaceScore,
            faceCount: result.face.length,
            details: faceDetails
        };
    } catch (error) {
        console.warn('Face analysis failed:', error);
        return { faceScore: 0, faceCount: 0, details: null };
    }
}

/**
 * Calculate overall quality score
 */
function calculateQualityScore(sharpness, exposureMetrics, faceMetrics = null) {
    const sharpnessScore = Math.min(Math.max(0, sharpness / 30), 1);
    
    const { meanBrightness, clipping, dynamicRange, entropy } = exposureMetrics;
    
    const validBrightness = isFinite(meanBrightness) ? meanBrightness : 0.5;
    const validClipping = isFinite(clipping) ? clipping : 0;
    const validDynamicRange = isFinite(dynamicRange) ? dynamicRange : 0.5;
    const validEntropy = isFinite(entropy) ? entropy : 0.5;
    
    const brightnessScore = 1 - Math.min(1, Math.abs(validBrightness - 0.5) * 2);
    const clippingScore = validClipping < 0.05 ? 1 : Math.max(0, 1 - (validClipping - 0.05) * 10);
    const dynamicRangeScore = Math.min(validDynamicRange / 0.6, 1);
    const entropyScore = validEntropy;
    
    const exposureScore = (
        brightnessScore * 0.3 +
        clippingScore * 0.3 +
        dynamicRangeScore * 0.2 +
        entropyScore * 0.2
    );
    
    let finalScore;
    if (faceMetrics && faceMetrics.faceCount > 0 && isFinite(faceMetrics.faceScore)) {
        finalScore = (
            sharpnessScore * 0.35 +
            exposureScore * 0.30 +
            faceMetrics.faceScore * 0.35
        );
    } else {
        finalScore = (
            sharpnessScore * 0.55 +
            exposureScore * 0.45
        );
    }
    
    return Math.min(Math.max(0, isFinite(finalScore) ? finalScore : 0.5), 1);
}

// --- Model Loading ---

async function loadModels() {
    if (modelsLoaded) return;
    
    console.log('Loading models...');
    
    try {
        // Load CLIP model from Hugging Face
        console.log('Loading CLIP model from Hugging Face (this may take a few minutes on first run)...');
        const modelId = 'Xenova/clip-vit-base-patch16';
        
        clipModel = await CLIPVisionModelWithProjection.from_pretrained(modelId, {
            device: 'cpu',
            dtype: 'fp32',
            // Model will be cached locally after first download
            cache_dir: './models_cache'
        });
        clipProcessor = await AutoProcessor.from_pretrained(modelId, {
            cache_dir: './models_cache'
        });
        console.log('CLIP model loaded successfully (cached locally for future use)');
        
        // Load Human library
        console.log('Loading Human library...');
        const humanConfig = {
            backend: 'tensorflow',
            modelBasePath: 'https://cdn.jsdelivr.net/npm/@vladmandic/human/models',
            face: {
                enabled: true,
                detector: { 
                    enabled: true, 
                    rotation: false,
                    maxDetected: 20,
                    minConfidence: 0.5,
                    iouThreshold: 0.4,
                    return: true
                },
                mesh: { enabled: true },
                iris: { enabled: false },
                description: { enabled: false },
                emotion: { 
                    enabled: true,
                    minConfidence: 0.3
                }
            },
            body: { enabled: false },
            hand: { enabled: false },
            gesture: { enabled: false },
            object: { enabled: false }
        };
        humanInstance = new Human(humanConfig);
        await humanInstance.load();
        console.log('Human library loaded successfully');
        
        modelsLoaded = true;
        console.log('All models loaded and ready!');
    } catch (error) {
        console.error('Failed to load models:', error);
        throw error;
    }
}

// --- API Endpoints ---

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        modelsLoaded,
        timestamp: new Date().toISOString()
    });
});

// Helper: fetch with auto token refresh and throttling handling
async function fetchGraphWithRetry(url, token, retry = true) {
    let options = {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    };
    
    let response = await fetch(url, options);
    
    // Handle unauthorized - client should refresh token
    if ((response.status === 401 || response.status === 403) && retry) {
        return { error: 'unauthorized', status: response.status };
    }
    
    // Handle throttling
    if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '2');
        console.warn(`Throttled by Graph API. Waiting ${retryAfter} seconds before retry.`);
        await new Promise(res => setTimeout(res, retryAfter * 1000));
        return fetchGraphWithRetry(url, token, false); // Retry once
    }
    
    if (!response.ok) {
        const errorText = await response.text();
        return { 
            error: errorText || `HTTP error! status: ${response.status}`, 
            status: response.status 
        };
    }
    
    return { data: await response.json(), status: response.status };
}

// Helper: fetch with retry for throttling
async function fetchWithThrottleRetry(url, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const response = await fetch(url);
        
        // Handle throttling
        if (response.status === 429) {
            const retryAfter = parseInt(response.headers.get('Retry-After') || '2');
            console.warn(`Throttled fetching ${url}. Waiting ${retryAfter} seconds (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(res => setTimeout(res, retryAfter * 1000));
            continue;
        }
        
        return response;
    }
    
    // Final attempt without retry
    return await fetch(url);
}

/**
 * Generate embedding and quality metrics from image buffer and RawImage
 * @param {Buffer} imageBuffer - Image data as buffer
 * @param {RawImage} rawImage - Image as RawImage object
 * @param {boolean} includeFaceDetection - Whether to include face detection (slower)
 * @returns {Promise<Object>} - Embedding and quality metrics
 */
async function generateEmbeddingFromImage(imageBuffer, rawImage, includeFaceDetection = false) {
    // Ensure models are loaded
    if (!modelsLoaded) {
        await loadModels();
    }
    
    // Calculate quality metrics
    const sharpness = estimateSharpness(rawImage);
    const exposureMetrics = estimateExposure(rawImage);
    
    // Analyze face quality (optional, slower)
    let faceMetrics = null;
    if (includeFaceDetection && humanInstance) {
        try {
            // Convert image buffer to TensorFlow tensor
            const tensor = humanInstance.tf.tidy(() => {
                const decode = humanInstance.tf.node.decodeImage(imageBuffer, 3);
                let expand;
                if (decode.shape[2] === 4) {
                    // RGBA to RGB conversion
                    const channels = humanInstance.tf.split(decode, 4, 2);
                    const rgb = humanInstance.tf.stack([channels[0], channels[1], channels[2]], 2);
                    expand = humanInstance.tf.reshape(rgb, [1, decode.shape[0], decode.shape[1], 3]);
                } else {
                    expand = humanInstance.tf.expandDims(decode, 0);
                }
                return humanInstance.tf.cast(expand, 'float32');
            });
            
            faceMetrics = await analyzeFaceQuality(tensor, humanInstance);
            humanInstance.tf.dispose(tensor);
        } catch (faceError) {
            console.warn(`Face detection failed:`, faceError.message);
        }
    }
    
    const qualityScore = calculateQualityScore(sharpness, exposureMetrics, faceMetrics);
    
    // Generate embedding
    const image_inputs = await clipProcessor(rawImage);
    const { image_embeds } = await clipModel(image_inputs);
    const normalized_embeds = image_embeds.normalize();
    const embedding = normalized_embeds.tolist()[0];
    
    return {
        embedding,
        qualityScore,
        qualityMetrics: {
            sharpness,
            exposure: exposureMetrics,
            face: faceMetrics
        }
    };
}

/**
 * Fetch image from URL and prepare for processing
 * @param {string} thumbnailUrl - URL of the thumbnail
 * @returns {Promise<Object>} - { imageBlob, imageBuffer, rawImage }
 */
async function fetchAndPrepareImage(thumbnailUrl) {
    const imageResponse = await fetchWithThrottleRetry(thumbnailUrl);
    if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
    }
    
    const imageBlob = await imageResponse.blob();
    const imageBuffer = Buffer.from(await imageBlob.arrayBuffer());
    const rawImage = await RawImage.fromBlob(imageBlob);
    
    return { imageBlob, imageBuffer, rawImage };
}

/**
 * Process photo and add embedding (used by /children endpoint)
 * @param {Object} photo - Photo item from Graph API
 * @param {string} thumbnailUrl - URL of the thumbnail
 * @returns {Promise<Object>} - Photo with embedding added
 */
async function processPhotoForEmbedding(photo, thumbnailUrl) {
    try {
        const { imageBuffer, rawImage } = await fetchAndPrepareImage(thumbnailUrl);
        const result = await generateEmbeddingFromImage(imageBuffer, rawImage, false);
        
        return {
            ...photo,
            ...result
        };
    } catch (error) {
        console.error(`Error processing photo ${photo.name}:`, error.message);
        return { ...photo, embedding: null, embeddingError: error.message };
    }
}

// Proxy endpoint for Microsoft Graph /children with automatic embedding generation
app.get('/children/:folderId', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { folderId } = req.params;
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ 
                error: 'Missing or invalid Authorization header. Expected: Bearer <token>' 
            });
        }
        
        const token = authHeader.substring(7); // Remove 'Bearer ' prefix
        
        // Build Graph API URL with query parameters
        const graphUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children?$expand=thumbnails`;
        
        console.log(`Proxying request to Graph API for folder: ${folderId}`);
        
        // Fetch from Graph API with retry/throttling handling
        const result = await fetchGraphWithRetry(graphUrl, token);
        
        if (result.error) {
            if (result.status === 401 || result.status === 403) {
                return res.status(result.status).json({ 
                    error: 'Unauthorized. Token may be expired.' 
                });
            }
            return res.status(result.status || 500).json({ 
                error: result.error 
            });
        }
        
        const graphData = result.data;
        
        // Process photos and generate embeddings
        console.log(`Processing ${graphData.value.length} items from Graph API response`);
        
        // Process photos with controlled concurrency to avoid overwhelming the service
        const processedItems = [];
        const BATCH_SIZE = 5; // Process 5 photos at a time
        
        for (let i = 0; i < graphData.value.length; i += BATCH_SIZE) {
            const batch = graphData.value.slice(i, i + BATCH_SIZE);
            
            const batchResults = await Promise.all(
                batch.map(async (item) => {
                    // Only process photos, return folders as-is
                    if (item.photo && item.thumbnails && item.thumbnails.length > 0) {
                        const thumbnailUrl = item.thumbnails[0]?.large?.url || 
                                            item.thumbnails[0]?.medium?.url || 
                                            item.thumbnails[0]?.small?.url;
                        
                        if (thumbnailUrl) {
                            console.log(`Processing photo: ${item.name}`);
                            return await processPhotoForEmbedding(item, thumbnailUrl);
                        }
                    }
                    
                    // Return non-photo items unchanged
                    return item;
                })
            );
            
            processedItems.push(...batchResults);
        }
        
        // Replace original items with processed items
        const responseData = {
            ...graphData,
            value: processedItems
        };
        
        const processingTime = Date.now() - startTime;
        console.log(`Completed processing folder ${folderId} in ${processingTime}ms`);
        
        // Add custom header to indicate embeddings were processed
        res.setHeader('X-Embeddings-Processed', 'true');
        res.setHeader('X-Processing-Time-Ms', processingTime.toString());
        
        res.json(responseData);
        
    } catch (error) {
        console.error('Error in /children endpoint:', error);
        res.status(500).json({ 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Process image endpoint
app.post('/process-image', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { thumbnailUrl, fileId } = req.body;
        
        if (!thumbnailUrl || !fileId) {
            return res.status(400).json({ 
                error: 'Missing required parameters: thumbnailUrl and fileId' 
            });
        }
        
        console.log(`Processing image: ${fileId}`);
        
        // Fetch and prepare image
        console.log(`Fetching image from: ${thumbnailUrl}`);
        const { imageBlob, imageBuffer, rawImage } = await fetchAndPrepareImage(thumbnailUrl);
        console.log(`Image fetched, size: ${imageBlob.size} bytes`);
        console.log(`RawImage created: ${rawImage.width}x${rawImage.height}`);
        
        // Generate embedding and quality metrics (with face detection enabled)
        console.log(`Generating embedding...`);
        const result = await generateEmbeddingFromImage(imageBuffer, rawImage, true);
        console.log(`Embedding generated, length: ${result.embedding.length}`);
        
        const processingTime = Date.now() - startTime;
        console.log(`Processing complete for ${fileId} in ${processingTime}ms`);
        
        res.json({
            fileId,
            embedding: result.embedding,
            qualityMetrics: {
                sharpness: result.qualityMetrics.sharpness,
                exposure: result.qualityMetrics.exposure,
                face: result.qualityMetrics.face,
                qualityScore: result.qualityScore
            },
            processingTime
        });
        
    } catch (error) {
        console.error('Error processing image:', error);
        res.status(500).json({ 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Start server
app.listen(PORT, async () => {
    console.log(`\n🚀 Photospace Embedding Server`);
    console.log(`📡 Server listening on http://localhost:${PORT}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  /health                    - Health check`);
    console.log(`  GET  /children/:folderId        - Proxy Graph API with embeddings`);
    console.log(`  POST /process-image             - Process image and generate embeddings`);
    console.log(`\n📥 Loading models in background...`);
    console.log(`   (First run: ~3-5 min to download from Hugging Face)`);
    console.log(`   (Subsequent runs: instant from cache)`);
    
    // Pre-load models on startup
    loadModels().catch(err => {
        console.error('Failed to pre-load models:', err);
        console.log('Models will be loaded on first request');
    });
});
