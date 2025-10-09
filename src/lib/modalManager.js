/**
 * Modal Manager Module
 * Handles photo modal display, navigation, and interactions
 */

/**
 * Initialize image modal with all event handlers
 * @param {Object} state - Application state object with modal state
 * @param {Object} callbacks - Callback functions
 * @returns {Object} - Modal control functions
 */
export function initializeModal(state, callbacks) {
    const {
        deletePhotosWithConfirmation,
        updateStatus,
        renderBrowserPhotoGrid,
        loadFullSizeImage,
        initializeServiceWorkerToken
    } = callbacks;
    
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-img');
    const closeBtn = document.getElementById('modal-close');
    const metadataToggle = document.getElementById('metadata-toggle');
    const metadataContent = document.getElementById('metadata-content');
    const deleteBtn = document.getElementById('modal-delete-btn');
    
    if (!modal || !closeBtn) {
        console.warn('Image modal elements not found');
        return null;
    }
    
    // Create navigation buttons if they don't exist
    let prevBtn = document.getElementById('modal-prev-btn');
    let nextBtn = document.getElementById('modal-next-btn');
    let counter = document.getElementById('modal-photo-counter');
    
    if (!prevBtn) {
        prevBtn = document.createElement('button');
        prevBtn.id = 'modal-prev-btn';
        prevBtn.className = 'modal-nav-btn modal-prev-btn';
        prevBtn.innerHTML = '◀';
        prevBtn.title = 'Previous photo (Left arrow)';
        modal.appendChild(prevBtn);
    }
    
    if (!nextBtn) {
        nextBtn = document.createElement('button');
        nextBtn.id = 'modal-next-btn';
        nextBtn.className = 'modal-nav-btn modal-next-btn';
        nextBtn.innerHTML = '▶';
        nextBtn.title = 'Next photo (Right arrow)';
        modal.appendChild(nextBtn);
    }
    
    if (!counter) {
        counter = document.createElement('div');
        counter.id = 'modal-photo-counter';
        counter.className = 'modal-photo-counter';
        modal.appendChild(counter);
    }
    
    // Create checkbox for photo selection
    let modalCheckbox = document.getElementById('modal-photo-checkbox');
    if (!modalCheckbox) {
        const checkboxContainer = document.createElement('label');
        checkboxContainer.className = 'modal-photo-checkbox-container';
        checkboxContainer.title = 'Select/deselect photo';
        
        modalCheckbox = document.createElement('input');
        modalCheckbox.type = 'checkbox';
        modalCheckbox.id = 'modal-photo-checkbox';
        modalCheckbox.className = 'modal-photo-checkbox';
        
        const checkboxCustom = document.createElement('span');
        checkboxCustom.className = 'modal-photo-checkbox-custom';
        
        checkboxContainer.appendChild(modalCheckbox);
        checkboxContainer.appendChild(checkboxCustom);
        modal.appendChild(checkboxContainer);
        
        // Checkbox change handler
        modalCheckbox.addEventListener('change', (e) => {
            e.stopPropagation();
            syncCheckboxToGrid(state);
        });
    }
    
    // Modal control functions
    const closeModal = () => {
        modal.dispatchEvent(new Event('hide'));
        modal.style.display = 'none';
        if (modalImg) modalImg.src = '';
        state.currentModalPhoto = null;
        state.currentModalPhotoList = [];
        state.currentModalPhotoIndex = -1;
        state.currentModalContext = null;
        if (metadataContent) metadataContent.classList.remove('collapsed');
        if (metadataToggle) metadataToggle.textContent = '📊';
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.textContent = '🗑️';
        }
    };
    
    const navigateModalPhoto = async (direction) => {
        if (state.currentModalPhotoList.length === 0 || state.currentModalPhotoIndex < 0) return;
        
        const newIndex = state.currentModalPhotoIndex + direction;
        if (newIndex < 0 || newIndex >= state.currentModalPhotoList.length) return;
        
        const photo = state.currentModalPhotoList[newIndex];
        const thumbnailSrc = `/api/thumb/${photo.file_id}`;
        
        await displayPhotoInModal(
            state,
            photo,
            thumbnailSrc,
            state.currentModalPhotoList,
            newIndex,
            state.currentModalContext,
            { loadFullSizeImage, initializeServiceWorkerToken }
        );
    };
    
    // Navigation button handlers
    prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateModalPhoto(-1);
    });
    
    nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateModalPhoto(1);
    });
    
    // Keyboard navigation
    const handleModalKeydown = (e) => {
        if (modal.style.display !== 'flex') return;
        
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            navigateModalPhoto(-1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            navigateModalPhoto(1);
        }
    };
    
    document.addEventListener('keydown', handleModalKeydown);
    
    // Metadata toggle
    if (metadataToggle && metadataContent) {
        metadataToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            metadataContent.classList.toggle('collapsed');
            metadataToggle.textContent = metadataContent.classList.contains('collapsed') ? '📊' : '📈';
        });
    }
    
    // Delete photo
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            if (!state.currentModalPhoto) {
                alert('No photo selected');
                return;
            }
            
            try {
                deleteBtn.disabled = true;
                deleteBtn.textContent = '⏳';
                
                await deletePhotosWithConfirmation([state.currentModalPhoto], updateStatus, async () => {
                    closeModal();
                    const browserPhotoGrid = document.getElementById('browser-photo-grid');
                    if (browserPhotoGrid && browserPhotoGrid.children.length > 0) {
                        await renderBrowserPhotoGrid(true);
                    }
                });
                
            } catch (error) {
                console.error('Failed to delete photo:', error);
                alert(`Failed to delete photo: ${error.message}`);
            } finally {
                deleteBtn.disabled = false;
                deleteBtn.textContent = '🗑️';
            }
        });
    }
    
    // Close modal handlers
    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
        }
    });
    
    console.log('Image modal initialized');
    
    return {
        closeModal,
        navigateModalPhoto
    };
}

