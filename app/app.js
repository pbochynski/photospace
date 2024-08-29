
async function getEmbeddingsDB() {
  let db = await idb.openDB('Embeddings', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('embeddings')) {
        db.deleteObjectStore('embeddings');
      }
      db.createObjectStore('embeddings', {
        keyPath: 'id'
      });
    },
  });
  return db;
}

var model
async function saveEmbedding(record) {

  const db = await getEmbeddingsDB();
  const tx = db.transaction('embeddings', 'readwrite');
  const store = tx.objectStore('embeddings');
  await store.put(record);
  await tx.done;
  console.log(`Embedding for ${record.name} saved`);
}
async function getEmbedding(id) {
  const db = await getEmbeddingsDB();
  const tx = db.transaction('embeddings', 'readonly');
  const store = tx.objectStore('embeddings');
  const record = await store.get(id);
  await tx.done;
  return record;
}
async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


async function calculateEmbeddings(data) {
  let inFlight = 0;
  for (let f of data.value) {

    if (f.file && f.image && f.thumbnails && f.thumbnails.length > 0 && f.thumbnails[0].large) {
      console.log(`Processing file ${f.name}`);
      let emb = await getEmbedding(f.id);
      if (emb) {
        console.log(`Embedding for ${f.name} already exists`);
        continue  // Skip if embedding already exists
      }
      inFlight++;
      while (inFlight > 10) {
        console.log("********* Waiting for 500 ms ********")
        await wait(500);
      }
      //fetch('proxy?'+new URLSearchParams({url: f.thumbnails[0].large.url}).toString())
      readThumbnail(f.id, 'large')
        .then(response => response.blob())
        .then((imageBlob) => {
          inFlight--;
          console.log("Image loaded %s, processing...", f.name);
          return processImageData(imageBlob, 'image/jpeg', f.id)
        }).then(result => {
          saveEmbedding({ id: f.id, name: f.name, embeddings: result.embeddings, predictions: result.predictions });
        }).catch((error) => {
          inFlight--;
          console.log("Error processing image", error)
        })


    }
  }

}


// calculate distance between two embeddings using cosine similarity
function distance(embedding1, embedding2) {
  const dotProduct = embedding1.reduce((acc, val, i) => acc + val * embedding2[i], 0);
  const norm1 = Math.sqrt(embedding1.reduce((acc, val) => acc + val * val, 0));
  const norm2 = Math.sqrt(embedding2.reduce((acc, val) => acc + val * val, 0));
  console.log(dotProduct, norm1, norm2);
  return 1 - dotProduct / (norm1 * norm2);
}

// Find similar images based on embeddings
async function findSimilarImages(emb) {
  const db = await getEmbeddingsDB();
  const store = db.transaction('embeddings', 'readonly').store;

  let cursor = await store.openCursor();
  const similarImages = [];

  while (cursor) {
    const record = cursor.value;
    const dist = distance(emb, record.embeddings);
    console.log(`Distance: ${dist}`);
    if (dist< 0.17) {
      record.distance = dist;
      similarImages.push(record);
    }
    cursor = await cursor.continue();
  }
  console.log('Number of similar images' ,similarImages.length);
  const filesDb = await getFilesDB();
  const filesStore = filesDb.transaction('files', 'readonly').store;
  for (let f of similarImages) {
    const file = await filesStore.get(f.id);
    Object.assign(f, file);
  }
  similarImages.sort((a, b) => a.distance - b.distance);
  return similarImages;


}