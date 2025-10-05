# Quality Score Improvements

## Overview
Enhanced the photo quality scoring system with improved algorithms for sharpness, exposure, and added face quality analysis using the Human library.

## Changes Made

### 1. **Improved Sharpness Calculation**
Previously used simple variance calculation. Now uses **proper Laplacian edge detection**:
- Applies Laplacian kernel `[[0,1,0], [1,-4,1], [0,1,0]]` to detect edges
- Measures edge strength and distribution
- Combines mean edge strength with edge density
- Sharp images typically score 15-40, blurry images < 10

**Benefits:**
- More accurate blur detection
- Better discrimination between sharp and soft images
- Considers both edge strength and distribution

### 2. **Enhanced Exposure Analysis**
Previously used only mean brightness. Now uses **histogram-based analysis**:
- **Mean Brightness**: Overall image brightness (0-1 scale)
- **Clipping Detection**: Measures % of pixels at pure black/white extremes
- **Dynamic Range**: Spread of tonal values across histogram
- **Entropy**: Quality of tonal distribution (higher = better spread)

**Scoring:**
- Optimal brightness: 0.4-0.6 (mid-tones)
- Clipping penalty: > 5% clipped pixels reduces score
- Dynamic range: > 0.6 is considered good
- Entropy: Indicates well-distributed tones

### 3. **Face Quality Analysis (NEW)**
Integrated the **Human library** (face-api successor) for face detection and scoring:

**Face Metrics:**
- **Eyes Open**: Detects if both eyes are open (important for portraits)
- **Smile Detection**: Uses emotion detection to identify happy expressions
- **Natural Expression**: Penalizes extreme negative emotions (anger, fear, disgust, sadness)
- **Face Confidence**: Detection confidence score
- **Face Size**: Larger faces in frame score higher (10% of image area is optimal)

**Benefits:**
- Automatically identifies better portrait photos
- Rewards photos with open eyes and natural expressions
- Helps filter out blinks, awkward expressions
- Adjusts quality weighting when faces are present

### 4. **Improved Quality Score Calculation**

**Without Faces (landscapes, objects, etc.):**
- Sharpness: 55%
- Exposure: 45%

**With Faces (portraits):**
- Sharpness: 35%
- Exposure: 30%
- Face Quality: 35%

## Technical Details

### Dependencies Added
```javascript
import Human from 'https://cdn.jsdelivr.net/npm/@vladmandic/human/dist/human.esm.js';
```

### Human Library Configuration
```javascript
{
  backend: 'webgl',
  face: {
    enabled: true,
    detector: { 
      enabled: true, 
      maxDetected: 20,        // Detect up to 20 faces
      minConfidence: 0.5,     // 50% minimum confidence
      iouThreshold: 0.4       // Overlap filtering
    },
    mesh: { enabled: true },
    emotion: { 
      enabled: true,
      minConfidence: 0.3      // 30% minimum for emotions
    }
  }
}
```

### Quality Metrics Structure
```javascript
qualityMetrics: {
  sharpness: 25.4,                    // Laplacian edge score
  exposure: {
    meanBrightness: 0.52,             // 0-1 scale
    clipping: 0.03,                   // 3% clipped pixels
    dynamicRange: 0.78,               // Good range
    entropy: 0.85                     // Good distribution
  },
  face: {
    faceScore: 0.87,                  // Overall face quality
    faceCount: 2,                     // Number of faces
    details: [
      {
        eyesOpen: 1.0,
        smile: 0.78,
        naturalExpression: 0.92,
        confidence: 0.95,
        faceSize: 0.65
      }
    ]
  },
  qualityScore: 0.78                  // Final combined score (0-1)
}
```

## Performance Considerations

- **Laplacian calculation**: Fast, processes entire image with single pass
- **Histogram analysis**: O(n) single pass through pixels
- **Face detection**: More expensive, but runs on WebGL for acceleration
- **Graceful degradation**: If Human library fails to load, falls back to basic quality metrics

## Bug Fixes

### NaN Quality Scores for Photos with People (Fixed)
**Problem**: Quality scores were showing as `NaN` for images with detected faces.

**Root Cause**: 
1. Improper image data conversion from RawImage (RGB/RGBA) to ImageData (always RGBA) when passing to Human library
2. Missing alpha channel values causing corrupted image data
3. No validation of intermediate calculation results

