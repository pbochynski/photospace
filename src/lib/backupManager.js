import { db } from './db.js';
import { exportEmbeddingsToOneDrive, getLastExportInfo, estimateExportSize } from './embeddingExport.js';
import { importEmbeddingsFromOneDrive, listAvailableEmbeddingFiles, deleteEmbeddingFileFromOneDrive, getLastImportInfo, getEmbeddingFileMetadata } from './embeddingImport.js';

/**
 * Backup Manager Module
 * Handles embedding import/export functionality
 */

/**
 * Handle export embeddings button click
 * @param {Function} updateStatusFn - Function to update status display
 * @param {HTMLElement} exportBtn - Export button element
 * @param {HTMLElement} exportInfoEl - Export info display element
 * @returns {Promise<void>}
 */
export async function handleExportEmbeddings(updateStatusFn, exportBtn, exportInfoEl) {
    try {
        exportBtn.disabled = true;
        updateStatusFn('Preparing embeddings for export...', true);
        
        const result = await exportEmbeddingsToOneDrive();
        
        updateStatusFn(`Successfully exported ${result.embeddingCount} embeddings (${result.fileSizeMB} MB) to OneDrive`, false);
        
        // Update export info
        exportInfoEl.textContent = `Last export: ${result.embeddingCount} embeddings (${result.fileSizeMB} MB)`;
        
    } catch (error) {
        console.error('Export failed:', error);
        
        // Check if it's because there are no embeddings
        if (error.message.includes('No embeddings found to export')) {
            updateStatusFn('No embeddings to export yet. Generate embeddings first, then try exporting again.', false);
        } else {
            updateStatusFn(`Export failed: ${error.message}`, false);
        }
    } finally {
        exportBtn.disabled = false;
    }
}

/**
 * Handle import embeddings button click
 * @param {HTMLElement} importModalEl - Import modal element
 * @param {Function} showSectionFn - Function to show import sections
 * @param {Function} displayFileListFn - Function to display file list
 * @returns {Promise<void>}
 */
export async function handleImportEmbeddings(importModalEl, showSectionFn, displayFileListFn) {
    try {
        importModalEl.style.display = 'flex';
        showSectionFn('loading');
        
        const files = await listAvailableEmbeddingFiles();
        
        if (files.length === 0) {
            showSectionFn('file-selection');
            const importFileList = document.getElementById('import-file-list');
            if (importFileList) {
                importFileList.innerHTML = '<p>No embedding files found on OneDrive.</p>';
            }
            return;
        }
        
        displayFileListFn(files);
        showSectionFn('file-selection');
        
    } catch (error) {
        console.error('Failed to load import files:', error);
        alert(`Failed to load import files: ${error.message}`);
        closeImportModal();
    }
}

/**
 * Display list of import files
 * @param {Array} files - List of embedding files
 * @param {Function} deleteFileFn - Function to delete a file
 * @returns {void}
 */
