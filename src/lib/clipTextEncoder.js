// CLIP Text Encoder Utility
// Loads the CLIP text model and provides an encode(text) method for prompt embeddings.
import { AutoTokenizer, CLIPTextModelWithProjection, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2';

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = true;

const modelPath = '/models/clip-vit-base-patch16/';

class CLIPTextEncoder {
    constructor() {
        this.model = null;
        this.tokenizer = null;
        this.ready = false;
        this.loadingPromise = null;
    }

    async load() {
        if (this.ready) return;
        if (this.loadingPromise) return this.loadingPromise;
        this.loadingPromise = (async () => {
            [this.model, this.tokenizer] = await Promise.all([
                CLIPTextModelWithProjection.from_pretrained(modelPath),
                AutoTokenizer.from_pretrained(modelPath)
            ]);
            this.ready = true;
        })();
        return this.loadingPromise;
    }

    async encode(text) {
        await this.load();
        // Tokenize the text prompt
        const tokenized = await this.tokenizer([text], { padding: true, truncation: true });
        const { text_embeds } = await this.model(tokenized);
        // text_embeds.data is a flat array, shape: [batch, dim]
        // For a single prompt, just return the first embedding
        const dim = text_embeds.dims[1];
        const embedding = text_embeds.data.slice(0, dim);
        // Normalize and return as array
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        return embedding.map(v => v / norm);
    }
}

export const clipTextEncoder = new CLIPTextEncoder();
