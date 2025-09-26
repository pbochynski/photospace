# Photospace.app

A privacy-first OneDrive photo library analyzer. This tool helps you find and remove groups of similar photos to free up space. All processing happens directly in your browser using AI models running locally. Your photos are never uploaded to a third-party server.

## Features

### 🔐 **Authentication & Privacy**
- Secure OAuth2 login with your Microsoft Account using MSAL.js
- All photo processing happens locally in your browser
- Photos and embeddings are stored securely in your browser's IndexedDB
- Service Worker provides persistent, authenticated caching for images

### 📁 **Photo Management**
- **Flexible Scanning**: Scan all OneDrive photos or specific folders
- **Folder Browser**: Interactive folder navigation to select specific directories
- **Smart Filtering**: Filter photos by date range and folder path
- **URL State**: Shareable URLs with filter parameters for easy navigation
- **Incremental Processing**: Only process new photos on subsequent scans
- **Force Reprocess**: Option to regenerate embeddings for all photos

### 🤖 **AI-Powered Analysis**
- **Local AI Processing**: CLIP vision model (ViT-Base-Patch16) running entirely in your browser
- **Parallel Processing**: Configurable number of Web Workers (1-8) for optimal performance
- **Mobile Optimization**: WebAssembly fallback for devices without WebGPU support
- **Quality Assessment**: Automatic sharpness, exposure, and overall quality scoring
- **Visual Similarity**: Advanced cosine similarity matching between photo embeddings

### 🔍 **Smart Photo Grouping**
- **Temporal Clustering**: Groups photos by time sessions (configurable 1-24 hours)
- **Similarity Thresholds**: Adjustable similarity detection (50%-95%)
- **Multiple Sort Options**: 
  - Group size (highest reduction potential first)
  - Date (newest or oldest first)
- **Quality Ranking**: Best photo selection based on sharpness, exposure, and quality metrics

### 🖼️ **Enhanced Image Viewing**
- **Thumbnail Caching**: Fast thumbnail loading with persistent browser cache
- **Full-Size Viewing**: Modal viewer with automatic full-resolution image loading
- **HEIC Support**: Automatic fallback to thumbnail for unsupported formats
- **Image Metadata**: Display quality metrics, sharpness, exposure scores
- **Batch Selection**: Select multiple photos for deletion within groups

### 💾 **Backup & Sync**
- **Embedding Export**: Export all photo embeddings to OneDrive (JSON format)
- **Chunked Uploads**: Reliable upload of large files (>4MB) using Microsoft Graph sessions
- **Embedding Import**: Import embeddings from previous exports
- **Conflict Resolution**: Choose how to handle duplicate embeddings during import
- **File Management**: View, delete, and manage embedding backup files

### 🐛 **Development & Debugging**
- **Debug Console**: Mobile-friendly debug overlay for development and troubleshooting
- **Worker Logging**: Capture and display Web Worker messages in debug console
- **Error Handling**: Comprehensive error catching and user-friendly error messages
- **Progress Tracking**: Real-time progress indicators for long-running operations

### ⚙️ **Configurable Settings**
- **Performance Tuning**: Adjustable worker count based on device capabilities
- **Analysis Parameters**: Customizable similarity thresholds and time spans
- **Persistent Settings**: All preferences saved locally and restored on app restart
- **Filter Memory**: Last used filters are remembered and restored

### 📱 **Cross-Platform Compatibility**
- **Progressive Web App**: Installable on desktop and mobile devices
- **Responsive Design**: Optimized for all screen sizes
- **Mobile Debug**: Special debugging features for mobile development
- **Browser Compatibility**: Works in all modern browsers with WebAssembly support

## Technical Architecture

### Frontend
- **Framework**: Vanilla JavaScript with ES6 modules
- **Build Tool**: Vite for development and production builds
- **Authentication**: Microsoft Authentication Library (MSAL.js) 2.x
- **Database**: IndexedDB for local storage of photos and embeddings
- **Service Worker**: Custom caching layer for authenticated Microsoft Graph API requests

### AI/ML Stack
- **Model**: OpenAI CLIP ViT-Base-Patch16 (vision transformer)
- **Runtime**: Transformers.js with ONNX.js backend
- **Acceleration**: WebGPU (primary) with WebAssembly fallback
- **Processing**: Web Workers for parallel embedding generation
- **Formats**: ONNX quantized models for optimal browser performance