export function displayImportFileList(files, deleteFileFn) {
    const importFileList = document.getElementById('import-file-list');
    const importOptions = document.querySelector('.import-options');
    const confirmImportBtn = document.getElementById('confirm-import-btn');
    
    if (!importFileList) return;
    
    importFileList.innerHTML = '';
    
    files.forEach(file => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.dataset.fileId = file.id;
        
        const formatDate = (dateStr) => new Date(dateStr).toLocaleString();
        const formatSize = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        
        fileItem.innerHTML = `
            <div class="file-info">
                <div class="file-name">${file.name}</div>
                <div class="file-meta">
                    Click to load details • ${formatSize(file.size)} • ${formatDate(file.createdDateTime)}
                    ${file.hasValidFormat ? '' : ' • ⚠️ Unknown format'}
                </div>
            </div>
            <div class="file-actions">
                <button type="button" class="delete-file-btn" data-file-id="${file.id}">Delete</button>
            </div>
        `;
        
        // Add delete button handler
        const deleteBtn = fileItem.querySelector('.delete-file-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteFileFn(file.id, deleteBtn);
        });
        
        // Add file selection handler
        fileItem.addEventListener('click', async (e) => {
            if (e.target.tagName === 'BUTTON') return;
            
            // Clear previous selection
            document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected'));
            
            // Select this item
            fileItem.classList.add('selected');
            
            // Show loading state
            const metaDiv = fileItem.querySelector('.file-meta');
            const originalMeta = metaDiv.innerHTML;
            metaDiv.innerHTML = 'Loading file details...';
            if (confirmImportBtn) confirmImportBtn.disabled = true;
            
            try {
                // Load metadata on demand
                const metadata = await getEmbeddingFileMetadata(file.id);
                
                if (metadata.valid) {
                    // Update display with actual metadata
                    metaDiv.innerHTML = `
                        ${metadata.embeddingCount} embeddings • ${formatSize(file.size)} • ${formatDate(file.createdDateTime)}
                        ${metadata.hasValidFormat ? '' : ' • ⚠️ Unknown format'}
                        ${metadata.exportDate ? ` • Exported: ${formatDate(metadata.exportDate)}` : ''}
                    `;
                    
                    // Show import options
                    if (importOptions) importOptions.style.display = 'block';
                    if (confirmImportBtn) {
                        confirmImportBtn.disabled = false;
                        confirmImportBtn.dataset.fileId = file.id;
                    }
                } else {
                    metaDiv.innerHTML = `${originalMeta} • ❌ Invalid file format`;
                    if (importOptions) importOptions.style.display = 'none';
                    if (confirmImportBtn) confirmImportBtn.disabled = true;
                }
            } catch (error) {
                console.error('Error loading file metadata:', error);
                metaDiv.innerHTML = `${originalMeta} • ❌ Error loading details`;
                if (importOptions) importOptions.style.display = 'none';
                if (confirmImportBtn) confirmImportBtn.disabled = true;
            }
        });
        
        importFileList.appendChild(fileItem);
    });
}

/**
 * Delete an import file
 * @param {string} fileId - File ID to delete
 * @param {HTMLElement} buttonElement - Delete button element
 * @returns {Promise<void>}
 */
export async function deleteImportFile(fileId, buttonElement) {
    if (!confirm('Are you sure you want to delete this embedding file?')) {
        return;
    }
    
    try {
        buttonElement.disabled = true;
        buttonElement.textContent = 'Deleting...';
        
        await deleteEmbeddingFileFromOneDrive(fileId);
        
        // Remove from UI
        buttonElement.closest('.file-item').remove();
        
        // Hide options if this was the selected file
        const confirmImportBtn = document.getElementById('confirm-import-btn');
        const importOptions = document.querySelector('.import-options');
        
        if (confirmImportBtn && confirmImportBtn.dataset.fileId === fileId) {
            if (importOptions) importOptions.style.display = 'none';
            confirmImportBtn.disabled = true;
        }
        
    } catch (error) {
        console.error('Delete failed:', error);
        alert(`Failed to delete file: ${error.message}`);
        buttonElement.disabled = false;
        buttonElement.textContent = 'Delete';
    }
}

/**
 * Perform import operation
 * @param {Function} showSectionFn - Function to show import sections
 * @param {HTMLElement} importInfoEl - Import info display element
 * @returns {Promise<void>}
 */