**Solution**:
1. **Fixed Image Data Conversion** (Lines 480-502 in worker.js):
   - Properly handles RGB (3 channels) to RGBA (4 channels) conversion
   - Sets alpha channel to 255 when not present
   - Handles both RGB and grayscale source images
   
2. **Added Comprehensive Validation** (Throughout worker.js):
   - All face metrics validated with `isFinite()` checks
   - Invalid values replaced with sensible defaults (0 or 0.5)
   - Scores clamped to [0, 1] range
   - Added validation for:
     - Individual face metrics (eyes, smile, expression, confidence, size)
     - Per-face scores
     - Overall face quality score
     - Final quality score calculation
     
3. **UI Safety Checks** (main.js):
   - Display functions validate all numeric values before rendering
   - Shows "N/A" for any invalid metrics
   - Prevents NaN from appearing in user interface

**Result**: Quality scores now always return valid numbers between 0 and 1, even if face detection encounters issues.

### Face Count Limited to 0 or 1 (Fixed)
**Problem**: Face detection was only finding 0 or 1 face, never detecting multiple faces in group photos.

**Root Cause**: 
The Human library's default `maxDetected` setting limits detection to 1 face. Without explicitly setting this parameter, the detector stops after finding the first face.

**Solution** (Lines 406-420 in worker.js):
```javascript
face: {
  detector: { 
    enabled: true, 
    rotation: false,
    maxDetected: 20,        // Allow up to 20 faces per image
    minConfidence: 0.5,     // Minimum confidence for detection
    iouThreshold: 0.4,      // Overlap threshold for filtering
    return: true
  },
  emotion: { 
    enabled: true,
    minConfidence: 0.3      // Lower threshold for emotion detection
  }
}
```

**Additional Improvements**:
- Added logging to track number of faces detected
- Logs face analysis completion with count and average score
- Helps debug face detection issues

**Result**: Now correctly detects multiple faces in group photos (up to 20 faces per image).

### Face Metrics Not Displayed in UI (Fixed)
**Problem**: Face detection was working (visible in logs), but face scores weren't displayed when viewing photos.

**Root Cause**: 
Face metrics from the worker were not being saved to the IndexedDB database. The `updatePhotoEmbedding` function only saved `sharpness`, `exposure`, and `quality_score` but not the `face` object.

**Solution** (db.js):
1. **Save face metrics** when updating embeddings (line 323)
2. **Import face metrics** when importing from backups (lines 239, 260)
3. **Export face metrics** in backup files (line 196)

```javascript
// Now saves all quality metrics including face data
if (qualityMetrics) {
    photo.sharpness = qualityMetrics.sharpness;
    photo.exposure = qualityMetrics.exposure;
    photo.face = qualityMetrics.face;  // ✨ Added
    photo.quality_score = qualityMetrics.qualityScore;
}
```

**Result**: Face metrics are now properly persisted and displayed in the UI showing face count, face quality score, and detailed metrics (eyes open, smile, natural expression).

### OneDrive Browser Photos Don't Open in Full Screen (Fixed)
**Problem**: Clicking photos in the OneDrive Browser panel didn't open the full-size image modal. This only worked from the similar groups results.

**Root Cause**: 
The `renderBrowserPhotoGrid` function rendered photo thumbnails but didn't add click event listeners to open the full-size modal. The similar groups display had this functionality, but it was missing from the browser panel.

**Solution** (main.js:834-887):
Added click event listeners to all browser photos that:
1. Open the image modal on click
2. Fetch full photo data from database (including quality metrics)
3. Display metadata overlay with quality scores
4. Load full-size image in background
5. Use service worker for caching

```javascript
// Add click event listeners to browser photos for full-size modal
browserPhotoGrid.querySelectorAll('.photo-item img').forEach((img, idx) => {
    img.addEventListener('click', async (e) => {
        // ... open modal and load full-size image
    });
});
```

**Additional Features**:
- Fetches photo from database to show quality metrics even in browser view
- Falls back to OneDrive data if photo not yet indexed
- Shows face detection results for browser photos too
- Reuses existing modal infrastructure for consistency