/**
 * Display photo in modal
 */
export async function displayPhotoInModal(state, photo, thumbnailSrc, photoList = [], photoIndex = -1, context = null, helpers) {
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-img');
    
    state.currentModalPhoto = photo;
    state.currentModalPhotoList = photoList;
    state.currentModalPhotoIndex = photoIndex;
    state.currentModalContext = context;
    
    populateImageMetadata(photo);
    updateModalNavigation(state);
    updateModalCheckbox(state);
    
    if (photo.file_id) {
        await helpers.initializeServiceWorkerToken();
        modalImg.src = thumbnailSrc;
        modal.style.display = 'flex';
        await helpers.loadFullSizeImage(photo.file_id, modalImg, thumbnailSrc);
    } else {
        modalImg.src = thumbnailSrc;
        modal.style.display = 'flex';
    }
}

/**
 * Update modal navigation buttons
 */
export function updateModalNavigation(state) {
    const prevBtn = document.getElementById('modal-prev-btn');
    const nextBtn = document.getElementById('modal-next-btn');
    
    if (!prevBtn || !nextBtn) return;
    
    const hasNavigation = state.currentModalPhotoList.length > 0 && state.currentModalPhotoIndex >= 0;
    
    if (hasNavigation) {
        prevBtn.style.display = 'flex';
        nextBtn.style.display = 'flex';
        prevBtn.disabled = state.currentModalPhotoIndex <= 0;
        nextBtn.disabled = state.currentModalPhotoIndex >= state.currentModalPhotoList.length - 1;
        
        const counter = document.getElementById('modal-photo-counter');
        if (counter) {
            counter.textContent = `${state.currentModalPhotoIndex + 1} / ${state.currentModalPhotoList.length}`;
            counter.style.display = 'block';
        }
    } else {
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        
        const counter = document.getElementById('modal-photo-counter');
        if (counter) {
            counter.style.display = 'none';
        }
    }
}

/**
 * Update modal checkbox state
 */
export function updateModalCheckbox(state) {
    const modalCheckbox = document.getElementById('modal-photo-checkbox');
    if (!modalCheckbox) return;
    
    const gridCheckbox = findGridCheckboxForCurrentPhoto(state);
    
    if (gridCheckbox) {
        modalCheckbox.checked = gridCheckbox.checked;
        modalCheckbox.parentElement.style.display = 'flex';
    } else {
        modalCheckbox.parentElement.style.display = 'none';
    }
}

/**
 * Sync checkbox to grid
 */
export function syncCheckboxToGrid(state) {
    const gridCheckbox = findGridCheckboxForCurrentPhoto(state);
    const modalCheckbox = document.getElementById('modal-photo-checkbox');
    
    if (gridCheckbox && modalCheckbox) {
        gridCheckbox.checked = modalCheckbox.checked;
    }
}

/**
 * Find grid checkbox for current modal photo
 */
export function findGridCheckboxForCurrentPhoto(state) {
    if (!state.currentModalPhoto || state.currentModalPhotoIndex < 0) return null;
    
    const browserPhotoGrid = document.getElementById('browser-photo-grid');
    const resultsContainer = document.getElementById('results-container');
    
    if (state.currentModalContext === 'browser') {
        const browserCheckboxes = browserPhotoGrid?.querySelectorAll('.browser-photo-checkbox');
        if (browserCheckboxes) {
            for (const checkbox of browserCheckboxes) {
                const photoItem = checkbox.closest('.photo-item');
                const img = photoItem?.querySelector('img');
                const fileId = img?.getAttribute('data-file-id');
                
                if (fileId === state.currentModalPhoto.file_id) {
                    return checkbox;
                }
            }
        }
        return null;
    } else if (state.currentModalContext === 'results') {
        const resultsCheckboxes = resultsContainer?.querySelectorAll('.photo-checkbox');
        if (resultsCheckboxes) {
            for (const checkbox of resultsCheckboxes) {
                const photoItem = checkbox.closest('.photo-item');
                const img = photoItem?.querySelector('img');
                const fileId = img?.getAttribute('data-file-id');
                
                if (fileId === state.currentModalPhoto.file_id) {
                    return checkbox;
                }
            }
        }
        return null;
    }
    
    return null;
}

