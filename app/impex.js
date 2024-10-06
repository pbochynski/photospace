import { importDB, exportDB } from 'https://cdn.jsdelivr.net/npm/dexie-export-import@4.1.2/+esm'
import { getFilesDB, getEmbeddingsDB  } from './db.js'
import { getTokenRedirect } from './auth.js'
import {Queue} from './queue.js'

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

async function createCompressedJsonFile(json, name) {
  // Convert JSON to a string
  const jsonString = JSON.stringify(json);
  
  // Convert the JSON string into a Uint8Array (binary data)
  const encoder = new TextEncoder();
  const uint8Array = encoder.encode(jsonString);

  // Create a compression stream
  const compressedStream = new CompressionStream('gzip');
  
  // Feed the uint8Array into the compression stream
  const stream = new Blob([uint8Array]).stream();
  const compressed = stream.pipeThrough(compressedStream);

  // Read the compressed data as a Blob
  const compressedBlob = await new Response(compressed).blob();

  // Set up the options for the OneDrive API request
  const options = {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/gzip" // Set to gzip for the compressed file
    },
    body: compressedBlob
  };

  // Make the API request to upload the gzip file
  return fetch(graphFilesEndpoint + `/root:/photospace/${name}.gz:/content`, options);
}


async function readJsonFile(name) {
  const options = {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` }
  }
  return fetch(graphFilesEndpoint + `/root:/photospace/${name}:/content`, options).then(response => response.json())
}

async function readCompressedJsonFile(name) {
  const options = {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` }
  };

  // Fetch the compressed file (assuming it's a .gz file)
  const response = await fetch(graphFilesEndpoint + `/root:/photospace/${name}.gz:/content`, options);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch the file: ${response.statusText}`);
  }

  // Get the response as a stream
  const compressedStream = response.body;

  // Create a decompression stream for gzip
  const decompressionStream = new DecompressionStream('gzip');

  // Pipe the compressed stream through the decompression stream
  const decompressedStream = compressedStream.pipeThrough(decompressionStream);

  // Convert the decompressed stream back into a Blob
  const decompressedBlob = await new Response(decompressedStream).blob();

  // Read the Blob as text
  const decompressedText = await decompressedBlob.text();

  // Parse the text as JSON and return it
  return JSON.parse(decompressedText);
}


async function exportToOneDrive(name, progress_callback) {
  const db = await getEmbeddingsDB();
  const queue = new Queue(5)
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
    let fileName = `${name}-${offset}.json`    
    await queue.enqueue ( ()=> createCompressedJsonFile(records, fileName), 10)
    console.log("Exporting", fileName)
    offset += records.length
  }
  await queue.done()
  console.log("Export done")
  return count
}
async function importFromOneDrive(name, progress_callback) {
  token = await getTokenRedirect().then(token => token.accessToken)
  const db = await getEmbeddingsDB();
  const queue = new Queue(5)
  let { count, chunk } = await readJsonFile(`${name}.json`)
  let offset = 0
  while (offset < count) {
    let fileName = `${name}-${offset}.json`
    await queue.enqueue( async ()=> {
      let json = await readCompressedJsonFile(fileName)
      await db.embeddings.bulkPut(json)
      console.log("Imported", fileName)
    }, 10)
    offset += chunk
    
  }
  await queue.done()
  console.log("Import done")
  return count
}

export { exportDatabase, importDatabase, clearDB, importFromOneDrive, exportToOneDrive };