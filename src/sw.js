// Service Worker for caching authenticated Microsoft Grap// Helper function to cache and return response
async function cacheAndReturnResponse(cache, cacheKey, blob, contentType, fileId, logPrefix) {
    // Create response for returning
    const returnResponse = createResponse(blob, contentType);
    
    // Create separate response for caching
    const cacheResponse = createResponse(blob, contentType);
    
    // Cache the response
    await cache.put(cacheKey, cacheResponse);
    
    return returnResponse;
} CACHE_NAME = 'photospace-images-v1';

// Store auth tokens temporarily in service worker
let authTokens = new Map();

self.addEventListener('install', (event) => {
    console.log('Service Worker installed');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker activated');
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
    if (event.data.type === 'SET_TOKEN') {
        // Store token temporarily for authenticated requests
        authTokens.set('current', event.data.token);
        console.log('Auth token set');
        
        // Send confirmation back to main thread
        event.ports[0]?.postMessage({ status: 'token_set' });
    }
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Handle our custom image URLs
    if (url.pathname.startsWith('/api/image/')) {
        event.respondWith(handleImageRequest(event.request));
    } 
    // Handle our custom thumbnail URLs
    else if (url.pathname.startsWith('/api/thumb/')) {
        event.respondWith(handleThumbnailRequest(event.request));
    } 
    else {
        // Let other requests pass through normally
        return;
    }
});

// Helper function to create response objects with proper headers
function createResponse(blob, contentType) {
    return new Response(blob.slice(), {
        status: 200,
        statusText: 'OK',
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400',
            'Last-Modified': new Date().toUTCString(),
            'Content-Length': blob.size.toString()
        }
    });
}

// Helper function to cache and return response
async function cacheAndReturnResponse(cache, cacheKey, blob, contentType, fileId, logPrefix) {
    // Create response for returning
    const returnResponse = createResponse(blob, contentType);
    
    // Create separate response for caching
    const cacheResponse = createResponse(blob, contentType);
    
    // Cache the response
    await cache.put(cacheKey, cacheResponse);
    
    console.log(`Cached new ${logPrefix}:`, fileId, 'size:', blob.size, 'bytes');
    return returnResponse;
}

// Helper function to fetch from Graph API with auth
async function fetchFromGraphAPI(url, fileId, resourceType) {
    const token = authTokens.get('current');
    if (!token) {
        console.error(`No auth token available for ${resourceType}:`, fileId);
        throw new Error('No auth token available');
    }
    
    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    
    if (!response.ok) {
        console.error(`Graph API ${resourceType} error:`, response.status, response.statusText, 'for:', fileId);
        throw new Error(`Graph API ${resourceType} error: ${response.status}`);
    }
    
    return response;
}

