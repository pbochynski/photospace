// Import the correct, higher-level components for vision-language models.
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2';
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
 * Estimate sharpness using Laplacian variance (higher = sharper).
 * @param {RawImage} rawImage - RawImage from transformers library
 * @returns {number}
 */
function estimateSharpness(rawImage) {
    const { data, width, height, channels } = rawImage;
    
    // Convert to grayscale and calculate variance (Laplacian-like sharpness measure)
    let sum = 0, sumSq = 0, count = 0;
    
    for (let i = 0; i < data.length; i += channels) {
        // Convert RGB to grayscale
        const gray = channels >= 3 
            ? 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]
            : data[i]; // If it's already grayscale
            
        sum += gray;
        sumSq += gray * gray;
        count++;
    }
    
    const mean = sum / count;
    return (sumSq / count) - (mean * mean); // variance as sharpness measure
}

/**
 * Estimate exposure balance (0 = very dark, 1 = very bright, ~0.5 = good).
 * @param {RawImage} rawImage - RawImage from transformers library
 * @returns {number}
 */
function estimateExposure(rawImage) {
    const { data, width, height, channels } = rawImage;
    
    let brightnessSum = 0;
    let count = 0;
    
    for (let i = 0; i < data.length; i += channels) {
        // Convert RGB to grayscale for brightness calculation
        const gray = channels >= 3 
            ? 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]
            : data[i]; // If it's already grayscale
            
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
function calculateQualityScore(sharpness, exposure) {
    // Normalize sharpness with a higher threshold and use logarithmic scaling
    // Most photos will have sharpness between 500-5000, so we use log scaling
    const sharpnessScore = Math.min(Math.log(sharpness + 1) / Math.log(5001), 1);
    
    // More nuanced exposure scoring with a bell curve
    // Optimal exposure is around 0.4-0.6, with gradual falloff
    let exposureScore;
    const optimal = 0.5;
    const distance = Math.abs(exposure - optimal);
    
    if (distance <= 0.1) {
        // Perfect range: 0.4-0.6
        exposureScore = 1.0;
    } else if (distance <= 0.2) {
        // Good range: 0.3-0.4 and 0.6-0.7
        exposureScore = 1.0 - (distance - 0.1) * 2; // Linear decrease from 1.0 to 0.8
    } else if (distance <= 0.3) {
        // Fair range: 0.2-0.3 and 0.7-0.8
        exposureScore = 0.8 - (distance - 0.2) * 2; // Linear decrease from 0.8 to 0.6
    } else {
        // Poor range: <0.2 or >0.8
        exposureScore = Math.max(0.1, 0.6 - (distance - 0.3) * 1.5); // Linear decrease with minimum 0.1
    }
        return (sharpnessScore * 0.7) + (exposureScore * 0.3);
}



// Singleton pattern to ensure the models are loaded only once.
class ModelSingleton {
    static clipModel = null;
    static clipProcessor = null;

    static async getInstance() {
        if (this.clipModel === null) {
            self.postMessage({ status: 'model_loading' });

            // --- Load CLIP Model ---
            // Re-introduce WebGPU detection and configuration
            let accelerator;
            if (navigator.gpu) {
                try {
                    const adapter = await navigator.gpu.requestAdapter();
                    // fp16 is faster and uses less memory if the GPU supports it.
                    const dtype = adapter.features.has('shader-f16') ? 'fp16' : 'fp32';
                    accelerator = { device: 'webgpu', dtype };
                    console.log(`WebGPU is available. Using device: webgpu, dtype: ${dtype}`);
                } catch (e) {
                    console.warn("WebGPU request failed, falling back to WASM.", e);
                    accelerator = { device: 'wasm' }; // Use 'wasm' instead of 'cpu'
                }
            } else {
                console.warn("WebGPU not supported, using WASM.");
                accelerator = { device: 'wasm' }; // Use 'wasm' instead of 'cpu'
            }

            const modelPath = '/models/clip-vit-base-patch16/';

            // Load the CLIP model and processor with individual error handling
            try {
                this.clipModel = await CLIPVisionModelWithProjection.from_pretrained(modelPath, accelerator);
                this.clipProcessor = await AutoProcessor.from_pretrained(modelPath, accelerator);
            } catch (error) {
                console.error('Model loading error:', error);
                throw error;
            }
            
            self.postMessage({ status: 'model_ready' });
        }
        return { 
            clipModel: this.clipModel, 
            clipProcessor: this.clipProcessor
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
        const { clipModel, clipProcessor } = await ModelSingleton.getInstance();
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
        
        // Calculate basic quality metrics using the RawImage data
        const sharpness = estimateSharpness(image);
        const exposure = estimateExposure(image);
        
        
        // Calculate final quality score including face metrics
        const qualityScore = calculateQualityScore(sharpness, exposure);
        console.log(`Quality metrics calculated for ${file_id}: sharpness=${sharpness}, exposure=${exposure}, score=${qualityScore}`);

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
                    exposure: exposure,
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