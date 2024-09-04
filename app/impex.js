import {importDB, exportDB, importInto, peakImportFile}  from 'https://cdn.jsdelivr.net/npm/dexie-export-import@4.1.2/+esm'
import {getFilesDB,getEmbeddingsDB, getQuickEmbeddingsDB, payload} from './db.js'

async function exportDatabase() {
  console.log('Exporting database');
  const db = await getEmbeddingsDB();
  // Export it
  return exportDB(db)
}

async function importDatabase(file) {
  // Import a file into a Dexie instance:
  const db = await importDB(file,{overwriteValues: true});
  return db.backendDB(); // backendDB() gives you the native IDBDatabase object.
}


async function cleanEmbeddings() {
  const db = await getEmbeddingsDB();
  const filesDB = await getFilesDB();
  let count = await db.embeddings.count()
  console.log("Number of embeddings", count)
  let offset = 0
  let toDelete = []
  while (offset < count) {
    let records = await db.embeddings.offset(offset).limit(1000).toArray()
    let ids = records.map(r => r.id)
    let files = await filesDB.files.bulkGet(ids)
    records.forEach((r, i) => {

      if (files[i] == undefined || records[i].embeddings == undefined) {
        toDelete.push(r.id)
      }
      if (r.embeddings && r.embeddings.embeddings) {
        r.embeddings = r.embeddings.embeddings
      }
      delete r.predictions
      Object.assign(r, payload(files[i]))
    })
    // db.embeddings.bulkPut(records)
    offset += records.length
    console.log("Offset", offset)
  }
  db.embeddings.bulkDelete(toDelete)
}

async function quickEmbeddings() {
  const db = await getEmbeddingsDB();
  const quickDb = await getQuickEmbeddingsDB();
  let count = await db.embeddings.count()
  console.log("Number of embeddings", count)
  let offset = 0
  while (offset < count) {
    let records = await db.embeddings.offset(offset).limit(1000).toArray()
    // console.log("Inserting", embeddings)
    await quickDb.embeddings.bulkPut(records)
    offset += records.length
    console.log("Offset", offset)
  }
}


export {exportDatabase, importDatabase, cleanEmbeddings, quickEmbeddings};