async function handleImageRequest(request) {
    const url = new URL(request.url);
    const fileId = url.pathname.replace('/api/image/', '');
    
    console.log('Service worker handling image request for:', fileId);
    
    // Create a stable cache key
    const cacheKey = new Request(`/api/image/${fileId}`);
    
    try {
        // Check cache first
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(cacheKey);
        
        if (cachedResponse) {
            console.log('Serving from cache:', fileId);
            return cachedResponse;
        }
        
        // Not in cache, fetch from Microsoft Graph
        const graphUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`;
        const response = await fetchFromGraphAPI(graphUrl, fileId, 'image');
        
        // Get the content type from the original response
        let contentType = response.headers.get('Content-Type') || 'image/jpeg';
        console.log('Original Content-Type:', contentType, 'for:', fileId);
        
        // Read the response as a blob to ensure we have the complete data
        const imageBlob = await response.blob();
        console.log('Blob size:', imageBlob.size, 'bytes for:', fileId);
        
        // Check if this is a HEIC/HEIF file or other unsupported format
        // HEIC files typically come as application/octet-stream from OneDrive
        const isHeicFormat = contentType === 'application/octet-stream' || 
                            contentType === 'application/octet-stream;charset=UTF-8' ||
                            contentType === 'image/heic' ||
                            contentType === 'image/heif';
        
        if (isHeicFormat) {
            console.log('📸 Detected HEIC/HEIF format, converting via Graph API thumbnail for:', fileId);
            
            // Microsoft Graph API converts HEIC→JPEG server-side
            // Using 'c1920x1920' for high quality (up to 1920px while maintaining aspect ratio)
            // Other options: 'large' (800x800), 'medium' (176x176), 'small' (96x96)
            try {
                const thumbnailUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/thumbnails/0/c1920x1920/content`;
                const thumbnailResponse = await fetchFromGraphAPI(thumbnailUrl, fileId, 'HEIC→JPEG conversion');
                
                const jpegBlob = await thumbnailResponse.blob();
                const jpegContentType = thumbnailResponse.headers.get('Content-Type') || 'image/jpeg';
                
                console.log('✅ Converted HEIC→JPEG:', jpegContentType, 'size:', Math.round(jpegBlob.size / 1024), 'KB for:', fileId);
                
                // Cache the JPEG version (NOT the HEIC)
                return await cacheAndReturnResponse(cache, cacheKey, jpegBlob, jpegContentType, fileId, 'JPEG (converted from HEIC)');
            } catch (thumbnailError) {
                console.warn('⚠️ HEIC conversion failed, trying standard thumbnail for:', fileId, thumbnailError);
                
                // Fallback to standard large thumbnail
                try {
                    const fallbackUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/thumbnails/0/large/content`;
                    const fallbackResponse = await fetchFromGraphAPI(fallbackUrl, fileId, 'thumbnail fallback');
                    const fallbackBlob = await fallbackResponse.blob();
                    const fallbackContentType = fallbackResponse.headers.get('Content-Type') || 'image/jpeg';
                    
                    return await cacheAndReturnResponse(cache, cacheKey, fallbackBlob, fallbackContentType, fileId, 'JPEG (fallback)');
                } catch (fallbackError) {
                    console.error('❌ All conversion attempts failed for:', fileId);
                    // Continue with original blob as last resort
                }
            }
        }
        
        if (imageBlob.size === 0) {
            console.error('Received empty blob for:', fileId);
            throw new Error('Received empty image data');
        }
        
        // If we get here, use the original content with proper content type
        if (contentType === 'application/octet-stream' || contentType === 'application/octet-stream;charset=UTF-8') {
            // Last resort: assume it's JPEG (some OneDrive endpoints do convert)
            contentType = 'image/jpeg';
            console.log('Using original content as JPEG for:', fileId);
        }
        
        return await cacheAndReturnResponse(cache, cacheKey, imageBlob, contentType, fileId, 'image');
        
    } catch (error) {
        console.error('Error fetching image in service worker:', error, 'for fileId:', fileId);
        
        // Return a fallback or error response
        return new Response('Error loading image', {
            status: 500,
            statusText: 'Internal Server Error'
        });
    }
}

async function handleThumbnailRequest(request) {
    const url = new URL(request.url);
    const fileId = url.pathname.replace('/api/thumb/', '');
    
    // Create a stable cache key for thumbnails (separate from full images)
    const cacheKey = new Request(`/api/thumb/${fileId}`);
    
    try {
        // Check cache first
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(cacheKey);
        
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Not in cache, fetch from Microsoft Graph thumbnail endpoint
        const thumbnailUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/thumbnails/0/large/content`;
        const response = await fetchFromGraphAPI(thumbnailUrl, fileId, 'thumbnail');
        
        // Get the content type from the response
        const contentType = response.headers.get('Content-Type') || 'image/jpeg';
        
        // Read the response as a blob
        const thumbnailBlob = await response.blob();
        
        if (thumbnailBlob.size === 0) {
            console.error('Received empty thumbnail blob for:', fileId);
            throw new Error('Received empty thumbnail data');
        }
        
        return await cacheAndReturnResponse(cache, cacheKey, thumbnailBlob, contentType, fileId, 'thumbnail');
        
    } catch (error) {
        console.error('Error fetching thumbnail in service worker:', error, 'for fileId:', fileId);
        
        // Return a fallback or error response
        return new Response('Error loading thumbnail', {
            status: 500,
            statusText: 'Internal Server Error'
        });
    }
}