**Result**: Photos from OneDrive Browser now open in full-screen modal with all quality metrics displayed, just like the similar groups results.

### Auto-Indexing from OneDrive Browser (NEW FEATURE)
**Feature**: Photos are now automatically indexed to the database as you browse OneDrive folders.

**Implementation** (main.js:786-811):
When you browse any folder in the OneDrive Browser panel, the app automatically:
1. **Indexes all photos** in that folder to the local database
2. **Preserves existing data** - if photo already indexed, keeps embeddings and quality metrics
3. **Queues new photos** - new photos get `embedding_status: 0` (ready for embedding generation)
4. **Updates scan tracking** - refreshes scan_id for visited folders
5. **Logs progress** - shows how many photos indexed and need embeddings

```javascript
// Automatically index browsed photos to database
if (photos.length > 0) {
    const scanId = Date.now();
    const photosToIndex = photos.map(photo => ({
        ...photo,
        scan_id: scanId,
        embedding_status: photo.embedding_status !== undefined ? photo.embedding_status : 0
    }));
    await db.addOrUpdatePhotos(photosToIndex);
    console.log(`Auto-indexed ${photos.length} photos from browsing`);
}
```

**Smart Update Logic**:
The `addOrUpdatePhotos` function intelligently handles updates:
- **Existing photos**: Preserves embeddings, quality metrics, and processing status
- **New photos**: Adds to database with `embedding_status: 0` (queued for processing)
- **Non-blocking**: Doesn't slow down browsing experience

**Benefits**:
✅ **No manual scanning needed** - just browse your folders naturally  
✅ **Discover-as-you-go** - photos automatically queued for processing  
✅ **Efficient** - doesn't reprocess photos that already have embeddings  
✅ **Seamless UX** - happens in background without disrupting browsing  

**Workflow**:
1. Browse OneDrive folders → Photos automatically indexed
2. Generate embeddings → Only processes new/unprocessed photos
3. Run analysis → All browsed photos included
4. No need to manually scan entire OneDrive tree

**Result**: You can now casually browse your OneDrive, and all viewed photos are automatically added to your indexed collection, ready for embedding generation and analysis!

### UI Refactoring: Analysis Moved to Browser (UX IMPROVEMENT)
**Change**: Refactored the UI to make analysis more intuitive by moving folder-specific analysis to the OneDrive Browser.

**Before**:
- Similarity Analysis section had a split button with "Current Folder Only" and "All Indexed Photos" options
- Confusing which "current folder" it referred to
- Extra clicks needed to analyze a specific folder

**After**:
- **OneDrive Browser** now has "🔍 Analyze This Folder" button right in the toolbar
- **Similarity Analysis** section simplified to single "Analyze All Indexed Photos" button
- Clear separation: Browse and analyze specific folders vs. analyze everything

**Changes Made**:
1. **HTML** (index.html):
   - Added `browser-analyze` button to browser toolbar (line 59)
   - Removed split button and menu from analysis section (line 183)
   - Added emojis to browser buttons for better visual clarity

2. **JavaScript** (main.js):
   - Added `browserAnalyzeBtn` event handler (line 2278-2282)
   - Simplified analysis button to only call `runAnalysisForScope('all')` (line 2144-2146)
   - Removed analysis menu and split button handlers

**Workflow Now**:
```
OneDrive Browser:
├─ 📁 Up → Navigate up one folder
├─ 🔍 Analyze This Folder → Analyze currently browsed folder
├─ ➕ Add to Scanned → Add to scanned folders list
└─ 🔄 Refresh → Reload current folder

Similarity Analysis:
└─ Analyze All Indexed Photos → Analyze entire collection
```

**Benefits**:
✅ **More intuitive** - analyze button right where you're browsing  
✅ **Less confusion** - clear what "current folder" means  
✅ **Faster workflow** - one click to analyze what you're looking at  
✅ **Better organization** - browser actions in browser, global actions in analysis  

**Result**: Much cleaner UX with context-specific actions where they make sense!

### Bug Fixes: Modal Close and Auto-Indexing (Fixed)

#### Issue 1: Modal Can't Be Closed from Browser Photos
**Problem**: When opening a photo from the OneDrive Browser, the close button and Escape key didn't work.