export async function performImport(showSectionFn, importInfoEl) {
    const confirmImportBtn = document.getElementById('confirm-import-btn');
    const conflictStrategySelect = document.getElementById('conflict-strategy');
    const importSummary = document.getElementById('import-summary');
    const importStatus = document.getElementById('import-status');
    
    if (!confirmImportBtn) return;
    
    const fileId = confirmImportBtn.dataset.fileId;
    const conflictStrategy = conflictStrategySelect?.value || 'skip';
    
    if (!fileId) {
        alert('No file selected');
        return;
    }
    
    try {
        showSectionFn('progress');
        if (importStatus) {
            importStatus.textContent = 'Downloading and processing embeddings...';
        }
        
        const result = await importEmbeddingsFromOneDrive(fileId, conflictStrategy);
        
        // Show results
        if (importSummary) {
            importSummary.innerHTML = `
                <div class="summary-item">
                    <span class="label">Source Export Date:</span>
                    <span class="value">${new Date(result.sourceMetadata.exportDate).toLocaleString()}</span>
                </div>
                <div class="summary-item">
                    <span class="label">Total in File:</span>
                    <span class="value">${result.sourceMetadata.embeddingCount}</span>
                </div>
                <div class="summary-item">
                    <span class="label">Newly Imported:</span>
                    <span class="value">${result.imported}</span>
                </div>
                <div class="summary-item">
                    <span class="label">Updated Existing:</span>
                    <span class="value">${result.updated}</span>
                </div>
                <div class="summary-item">
                    <span class="label">Skipped:</span>
                    <span class="value">${result.skipped}</span>
                </div>
            `;
        }
        
        showSectionFn('results');
        
        // Update import info in main panel
        if (importInfoEl) {
            importInfoEl.textContent = `Last import: ${result.imported + result.updated} embeddings imported/updated`;
        }
        
    } catch (error) {
        console.error('Import failed:', error);
        alert(`Import failed: ${error.message}`);
        showSectionFn('file-selection');
    }
}

/**
 * Show specific import modal section
 * @param {string} section - Section name to show
 * @returns {void}
 */
export function showImportSection(section) {
    const sections = ['loading', 'file-selection', 'progress', 'results'];
    sections.forEach(s => {
        const el = document.getElementById(`import-${s}`);
        if (el) {
            el.style.display = s === section ? 'block' : 'none';
        }
    });
}

/**
 * Close import modal
 * @returns {void}
 */
export function closeImportModal() {
    const importModal = document.getElementById('import-modal');
    const importOptions = document.querySelector('.import-options');
    const confirmImportBtn = document.getElementById('confirm-import-btn');
    
    if (importModal) importModal.style.display = 'none';
    
    // Reset modal state
    if (importOptions) importOptions.style.display = 'none';
    if (confirmImportBtn) {
        confirmImportBtn.disabled = true;
        confirmImportBtn.removeAttribute('data-file-id');
    }
    
    // Clear selections
    document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected'));
}

/**
 * Initialize backup panel with current status
 * @param {HTMLElement} exportBtn - Export button element
 * @param {HTMLElement} exportInfoEl - Export info display element
 * @param {HTMLElement} importInfoEl - Import info display element
 * @returns {Promise<void>}
 */
export async function initializeBackupPanel(exportBtn, exportInfoEl, importInfoEl) {
    try {
        // Always enable the export button
        if (exportBtn) exportBtn.disabled = false;
        
        // Check if we have embeddings to show accurate info
        const sizeEstimate = await estimateExportSize();
        
        if (exportInfoEl) {
            if (sizeEstimate.embeddingCount > 0) {
                exportInfoEl.textContent = `Ready to export: ${sizeEstimate.embeddingCount} embeddings (~${sizeEstimate.estimatedSizeMB} MB)`;
            } else {
                exportInfoEl.textContent = 'Export will include any existing embeddings (may be empty if no embeddings generated yet)';
            }
            
            // Show last export info if available
            const lastExport = await getLastExportInfo();
            if (lastExport) {
                const date = new Date(lastExport.date).toLocaleString();
                exportInfoEl.textContent += ` • Last export: ${date}`;
            }
        }
        
        // Show last import info if available
        if (importInfoEl) {
            const lastImport = await getLastImportInfo();
            if (lastImport) {
                const date = new Date(lastImport.date).toLocaleString();
                importInfoEl.textContent = `Last import: ${lastImport.imported + lastImport.updated} embeddings • ${date}`;
            }
        }
        
    } catch (error) {
        console.error('Error initializing backup panel:', error);
        // Even on error, keep export button enabled
        if (exportBtn) exportBtn.disabled = false;
        if (exportInfoEl) exportInfoEl.textContent = 'Export available (click to check for embeddings)';
    }
}

