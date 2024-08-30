import { openDB } from 'https://cdn.jsdelivr.net/npm/idb@8/+esm';
import { getTokenRedirect, tokenRequest } from './authRedirect.js';

const graphFilesEndpoint = "https://graph.microsoft.com/v1.0/me/drive"

function fetchWithToken(url, token) {
  const headers = new Headers();
  const bearer = `Bearer ${token}`;

  headers.append("Authorization", bearer);

  const options = {
    method: "GET",
    headers: headers
  };

  return fetch(url, options)
}


async function parentFolders(id) {
  let token = await getTokenRedirect(tokenRequest).then(response => response.accessToken)
  let folders = []
  while (id) {
    let data = await fetchWithToken(graphFilesEndpoint + `/items/${id}`, token).then(response => response.json())
    folders.push({ id, name: data.name })
    id = (data.parentReference && data.parentReference.id) ? data.parentReference.id : null
  }
  console.log("Folders: ", folders)
  return folders
}

async function readFolder(id, callback) {
  let token = await getTokenRedirect(tokenRequest).then(response => response.accessToken)
  const path = (id) ? `/items/${id}` : `/root`
  let data = await fetchWithToken(graphFilesEndpoint + path + '/children?$expand=thumbnails', token).then(response => response.json())
  if (callback) {
    callback(data)
  }
  while (data["@odata.nextLink"]) {
    let next = await fetchWithToken(data["@odata.nextLink"], token).then(response => response.json())
    data.value = data.value.concat(next.value)
    data["@odata.nextLink"] = next["@odata.nextLink"]
    if (callback) {
      callback(next)
    }
  }
  return data
}
async function readThumbnail(id, size) {
  let token = await getTokenRedirect(tokenRequest).then(response => response.accessToken)
  const path = (id) ? `/items/${id}` : `/root`
  return fetchWithToken(graphFilesEndpoint + path + `/thumbnails/0/${size}/content`, token)
}

async function deleteFromCache(items) {
  let db = await getFilesDB()
  const tx = db.transaction('files', 'readwrite');
  const store = tx.objectStore('files');
  for (let i of items) {
    console.log("Deleting from cache:", i.name, i.id)
    await store.delete(i.id)
  }
  await tx.done;
}

async function getCachedFile(id) {
  let db = await getFilesDB()
  const tx = db.transaction('files', 'readonly');
  const store = tx.objectStore('files');
  const record = await store.get(id);
  await tx.done;
  return record;
}

async function deleteItems(items) {
  return new Promise(async (resolve, reject) => {
    getTokenRedirect(tokenRequest)
      .then(async (response) => {
        const headers = new Headers();
        const bearer = `Bearer ${response.accessToken}`;

        headers.append("Authorization", bearer);

        const options = {
          method: "DELETE",
          headers: headers
        };

        try {
          for (let i of items) {
            console.log("Deleting file:", i.name, i.id)
            await fetch(graphFilesEndpoint + `/items/${i.id}`, options)
          }
          console.log("Items deleted:", items.length)
          resolve("items deleted: " + items.length)
        } catch (error) {
          reject(error)
        }

      })
  }
  )
}

async function worker(urls, number, callback) {
  return new Promise(async (resolve, reject) => {
    console.log("Worker %s started", number)
    let waits = 6
    let processed = 0
    let token = await getTokenRedirect(tokenRequest).then(response => response.accessToken)
    console.log("Worker %s token", number, token)

    while (urls.length || waits > 0) {
      if (urls.length == 0) {
        console.log("Worker %s waits. Remaining waits: %s", number, waits)
        await wait(500)
        waits--
        continue
      }
      let url = urls.shift()
      let data = await fetchWithToken(url.url, token).then(response => response.json())
      if (!data || !data.value) {
        console.log("PROBLEM:", data)
      }
      for (let f of data.value) {
        if (f.folder) {
          urls.push({ url: `${graphFilesEndpoint}/items/${f.id}/children?$expand=thumbnails`, path: f.parentReference.path + "/" + f.name })
        }
      }
      cacheFiles(data)
      if (data["@odata.nextLink"]) {
        urls.push({ url: data["@odata.nextLink"], path: url.path })
      }
      console.log("Worker: %s, processed: %s, queue: %s, waits: %s", number, ++processed, urls.length, waits)
      callback({ urls, processed })

    }
    console.log("Worker %s done", number)
    resolve()
  })
}

async function cacheAllFiles(callback) {
  let urls = [{ url: graphFilesEndpoint + "/root/children?$expand=thumbnails", path: "/root" }]
  let processed = 0
  let db = await getFilesDB()
  await db.clear('files')
  let tasks = []
  for (let i = 0; i < 8; ++i) {
    tasks.push(worker(urls, i, callback))
  }
  await Promise.all(tasks)
  console.log("All workers completed")
  return processed;
}


async function cacheFiles(data) {
  let db = await getFilesDB()
  const tx = db.transaction('files', 'readwrite');
  const store = tx.objectStore('files');
  for (let f of data.value) {
    await store.put(f);
  }
  await tx.done;
}



async function getFilesDB() {
  let db = await openDB('Files', 3, { // Increment the version number
    upgrade(db) {
      if (db.objectStoreNames.contains('files')) {
        db.deleteObjectStore('files');
      }
      const store = db.createObjectStore('files', {
        keyPath: 'id'
      });

      store.createIndex('dateTaken', 'photo.takenDateTime');
      store.createIndex('quickXorHash', 'file.hashes.quickXorHash');
    },
  });
  return db;
}

