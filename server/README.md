# Photospace Embedding Server

Node.js server for generating photo embeddings and quality scores. This server provides an alternative to client-side processing using web workers, allowing you to process images on the server side.

## Features

- **CLIP Embeddings**: Generate 512-dimensional image embeddings using CLIP ViT-Base-Patch16
- **Quality Analysis**: Calculate sharpness, exposure, and face quality scores
- **Face Detection**: Detect and analyze faces using the Human library
- **REST API**: Simple HTTP endpoint for processing images

## Installation

1. Install dependencies:
```bash
cd server
npm install
```

2. Models are downloaded automatically:
   - CLIP model is automatically downloaded from Hugging Face on first run
   - Models are cached locally in `models_cache/` for faster subsequent startups
   - Initial download takes ~3-5 minutes (models are ~200MB)
   - No manual model setup required!

## Usage

### Start the Server

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The server will start on `http://localhost:3001` by default.

### Environment Variables

- `PORT` - Server port (default: 3001)
- `NODE_ENV` - Environment mode (development/production)

### API Endpoints

#### Health Check
```http
GET /health
```

Response:
```json
{
  "status": "ok",
  "modelsLoaded": true,
  "timestamp": "2025-10-07T12:00:00.000Z"
}
```

#### Process Image
```http
POST /process-image
Content-Type: application/json

{
  "thumbnailUrl": "https://graph.microsoft.com/v1.0/me/drive/items/{id}/thumbnails/0/large/content",
  "fileId": "816DE1A42C711782!s12345"
}
```

Response:
```json
{
  "fileId": "816DE1A42C711782!s12345",
  "embedding": [0.123, 0.456, ...], // 512-dimensional array
  "qualityMetrics": {
    "sharpness": 25.3,
    "exposure": {
      "meanBrightness": 0.52,
      "clipping": 0.02,
      "dynamicRange": 0.85,
      "entropy": 0.78
    },
    "face": {
      "faceScore": 0.87,
      "faceCount": 2,
      "details": [...]
    },
    "qualityScore": 0.82
  },
  "processingTime": 1523
}
```

## Integration with Frontend

### 1. Configure Server URL

In your frontend application, set the embedding server URL:

```javascript
// In main.js or config
const EMBEDDING_SERVER_URL = 'http://localhost:3001';
```

### 2. Fetch Photos with Thumbnail URLs

Modify OneDrive API calls to include thumbnails:

```javascript
// In graph.js
const url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children?$expand=thumbnails`;

// Store thumbnail URL in database
const photo = {
  file_id: item.id,
  name: item.name,
  thumbnailUrl: item.thumbnails?.[0]?.large?.url,
  // ... other fields
};
```

### 3. Process Images via Server

```javascript
async function processImageViaServer(thumbnailUrl, fileId) {
  const response = await fetch(`${EMBEDDING_SERVER_URL}/process-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thumbnailUrl, fileId })
  });
  
  const result = await response.json();
  
  // Update database with embedding and quality metrics
  await db.updatePhotoEmbedding(
    fileId,
    result.embedding,
    result.qualityMetrics
  );
}
```

## Performance

- **First request**: ~5-10 seconds (model loading)
- **Subsequent requests**: ~1-2 seconds per image
- **Concurrent processing**: Handles multiple requests simultaneously
- **Memory usage**: ~2-3 GB (CLIP model + Human library)

## Differences from Client-Side Worker

| Feature | Worker.js (Client) | Server.js (Node) |
|---------|-------------------|------------------|
| **Execution** | Browser web worker | Node.js server |
| **GPU** | WebGPU support | CPU only |
| **Model Loading** | Per browser session | Once on startup |
| **CORS** | Limited by browser | No restrictions |
| **Concurrency** | Limited by CPU | Better parallel processing |
| **Cache** | Browser cache | File system cache |

## Troubleshooting

### Models Not Loading

Models are automatically downloaded from Hugging Face on first run. If download fails:
- Check your internet connection
- Ensure you have ~500MB free disk space
- Models are cached in `server/models_cache/`
- Delete `models_cache/` to force re-download if corrupted

### Out of Memory

Reduce the number of concurrent requests or increase Node.js memory:
```bash
node --max-old-space-size=4096 server.js
```

### Slow Processing

- Use a machine with better CPU
- Consider using GPU acceleration (requires additional setup)
- Process images in batches during off-peak hours

## Development

### Running Tests
```bash
# Test health endpoint
curl http://localhost:3001/health

# Test image processing
curl -X POST http://localhost:3001/process-image \
  -H "Content-Type: application/json" \
  -d '{
    "thumbnailUrl": "YOUR_THUMBNAIL_URL",
    "fileId": "YOUR_FILE_ID"
  }'
```

### Debugging

Enable detailed logging:
```bash
NODE_ENV=development npm start
```

## License

MIT
