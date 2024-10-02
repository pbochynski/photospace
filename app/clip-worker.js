import { AutoProcessor, RawImage, CLIPVisionModelWithProjection } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0-alpha.19';

console.log('ClIP worker loaded');
// Load processor and vision model
// const processorModelId = 'Xenova/clip-vit-base-patch32';
// const visionModelId = 'jinaai/jina-clip-v1';
const processorModelId = 'Xenova/clip-vit-base-patch16';
const visionModelId = 'Xenova/clip-vit-base-patch16';
let inFlight = 0;

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

class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    this.current--;
    if (this.queue.length > 0) {
      this.current++;
      const resolve = this.queue.shift();
      resolve();
    }
  }
}
class EmbeddingQueue {
  constructor(concurrency = 1, maxPending = 10) {
    this.queue = [];
    this.concurrency = concurrency;
    this.currentlyProcessing = 0;
    this.maxPending = maxPending;
    this.semaphore = new Semaphore(maxPending);
  }

  enqueue(task) {
    this.queue.push(task);
    this.processNext();
  }

  async processNext() {
    if (
      this.currentlyProcessing < this.concurrency &&
      this.queue.length > 0
    ) {
      await this.semaphore.acquire();
      const task = this.queue.shift();
      this.currentlyProcessing++;
      task()
        .then(() => {
          this.currentlyProcessing--;
          this.semaphore.release();
          this.processNext();
        })
        .catch((err) => {
          console.error('Error processing embedding:', err);
          this.currentlyProcessing--;
          this.semaphore.release();
          this.processNext();
        });
    }
  }
}
class FetchQueue {
  constructor(embeddingQueue, fetchConcurrency = 5) {
    this.embeddingQueue = embeddingQueue;
    this.fetchConcurrency = fetchConcurrency;
    this.queue = [];
    this.currentlyFetching = 0;
  }

  enqueue(fileId, fileUrl, token) {
    this.queue.push({ fileId, fileUrl, token });
    this.processQueue();
  }

  async processQueue() {
    while (
      this.currentlyFetching < this.fetchConcurrency &&
      this.queue.length > 0
    ) {
      const { fileId, fileUrl } = this.queue.shift();
      this.currentlyFetching++;
      this.fetchImageTask(fileId, fileUrl)
        .then(() => {
          this.currentlyFetching--;
          this.processQueue();
        })
        .catch((err) => {
          console.error('Error fetching image:', err);
          this.currentlyFetching--;
          this.processQueue();
        });
    }
  }

  async fetchImageTask(fileId, fileUrl) {
    try {
      const rawImage = await fetchImage(fileId, fileUrl);
      // Enqueue embedding task
      this.embeddingQueue.enqueue(() => calculateEmbedding(fileId, rawImage));
    } catch (error) {
      console.error(`Failed to fetch image ${fileId}:`, error);
    }
  }
}
// Initialize EmbeddingQueue with concurrency 1 and max 10 pending
const embeddingQueue = new EmbeddingQueue(1, 10);

// Initialize FetchQueue with embeddingQueue and desired fetch concurrency
const fetchQueue = new FetchQueue(embeddingQueue, 5);

// Simulate fetching an image and converting it to raw data
async function fetchImage(id, url, token) {
  let image;
  try {
    let blob = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
    .then(async response => {
      console.log('Response', response);
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

// Simulate calculating embedding from raw image
async function calculateEmbedding(fileId,rawImage) {
  let image_inputs = await processor(rawImage, { return_tensors: true });
  // Compute embeddings
  const { image_embeds } = await vision_model(image_inputs);
  const embed_as_list =  image_embeds.tolist()[0];
  self.postMessage({ fileId, embeddings: embed_as_list });
  return embed_as_list;
}


self.onmessage = async function (event) {
  console.log('Worker received message', event  );
  const {id, url, token} = event.data;  
  console.log('Enqueueing', id, url, token);
  fetchQueue.enqueue(id, url, token);
};
console.log('CLIP worker initialized');
self.postMessage({ status: 'initialized' });