async function largeFiles() {
  let db = await getFilesDB()
  let cursor = await db.transaction('files').store.openCursor();
  let n = 0, p = 0
  let top = []
  while (cursor) {
    // console.log(cursor.key, cursor.value);
    n++
    if (cursor.value.photo) {
      p++
    }
    if (!cursor.value.folder && cursor.value.size) {
      if (top.length < 100) {
        top.push(cursor.value)
        top.sort((a, b) => b.size - a.size)
      } else {
        let last = top[top.length - 1]
        if (cursor.value.size > last.size) {
          top.pop()
          top.push(cursor.value)
          top.sort((a, b) => b.size - a.size)
        }
      }
    }
    cursor = await cursor.continue();
  }
  console.log("Total files: %s, photos: %s", n, p)
  return top
}
function compareParentId(a, b) {
  if (a.parentReference.id > b.parentReference.id) return 1
  if (a.parentReference.id < b.parentReference.id) return -1
  if (a.name > b.name) return 1
  if (a.name < b.name) return -1
  return 0
}

function compareLength(a, b) {
  return b[0].items.length - a[0].items.length
}

async function findDuplicates() {
  let db = await getFilesDB()
  let cursor = await db.transaction('files').store.openCursor();
  let n = 0, p = 0
  let h = {}
  let duplicates = {}
  while (cursor) {
    // console.log(cursor.key, cursor.value);
    n++
    if (cursor.value.photo) {
      p++
    }
    if (cursor.value.file && cursor.value.file.hashes && cursor.value.file.hashes.quickXorHash && cursor.value.size > 100000) {
      if (h[cursor.value.file.hashes.quickXorHash]) {
        h[cursor.value.file.hashes.quickXorHash].push(cursor.value)
        duplicates[cursor.value.file.hashes.quickXorHash] = true
      } else {
        h[cursor.value.file.hashes.quickXorHash] = [cursor.value]
      }
    }
    cursor = await cursor.continue();
  }
  console.log("Total files: %s, photos: %s, duplicates", n, p, Object.keys(duplicates).length)
  let result = []
  let pairs = {}
  for (let key of Object.keys(duplicates)) {

    for (let i = 0; i < h[key].length - 1; ++i) {
      for (let j = i + 1; j < h[key].length; ++j) {
        let pair = [h[key][i], h[key][j]]
        pair.sort(compareParentId)
        let id = pair[0].parentReference.id + '_' + pair[1].parentReference.id
        if (pairs[id]) {
          pairs[id][0].items.push(pair[0])
          pairs[id][1].items.push(pair[1])
        } else {
          pairs[id] = [{ parentId: pair[0].parentReference.id, path: pair[0].parentReference.path, items: [pair[0]] },
          { parentId: pair[1].parentReference.id, path: pair[1].parentReference.path, items: [pair[1]] }]
        }
      }
    }
  }
  return pairs
}

async function getEmbeddingsDB() {
  let db = await openDB('Embeddings', 2, {
    upgrade(db) {
      if (db.objectStoreNames.contains('embeddings')) {
        db.deleteObjectStore('embeddings');
      }
      db.createObjectStore('embeddings', {
        keyPath: 'id'
      });
    },
  });
  return db;
}

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
    if (dist < 0.17) {
      record.distance = dist;
      similarImages.push(record);
    }
    cursor = await cursor.continue();
  }
  console.log('Number of similar images', similarImages.length);
  const filesDb = await getFilesDB();
  const filesStore = filesDb.transaction('files', 'readonly').store;
  for (let f of similarImages) {
    const file = await filesStore.get(f.id);
    Object.assign(f, file);
  }
  similarImages.sort((a, b) => a.distance - b.distance);
  return similarImages;


}
// Create a new Web Worker
const visionWorker = new Worker('vision-worker.js', { type: 'module' });
console.log("Worker created")
// Map to store promises for each request by their unique identifier
const pendingRequests = new Map();

// Function to process image data using the Web Worker
function processImageData(imageBlob, mimeType, id) {
  if (!id){
    id = generateUniqueId(); // Function to generate a unique ID
  }
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });

    visionWorker.postMessage({ id, imageBlob, mimeType });
    console.log("queue size", pendingRequests.size)
  });
}

// Handle messages from the Web Worker
visionWorker.onmessage = function(event) {
  const { id, predictions, embeddings } = event.data;
  if (pendingRequests.has(id)) {
    const { resolve } = pendingRequests.get(id);
    resolve({ predictions, embeddings });
    pendingRequests.delete(id);
  }
  console.log("queue size", pendingRequests.size)
};

visionWorker.onerror = function(error) {
  // Handle errors and reject the corresponding promise
  for (const [id, { reject }] of pendingRequests) {
    reject(error);
    pendingRequests.delete(id);
  }
};

// Function to generate a unique ID
function generateUniqueId() {
  return '_' + Math.random().toString(36).substr(2, 9);
}

export {
  readFolder, cacheFiles, cacheAllFiles, largeFiles, calculateEmbeddings,
  findDuplicates, deleteItems, deleteFromCache, findSimilarImages, 
  getEmbedding, saveEmbedding, parentFolders
}

