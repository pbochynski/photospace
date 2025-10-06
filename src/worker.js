// Import the correct, higher-level components for vision-language models.
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2';
// Import Human library for face detection and analysis
import Human from 'https://cdn.jsdelivr.net/npm/@vladmandic/human/dist/human.esm.js';
// Worker ID for console prefixing
let workerId = 'Unknown';

// Override console in worker to send messages to main thread
const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info
};

function sendConsoleToMain(level, args) {
    // Prefix messages with worker ID
    const prefixedArgs = [`[Worker ${workerId}]`, ...args];
    
    // Send to main thread for debug console
    self.postMessage({
        type: 'console',
        level: level,
        args: prefixedArgs.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        })
    });
    
    // Also call original console with prefix
    originalConsole[level].apply(console, prefixedArgs);
}

console.log = (...args) => sendConsoleToMain('log', args);
console.error = (...args) => sendConsoleToMain('error', args);
console.warn = (...args) => sendConsoleToMain('warn', args);
console.info = (...args) => sendConsoleToMain('info', args);

// Catch worker errors
self.addEventListener('error', (event) => {
    sendConsoleToMain('error', [`Worker Error: ${event.message}`, event.filename ? `at ${event.filename}:${event.lineno}` : '']);
});

self.addEventListener('unhandledrejection', (event) => {
    sendConsoleToMain('error', [`Worker Unhandled Rejection: ${event.reason}`]);
});

// Face detection will be done using simple image analysis
// MediaPipe requires DOM access which is not available in web workers

// --- Final Configuration ---
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = true;

// Debug: Log the base URL for model loading
console.log('Worker environment:', {
    location: self.location?.href || 'unknown',
    origin: self.location?.origin || 'unknown'
});

// --- Photo Quality Analysis Functions ---

/**
 * Estimate sharpness using proper Laplacian operator for edge detection.
 * This applies a Laplacian kernel to detect edges and measures their strength.
 * @param {RawImage} rawImage - RawImage from transformers library
 * @returns {number} - Sharpness score (higher = sharper, typically 0-50+)
 */
function estimateSharpness(rawImage) {
    const { data, width, height, channels } = rawImage;
    
    // First, convert to grayscale array
    const gray = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * channels;
            gray[y * width + x] = channels >= 3 
                ? 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
                : data[idx];
        }
    }
    
    // Apply Laplacian kernel: [[0, 1, 0], [1, -4, 1], [0, 1, 0]]
    // This detects edges by measuring local intensity changes
    let laplacianSum = 0;
    let edgePixels = 0;
    const threshold = 10; // Minimum edge strength to count
    
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const laplacian = Math.abs(
                -4 * gray[idx] +
                gray[idx - 1] +      // left
                gray[idx + 1] +      // right
                gray[idx - width] +  // top
                gray[idx + width]    // bottom
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
    
    // Combine edge strength and density for final sharpness score
    // Sharp images have strong edges (high meanLaplacian) with good distribution (edgeDensity)
    return meanLaplacian * (0.3 + 0.7 * edgeDensity);
}

/**
 * Estimate exposure quality using histogram analysis.
 * Analyzes dynamic range, clipping, and brightness distribution.
 * @param {RawImage} rawImage - RawImage from transformers library
 * @returns {Object} - { score: 0-1, meanBrightness: 0-1, clipping: 0-1, dynamicRange: 0-1 }
 */
