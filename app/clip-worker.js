import { AutoProcessor, RawImage, CLIPVisionModelWithProjection } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0-alpha.19';
import { Queue } from './queue.js';
// Load processor and vision model
// const processorModelId = 'Xenova/clip-vit-base-patch32';
// const visionModelId = 'jinaai/jina-clip-v1';
const processorModelId = 'Xenova/clip-vit-base-patch16';
const visionModelId = 'Xenova/clip-vit-base-patch16';

let accelerator
if (navigator.gpu) {
  accelerator = { device: 'webgpu' };
  const adapter = await navigator.gpu.requestAdapter();
  accelerator.dtype = (adapter.features.has('shader-f16')) ? 'fp16' : 'fp32';
  console.log('Using WebGPU', accelerator.dtype);
} else {
  console.warn('WebGPU not supported, using CPU');
}
const processor = await AutoProcessor.from_pretrained(processorModelId, accelerator);
const vision_model = await CLIPVisionModelWithProjection.from_pretrained(visionModelId, accelerator);
console.log('CLIP model loaded');

// Initialize EmbeddingQueue with concurrency 1 and max 10 pending
const embeddingQueue = new Queue(1);


// Simulate fetching an image and converting it to raw data
async function fetchImage(id, url, token) {
  let image;
  try {
    let blob = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(async response => {
        if (!response.ok) {
          console.error(`Failed to fetch image: ${response.status} ${response.statusText}`);
          let text = await response.text();
          console.error('Response text', text);
          throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        }
        return response.blob()
      })
    image = await RawImage.fromBlob(blob);
    return image;
  } catch (e) {
    // Unable to load image, so we ignore it
    console.warn('Ignoring image due to error', e)
    self.postMessage({ id, embeddings: null });
    return;
  }
}

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
// Simulate calculating embedding from raw image
async function calculateEmbedding(fileId, rawImage) {
  // await wait(2000);
  let image_inputs = await processor(rawImage, { return_tensors: true });
  // Compute embeddings
  const { image_embeds } = await vision_model(image_inputs);
  const embed_as_list = image_embeds.normalize().tolist()[0];
  self.postMessage({ id: fileId, embeddings: embed_as_list });

  return embed_as_list;
}


self.onmessage = async function (event) {
  const { id, url, token } = event.data;
  const rawImage = await fetchImage(id, url, token);
  embeddingQueue.enqueue(() => calculateEmbedding(id, rawImage));
};
self.postMessage({ status: 'initialized', log: 'Worker initialized' });
