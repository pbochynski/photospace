
import {env, dot, AutoTokenizer,CLIPTextModelWithProjection} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0-alpha.19';
import { getEmbeddingsDB, getFilesDB } from './db.js';

env.allowLocalModels = false;
// const textModelId = 'jinaai/jina-clip-v1';
const textModelId = 'Xenova/clip-vit-base-patch16';
// calculate distance between two embeddings using cosine similarity
function distance(embedding1, embedding2) {
  const dotProduct = embedding1.reduce((acc, val, i) => acc + val * embedding2[i], 0);
  const norm1 = Math.sqrt(embedding1.reduce((acc, val) => acc + val * val, 0));
  const norm2 = Math.sqrt(embedding2.reduce((acc, val) => acc + val * val, 0));
  return 1 - dotProduct / (norm1 * norm2);
}

const tokenizer = await AutoTokenizer.from_pretrained(textModelId);
const text_model = await CLIPTextModelWithProjection.from_pretrained(textModelId);
// See `model.logit_scale` parameter of original model
const exp_logit_scale = Math.exp(4.6052);

console.log('Text model loaded');

function parseQuery(query) {
  if (!query) {
    return {}
  }
  // extract path:{path}, date:{date} and the rest as text
  const params = ['path', 'date'];
  const queryParams = {};

  for (const param of params) {
    const match = query.match(new RegExp(`${param}:([^ ]+)`));
    if (match) {
      query = query.replace(match[0], '');
      queryParams[param] = match[1];
    }
  }
  return { text: query.trim(), ...queryParams };  
}

async function findImages(queryParams) {
  const db = await getFilesDB();
  let collection = db.files;
  if (queryParams.date) {
    let dates = queryParams.date.split('..');
    collection = collection.where('photo.takenDateTime').between(dates[0],dates[1], true, true);
  }
  if (queryParams.path) {    

    collection = collection.filter(f => f.parentReference && f.parentReference && f.parentReference.path.startsWith(queryParams.path))
    
  }
  let files = await collection.limit(queryParams.limit || 500).toArray();
  const embeddingsDB = await getEmbeddingsDB();
  const embeddings = await embeddingsDB.embeddings.bulkGet(files.map(f => f.id));
  files.forEach((f, i) => {
    if (embeddings[i]) {
      f.embeddings = embeddings[i].embeddings;
    }
  })
  return files
}

async function findSimilarImages(queryParams) {
  const emb = queryParams.embeddings;
  console.log('Finding similar images',emb);
  if (!emb) {
    return findImages(queryParams);
  }
  const db = await getEmbeddingsDB();
  let similarImages = [];
  const maxImages = 200;
  const maxDistance = 2;

  let collection = db.embeddings;
  if (queryParams.date) {
    let dates = queryParams.date.split('..');
    collection = collection.where('photo.takenDateTime').between(dates[0],dates[1], true, true);
  }
  
  if (queryParams.path) {    
    collection = collection.filter(f => f.path.startsWith(queryParams.path))
  }
  
  console.time('findSimilarImages');
  await collection.each(record => {
    const dist = distance(emb, record.embeddings);
    // const dist = dot(emb, record.embeddings)
    if (dist < maxDistance
      && (similarImages.length < maxImages || dist < similarImages[similarImages.length - 1].distance)) {
      record.distance = dist;
      console.log('Adding similar image', record.id, record.distance);
      similarImages.push(record);
      similarImages.sort((a, b) => a.distance - b.distance);
      if (similarImages.length > maxImages) {
        let removed = similarImages.pop();
        console.log('Removed similar image', removed.id, removed.distance);
      }
    }
  })
  console.timeEnd('findSimilarImages');
  console.log('Number of similar images', similarImages.length);
  const filesDb = await getFilesDB();
  const files = await filesDb.files.bulkGet(similarImages.map(f => f.id));
  //filter out files that are not found
  similarImages = similarImages.filter((f, i) => files[i]);
  similarImages.forEach((f, i) => {
    Object.assign(f, files[i]);
  })
  return similarImages
}


self.onmessage = async function (event) {
  console.log("event", event.data)
  const { similar, query } = event.data;
  const queryParams = parseQuery(query);
  if (similar) {
    const db = await getEmbeddingsDB();
    const f = await db.embeddings.get(similar)
    queryParams.embeddings = f.embeddings;
  } else if (queryParams.text) {
    const text_inputs = tokenizer(queryParams.text, { padding: true, truncation: true });
    const { text_embeds } = await text_model(text_inputs);
    queryParams.embeddings = text_embeds.normalize().tolist()[0];
    console.log('Text embeddings', queryParams.embeddings);
  }
  const files = await findSimilarImages(queryParams);
  self.postMessage({ status: 'ok', files });
}
