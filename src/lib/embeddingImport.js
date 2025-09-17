import { db } from './db.js';
import { downloadFileFromOneDrive, listEmbeddingFiles, deleteEmbeddingFile } from './graph.js';

/**
 * Import embeddings from OneDrive file
 * @param {string} fileId - OneDrive file ID to import
 * @param {string} conflictStrategy - How to handle conflicts ('skip' or 'overwrite')
 * @returns {Promise<Object>} - Import result statistics
 */
export async function importEmbeddingsFromOneDrive(fileId, conflictStrategy = 'skip') {
    try {
        console.log(`Starting embedding import from file ID: ${fileId}`);
        
        // 1. Download file content
        const fileContent = await downloadFileFromOneDrive(fileId);
        
        // 2. Parse JSON
        let importData;
        try {
            importData = JSON.parse(fileContent);
        } catch (parseError) {
            throw new Error('Invalid JSON format in embedding file');
        }
        
        // 3. Validate format
        if (!importData.metadata || !importData.embeddings || !Array.isArray(importData.embeddings)) {
            throw new Error('Invalid embedding file format - missing required fields');
        }
        
        if (importData.metadata.format !== 'photospace-embeddings-v1') {
            console.warn('Unknown format version, attempting to import anyway');
        }
        
        console.log(`Found ${importData.embeddings.length} embeddings in import file`);
        console.log(`Import file created: ${importData.metadata.exportDate}`);
        
        // 4. Import embeddings
        const result = await db.importEmbeddingData(importData.embeddings, conflictStrategy);
        
        // 5. Store import metadata
        await db.setSetting('lastEmbeddingImport', {
            date: new Date().toISOString(),
            sourceFileId: fileId,
            sourceExportDate: importData.metadata.exportDate,
            conflictStrategy: conflictStrategy,
            ...result
        });
        
        console.log('Embedding import completed:', result);
        
        return {
            success: true,
            sourceMetadata: importData.metadata,
            ...result
        };
        
    } catch (error) {
        console.error('Error importing embeddings:', error);
        throw error;
    }
}

/**
 * List available embedding files on OneDrive
 * @returns {Promise<Array>} - Array of available embedding files with metadata
 */
export async function listAvailableEmbeddingFiles() {
    try {
        const files = await listEmbeddingFiles();
        
        // Enhance with metadata if possible
        const enhancedFiles = await Promise.all(files.map(async (file) => {
            try {
                // Try to peek at metadata without downloading full file
                const content = await downloadFileFromOneDrive(file.id);
                const data = JSON.parse(content);
                
                return {
                    ...file,
                    metadata: data.metadata,
                    embeddingCount: data.metadata?.embeddingCount || 0,
                    hasValidFormat: data.metadata?.format === 'photospace-embeddings-v1'
                };
            } catch (error) {
                // If we can't read metadata, return basic info
                console.warn(`Could not read metadata for file ${file.name}:`, error);
                return {
                    ...file,
                    metadata: null,
                    embeddingCount: 0,
                    hasValidFormat: false
                };
            }
        }));
        
        // Sort by creation date (newest first)
        enhancedFiles.sort((a, b) => new Date(b.createdDateTime) - new Date(a.createdDateTime));
        
        return enhancedFiles;
        
    } catch (error) {
        console.error('Error listing embedding files:', error);
        throw error;
    }
}

/**
 * Delete an embedding file from OneDrive
 * @param {string} fileId - File ID to delete
 * @returns {Promise<void>}
 */
export async function deleteEmbeddingFileFromOneDrive(fileId) {
    try {
        await deleteEmbeddingFile(fileId);
        console.log(`Deleted embedding file: ${fileId}`);
    } catch (error) {
        console.error('Error deleting embedding file:', error);
        throw error;
    }
}

/**
 * Get information about the last import
 * @returns {Promise<Object|null>} - Last import info or null
 */
export async function getLastImportInfo() {
    try {
        return await db.getSetting('lastEmbeddingImport');
    } catch (error) {
        console.error('Error getting last import info:', error);
        return null;
    }
}

/**
 * Validate embedding file format without importing
 * @param {string} fileId - File ID to validate
 * @returns {Promise<Object>} - Validation result
 */
export async function validateEmbeddingFile(fileId) {
    try {
        const fileContent = await downloadFileFromOneDrive(fileId);
        const data = JSON.parse(fileContent);
        
        const validation = {
            valid: true,
            issues: [],
            metadata: data.metadata || null,
            embeddingCount: 0
        };
        
        // Check required fields
        if (!data.metadata) {
            validation.valid = false;
            validation.issues.push('Missing metadata section');
        }
        
        if (!data.embeddings || !Array.isArray(data.embeddings)) {
            validation.valid = false;
            validation.issues.push('Missing or invalid embeddings array');
        } else {
            validation.embeddingCount = data.embeddings.length;
            
            // Validate embedding structure
            if (data.embeddings.length > 0) {
                const sample = data.embeddings[0];
                const requiredFields = ['file_id', 'embedding', 'name', 'path'];
                
                for (const field of requiredFields) {
                    if (!(field in sample)) {
                        validation.issues.push(`Missing required field: ${field}`);
                    }
                }
                
                if (sample.embedding && !Array.isArray(sample.embedding)) {
                    validation.issues.push('Embedding data is not an array');
                }
            }
        }
        
        // Check format version
        if (data.metadata?.format !== 'photospace-embeddings-v1') {
            validation.issues.push('Unknown or missing format version');
        }
        
        return validation;
        
    } catch (error) {
        return {
            valid: false,
            issues: [`Failed to parse file: ${error.message}`],
            metadata: null,
            embeddingCount: 0
        };
    }
}
