// We still import the library from the CDN or NPM as before.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2';

// --- THE FIX: Configure for local model loading ---

// 1. MUST allow local models.
env.allowLocalModels = true;
env.allowRemoteModels = false;


// Other standard configuration
env.useBrowserCache = false;


// --- The rest of the pipeline implementation is adapted for local paths ---
class PipelineSingleton {
    static task = 'feature-extraction';
    
    // 3. The model path now points to our local folder in 'public'.
    // The leading slash makes it an absolute path from the domain root.
    static model = 'clip-vit-base-patch16';

    static instance = null;

    static async getInstance(progress_callback) {
        if (this.instance === null) {
            this.instance = await pipeline(this.task, this.model, {
                // 4. We tell the pipeline to look for a quantized model.
                // Because we renamed our file to 'model_quantized.onnx', it will find it.
                quantized: true, 
                progress_callback,
            });
        }
        return this.instance;
    }
}

// The onmessage handler remains exactly the same as the last working version.
self.onmessage = async (event) => {
    const progress_callback = (data) => {
        // Progress for local files is instant, so this may not fire, but it's good to keep.
        self.postMessage({
            status: 'model_progress',
            data: data
        });
    };

    try {
        console.log(`Worker started for file ${event.data.file_id}`);
        const extractor = await PipelineSingleton.getInstance(progress_callback);
        console.log(`Extractor loaded for file ${event.data.file_id}`);

        const { file_id, thumbnail_url } = event.data;

        if (!thumbnail_url) {
            throw new Error("Thumbnail URL is missing.");
        }

        const embedding = await extractor(thumbnail_url, {
            pooling: 'mean',
            normalize: true,
        });

        self.postMessage({
            status: 'complete',
            file_id: file_id,
            embedding: Array.from(embedding.data),
        });
    } catch (error) {
        console.error(`Worker failed for file ${event.data.file_id}:`, error);
        self.postMessage({
            status: 'error',
            file_id: event.data.file_id,
            error: error.message,
        });
    }
};