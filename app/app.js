import { getTokenRedirect } from './auth.js';
import { getEmbeddingsDB, getFilesDB, saveEmbedding, payload } from './db.js';

const graphFilesEndpoint = "https://graph.microsoft.com/v1.0/me/drive"

const cacheWorkers = []
const cacheQueue = []
let cacheProcessed = 0
const embeddingQueue = []
let processed = 0
const embeddingWorkers = []

function startVisionWorker() {
  console.log("Starting vision worker, queue length", embeddingQueue.length)
  let consoleDiv = document.getElementById('consoleDiv')
  embeddingWorkers.push(embeddingWorker(embeddingQueue, embeddingWorkers.length))

  consoleDiv.appendChild(document.createTextNode(`Embedding worker no ${embeddingWorkers.length} started`))
  consoleDiv.appendChild(document.createElement('br'))

}
for (let i = 0; i < 4; ++i) {
  cacheWorkers.push(worker(cacheQueue, i))
}

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
  let token = await getTokenRedirect().then(response => response.accessToken)
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
  let token = await getTokenRedirect().then(response => response.accessToken)
  const path = (id) ? `/items/${id}` : `/root`
  let data = await fetchWithToken(graphFilesEndpoint + path + '/children?$expand=thumbnails', token).then(response => response.json())
  cacheFiles(data)
  calculateEmbeddings(token, data)
  if (callback) {
    callback(data)
  }
  while (data["@odata.nextLink"]) {
    let next = await fetchWithToken(data["@odata.nextLink"], token).then(response => response.json())
    cacheFiles(next)
    calculateEmbeddings(token, next)
    data.value = data.value.concat(next.value)
    data["@odata.nextLink"] = next["@odata.nextLink"]
    if (callback) {
      callback(next)
    }
  }
  return data.value
}
async function readThumbnail(token, id, size) {
  return fetchWithToken(graphFilesEndpoint + `/items/${id}/thumbnails/0/${size}/content`, token)
}

async function deleteFromCache(items) {
  let db = await getFilesDB()
  for (let i of items) {
    console.log("Deleting from cache:", i.name, i.id)
    await db.files.delete(i.id)
  }
}


async function deleteItems(items) {
  return new Promise(async (resolve, reject) => {
    getTokenRedirect()
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

async function embeddingWorker(queue, number) {
  let token
  let initialized = false
  // Create a new Web Worker
  const visionWorker = new Worker('clip-worker.js', { type: 'module' });
  // Map to store promises for each request by their unique identifier
  const pendingRequests = new Map();

  // Handle messages from the Web Worker
  visionWorker.onmessage = function (event) {
    if (event.data.status == 'initialized') {
      initialized = true
      return
    }
    const { id, embeddings } = event.data;
    processed++
    const f = pendingRequests.get(id);
    if (embeddings) {
      saveEmbedding({ id, embeddings, ...payload(f) });
    }
    pendingRequests.delete(id);
  };

  visionWorker.onerror = function (error) {
    console.error('Worker error:', error);
    // Handle errors and reject the corresponding promise
    for (const [id, { reject }] of pendingRequests) {
      reject(error);
      pendingRequests.delete(id);
    }
  };
  while (true) {
    if (queue.length == 0 || !initialized || pendingRequests.size > 100) {
      await wait(500)
      continue
    }
    if (!token) {
      token = await getTokenRedirect().then(response => response.accessToken)
      console.log(`Worker ${number} token`, token)
      setTimeout(() => { token = null }, 60000) // renew token every minute
    }
    let f = queue.shift()
    let thumbnailUrl = graphFilesEndpoint + `/items/${f.id}/thumbnails/0/large/content`

    pendingRequests.set(f.id, f);
    visionWorker.postMessage({ id: f.id, url: thumbnailUrl, token });

  }
}


async function worker(urls, number) {
  console.log("Cache worker %s started", number)
  let token
  while (true) {
    if (urls.length == 0) {
      await wait(1000)
      continue
    }
    if (!token) {
      token = await getTokenRedirect().then(response => response.accessToken)
      console.log("Worker %s token", number, token)
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
    await cacheFiles(data)
    // calculateEmbeddings(token, data)
    if (data["@odata.nextLink"]) {
      urls.push({ url: data["@odata.nextLink"], path: url.path })
    }

  }
}


async function cacheAllFiles(id) {
  cacheQueue.length = 0
  if (id) {
    cacheQueue.push({ url: graphFilesEndpoint + `/items/${id}/children?$expand=thumbnails`, path: `/items/${id}` })
  } else {
    cacheQueue.push({ url: graphFilesEndpoint + "/root/children?$expand=thumbnails", path: "/root" })
  }
}




async function cacheFiles(data) {
  let db = await getFilesDB()
  db.files.bulkPut(data.value.filter(f => f.image))
}




async function largeFiles() {
  let db = await getFilesDB()

  let top = []
  const max = 100
  db.files.each(record => {
    top.push(record)
    if (top.length > max) {
      top.sort((a, b) => b.size - a.size)
      top.pop()
    }
  })
  return top
}
function compareParentId(a, b) {
  if (a.parentReference.id > b.parentReference.id) return 1
  if (a.parentReference.id < b.parentReference.id) return -1
  if (a.name > b.name) return 1
  if (a.name < b.name) return -1
  return 0
}


async function findDuplicates() {
  let db = await getFilesDB()
  let n = 0, p = 0
  let h = {}
  let duplicates = {}
  await db.files.each(value => {
    n++
    if (value.photo) {
      p++
    }
    if (value.file && value.file.hashes && value.file.hashes.quickXorHash && value.size > 100000) {
      if (h[value.file.hashes.quickXorHash]) {
        h[value.file.hashes.quickXorHash].push(value)
        duplicates[value.file.hashes.quickXorHash] = true
      } else {
        h[value.file.hashes.quickXorHash] = [value]
      }
    }

  })
  console.log("Total files: %s, photos: %s, duplicates", n, p, Object.keys(duplicates).length)
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


async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function queueMissingEmbeddings() {

  let filesDB = await getFilesDB()
  let db = await getEmbeddingsDB()
  let keys = await db.embeddings.toCollection().primaryKeys()
  let existing = {}
  for (let key of keys) {
    existing[key] = true
  } 
  console.log("Number of existing embeddings", keys.length)
  let missing = {}
  await filesDB.files.each(async record => {
    if (!existing[record.id]) {
      missing[record.id] = record
    }
  })
  console.log("Number of missing embeddings", Object.keys(missing).length)
  for (let record of Object.values(missing)) {
    embeddingQueue.push(record)
  }

}


async function calculateEmbeddings(token, data) {
  let db = await getEmbeddingsDB()
  let embeddings = await db.embeddings.bulkGet(data.value.map(f => f.id))

  for (let f of data.value) {

    if (f.file && f.image && f.thumbnails && f.thumbnails.length > 0 && f.thumbnails[0].large) {
      let emb = embeddings.find(e => e && e.id == f.id)
      if (!emb) {
        embeddingQueue.push(f)
      }
    }
  }
}



async function processingStatus() {

  return { pending: embeddingQueue.length, processed, cacheProcessed, cacheQueue: cacheQueue.length }
}

async function serverEmbedding(file) {
  let url = file.thumbnails[0].large.url
  return fetch('/classify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, id: file.id })
  }).then(response => response.json())
}


export {
  readFolder, cacheFiles, cacheAllFiles, largeFiles, calculateEmbeddings,
  findDuplicates, deleteItems, deleteFromCache,
  parentFolders, processingStatus, serverEmbedding,
  queueMissingEmbeddings, startVisionWorker
}
