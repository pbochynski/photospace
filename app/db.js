import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/+esm'

async function getFilesDB() {
  let db = new Dexie('Files');
  db.version(5).stores({
    files: 'id,takenDateTime,hash'
  });
  return db;
}
async function getEmbeddingsDB() {
  const db = new Dexie('Embeddings');
  db.version(5).stores({
    embeddings: 'id,takenDateTime,path'
  })
  return db;
}

async function getAlbumsDB() {
  const db = new Dexie('Albums');
  db.version(2).stores({
    albums: '[fileId+albumId],fileId,albumId'
  })
  return db;
}


async function saveEmbedding(record) {
  const db = await getEmbeddingsDB();
  db.embeddings.put(record)
}
async function getEmbedding(id) {
  const db = await getEmbeddingsDB();
  let record = await db.embeddings.get(id)
  return record
}

function payload(file) {
  return {
    id: file.id,
    name: file.name, 
    hash: file.file.hash, 
    mimeType: file.file.mimeType,
    size: file.size, 
    lastModified: file.lastModifiedDateTime, 
    created: file.createdDateTime,
    folderId: file.parentReference.id,
    path: file.parentReference.path,
    thumbnailUrl: file.thumbnails[0].large.url,
    takenDateTime: file.photo.takenDateTime || file.createdDateTime,
    photo: file.photo,
    image: file.image
  }
}
async function dbInfo() {
  let db = await getEmbeddingsDB()
  let embCount = await db.embeddings.count()  
  let filesDB = await getFilesDB()
  let filesCount = 0
  let uniqueHashes = {}
  let duplicates = []
  await filesDB.files.each(async function(f) {
    
    filesCount++
    let hash = f.hash
    let fullPath = f.path.replace(/^\/drive\/root:\//, '') + '/' + f.name
    if (uniqueHashes[hash]) {
      uniqueHashes[hash].push(fullPath)
      duplicates.push(hash)
    } else {
      uniqueHashes[hash]=[fullPath]
    }

  })
  duplicates = duplicates.map(h => uniqueHashes[h])
  return {files: filesCount, embeddings: embCount, duplicates: duplicates.length, uniqueHashes: Object.keys(uniqueHashes).length}    
}
export {getFilesDB, getEmbeddingsDB, saveEmbedding, getEmbedding, payload, getAlbumsDB, dbInfo};