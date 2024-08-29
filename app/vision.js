// Create a new Web Worker
const visionWorker = new Worker('vision-worker.js', { type: 'module' });
console.log("Worker created")
// Map to store promises for each request by their unique identifier
const pendingRequests = new Map();

// Function to process image data using the Web Worker
function processImageData(imageBlob, mimeType, id) {
  if (!id){
    id = generateUniqueId(); // Function to generate a unique ID
  }
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });

    visionWorker.postMessage({ id, imageBlob, mimeType });
    console.log("queue size", pendingRequests.size)
  });
}

// Handle messages from the Web Worker
visionWorker.onmessage = function(event) {
  const { id, predictions, embeddings } = event.data;
  if (pendingRequests.has(id)) {
    const { resolve } = pendingRequests.get(id);
    resolve({ predictions, embeddings });
    pendingRequests.delete(id);
  }
  console.log("queue size", pendingRequests.size)
};

visionWorker.onerror = function(error) {
  // Handle errors and reject the corresponding promise
  for (const [id, { reject }] of pendingRequests) {
    reject(error);
    pendingRequests.delete(id);
  }
};

// Function to generate a unique ID
function generateUniqueId() {
  return '_' + Math.random().toString(36).substr(2, 9);
}