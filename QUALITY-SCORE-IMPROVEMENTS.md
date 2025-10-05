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
