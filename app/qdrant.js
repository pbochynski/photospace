function newClient(url, apikey) {
  return new QdrantClient(url, apikey);
}

class QdrantClient {
  constructor(url, apikey) {
    this.url = url;
    this.apikey = apikey;
  }

  createCollection(name, dimension) {
    let body = {
      "vectors": {
        "size": dimension,
        "distance": "Cosine"
      }
    }
    return fetch(this.url + `/collections/${name}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    }).catch(e => {
      console.log(e);

    });
  }
  async scroll(collection, limit, offset) {
    let body = {with_payload: true, with_vector:true,limit}
    if (offset) {
      body.offset = offset;
    }
    return fetch(this.url + `/collections/${collection}/points/scroll`, {
      method: 'POST',
      headers: {
        'api-key': this.apikey,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    }).then(res => res.json()).catch(e => {
      console.log(e);
    });
  }
  async search(collection, vector, limit) {
    let body = {vector, limit}
    return fetch(this.url + `/collections/${collection}/points/search`, {
      method: 'POST',
      headers: {
        'api-key': this.apikey,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    }).then(res => res.json()).catch(e => {
      console.log(e);
    });
  }
  
  async insert(collection, id, vector, payload) {
    let body = {
      batch: 
        {
          "ids": [id],
          "vectors": [vector],
          "payloads": [payload]
        }
    }
    let res = await fetch(this.url + `/collections/${collection}/points`, {
      method: 'PUT',
      headers: {
        'api-key': this.apikey,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)})
    let resBody = await res.text();
    if (res.status == 200) {
      return true;
    }
    console.log(resBody);
    throw new Error(resBody);
  }
  
}
async function qdrantToDexie() {
  let qdrant = newClient('http://localhost:6333');
  let db = new Dexie('Qdrant');
  db.version(2).stores({
    embeddings: 'id'
  })
  console.log("Opened db")
  let offset = null
  while (true) {
    let records = await qdrant.scroll('embeddings', 500, offset);
    let embeddings = records.result.points.map((record) => {
      return {id:record.id, embeddings: record.vector, ...record.payload}
    })
    // console.log("Inserting", embeddings)
    await db.embeddings.bulkPut(embeddings)
    offset = records.result.next_page_offset
    if (!offset) {
      break;
    }
    console.log("offset", records.result.next_page_offset)
  }
}
async function dexieToQdrant() {
  let qdrant = newClient('http://localhost:6333');
  await qdrant.createCollection('embeddings', 512);
  console.log("Created collection")
  const db = await getEmbeddingsDB();
  const filesDB = await getFilesDB();
  console.log("Opened db")
  let count = await db.embeddings.count()
  console.log("Count", count)
  let offset = 0
  while (offset < count) {
    let records = await db.embeddings.offset(offset).limit(5).toArray()
    let ids = records.map(r => r.id)
    let files = await filesDB.files.bulkGet(ids)

    records = records.filter((r, i) => { return files[i] != undefined})
    records = records.map((r, i) => {return {id: r.id, vector: r.embeddings,payload: payload(files[i])}});
    if (records.length == 0) {
      break;
    }
    let body = {
      batch: {
        ids: records.map(r => Number(r.id.split('!')[1])),
        vectors: records.map(r => r.vector),
        payloads: records.map(r => r.payload)
      }
    }
    console.log("Inserting", body)  
    let res = await fetch(qdrant.url + `/collections/embeddings/points`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    let resBody = await res.text();
    if (res.status == 200) {
      console.log("Inserted", records.length)
    } else {
      console.log(resBody);
      throw new Error(resBody);
    }
    offset += records.length
  }
}

export { newClient };
