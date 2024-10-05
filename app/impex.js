import { importDB, exportDB } from 'https://cdn.jsdelivr.net/npm/dexie-export-import@4.1.2/+esm'
import { getFilesDB, getEmbeddingsDB  } from './db.js'
import { getTokenRedirect } from './auth.js'

const graphFilesEndpoint = "https://graph.microsoft.com/v1.0/me/drive"


async function exportDatabase() {
  console.log('Exporting database');
  const db = await getEmbeddingsDB();
  // Export it
  return exportDB(db)
}

async function importDatabase(file) {
  // Import a file into a Dexie instance:
  const db = await importDB(file, { overwriteValues: true });
  return db.backendDB(); // backendDB() gives you the native IDBDatabase object.
}


async function clearDB() {
  const filesDB = await getFilesDB();
  await filesDB.files.clear()
  return true
}

let token = null
async function createPhotspaceFolder() {
  const options = {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "photospace", folder: {} })
  }
  return fetch(graphFilesEndpoint + "/root/children", options)
}

async function createJsonFile(json, name) {
  const options = {
    method: "PUT",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(json)
  }
  return fetch(graphFilesEndpoint + `/root:/photospace/${name}:/content`, options)

}
async function readJsonFile(name) {
  const options = {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` }
  }
  return fetch(graphFilesEndpoint + `/root:/photospace/${name}:/content`, options).then(response => response.json())
}
async function exportToOneDrive(name, progress_callback) {
  const db = await getEmbeddingsDB();
  token = await getTokenRedirect().then(token => token.accessToken)
  console.log("Token", token)
  await createPhotspaceFolder()
  let offset = 0
  let count = await db.embeddings.count()
  let chunk = 500
  console.log("Number of embeddings", count)
  await createJsonFile({ count, chunk }, `${name}.json`)
  while (offset < count) {
    let records = await db.embeddings.offset(offset).limit(chunk).toArray()
    progress_callback({ offset, count })
    await createJsonFile(records, `${name}-${offset}.json`)
    offset += records.length
  }
  return count
}
async function importFromOneDrive(name, progress_callback) {
  token = await getTokenRedirect().then(token => token.accessToken)
  const db = await getEmbeddingsDB();
  let { count, chunk } = await readJsonFile(`${name}.json`)
  let offset = 0
  while (offset < count) {
    let json = await readJsonFile(`${name}-${offset}.json`)
    await db.embeddings.bulkPut(json)
    offset += chunk
    progress_callback({ offset, count })
  }
  return count
}

export { exportDatabase, importDatabase, clearDB, importFromOneDrive, exportToOneDrive };