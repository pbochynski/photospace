import * as _ from 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/+esm';
import * as mobilenet from 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/+esm';

let model;

async function loadModel() {
  console.log('Loading mobilenet..');
  model = await mobilenet.load();
  console.log('Sucessfully loaded model');
}
loadModel();

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

self.onmessage = async function (event) {
  while (!model) {
    await wait(300);
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