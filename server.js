import express from 'express'
import morgan from 'morgan';
import path from 'path';  

const DEFAULT_PORT = process.env.PORT || 3000;

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';

import { AutoProcessor, RawImage, CLIPVisionModelWithProjection } from '@xenova/transformers';
import { newClient } from './app/qdrant.js';

const qdrant = newClient(QDRANT_URL);
const COLLECTION_NAME = 'serverembeddings';
// qdrant.createCollection(COLLECTION_NAME, 512);

console.log('ClIP worker loaded');
// Load processor and vision model
const model_id = 'Xenova/clip-vit-base-patch16';
const processor = await AutoProcessor.from_pretrained(model_id, { feature_extractor_type: "ImageFeatureExtractor" });
const vision_model = await CLIPVisionModelWithProjection.from_pretrained(model_id, {
  quantized: false,
});
console.log('ClIP model loaded');


async function embeddingForUrl(id, url, token) {
  let options = {};
  if (token) {
    options.headers = { 'Authorization': `Bearer ${token}`}  
  }
  let imageBlob = await fetch(url, options).then(response => response.blob());
  let image = await RawImage.fromBlob(imageBlob);
  let image_inputs = await processor(image, { return_tensors: true });
  const { image_embeds } = await vision_model(image_inputs);
  const embed_as_list = image_embeds.tolist()[0];
  // await qdrant.insert(COLLECTION_NAME,Number(id.split('!')[1]), embed_as_list,{});
  return embed_as_list;
}

// initialize express.
const app = express();

app.use(express.json());

// Initialize variables.
let port = DEFAULT_PORT;

// Configure morgan module to log all requests.
app.use(morgan('dev'));


app.post('/classify', async (req, res) => {
  let body = req.body;
  if (body.url && body.id) {
    try{
      let embeddings = await embeddingForUrl(body.id, body.url, body.token);
      res.send({ status: 'ok', embeddings });  
    } catch (e) {
      console.error('Error processing request', e);
      res.send({ status: 'error', error: e.message });
    }
  }else {
    res.send({ status: 'url or id missing' });
  } 
});



// Setup app folders.
app.use(express.static('app'));


// Start the server.
app.listen(port);
console.log(`Listening on port ${port}...`);
