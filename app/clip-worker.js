
import { AutoProcessor, RawImage, CLIPVisionModelWithProjection } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.6.0';

console.log('ClIP worker loaded');
// Load processor and vision model
const model_id = 'Xenova/clip-vit-base-patch16';

const processor = await AutoProcessor.from_pretrained(model_id, { feature_extractor_type: "ImageFeatureExtractor" });
const vision_model = await CLIPVisionModelWithProjection.from_pretrained(model_id, {
  quantized: false,
});
console.log('ClIP model loaded');

self.onmessage = async function (event) {

  const { id, url, token } = event.data;
  let image;
  try {
    let blob = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
    .then(response => response.blob())
    image = await RawImage.fromBlob(blob);
  } catch (e) {
    // Unable to load image, so we ignore it
    console.warn('Ignoring image due to error', e)
    self.postMessage({ id, embeddings: null });
    return;
  }
  // Read image and run processor
  let image_inputs = await processor(image, { return_tensors: true });
  // Compute embeddings
  const { image_embeds } = await vision_model(image_inputs);
  const embed_as_list = image_embeds.tolist()[0];

  self.postMessage({ id, embeddings: embed_as_list });
};