### Microsoft Graph Integration
- **API**: Microsoft Graph API v1.0
- **Endpoints**: Drive, Photos, Thumbnails, and Upload Session APIs
- **Authentication**: OAuth2 with automatic token refresh
- **Upload**: Chunked upload sessions for large files (>4MB)
- **Caching**: Service Worker handles authenticated requests with persistent caching

## Setup & Running Locally

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd photospace-app
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Azure App ID:**
    You need to create a file named `.env.local` in the root of the project and add your Azure Application (Client) ID to it.

    Create the file `.env.local`:
    ```
    VITE_AZURE_CLIENT_ID="YOUR_AZURE_APP_CLIENT_ID_HERE"
    ```
    Replace `YOUR_AZURE_APP_CLIENT_ID_HERE` with the actual ID from your Azure App Registration.

    **Important:** In your Azure App Registration, under **Authentication**, make sure you have configured a **Single-page application (SPA)** platform with the redirect URI: `http://localhost:5173` (or whatever port Vite uses). You will need to add your final production URL (`https://photospace.app`) here as well.

4.  **Run the development server:**
    ```bash
    npm run dev
    ```
    Open your browser and navigate to the local URL provided by Vite (typically `http://localhost:5173`).

5.  **Initial Setup:**
    - Grant permissions to access your OneDrive when prompted
    - The app will download AI models (~50MB) on first use
    - Models are cached locally for subsequent visits

## Usage Guide

### Getting Started
1. **Login**: Click "Login with Microsoft" and authenticate with your Microsoft account
2. **Scan Photos**: Click "Scan OneDrive Photos" to fetch photo metadata from your OneDrive
3. **Generate Embeddings**: Click "Generate Embeddings" to create AI-powered photo signatures
4. **Run Analysis**: Click "Analyze Photos" to find groups of similar photos

### Advanced Features
- **Folder Filtering**: Use the folder browser to analyze specific directories
- **Date Filtering**: Set date ranges to focus on particular time periods
- **Performance Tuning**: Adjust worker count based on your device capabilities
- **Backup Management**: Export/import embeddings to preserve analysis across devices
- **Quality Assessment**: View detailed quality metrics for each photo

### Tips for Best Results
- **Similarity Threshold**: Start with 85-90% for general duplicate detection
- **Time Span**: Use 2-8 hours for typical photo sessions
- **Worker Count**: Use 4-6 workers on desktop, 1-2 on mobile devices
- **Regular Exports**: Export embeddings periodically to backup your analysis data

## Deployment

### Automatic Deployment
This project includes a GitHub Action workflow to automatically build and deploy the application to GitHub Pages whenever you push to the `main` branch.

### Manual Setup
To enable automatic deployment:
1. Push your code to a GitHub repository.
2. In your repository settings, under **Pages**, select **GitHub Actions** as the source.
3. Ensure the `CNAME` file contains your custom domain (`photospace.app`).
4. Configure your domain's DNS records to point to GitHub Pages.

### Production Considerations
- **HTTPS Required**: Microsoft Graph API requires HTTPS for production
- **CORS Configuration**: Ensure your domain is added to Azure App Registration
- **Model Hosting**: ONNX models must be accessible from your domain
- **Service Worker**: Ensure service worker is properly registered for caching

## Browser Requirements

### Minimum Requirements
- **Modern Browser**: Chrome 88+, Firefox 78+, Safari 14+, Edge 88+
- **WebAssembly**: Required for AI model execution
- **IndexedDB**: Required for local data storage
- **Service Workers**: Required for image caching

### Recommended for Best Performance
- **WebGPU Support**: Chrome 113+ for GPU-accelerated AI processing
- **8GB+ RAM**: For processing large photo libraries
- **SSD Storage**: For faster IndexedDB operations

## Contributing

### Development Setup
1. Fork the repository
2. Install dependencies: `npm install`
3. Configure your Azure App Registration for localhost
4. Run development server: `npm run dev`

### Key Development Areas
- **Performance Optimization**: Improve AI model loading and processing speed
- **Mobile Experience**: Enhance mobile interface and touch interactions  
- **Additional AI Models**: Integration of other vision models for better accuracy
- **Export Formats**: Support for additional backup/export formats
- **Batch Operations**: Enhanced batch processing capabilities

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Privacy Policy

Photospace.app is designed with privacy as a core principle:
- **No Server Processing**: All AI analysis happens locally in your browser
- **No Data Collection**: We don't collect, store, or transmit your photos or personal data
- **Local Storage Only**: All data is stored locally in your browser's IndexedDB
- **Microsoft Integration**: Only uses standard Microsoft Graph API for OneDrive access
- **Open Source**: Full source code is available for transparency and security review