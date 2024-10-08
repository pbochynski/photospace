import { getTokenRedirect } from './auth.js';
import { getAlbumsDB } from './db.js';




let token = null

async function fetchWithToken(url, options) {
  if (!token) {
    token = await getTokenRedirect().then(response => {
      return response.accessToken;
    });
  }
  return fetch(url, {
    ...options,
    headers: { 'Authorization': `Bearer ${token}` }
  });
}
async function getAllAlbums() {
  const graphFilesEndpoint = "https://graph.microsoft.com/v1.0/me/drive/bundles?filter=bundle%2Falbum+ne+null&expand=tags%2Cthumbnails"

  let response = await fetchWithToken(graphFilesEndpoint , {});
  let albums =  await response.json();
  let list = albums.value;
  while (albums['@odata.nextLink']) {
    response = await fetchWithToken(albums['@odata.nextLink'], {});
    albums =  await response.json();
    list = list.concat(albums.value);
  }

  return list

}
async function getAlbum(albumId) {
  let response = await fetchWithToken(`https://graph.microsoft.com/v1.0/drive/items/${albumId}/children?expand=thumbnails`, {});
  let album =  await response.json();
  let items = album.value;
  while (album['@odata.nextLink']) {
    response = await fetchWithToken(album['@odata.nextLink'], {});
    album =  await response.json();
    items = items.concat(album.value);
  }
  items = items.sort((a, b) => {
    let t1 = new Date(a.photo.takenDateTime);
    let t2 = new Date(b.photo.takenDateTime);
    // console.log("Album items", t1, t2)
    return t1.getTime() - t2.getTime(); });   
  return items
}

async function getAlbumName(id) {
  let response = await fetchWithToken(`https://graph.microsoft.com/v1.0/drive/items/${id}`, {});
  let album =  await response.json();
  return album.name;
}

async function addToAlbum(albumId, fileId) {
  let response = await fetchWithToken(`https://graph.microsoft.com/v1.0/drive/bundles/${albumId}/children`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ id: fileId })
  });
}

async function removeFromAlbum(album, fileId) {
  let response = await fetchWithToken(`https://graph.microsoft.com/v1.0/drive/bundles/${album.id}/children/${fileId}`, {
    method: 'DELETE'
  });
  
}

async function indexAlbums(){
  let albums = await getAllAlbums();
  let db = await getAlbumsDB();
  await db.albums.clear();
  for (let album of albums) {
    let files = await getAlbum(album.id);    
    await db.albums.bulkAdd(files.map(f => ({ fileId: f.id, albumId: album.id, albumName: album.name })));  
  }  
  console.log(`Indexed ${albums.length} albums`);
}

async function getFileAlbums(fileId) {
  let db = await getAlbumsDB();
  let albums = await db.albums.where('fileId').equals(fileId).toArray();
  return albums;
}


export { getAllAlbums, getAlbum, addToAlbum, removeFromAlbum, indexAlbums, getFileAlbums,
  getAlbumName
 };