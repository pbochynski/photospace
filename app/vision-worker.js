importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs');
importScripts('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet');

let model;

async function loadModel() {
  model = await mobilenet.load();
}
loadModel();


self.onmessage = async function (event) {
  if (!model) {
    await loadModel();
  }

  const { id, imageBlob } = event.data;

  // Create an offscreen canvas
  const offscreenCanvas = new OffscreenCanvas(1, 1);
  const ctx = offscreenCanvas.getContext('2d');

  // Create an image bitmap from the blob
  const imageBitmap = await createImageBitmap(imageBlob);

  // Resize the canvas to match the image size
  offscreenCanvas.width = imageBitmap.width;
  offscreenCanvas.height = imageBitmap.height;

  // Draw the image onto the canvas
  ctx.drawImage(imageBitmap, 0, 0);

  const predictions = await model.classify(offscreenCanvas);
  const embeddings = await model.infer(offscreenCanvas, true);
  const embeddingArray = await embeddings.array();

  self.postMessage({ id, predictions, embeddings: embeddingArray[0] });
};