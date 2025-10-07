/**
 * Example: How to use the Photospace Embedding Server
 * 
 * This script demonstrates how to:
 * 1. Check server health
 * 2. Process an image and get embeddings + quality scores
 */

const SERVER_URL = 'http://localhost:3001';

// Example 1: Health Check
async function checkHealth() {
    console.log('Checking server health...');
    
    const response = await fetch(`${SERVER_URL}/health`);
    const data = await response.json();
    
    console.log('Server Status:', data);
    return data.modelsLoaded;
}

// Example 2: Process Image
async function processImage(thumbnailUrl, fileId) {
    console.log(`\nProcessing image: ${fileId}`);
    console.log(`Thumbnail URL: ${thumbnailUrl}`);
    
    const startTime = Date.now();
    
    const response = await fetch(`${SERVER_URL}/process-image`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            thumbnailUrl,
            fileId
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Server error: ${error.error}`);
    }
    
    const result = await response.json();
    const clientTime = Date.now() - startTime;
    
    console.log('\n✅ Processing Complete!');
    console.log(`Server processing time: ${result.processingTime}ms`);
    console.log(`Total roundtrip time: ${clientTime}ms`);
    console.log(`\nQuality Metrics:`);
    console.log(`  Sharpness: ${result.qualityMetrics.sharpness.toFixed(2)}`);
    console.log(`  Exposure Brightness: ${(result.qualityMetrics.exposure.meanBrightness * 100).toFixed(1)}%`);
    console.log(`  Faces Detected: ${result.qualityMetrics.face?.faceCount || 0}`);
    console.log(`  Overall Quality Score: ${(result.qualityMetrics.qualityScore * 100).toFixed(1)}%`);
    console.log(`\nEmbedding:`);
    console.log(`  Dimensions: ${result.embedding.length}`);
    console.log(`  First 5 values: [${result.embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
    
    return result;
}

// Example 3: Batch Processing
async function processBatch(images) {
    console.log(`\n📦 Processing batch of ${images.length} images...\n`);
    
    const results = [];
    const startTime = Date.now();
    
    // Process sequentially (or use Promise.all for parallel)
    for (const img of images) {
        try {
            const result = await processImage(img.thumbnailUrl, img.fileId);
            results.push({ success: true, ...result });
        } catch (error) {
            console.error(`❌ Failed to process ${img.fileId}:`, error.message);
            results.push({ success: false, fileId: img.fileId, error: error.message });
        }
    }
    
    const totalTime = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    
    console.log(`\n📊 Batch Summary:`);
    console.log(`  Total images: ${images.length}`);
    console.log(`  Successful: ${successCount}`);
    console.log(`  Failed: ${images.length - successCount}`);
    console.log(`  Total time: ${(totalTime / 1000).toFixed(1)}s`);
    console.log(`  Average per image: ${(totalTime / images.length).toFixed(0)}ms`);
    
    return results;
}

// Main execution
async function main() {
    try {
        // 1. Check health
        const isHealthy = await checkHealth();
        if (!isHealthy) {
            console.log('⚠️  Models not loaded yet. They will load on first request.');
        }
        
        // 2. Example single image processing
        // Replace with actual OneDrive thumbnail URL
        const exampleThumbnailUrl = 'https://example.com/thumbnail.jpg';
        const exampleFileId = 'example-file-id';
        
        console.log('\n--- Single Image Example ---');
        console.log('To test with a real image, replace the URL and file ID above.');
        console.log('Example:');
        console.log('  const result = await processImage(');
        console.log('    "https://graph.microsoft.com/v1.0/me/drive/items/YOUR_ID/thumbnails/0/large/content",');
        console.log('    "YOUR_FILE_ID"');
        console.log('  );');
        
        // Uncomment to test with real image:
        // const result = await processImage(exampleThumbnailUrl, exampleFileId);
        
        // 3. Example batch processing
        console.log('\n--- Batch Processing Example ---');
        console.log('To process multiple images:');
        console.log('  const images = [');
        console.log('    { thumbnailUrl: "url1", fileId: "id1" },');
        console.log('    { thumbnailUrl: "url2", fileId: "id2" },');
        console.log('  ];');
        console.log('  const results = await processBatch(images);');
        
        // Uncomment to test batch:
        // const images = [
        //     { thumbnailUrl: 'url1', fileId: 'id1' },
        //     { thumbnailUrl: 'url2', fileId: 'id2' }
        // ];
        // const results = await processBatch(images);
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.log('\nMake sure the server is running:');
        console.log('  cd server');
        console.log('  npm start');
    }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

// Export functions for use in other scripts
export { checkHealth, processImage, processBatch };
