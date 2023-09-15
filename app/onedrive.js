const graphFilesEndpoint = "https://graph.microsoft.com/v1.0/me/drive"

function callMSGraph(endpoint, token, callback) {
  const headers = new Headers();
  const bearer = `Bearer ${token}`;

  headers.append("Authorization", bearer);

  const options = {
    method: "GET",
    headers: headers
  };

  console.log('request made to Graph API at: ' + new Date().toString(), endpoint);

  fetch(endpoint, options)
    .then(response => response.json())
    .then(response => {
      callback(response)
      if (response["@odata.nextLink"]) {
        callMSGraph(response["@odata.nextLink"], token, callback)
      }
    })
    .catch(error => console.log(error));
}

function rootFolder(callback) {
  getTokenRedirect(tokenRequest)
    .then(response => {
      callMSGraph(graphFilesEndpoint + '/root', response.accessToken, callback);

    }).catch(error => {
      console.error(error);
    });

}
function parentFolders(folders, callback) {
  console.log("Folders: ", folders)
  let id = folders[folders.length - 1].id
  getTokenRedirect(tokenRequest)
    .then(response => {
      callMSGraph(graphFilesEndpoint + `/items/${id}`, response.accessToken, (data) => {
        folders[folders.length - 1].name = data.name
        if (data.parentReference && data.parentReference.id) {
          folders.push({ id: data.parentReference.id })
          parentFolders(folders, callback)
        } else {
          callback(folders)
        }
      });

    }).catch(error => {
      console.error(error);
    });

}




function readFiles(id, callback) {
  const path = (id) ? `/items/${id}` : `/root`
  getTokenRedirect(tokenRequest)
    .then(response => {
      callMSGraph(graphFilesEndpoint + path + '/children?$expand=thumbnails', response.accessToken, callback);

    }).catch(error => {
      console.error(error);
    });
}
async function deleteFromCache(items){
  let db = await getFilesDB()
  const tx = db.transaction('files', 'readwrite');
  const store = tx.objectStore('files');
  for (let i of items) {
    console.log("Deleting from cache:", i.name, i.id)
    await store.delete(i.id)
  }
  await tx.done;      
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

async function getDriveData(url) {
  return new Promise(async (resolve, reject) => {
    getTokenRedirect(tokenRequest)
      .then(response => {
        const headers = new Headers();
        const bearer = `Bearer ${response.accessToken}`;

        headers.append("Authorization", bearer);

        const options = {
          method: "GET",
          headers: headers
        };
        fetch(url, options)
          .then(response => response.json())
          .then(response => {
            resolve(response)
          })
          .catch(error => reject(error));

      }).catch(error => {
        reject(error)
      });

  })
}
async function wait(t) {
  console.log("Waiting", t)
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve("foo")
    }, t)
  })
}
async function worker(urls, number, callback) {
  return new Promise(async (resolve,reject)=>{
    console.log("Worker %s started", number)
    let waits=6
    let processed=0
    while (urls.length || waits>0) {
      if (urls.length==0) {
        console.log("Worker %s waits. Remaining waits: %s", number, waits)
        await wait(500)
        waits--
        continue
      }
      let url = urls.pop()
      let data = await getDriveData(url.url)
      if (!data || !data.value) {
        console.log("PROBLEM:", data)
      }
      for (let f of data.value) {
        if (f.folder) {
          urls.push({url:`${graphFilesEndpoint}/items/${f.id}/children?$expand=thumbnails`, path:f.parentReference.path+"/"+f.name})
        }
      }
      cacheFiles(data)
      if (data["@odata.nextLink"]) {
        urls.push({url: data["@odata.nextLink"],path: url.path})
      }
      console.log("Worker: %s, processed: %s, queue: %s, waits: %s", number, ++processed, urls.length, waits)
      callback({ urls, processed })
  
    }
    console.log("Worker %s done",number)
    resolve()
  })
}

async function cacheAllFiles(callback) {
  let urls = [{url: graphFilesEndpoint + "/root/children?$expand=thumbnails", path: "/root"}]
  let processed = 0
  let db = await getFilesDB()
  await db.clear('files')
  let tasks = []
  for (let i=0;i<8;++i) {
    tasks.push(worker(urls,i,callback))
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
  let db = await idb.openDB('Files', 1, {
    upgrade(db) {
      // Create a store of objects
      const store = db.createObjectStore('files', {
        keyPath: 'id'
      });
      // Create an index on the 'date' property of the objects.
      store.createIndex('dateTaken', 'photo.takenDateTime');
    },
  });
  return db
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
    if (cursor.value.file && cursor.value.file.hashes && cursor.value.file.hashes.sha256Hash && cursor.value.size > 100000) {
      if (h[cursor.value.file.hashes.sha256Hash]) {
        h[cursor.value.file.hashes.sha256Hash].push(cursor.value)
        duplicates[cursor.value.file.hashes.sha256Hash] = true
      } else {
        h[cursor.value.file.hashes.sha256Hash] = [cursor.value]
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
  // for (let p of Object.values(pairs).sort(compareLength)[0]) {
  //   for (let item of p.items) {
  //     result.push(item)
  //   }
  // }
  // return result
  return pairs
}

