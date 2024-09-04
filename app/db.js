import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/+esm'

async function getFilesDB() {
  let db = new Dexie('Files');
  db.version(0.3).stores({
    files: 'id,photo.takenDateTime,file.hashes.quickXorHash'
  });
  return db;
}
async function getEmbeddingsDB() {
  const db = new Dexie('Embeddings');
  db.version(4).stores({
    embeddings: 'id,photo.takenDateTime,path'
  })
  return db;
}
async function getQuickEmbeddingsDB() {
  const db = new Dexie('QuickEmbeddings');
  db.version(2).stores({
    embeddings: 'id,path,photo.takenDateTime'
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
  return {name: file.name, 
    hash: file.file.hashes.quickXorHash, 
    mimeType: file.file.mimeType,
    size: file.size, 
    lastModified: file.lastModifiedDateTime, 
    folderId: file.parentReference.id,
    path: file.parentReference.path,
    thumbnailUrl: file.thumbnails[0].large.url,
    photo: file.photo,
    image: file.image
  }
}
export {getFilesDB, getEmbeddingsDB, saveEmbedding, getEmbedding, getQuickEmbeddingsDB, payload};