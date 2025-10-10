# Photospace.app

A privacy-first OneDrive photo library analyzer and organizer. Find and remove duplicate photos, discover photo series, and manage your photo library efficiently. All processing happens directly in your browser using AI models running locally. Your photos are never uploaded to a third-party server.

## 🚀 Quick Overview

- 🔒 **100% Private** - All AI processing happens in your browser
- 🤖 **Smart AI** - CLIP vision model for accurate similarity detection  
- 📁 **Easy Organization** - Browse, scan, and analyze your OneDrive photos
- 🎯 **Two Analysis Modes** - Find duplicates (AI) or photo series (time-based)
- ⚡ **Fast Processing** - Parallel workers with pause/resume capability
- 💾 **Backup & Sync** - Export/import embeddings across devices
- 🗑️ **Quick Cleanup** - Select and delete duplicates with one click

## Features

### 🔐 **Authentication & Privacy**
- Secure OAuth2 login with your Microsoft Account using MSAL.js
- All photo processing happens locally in your browser
- Photos and embeddings are stored securely in your browser's IndexedDB
- Service Worker provides persistent, authenticated caching for images
- No data collection or third-party server processing

### 📁 **OneDrive Browser & Photo Management**
- **Interactive Folder Browser**: Navigate your OneDrive folders with clickable breadcrumbs
- **Auto-Indexing**: Automatically indexes photos as you browse folders
- **Smart Queue System**: Queue multiple folders for scanning with parallel processing (up to 5 concurrent)
- **Real-time Status**: Live updates showing scan queue, active scans, and database statistics
- **Batch Operations**: Select and delete multiple photos at once
- **Folder-Specific Analysis**: Analyze current folder or all indexed photos
- **Incremental Updates**: Only processes new photos, automatically removes deleted ones
- **URL State Management**: Shareable URLs preserve folder navigation and filters

### 🤖 **AI-Powered Analysis**
- **Local AI Processing**: CLIP vision model (ViT-Base-Patch16) running entirely in your browser
- **Parallel Processing**: Configurable Web Workers (1-8) for optimal performance
- **Automatic Embedding Generation**: Background processing with pause/resume capability
- **Quality Assessment**: 
  - Sharpness detection (blur detection)
  - Exposure analysis (brightness, clipping, dynamic range, entropy)
  - Face detection with quality scoring
  - Overall quality score combining all metrics
- **Visual Similarity**: Advanced cosine similarity matching between photo embeddings

### 🔍 **Similarity Analysis (Duplicate Detection)**
- **Smart Grouping**: Finds groups of visually similar photos
- **Temporal Clustering**: Groups photos by time sessions (0-24 hours, configurable)
- **Adjustable Threshold**: Fine-tune similarity detection (50%-99%)
- **Quality-Based Ranking**: Automatically identifies best photo in each group
- **Minimum Group Size**: Filter by group size (2-20 photos)
- **Multiple Sort Options**: 
  - Group size (highest reduction potential first)
  - Date (newest or oldest first)
  - Density (for series analysis)

### 📸 **Photo Series Detection**
- **Time-Based Analysis**: Finds large photo series based on shooting patterns
- **No Embeddings Required**: Works without AI processing for faster analysis
- **Density Filtering**: Minimum photos per minute threshold (0.5-10 photos/min)
- **Size Filtering**: Minimum group size (5-100 photos)
- **Gap Detection**: Maximum time gap between photos (1-60 minutes)
- **Detailed Metrics**: Shows duration, density, average time between photos

### 🖼️ **Enhanced Image Viewing**
- **Modal Viewer**: Full-screen photo viewing with keyboard navigation
- **Next/Previous Navigation**: Arrow keys and buttons to browse through photos
- **Photo Metadata Overlay**: 
  - Sharpness scores with color coding
  - Exposure metrics (brightness, clipping, dynamic range)
  - Face detection results with quality scores
  - Overall quality percentage