**Root Cause**: 
Modal close handlers were only initialized inside `displayResults()` function, which only runs when showing similar photo groups. Browser photos opened the modal but had no way to close it!

**Solution** (main.js:880-925, 2335):
- Created `initializeImageModal()` function to set up handlers once at startup
- Moved all modal close logic out of `displayResults()`
- Called from `main()` during app initialization
- Now works for both browser photos and analysis results

```javascript
// Initialize modal handlers at startup
function initializeImageModal() {
    const closeModal = () => {
        modal.style.display = 'none';
        modalImg.src = '';
        // Reset metadata overlay
    };
    
    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
        }
    });
}
```

#### Issue 2: Photos Not Being Auto-Indexed from Browser
**Problem**: Despite the auto-indexing code, photos weren't being saved to IndexedDB when browsing folders.

**Root Cause**:
- Photos from `fetchFolderChildren` had missing/inconsistent field formats
- `photo_taken_ts` was a string, not timestamp
- Missing required fields like `embedding_status`, `embedding`, `scan_id`

**Solution** (main.js:745-796):
- Properly format all required database fields
- Convert date strings to timestamps
- Set default values for missing fields
- Added visual feedback with status updates
- Better logging with emojis

```javascript
const photosToIndex = photos.map(photo => {
    const photoTakenTs = photo.photo_taken_ts 
        ? (typeof photo.photo_taken_ts === 'string' 
            ? new Date(photo.photo_taken_ts).getTime() 
            : photo.photo_taken_ts)
        : Date.now();
    
    return {
        file_id: photo.file_id,
        name: photo.name,
        size: photo.size || 0,
        path: photo.path || '/drive/root:',
        last_modified: photo.last_modified || new Date().toISOString(),
        photo_taken_ts: photoTakenTs,
        embedding_status: 0,
        embedding: null,
        scan_id: scanId
    };
});

await db.addOrUpdatePhotos(photosToIndex);
console.log(`✅ Auto-indexed ${photos.length} photos from browsing`);
```

**Visual Feedback Added**:
- Status bar shows: `"Auto-indexed X photos (Y need embeddings)"` for 3 seconds
- Console shows: `✅ Auto-indexed`, `📊 Total indexed`, `❌ Failed` with emojis
- Helps users see that auto-indexing is working

**Result**: Both issues fixed! Modal closes properly from anywhere, and auto-indexing works reliably with visual feedback.

### Debugging: Analysis Returns Empty Results

If analysis returns no results, check the console for debugging information:

**Debug Output Added** (main.js:1777-1848):
```
📊 Analysis scope: all indexed photos, found X photos with embeddings
📅 Date filter active: MM/DD/YYYY to MM/DD/YYYY
📅 Date filter: X photos → Y photos (filtered out Z)
🔍 Found X similar groups (before min size filter)
🔍 After min size filter (≥3): Y groups (filtered out Z small groups)
```

**Common Issues & Solutions:**

1. **No photos with embeddings**
   ```
   ⚠️ No photos with embeddings. Total photos: 150, Without embeddings: 150
   ```
   **Solution**: Generate embeddings first!
   - Click "Generate Embeddings (All Indexed)"
   - Wait for processing to complete
   - Then run analysis

2. **Date filter too restrictive**
   ```
   📅 Date filter: 100 photos → 0 photos (filtered out 100)
   ```
   **Solution**: Adjust or disable date filter
   - Toggle date filter OFF temporarily
   - Or expand the date range in Similarity Analysis section

3. **All groups filtered out by min group size**
   ```
   🔍 Found 10 similar groups (before min size filter)
   🔍 After min size filter (≥3): 0 groups (filtered out 10 small groups)
   ```
   **Solution**: Lower the "Minimum Group Size" setting
   - In Similarity Analysis section
   - Reduce from 3 to 2 photos

4. **Similarity threshold too high**
   - Lower the similarity threshold (try 0.85 instead of 0.90)
   - More lenient = more groups found

**Quick Diagnostic Steps:**
1. Check console for `📊 Analysis scope` message - shows how many photos with embeddings
2. If 0, generate embeddings first
3. Check `📅 Date filter` messages - shows if date filter is excluding photos
4. Check `🔍 Found X similar groups` - shows if groups are being found
5. If groups found but then filtered out, adjust min group size

