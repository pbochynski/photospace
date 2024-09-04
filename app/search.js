const searchWorker = new Worker('search-worker.js', { type: 'module' });
let searchCallback = null

searchWorker.onmessage = function (e) {
  console.log('Message received from worker', e);
  if (searchCallback) {
    searchCallback(e.data)
  }
}

async function search(params, callback) {
  searchCallback = callback
  searchWorker.postMessage(params)
}


export { search }