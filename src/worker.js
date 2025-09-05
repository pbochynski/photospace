// Import the correct, higher-level components for vision-language models.
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2';

// --- Final Configuration ---
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = true;


// Singleton pattern to ensure the model is loaded only once.
class CLIPSingleton {
    static model = null;
    static processor = null;

    static async getInstance() {
        if (this.model === null) {
            self.postMessage({ status: 'model_loading' });

            // --- THE FIX: Re-introduce WebGPU detection and configuration ---
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

            // Load the model and the processor.
            [this.model, this.processor] = await Promise.all([
                CLIPVisionModelWithProjection.from_pretrained(modelPath, accelerator),
                // The processor doesn't run on the GPU, so it doesn't need the config.
                AutoProcessor.from_pretrained(modelPath, accelerator)
            ]);
            
            self.postMessage({ status: 'model_ready' });
        }
        return { model: this.model, processor: this.processor };
    }
}

self.onmessage = async (event) => {
    // Handle worker init message for model loading
    if (event.data && event.data.type === 'init') {
        try {
            await CLIPSingleton.getInstance();
            // Model loading status is posted inside getInstance()
        } catch (error) {
            self.postMessage({ status: 'error', error: error.message });
        }
        return;
    }

    const { file_id, thumbnail_url } = event.data;
    console.log(`Worker started: ${JSON.stringify(event.data)}`);
    try {
        const { model, processor } = await CLIPSingleton.getInstance();
        

        if (!thumbnail_url) throw new Error("Thumbnail URL is missing.");

        const image = await RawImage.fromURL(thumbnail_url);
        const image_inputs = await processor(image); 
        const { image_embeds } = await model(image_inputs);
        const embedding = image_embeds.normalize().tolist()[0]

        self.postMessage({
            status: 'complete',
            file_id: file_id,
            embedding: embedding
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