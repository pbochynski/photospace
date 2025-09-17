import { db } from './db.js';
import { uploadFileToOneDrive } from './graph.js';

/**
 * Export all embeddings to OneDrive
 * @returns {Promise<Object>} - Export result with file info
 */
export async function exportEmbeddingsToOneDrive() {
    try {
        console.log('Starting embedding export...');
        
        // 1. Get all photos with embeddings
        const embeddings = await db.getEmbeddingExportData();
        
        if (embeddings.length === 0) {
            throw new Error('No embeddings found to export');
        }
        
        console.log(`Found ${embeddings.length} embeddings to export`);
        
        // 2. Create export object
        const exportData = {
            metadata: {
                exportDate: new Date().toISOString(),
                appVersion: "1.0.0",
                embeddingCount: embeddings.length,
                deviceInfo: navigator.userAgent,
                format: "photospace-embeddings-v1"
            },
            embeddings: embeddings
        };
        
        // 3. Convert to JSON
        const jsonContent = JSON.stringify(exportData, null, 2);
        const fileSizeMB = (new Blob([jsonContent]).size / (1024 * 1024)).toFixed(2);
        
        console.log(`Export file size: ${fileSizeMB} MB`);
        
        // 4. Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `photospace_embeddings_${timestamp}.json`;
        
        // 5. Upload to OneDrive
        console.log(`Uploading ${fileName} to OneDrive...`);
        const uploadResult = await uploadFileToOneDrive(fileName, jsonContent);
        
        // 6. Store export metadata in settings
        await db.setSetting('lastEmbeddingExport', {
            date: exportData.metadata.exportDate,
            fileName: fileName,
            fileId: uploadResult.id,
            embeddingCount: embeddings.length,
            fileSizeMB: fileSizeMB
        });
        
        console.log('Embedding export completed successfully');
        
        return {
            success: true,
            fileName: fileName,
            fileId: uploadResult.id,
            embeddingCount: embeddings.length,
            fileSizeMB: fileSizeMB,
            uploadResult: uploadResult
        };
        
    } catch (error) {
        console.error('Error exporting embeddings:', error);
        throw error;
    }
}

/**
 * Get information about the last export
 * @returns {Promise<Object|null>} - Last export info or null
 */
export async function getLastExportInfo() {
    try {
        return await db.getSetting('lastEmbeddingExport');
    } catch (error) {
        console.error('Error getting last export info:', error);
        return null;
    }
}

/**
 * Estimate export file size without actually creating the file
 * @returns {Promise<Object>} - Size estimation
 */
export async function estimateExportSize() {
    try {
        const embeddings = await db.getEmbeddingExportData();
        
        if (embeddings.length === 0) {
            return {
                embeddingCount: 0,
                estimatedSizeMB: 0
            };
        }
        
        // Sample first embedding to estimate size
        const sampleEmbedding = embeddings[0];
        const sampleSize = JSON.stringify(sampleEmbedding).length;
        
        // Add metadata overhead (estimated)
        const metadataSize = 500; // bytes
        const totalEstimatedSize = (sampleSize * embeddings.length) + metadataSize;
        const estimatedSizeMB = (totalEstimatedSize / (1024 * 1024)).toFixed(2);
        
        return {
            embeddingCount: embeddings.length,
            estimatedSizeMB: parseFloat(estimatedSizeMB)
        };
        
    } catch (error) {
        console.error('Error estimating export size:', error);
        return {
            embeddingCount: 0,
            estimatedSizeMB: 0
        };
    }
}