- **Quick Actions**:
  - Find Similar Photos: Search for photos similar to current one
  - View in Folder: Jump to photo's location in browser
  - Delete Photo: Remove with seamless navigation to next photo
- **Photo Selection**: Checkbox in modal syncs with grid selections
- **Persistent Caching**: Service Worker ensures fast loading

### 💾 **Backup & Sync**
- **Embedding Export**: Export all photo embeddings to OneDrive (JSON format)
- **Chunked Uploads**: Reliable upload of large files (>4MB) using Microsoft Graph sessions
- **Embedding Import**: Import embeddings from previous exports
- **Conflict Resolution**: Choose how to handle duplicate embeddings during import
- **File Management**: View, delete, and manage embedding backup files
- **Cross-Device Sync**: Share embeddings between devices to avoid reprocessing

### 🎯 **Smart Features**
- **Find Similar Photos**: Right-click or use modal button to find photos similar to any specific photo
- **Photo Series Detection**: Automatically find burst photo sequences and long photo sessions
- **Date Range Filter**: Global date filter applies to all analysis operations
- **Collapsible Panels**: Organize UI with expandable/collapsible sections
- **Progress Tracking**: Real-time progress indicators for all operations
- **Status Updates**: Live status bar shows current operations and database stats

### 🐛 **Development & Debugging**
- **Debug Console**: Mobile-friendly debug overlay for development and troubleshooting
- **Worker Logging**: Capture and display Web Worker messages in debug console
- **Error Handling**: Comprehensive error catching and user-friendly error messages
- **Mobile-Optimized**: Special debugging features for mobile development

### ⚙️ **Configurable Settings**
- **Performance Tuning**: Adjustable worker count (1-8) based on device capabilities
- **Analysis Parameters**: 
  - Similarity threshold (50%-99%)
  - Time window for sessions (0-24 hours)
  - Minimum group size (2-20 photos)
  - Series density (0.5-10 photos/min)
  - Maximum time gap (1-60 minutes)
- **Persistent Settings**: All preferences saved locally in IndexedDB
- **Filter Memory**: Last used filters and folder paths restored on app restart
- **Sort Preferences**: Remember sorting preferences for browser and results

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

#### 1. Initial Setup
1. **Login**: Click "Login with Microsoft" and authenticate with your Microsoft account
2. **Grant Permissions**: Allow access to your OneDrive when prompted
3. **Wait for Models**: The app will download AI models (~50MB) on first use
4. **Browse Your Photos**: The app opens to the OneDrive Browser showing root folder

#### 2. Indexing Your Photos
**Option A: Auto-Index While Browsing (Recommended)**
- Simply browse folders in the OneDrive Browser
- Photos are automatically indexed as you navigate
- Embedding workers start processing in the background

**Option B: Queue Full Folder Scans**
- Navigate to any folder and click "➕ Queue Scan"
- The scanner will recursively scan all subfolders
- Up to 5 folders scan in parallel
- Monitor progress in the "Scan Queue Status" panel

#### 3. Processing Photos
- **Automatic**: Embedding workers start automatically after scanning
- **Manual Control**: Use "▶️ Start Embedding Workers" or "⏸️ Pause" button
- **Parallel Processing**: Adjust worker count (1-8) based on your device
- **Monitor Progress**: Check "Processing" panel for queue status

#### 4. Finding Duplicates (Similarity Analysis)
1. Navigate to "Similarity Analysis" panel
2. Adjust settings:
   - **Similarity Threshold**: 85-95% for duplicates (lower = more results)
   - **Time Window**: 2-8 hours for photo sessions (0 = no time limit)
   - **Minimum Group Size**: Filter out small groups
3. Set date range in "Date Range Filter" panel (optional)
4. Click "Analyze All Indexed Photos" (or "🔍 Analyze This Folder" in browser)
5. Review results - best photo is unselected, others selected for deletion

#### 5. Finding Photo Series
1. Navigate to "Large Photo Series" panel
2. Adjust settings:
   - **Minimum Group Size**: 20+ photos for large series
   - **Minimum Density**: 3+ photos/min for burst sequences
   - **Maximum Time Gap**: 5 minutes typical
