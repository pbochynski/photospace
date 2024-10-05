
import { env, AutoTokenizer, CLIPTextModelWithProjection, dot } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0-alpha.19';
import { getEmbeddingsDB, getFilesDB } from './db.js';

env.allowLocalModels = false;
const textModelId = 'Xenova/clip-vit-base-patch16';

const tokenizer = await AutoTokenizer.from_pretrained(textModelId);
const text_model = await CLIPTextModelWithProjection.from_pretrained(textModelId);

console.log('Text model loaded');
const {positiveEmbeds,negativeEmbeds} = await scoreEmbeddings();
self.postMessage({log: 'Score embeddings calculated' });

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
    collection = collection.where('takenDateTime').between(dates[0], dates[1], true, true);
  }
  if (queryParams.path) {

    collection = collection.filter(f => f.path.startsWith(queryParams.path))

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
    collection = collection.where('photo.takenDateTime').between(dates[0], dates[1], true, true);
  }

  if (queryParams.path) {
    collection = collection.filter(f => f.path.startsWith(queryParams.path))
  }
  
  console.time('findSimilarImages');
  await collection.each(record => {
    let n1 = calculateNorm(record.embeddings);
    let n2 = calculateNorm(emb); 
    const dist = 1-dot(emb, record.embeddings);
    // const dist = dot(emb, record.embeddings)
    if (dist < maxDistance
      && (similarImages.length < maxImages || dist < similarImages[similarImages.length - 1].distance)) {
      record.distance = dist;
      similarImages.push(record);
      similarImages.sort((a, b) => a.distance - b.distance);
      if (similarImages.length > maxImages) {
        similarImages.pop();
      }
    }
  })
  console.timeEnd('findSimilarImages');
  const filesDb = await getFilesDB();
  const files = await filesDb.files.bulkGet(similarImages.map(f => f.id));
  //filter out files that are not found
  similarImages = similarImages.filter((f, i) => files[i]);

  similarImages.forEach((f, i) => {
    f.score = calculateScore(f.embeddings, positiveEmbeds, negativeEmbeds);

    Object.assign(f, files[i]);
  })
  return similarImages
}
function calculateScore(imageEmbedding, positiveEmbeds, negativeEmbeds) {
  // Positive similarity
  const exp_logit_scale = Math.exp(4.6052);

  const positiveSimilarity = positiveEmbeds.map(x => dot(x, imageEmbedding)*exp_logit_scale);
  const positiveScore = positiveSimilarity.reduce((acc, val) => acc + val, 0)/positiveEmbeds.length;

  // Negative similarity
  const negativeSimilarity = negativeEmbeds.map(x => dot(x, imageEmbedding)*exp_logit_scale);
  const negativeScore = negativeSimilarity.reduce((acc, val) => acc + val, 0)/negativeEmbeds.length;
  // Combined score: High positive, low negative
  return positiveScore - negativeScore;
}
async function scoreEmbeddings() {
  const positivePrompts = [ "good photo"
    // "A sharply focused photograph with clear and crisp details.",
    // "A good looking portrait photo with a well-exposed face.",
    // "A well-composed image following the rule of thirds with balanced elements.",
    // "A photograph with balanced and natural lighting.",
    // "A clean photo without any obstructions in the foreground, such as fingers or objects."
  ];

  const negativePrompts = [ "bad photo"
    // "A photograph with blurred or unsharp details.",
    // "A weird looking portrait photo with an ugly face expression.",
    // "An image cluttered with unwanted objects or obstructions in the foreground.",
    // "A poorly lit photograph with uneven lighting.",
    // "An image with distracting elements covering the main subject."
  ];

  // Encode prompts
  const encodedPositive = await tokenizer(positivePrompts, { padding: true, truncation: true });
  const {text_embeds: positiveEmbeds} = await text_model(encodedPositive)
  

  const encodedNegative = await tokenizer(negativePrompts, { padding: true, truncation: true });
  const {text_embeds: negativeEmbeds} = await text_model(encodedNegative)

  return { positiveEmbeds: positiveEmbeds.normalize().tolist(), negativeEmbeds: negativeEmbeds.normalize().tolist() };
}

self.onmessage = async function (event) {
  const { similar, query } = event.data;
  const queryParams = parseQuery(query);
  if (similar) {
    const db = await getEmbeddingsDB();
    const f = await db.embeddings.get(similar)
    queryParams.embeddings = f.embeddings;
  } else if (queryParams.text) {
    const text_inputs = await tokenizer([queryParams.text], { padding: true, truncation: true });
    const { text_embeds } = await text_model(text_inputs);
    queryParams.embeddings = text_embeds.normalize().tolist()[0];
  }
  const files = await findSimilarImages(queryParams);
  self.postMessage({ status: 'ok', files });
}

self.postMessage({ status: 'ready', log: 'Search worker ready' });
