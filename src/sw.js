// Service Worker for caching authenticated Microsoft Graph images
const CACHE_NAME = 'photospace-images-v1';
const AUTH_CACHE_NAME = 'photospace-auth-v1';

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
    }
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Only handle our custom image URLs
    if (url.pathname.startsWith('/api/image/')) {
        event.respondWith(handleImageRequest(event.request));
    }
});

async function handleImageRequest(request) {
    const url = new URL(request.url);
    const fileId = url.pathname.replace('/api/image/', '');
    
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
        const token = authTokens.get('current');
        if (!token) {
            throw new Error('No auth token available');
        }
        
        const graphUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`;
        const response = await fetch(graphUrl, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`Graph API error: ${response.status}`);
        }
        
        // Clone response for caching
        const responseToCache = response.clone();
        
        // Create cacheable response with proper headers
        const cacheableResponse = new Response(responseToCache.body, {
            status: 200,
            statusText: 'OK',
            headers: {
                'Content-Type': response.headers.get('Content-Type') || 'image/jpeg',
                'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
                'Last-Modified': new Date().toUTCString()
            }
        });
        
        // Cache the response
        await cache.put(cacheKey, cacheableResponse.clone());
        
        console.log('Cached new image:', fileId);
        return cacheableResponse;
        
    } catch (error) {
        console.error('Error fetching image:', error);
        
        // Return a fallback or error response
        return new Response('Error loading image', {
            status: 500,
            statusText: 'Internal Server Error'
        });
    }
}