3. Click "Analyze All Indexed Photos"
4. Perfect for finding:
   - Burst photo sequences
   - Long photography sessions
   - Time-lapse sets
   - Sports/action sequences

#### 6. Working with Results
- **Browse Photos**: Click any photo for full-screen view
- **Navigate**: Use arrow keys or ◀/▶ buttons
- **View Metadata**: Check quality scores, sharpness, exposure
- **Find Similar**: Click "🔍 Find Similar Photos" to find photos like current one
- **View in Folder**: Click "📁 View in Folder" to jump to photo's location
- **Delete Photos**: 
  - Select/unselect with checkboxes
  - Click "🗑️ Delete Selected" in each group
  - Or delete in modal and move to next photo seamlessly
- **Re-sort Results**: Use "Sort" dropdown to reorder groups

### Advanced Workflows

#### Managing Large Libraries
1. **Incremental Scanning**: Scan frequently-updated folders separately
2. **Folder-Specific Analysis**: Analyze one folder at a time for focused cleanup
3. **Date Range Focus**: Use date filter to work through library chronologically
4. **Export Embeddings**: Save your work periodically to OneDrive backup

#### Cross-Device Usage
1. **Export on Primary Device**: Use "Export Embeddings" in Backup panel
2. **Import on Other Device**: Use "Import Embeddings" to restore analysis
3. **Conflict Strategy**: Choose "Skip existing" to merge, "Overwrite" to replace

#### Finding Specific Photos
1. Open any photo in modal viewer
2. Click "🔍 Find Similar Photos"
3. View all similar photos sorted by similarity percentage
4. Navigate and delete unwanted duplicates

### Tips for Best Results

#### Performance Optimization
- **Worker Count**: 
  - Desktop: 4-6 workers
  - Mobile: 1-2 workers
  - High-end: 8 workers for maximum speed
- **Pause workers** when using other browser tabs
- **Close other tabs** during embedding generation for faster processing

#### Analysis Settings
- **Duplicate Detection**: 
  - Exact duplicates: 95-99%
  - Near duplicates: 90-95%
  - Similar shots: 85-90%
  - Loose grouping: 70-85%
- **Time Windows**:
  - Same photo session: 2-4 hours
  - Same day: 12-24 hours
  - All photos: 0 (disabled)
- **Series Detection**:
  - Burst sequences: 5+ photos/min, 2-3 min gap
  - Long sessions: 1-3 photos/min, 5-10 min gap
  - Time-lapse: 0.5-1 photos/min, 1-2 min gap

#### Best Practices
- **Backup Regularly**: Export embeddings after major processing sessions
- **Review Before Delete**: Check "best photo" selection before mass deletion
- **Use Date Filters**: Work through your library in manageable time periods
- **Browser Memory**: Clear database if it becomes too large (photos not affected)
- **URL Sharing**: Share URLs to return to specific folders or search results

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
- **Performance Optimization**: 
  - Improve AI model loading and processing speed
  - Optimize IndexedDB queries for large libraries
  - Reduce memory usage during embedding generation
- **Enhanced Analysis**:
  - Face recognition for duplicate people detection
  - GPS/location-based grouping
  - Advanced quality metrics (composition, lighting)
- **Mobile Experience**: 
  - Enhanced mobile interface and touch interactions
  - Improved performance on mobile devices
  - Native mobile app wrapper
- **Additional Features**:
  - Photo tagging and search
  - Custom folder organization
  - Bulk operations UI improvements
  - Export selected groups to new folders

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Privacy Policy

Photospace.app is designed with privacy as a core principle:
- **No Server Processing**: All AI analysis happens locally in your browser
- **No Data Collection**: We don't collect, store, or transmit your photos or personal data
- **Local Storage Only**: All data is stored locally in your browser's IndexedDB
- **Microsoft Integration**: Only uses standard Microsoft Graph API for OneDrive access
- **Open Source**: Full source code is available for transparency and security review