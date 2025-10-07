# Docker Deployment Guide

This guide explains how to build and run the Photospace Embedding Server using Docker.

## 🐳 Using Docker

### Quick Start with Docker Run

Pull and run the latest image from GitHub Container Registry:

```bash
docker run -d \
  --name photospace-server \
  -p 3001:3001 \
  -v $(pwd)/models_cache:/app/models_cache \
  ghcr.io/[YOUR_GITHUB_USERNAME]/photospace/photospace-embedding-server:latest
```

### Using Docker Compose (Recommended)

1. **Start the server:**
   ```bash
   docker-compose up -d
   ```

2. **View logs:**
   ```bash
   docker-compose logs -f
   ```

3. **Stop the server:**
   ```bash
   docker-compose down
   ```

### Building Locally

Build the Docker image locally:

```bash
# From the server directory
docker build -t photospace-embedding-server .

# Run the locally built image
docker run -d \
  --name photospace-server \
  -p 3001:3001 \
  -v $(pwd)/models_cache:/app/models_cache \
  photospace-embedding-server
```

## 📦 Published Images

Images are automatically built and published to GitHub Container Registry (GHCR) on every push to `main`:

- **Latest stable:** `ghcr.io/[YOUR_GITHUB_USERNAME]/photospace/photospace-embedding-server:latest`
- **Specific version:** `ghcr.io/[YOUR_GITHUB_USERNAME]/photospace/photospace-embedding-server:v1.0.0`
- **By commit SHA:** `ghcr.io/[YOUR_GITHUB_USERNAME]/photospace/photospace-embedding-server:main-abc1234`

### Supported Platforms

- `linux/amd64` (x86_64)
- `linux/arm64` (Apple Silicon, ARM servers)

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `NODE_ENV` | `production` | Node environment |

### Volumes

Mount a volume to persist downloaded models (recommended):

```bash
-v /path/to/local/cache:/app/models_cache
```

This prevents re-downloading ~3GB of models on container restarts.

## 🏥 Health Check

The container includes a built-in health check:

```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "ok",
  "modelsLoaded": true,
  "timestamp": "2025-10-07T..."
}
```

## 🚀 Production Deployment

### Docker with Restart Policy

```bash
docker run -d \
  --name photospace-server \
  --restart unless-stopped \
  -p 3001:3001 \
  -v /data/photospace/models_cache:/app/models_cache \
  ghcr.io/[YOUR_GITHUB_USERNAME]/photospace/photospace-embedding-server:latest
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: photospace-embedding-server
spec:
  replicas: 2
  selector:
    matchLabels:
      app: photospace-server
  template:
    metadata:
      labels:
        app: photospace-server
    spec:
      containers:
      - name: server
        image: ghcr.io/[YOUR_GITHUB_USERNAME]/photospace/photospace-embedding-server:latest
        ports:
        - containerPort: 3001
        volumeMounts:
        - name: models-cache
          mountPath: /app/models_cache
        resources:
          requests:
            memory: "2Gi"
            cpu: "1000m"
          limits:
            memory: "4Gi"
            cpu: "2000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 120
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 60
          periodSeconds: 10
      volumes:
      - name: models-cache
        persistentVolumeClaim:
          claimName: photospace-models-pvc
```

## 🔐 Pulling Private Images

If your repository is private, authenticate with GitHub Container Registry:

```bash
# Create a GitHub Personal Access Token with 'read:packages' scope
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# Pull the image
docker pull ghcr.io/[YOUR_GITHUB_USERNAME]/photospace/photospace-embedding-server:latest
```

## 📊 Resource Requirements

**Minimum:**
- CPU: 2 cores
- RAM: 2 GB
- Disk: 5 GB (for models)

**Recommended:**
- CPU: 4 cores
- RAM: 4 GB
- Disk: 10 GB

**First Run:**
- Initial startup takes 3-5 minutes to download models (~3GB)
- Subsequent runs are instant with volume mounted

## 🐛 Troubleshooting

### Container won't start

Check logs:
```bash
docker logs photospace-server
```

### Models not loading

Ensure the models_cache volume has sufficient space:
```bash
docker exec photospace-server du -sh /app/models_cache
```

### Port already in use

Change the host port:
```bash
docker run -p 3002:3001 ...
```

## 📝 Notes

- The server downloads models from Hugging Face on first run
- Models are cached locally in `/app/models_cache`
- Face detection is enabled and uses TensorFlow
- CORS is enabled for all origins
- Health checks start after 120s to allow model loading