function estimateExposure(rawImage) {
    const { data, width, height, channels } = rawImage;
    
    // Build histogram (256 bins)
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
    
    const meanBrightness = brightnessSum / count / 255; // normalize [0,1]
    
    // Calculate clipping (% of pixels at extremes)
    const clippingThreshold = count * 0.01; // 1% threshold
    const shadowClipping = (histogram[0] + histogram[1] + histogram[2]) / count;
    const highlightClipping = (histogram[255] + histogram[254] + histogram[253]) / count;
    const totalClipping = shadowClipping + highlightClipping;
    
    // Calculate dynamic range (spread of histogram)
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
    const dynamicRange = (lastNonZero - firstNonZero) / 255; // 0-1
    
    // Calculate histogram entropy (distribution quality)
    let entropy = 0;
    for (let i = 0; i < 256; i++) {
        if (histogram[i] > 0) {
            const p = histogram[i] / count;
            entropy -= p * Math.log2(p);
        }
    }
    const normalizedEntropy = entropy / 8; // normalize to 0-1 (max entropy is 8 for 256 bins)
    
    return {
        meanBrightness,
        clipping: totalClipping,
        dynamicRange,
        entropy: normalizedEntropy
    };
}

/**
 * Analyze face quality using Human library.
 * Detects faces and scores them based on eyes open, smile, and natural expression.
 * @param {Canvas|ImageData} imageData - Image to analyze
 * @param {Human} humanInstance - Human library instance
 * @returns {Object} - { faceScore: 0-1, faceCount: number, details: {...} }
 */