/**
 * Populate image metadata
 */
export function populateImageMetadata(photo) {
    const photoName = document.getElementById('photo-name');
    const sharpnessValue = document.getElementById('sharpness-value');
    const exposureValue = document.getElementById('exposure-value');
    const qualityScoreValue = document.getElementById('quality-score-value');
    
    if (photoName) photoName.textContent = photo.name || 'Unknown Photo';
    
    // Sharpness
    if (sharpnessValue) {
        if (photo.sharpness !== undefined && isFinite(photo.sharpness)) {
            const sharpness = typeof photo.sharpness === 'number' ? photo.sharpness : 0;
            sharpnessValue.textContent = `${sharpness.toFixed(2)}`;
            
            if (sharpness >= 15) {
                sharpnessValue.style.color = '#4caf50';
            } else if (sharpness >= 10) {
                sharpnessValue.style.color = '#ffeb3b';
            } else {
                sharpnessValue.style.color = '#f44336';
            }
        } else {
            sharpnessValue.textContent = 'N/A';
            sharpnessValue.style.color = '#fff';
        }
    }
    
    // Exposure
    if (exposureValue) {
        if (photo.exposure !== undefined) {
            if (typeof photo.exposure === 'object') {
                const exp = photo.exposure;
                const brightness = Math.round((exp.meanBrightness || 0) * 100);
                const clipping = Math.round((exp.clipping || 0) * 100);
                const dynamicRange = Math.round((exp.dynamicRange || 0) * 100);
                const entropy = Math.round((exp.entropy || 0) * 100);
                
                exposureValue.innerHTML = `
                    <div style="margin-bottom: 4px;">Brightness: ${brightness}%</div>
                    <div style="font-size: 0.85em; opacity: 0.9;">
                        Clipping: ${clipping}% | Dynamic Range: ${dynamicRange}% | Entropy: ${entropy}%
                    </div>
                `;
                
                if (brightness >= 40 && brightness <= 60 && clipping < 5) {
                    exposureValue.style.color = '#4caf50';
                } else if (brightness >= 25 && brightness <= 75 && clipping < 10) {
                    exposureValue.style.color = '#ffeb3b';
                } else {
                    exposureValue.style.color = '#f44336';
                }
            } else {
                const exposurePercent = Math.round(photo.exposure * 100);
                exposureValue.textContent = `${exposurePercent}%`;
                
                if (exposurePercent >= 40 && exposurePercent <= 60) {
                    exposureValue.style.color = '#4caf50';
                } else if (exposurePercent >= 25 && exposurePercent <= 75) {
                    exposureValue.style.color = '#ffeb3b';
                } else {
                    exposureValue.style.color = '#f44336';
                }
            }
        } else {
            exposureValue.textContent = 'N/A';
            exposureValue.style.color = '#fff';
        }
    }
    
    // Quality score
    if (qualityScoreValue) {
        if (photo.quality_score !== undefined && isFinite(photo.quality_score)) {
            const qualityPercent = Math.round(photo.quality_score * 100);
            
            let qualityHtml = `<div style="margin-bottom: 4px;">${qualityPercent}%</div>`;
            
            if (photo.face && photo.face.faceCount > 0 && isFinite(photo.face.faceScore)) {
                const faceScore = Math.round(photo.face.faceScore * 100);
                qualityHtml += `<div style="font-size: 0.85em; opacity: 0.9;">
                    ${photo.face.faceCount} face${photo.face.faceCount > 1 ? 's' : ''} detected | Face Quality: ${faceScore}%
                </div>`;
                
                if (photo.face.details && photo.face.details.length > 0) {
                    const detail = photo.face.details[0];
                    const metrics = [];
                    if (detail.eyesOpen !== undefined && isFinite(detail.eyesOpen)) {
                        metrics.push(`Eyes: ${Math.round(detail.eyesOpen * 100)}%`);
                    }
                    if (detail.smile !== undefined && isFinite(detail.smile)) {
                        metrics.push(`Smile: ${Math.round(detail.smile * 100)}%`);
                    }
                    if (detail.naturalExpression !== undefined && isFinite(detail.naturalExpression)) {
                        metrics.push(`Natural: ${Math.round(detail.naturalExpression * 100)}%`);
                    }
                    
                    if (metrics.length > 0) {
                        qualityHtml += `<div style="font-size: 0.8em; opacity: 0.85; margin-top: 2px;">
                            ${metrics.join(' | ')}
                        </div>`;
                    }
                }
            }
            
            qualityScoreValue.innerHTML = qualityHtml;
            
            if (qualityPercent >= 70) {
                qualityScoreValue.style.color = '#4caf50';
            } else if (qualityPercent >= 40) {
                qualityScoreValue.style.color = '#ffeb3b';
            } else {
                qualityScoreValue.style.color = '#f44336';
            }
        } else {
            qualityScoreValue.textContent = 'N/A';
            qualityScoreValue.style.color = '#fff';
        }
    }
}

