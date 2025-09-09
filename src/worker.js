// Import the correct, higher-level components for vision-language models.
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2';

// Face detection will be done using simple image analysis
// MediaPipe requires DOM access which is not available in web workers

// --- Final Configuration ---
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = true;

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
                    console.warn("WebGPU request failed, falling back to CPU/WASM.", e);
                    accelerator = { device: 'cpu' }; // Explicitly fallback
                }
            } else {
                console.warn("WebGPU not supported, using CPU/WASM.");
                accelerator = { device: 'cpu' }; // Explicitly fallback
            }

            const modelPath = '/models/clip-vit-base-patch16/';

            // Load the CLIP model and processor
            [this.clipModel, this.clipProcessor] = await Promise.all([
                CLIPVisionModelWithProjection.from_pretrained(modelPath, accelerator),
                AutoProcessor.from_pretrained(modelPath, accelerator)
            ]);
            
            self.postMessage({ status: 'model_ready' });
        }
        return { 
            clipModel: this.clipModel, 
            clipProcessor: this.clipProcessor
        };
    }
}

self.onmessage = async (event) => {
    // Handle worker init message for model loading
    if (event.data && event.data.type === 'init') {
        try {
            await ModelSingleton.getInstance();
            // Model loading status is posted inside getInstance()
        } catch (error) {
            self.postMessage({ status: 'error', error: error.message });
        }
        return;
    }

    const { file_id, thumbnail_url } = event.data;
    console.log(`Worker started: ${JSON.stringify(event.data)}`);
    try {
        const { clipModel, clipProcessor } = await ModelSingleton.getInstance();
        
        if (!thumbnail_url) throw new Error("Thumbnail URL is missing.");

        const image = await RawImage.fromURL(thumbnail_url);
        
        // Calculate basic quality metrics using the RawImage data
        const sharpness = estimateSharpness(image);
        const exposure = estimateExposure(image);
        
        
        // Calculate final quality score including face metrics
        const qualityScore = calculateQualityScore(sharpness, exposure);

        // Generate embedding
        const image_inputs = await clipProcessor(image); 
        const { image_embeds } = await clipModel(image_inputs);
        const embedding = image_embeds.normalize().tolist()[0];

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

    } catch (error) {
        console.error(`Worker failed for file ${file_id}:`, error);
        self.postMessage({
            status: 'error',
            file_id: file_id,
            error: error.message,
        });
    }
};