async function analyzeFaceQuality(imageData, humanInstance) {
    try {
        const result = await humanInstance.detect(imageData);
        
        console.log(`Face detection result: ${result.face ? result.face.length : 0} faces detected`);
        
        if (!result.face || result.face.length === 0) {
            return { faceScore: 0, faceCount: 0, details: null };
        }
        
        let totalFaceScore = 0;
        const faceDetails = [];
        
        for (const face of result.face) {
            let faceScore = 0;
            let factorsCount = 0;
            const details = {};
            
            // 1. Eyes open score (both eyes should be open)
            if (face.annotations?.leftEye && face.annotations?.rightEye) {
                // Human library provides eye landmarks
                // Open eyes typically have larger vertical distance
                const leftEyeOpen = face.annotations.leftEye.length > 0 ? 1 : 0;
                const rightEyeOpen = face.annotations.rightEye.length > 0 ? 1 : 0;
                const eyesScore = (leftEyeOpen + rightEyeOpen) / 2;
                const validEyesScore = isFinite(eyesScore) ? eyesScore : 0.5;
                details.eyesOpen = validEyesScore;
                faceScore += validEyesScore;
                factorsCount++;
            }
            
            // 2. Smile detection
            if (face.emotion) {
                // Human provides emotion detection including 'happy'
                const smileScore = face.emotion.find(e => e.emotion === 'happy')?.score || 0;
                const validSmileScore = isFinite(smileScore) ? Math.min(Math.max(0, smileScore), 1) : 0;
                details.smile = validSmileScore;
                faceScore += validSmileScore;
                factorsCount++;
            }
            
            // 3. Natural expression (not extreme emotions, good confidence)
            if (face.emotion) {
                // Natural expression = balanced emotions with good confidence
                // Penalize extreme negative emotions (angry, disgusted, fearful, sad)
                const negativeEmotions = ['angry', 'disgusted', 'fearful', 'sad'];
                let negativeScore = 0;
                negativeEmotions.forEach(emotion => {
                    const score = face.emotion.find(e => e.emotion === emotion)?.score || 0;
                    negativeScore += isFinite(score) ? score : 0;
                });
                
                // Natural = low negative emotions + reasonable confidence
                const naturalScore = Math.max(0, Math.min(1, 1 - negativeScore));
                const validNaturalScore = isFinite(naturalScore) ? naturalScore : 0.5;
                details.naturalExpression = validNaturalScore;
                faceScore += validNaturalScore;
                factorsCount++;
            }
            
            // 4. Face detection confidence
            if (face.score !== undefined && isFinite(face.score)) {
                const validConfidence = Math.min(Math.max(0, face.score), 1);
                details.confidence = validConfidence;
                faceScore += validConfidence;
                factorsCount++;
            }
            
            // 5. Face size (larger faces = better quality typically)
            if (face.box && isFinite(face.box.width) && isFinite(face.box.height)) {
                const faceArea = face.box.width * face.box.height;
                // Assume image is at least 224x224 (thumbnail size)
                const normalizedSize = Math.min(1, faceArea / (224 * 224 * 0.1)); // 10% of image is good
                const validNormalizedSize = isFinite(normalizedSize) ? normalizedSize : 0.5;
                details.faceSize = validNormalizedSize;
                faceScore += validNormalizedSize;
                factorsCount++;
            }
            
            const avgFaceScore = factorsCount > 0 ? faceScore / factorsCount : 0;
            // Ensure face score is valid
            const validFaceScore = isFinite(avgFaceScore) ? avgFaceScore : 0;
            totalFaceScore += validFaceScore;
            faceDetails.push(details);
        }
        
        const avgFaceScore = result.face.length > 0 ? totalFaceScore / result.face.length : 0;
        // Ensure final score is valid and clamped to [0, 1]
        const validAvgFaceScore = Math.min(Math.max(0, isFinite(avgFaceScore) ? avgFaceScore : 0), 1);
        
        console.log(`Face analysis complete: ${result.face.length} faces processed, avg score: ${validAvgFaceScore.toFixed(3)}`);
        
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
 * Calculate overall quality score based on sharpness, exposure, and faces.
 * @param {number} sharpness - Laplacian edge detection score
 * @param {Object} exposureMetrics - Exposure analysis results
 * @param {Object} faceMetrics - Face quality analysis results
 * @returns {number} - Quality score 0-1 (higher is better)
 */
function calculateQualityScore(sharpness, exposureMetrics, faceMetrics = null) {
    // 1. Normalize sharpness score (typically 0-50+)
    // Sharp images usually score 15-40, blurry images < 10
    const sharpnessScore = Math.min(Math.max(0, sharpness / 30), 1);
    
    // 2. Calculate exposure score from multiple factors
    const { meanBrightness, clipping, dynamicRange, entropy } = exposureMetrics;
    
    // Validate all exposure metrics
    const validBrightness = isFinite(meanBrightness) ? meanBrightness : 0.5;
    const validClipping = isFinite(clipping) ? clipping : 0;
    const validDynamicRange = isFinite(dynamicRange) ? dynamicRange : 0.5;
    const validEntropy = isFinite(entropy) ? entropy : 0.5;
    
    // Optimal brightness is 0.4-0.6
    const brightnessScore = 1 - Math.min(1, Math.abs(validBrightness - 0.5) * 2);
    
    // Penalize clipping (should be < 5%)
    const clippingScore = validClipping < 0.05 ? 1 : Math.max(0, 1 - (validClipping - 0.05) * 10);
    
    // Reward good dynamic range (> 0.6 is good)
    const dynamicRangeScore = Math.min(validDynamicRange / 0.6, 1);
    
    // Entropy indicates good tonal distribution
    const entropyScore = validEntropy;
    
    // Combined exposure score
    const exposureScore = (
        brightnessScore * 0.3 +
        clippingScore * 0.3 +
        dynamicRangeScore * 0.2 +
        entropyScore * 0.2
    );
    
    // 3. Face quality score (if faces detected)
    let finalScore;
    if (faceMetrics && faceMetrics.faceCount > 0 && isFinite(faceMetrics.faceScore)) {
        // With faces: weight face quality heavily
        finalScore = (
            sharpnessScore * 0.35 +
            exposureScore * 0.30 +
            faceMetrics.faceScore * 0.35
        );
    } else {
        // Without faces: traditional quality metrics
        finalScore = (
            sharpnessScore * 0.55 +
            exposureScore * 0.45
        );
    }
    
    // Ensure final score is valid and clamped to [0, 1]
    return Math.min(Math.max(0, isFinite(finalScore) ? finalScore : 0.5), 1);
}



// Singleton pattern to ensure the models are loaded only once.
class ModelSingleton {
    static clipModel = null;
    static clipProcessor = null;
    static humanInstance = null;

    static async getInstance() {
        if (this.clipModel === null) {
            self.postMessage({ status: 'model_loading' });

            // --- Load CLIP Model ---
            let accelerator;
            if (navigator.gpu) {
                try {
                    const adapter = await navigator.gpu.requestAdapter();
                    const dtype = adapter.features.has('shader-f16') ? 'fp16' : 'fp32';
                    accelerator = { device: 'webgpu', dtype };
                    console.log(`WebGPU is available. Using device: webgpu, dtype: ${dtype}`);
                } catch (e) {
                    console.warn("WebGPU request failed, falling back to WASM.", e);
                    accelerator = { device: 'wasm' };
                }
            } else {
                console.warn("WebGPU not supported, using WASM.");
                accelerator = { device: 'wasm' };
            }

            const modelPath = '/models/clip-vit-base-patch16/';

            try {
                this.clipModel = await CLIPVisionModelWithProjection.from_pretrained(modelPath, accelerator);
                this.clipProcessor = await AutoProcessor.from_pretrained(modelPath, accelerator);
            } catch (error) {
                console.error('Model loading error:', error);
                throw error;
            }
            
            // --- Load Human Library for Face Detection ---
            try {
                const humanConfig = {
                    backend: 'webgl',
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
                this.humanInstance = new Human(humanConfig);
                await this.humanInstance.load();
                console.log('Human library loaded successfully with multi-face detection (maxDetected: 20)');
            } catch (error) {
                console.warn('Human library loading failed (face features will be disabled):', error);
                this.humanInstance = null;
            }
            
            self.postMessage({ status: 'model_ready' });
        }
        return { 
            clipModel: this.clipModel, 
            clipProcessor: this.clipProcessor,
            humanInstance: this.humanInstance
        };
    }
}

self.onmessage = async (event) => {
    // Handle worker ID assignment
    if (event.data && event.data.type === 'setWorkerId') {
        workerId = event.data.workerId;
        console.log(`Worker ID set to: ${workerId}`);
        return;
    }
    
    // Handle worker init message for model loading
    if (event.data && event.data.type === 'init') {
        try {
            await ModelSingleton.getInstance();
            // Model loading status is posted inside getInstance()
        } catch (error) {
            console.error('Worker model initialization failed:', error);
            self.postMessage({ status: 'error', error: error.message });
        }
        return;
    }

    const { file_id } = event.data;
    try {
        console.log(`Starting processing for file: ${file_id}`);
        const { clipModel, clipProcessor, humanInstance } = await ModelSingleton.getInstance();
        const thumbnail_url = `/api/thumb/${file_id}`;
        
        console.log(`Fetching thumbnail for: ${file_id}`);
        // Use fetch() to properly work with service worker, then convert to RawImage
        const response = await fetch(thumbnail_url);
        
        if (!response.ok) {
            console.error(`Fetch failed: ${response.status} ${response.statusText} for ${file_id}`);
            throw new Error(`Failed to fetch thumbnail: ${response.status} ${response.statusText}`);
        }
        
        console.log(`Got response for: ${file_id}, content-type: ${response.headers.get('content-type')}`);
        const blob = await response.blob();
        console.log(`Blob size: ${blob.size} bytes for ${file_id}`);
        
        if (blob.size === 0) {
            console.error(`Empty blob for ${file_id}`);
            throw new Error(`Received empty blob for thumbnail: ${file_id}`);
        }
        
        console.log(`Creating RawImage for: ${file_id}`);
        const image = await RawImage.fromBlob(blob);
        console.log(`RawImage created: ${image.width}x${image.height} for ${file_id}`);
        
        // Calculate quality metrics using the RawImage data
        const sharpness = estimateSharpness(image);
        const exposureMetrics = estimateExposure(image);
        
        // Analyze face quality if Human library is available
        let faceMetrics = null;
        if (humanInstance) {
            try {
                // Convert RawImage to canvas for Human library
                const canvas = new OffscreenCanvas(image.width, image.height);
                const ctx = canvas.getContext('2d');
                const imageData = ctx.createImageData(image.width, image.height);
                
                // Copy RawImage data to ImageData with proper channel handling
                // RawImage might be RGB (3 channels) or RGBA (4 channels)
                // ImageData is always RGBA (4 channels)
                const { data: rawData, channels } = image;
                for (let i = 0; i < image.width * image.height; i++) {
                    const srcIdx = i * channels;
                    const dstIdx = i * 4;
                    
                    if (channels >= 3) {
                        imageData.data[dstIdx] = rawData[srcIdx];         // R
                        imageData.data[dstIdx + 1] = rawData[srcIdx + 1]; // G
                        imageData.data[dstIdx + 2] = rawData[srcIdx + 2]; // B
                        imageData.data[dstIdx + 3] = channels === 4 ? rawData[srcIdx + 3] : 255; // A
                    } else {
                        // Grayscale
                        const gray = rawData[srcIdx];
                        imageData.data[dstIdx] = gray;     // R
                        imageData.data[dstIdx + 1] = gray; // G
                        imageData.data[dstIdx + 2] = gray; // B
                        imageData.data[dstIdx + 3] = 255;  // A
                    }
                }
                ctx.putImageData(imageData, 0, 0);
                
                faceMetrics = await analyzeFaceQuality(canvas, humanInstance);
                console.log(`Face metrics for ${file_id}:`, faceMetrics);
            } catch (faceError) {
                console.warn(`Face detection failed for ${file_id}:`, faceError);
            }
        }
        
        // Calculate final quality score including face metrics
        const qualityScore = calculateQualityScore(sharpness, exposureMetrics, faceMetrics);
        console.log(`Quality metrics calculated for ${file_id}: sharpness=${sharpness.toFixed(2)}, exposure=${JSON.stringify(exposureMetrics)}, faces=${faceMetrics?.faceCount || 0}, score=${qualityScore.toFixed(3)}`);

        // Generate embedding
        console.log(`Starting embedding generation for: ${file_id}`);
        try {
            console.log(`Processing image with clipProcessor for: ${file_id}`);
            const image_inputs = await clipProcessor(image);
            console.log(`Image inputs processed for: ${file_id}, shape:`, image_inputs?.pixel_values?.dims || 'unknown');
            
            console.log(`Running inference with clipModel for: ${file_id}`);
            const { image_embeds } = await clipModel(image_inputs);
            console.log(`Model inference complete for: ${file_id}, embedding shape:`, image_embeds?.dims || 'unknown');
            
            console.log(`Normalizing embedding for: ${file_id}`);
            const normalized_embeds = image_embeds.normalize();
            console.log(`Converting to list for: ${file_id}`);
            const embedding = normalized_embeds.tolist()[0];
            console.log(`Embedding generated successfully for: ${file_id}, length: ${embedding?.length || 'unknown'}`);
            
            self.postMessage({
                status: 'complete',
                file_id: file_id,
                embedding: embedding,
                qualityMetrics: {
                    sharpness: sharpness,
                    exposure: exposureMetrics,
                    face: faceMetrics,
                    qualityScore: qualityScore
                }
            });
        } catch (embeddingError) {
            console.error(`Embedding generation failed for ${file_id}:`, embeddingError);
            console.error(`Embedding error details:`, {
                message: embeddingError.message,
                stack: embeddingError.stack,
                name: embeddingError.name
            });
            throw embeddingError;
        }

    } catch (error) {
        console.error(`Worker failed for file ${file_id}:`, error);
        self.postMessage({
            status: 'error',
            file_id: file_id,
            error: error.message,
        });
    }
};