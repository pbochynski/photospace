import { pipeline, env } from '@xenova/transformers';

// Configure transformers.js
env.allowLocalModels = false; // Use models from HuggingFace hub
env.backends.pipeline.default = 'webgpu'; // Use WebGPU for performance
env.backends.pipeline.fallback = 'wasm'; // Fallback to WASM if WebGPU is not available

class EmbeddingPipeline {
    static task = 'feature-extraction';
    static model = 'Xenova/clip-vit-base-patch32';
    static instance = null;

    static async getInstance() {
        if (this.instance === null) {
            this.instance = await pipeline(this.task, this.model, {
                quantized: true, // Use smaller, quantized models for speed and memory
            });
        }
        return this.instance;
    }
}

self.onmessage = async (event) => {
    try {
        const extractor = await EmbeddingPipeline.getInstance();
        const { file_id, thumbnail_url } = event.data;

        const embedding = await extractor(thumbnail_url, {
            pooling: 'mean',
            normalize: true,
        });

        // Post the result back to the main thread
        self.postMessage({
            status: 'complete',
            file_id: file_id,
            embedding: Array.from(embedding.data),
        });
    } catch (error) {
        self.postMessage({
            status: 'error',
            file_id: event.data.file_id,
            error: error.message,
        });
    }
};

// Signal that the worker is ready to receive tasks
self.postMessage({ status: 'ready' });