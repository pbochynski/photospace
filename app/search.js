const searchWorker = new Worker('search-worker.js', { type: 'module' });
let searchCallback = null

searchWorker.onmessage = function (e) {
  if (e.data.log) {
    console.log(e.data.log)
    return
  }
  if (searchCallback) {
    searchCallback(e.data)
  }
}

async function search(params, callback) {
  searchCallback = callback
  searchWorker.postMessage(params)
}


export { search }