**Result**: Comprehensive debugging helps identify exactly why analysis returns empty results!

### Fix: Temporal Clustering Creating Too Many Single-Photo Sessions

**Problem Identified**:
When photos are spread out over time (e.g., from different days in an album), temporal clustering creates one session per photo. Since similarity comparison only happens within sessions, this results in 0 comparisons and 0 groups found.

**Example Logs**:
```
🔎 Created 50 temporal sessions (time span: 8h)
🔎 Session 1: Only 1 photo, skipping
🔎 Session 2: Only 1 photo, skipping
...
🔎 Similarity analysis complete: 0 comparisons, 0 similar pairs found, 0 groups created
```

**Solutions Implemented**:

1. **Allow disabling temporal clustering** (analysis.js:60-63)
   - Set time window to 0 hours to treat all photos as one session
   - Compares all photos regardless of when they were taken
   - Perfect for albums/collections spanning multiple days

2. **Updated UI** (index.html:167, main.js:2224-2225)
   - Time window slider now goes from 0 to 24 hours (was 1-24)
   - 0 hours = "Disabled (compare all)"
   - 1-24 hours = temporal clustering enabled

3. **Added warning** (analysis.js:77-81)
   - If >80% of sessions have only 1 photo, shows warning
   - Suggests increasing time window or disabling (set to 0)

**Quick Fix for Users**:
1. Go to "Similarity Analysis" section
2. Find "Time Window for Photo Sessions" slider
3. **Drag all the way left to 0** → shows "Disabled (compare all)"
4. Run analysis again
5. Should now find similar photos across all time periods!

**When to Use Each Setting**:
- **0 hours (Disabled)**: Albums, collections, or photos from different days
- **1-8 hours**: Single photo session/event (recommended for burst photos)
- **12-24 hours**: Multi-session events (weddings, vacations)

**Result**: Analysis now works for both time-grouped sessions AND time-independent collections!

### Critical Fix: String Timestamps Breaking Temporal Clustering

**Problem Discovered**:
The database was storing `photo_taken_ts` as **ISO date strings** (e.g., `"2025-10-05T13:49:46.33Z"`) instead of numeric timestamps. When the temporal clustering code tried to calculate time differences:

```javascript
"2025-10-05T13:49:47.16Z" - "2025-10-05T13:49:46.33Z" = NaN  // String math = broken!
NaN < TIME_SPAN = false  // Always creates new session!
```

This caused photos taken **within seconds** to be treated as separate sessions, resulting in 50 sessions for 50 photos → 0 comparisons → 0 groups found.

**Database Example** (photos taken 1 second apart, but treated as different sessions):
```
Photo 7:  "2025-10-05T13:49:46.33Z"  ← 1 second apart
Photo 38: "2025-10-05T13:49:47.16Z"  ← 1 second apart  
Photo 39: "2025-10-05T13:49:48.2Z"   ← but split into 3 separate sessions!
```

**Fix Implemented** (analysis.js:68-76):
```javascript
// Convert string timestamps to numeric timestamps for proper temporal clustering
photosWithValidEmbeddings.forEach(photo => {
    if (typeof photo.photo_taken_ts === 'string') {
        const numericTs = new Date(photo.photo_taken_ts).getTime();
        if (!isNaN(numericTs)) {
            photo.photo_taken_ts = numericTs;
        }
    }
});
```

**Why This Happened**:
- Auto-indexing from OneDrive browser (lines 752-773 in main.js) converts timestamps correctly
- But some older records or different code paths might store strings
- The bug was **silent** - no errors, just wrong behavior

**Result**: Photos taken within the same time window now correctly group into sessions! Analysis should now work as expected. 🎉

## Usage Example

The worker now automatically:
1. Calculates improved sharpness with edge detection
2. Analyzes exposure using histogram
3. Detects faces and scores their quality (if Human library loaded)
4. Combines all metrics into final quality score
5. Returns detailed breakdown for debugging

No changes needed in calling code - the API remains the same, just with richer metrics returned.

## Future Enhancements

Potential improvements:
- Add composition analysis (rule of thirds, golden ratio)
- Detect focus quality (contrast in focus area vs edges)
- Color harmony analysis
- Noise/grain detection
- Motion blur detection (different from general sharpness)
