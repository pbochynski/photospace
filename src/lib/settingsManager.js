import { db } from './db.js';

/**
 * Settings Manager Module
 * Manages application settings and preferences
 */

/**
 * Initialize analysis settings with retry logic
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} delay - Delay between retries in milliseconds
 * @returns {Promise<boolean>} - Success status
 */
export async function initializeAnalysisSettingsWithRetry(maxRetries = 10, delay = 100) {
    for (let i = 0; i < maxRetries; i++) {
        const success = await initializeAnalysisSettings();
        if (success) {
            return true;
        }
        console.log(`Retrying initializeAnalysisSettings (attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    console.error('Failed to initialize analysis settings after maximum retries');
    return false;
}

/**
 * Initialize analysis settings from database
 * @returns {Promise<boolean>} - Success status
 */
export async function initializeAnalysisSettings() {
    try {
        // Get DOM elements fresh each time to ensure they're available
        const similarityThresholdSlider = document.getElementById('similarity-threshold');
        const thresholdValueDisplay = document.getElementById('threshold-value');
        const timeSpanSlider = document.getElementById('time-span');
        const timeSpanValueDisplay = document.getElementById('time-span-value');
        const minGroupSizeSlider = document.getElementById('min-group-size');
        const minGroupSizeValueDisplay = document.getElementById('min-group-size-value');
        const resultsSortSelect = document.getElementById('results-sort');
        const workerCountSlider = document.getElementById('worker-count');
        const workerCountValueDisplay = document.getElementById('worker-count-value');
        const dateEnabledToggle = document.getElementById('date-enabled-toggle');
        const dateFromInput = document.getElementById('date-from');
        const dateToInput = document.getElementById('date-to');
        const seriesMinGroupSizeSlider = document.getElementById('series-min-group-size');
        const seriesMinGroupSizeValueDisplay = document.getElementById('series-min-group-size-value');
        const seriesMinDensitySlider = document.getElementById('series-min-density');
        const seriesMinDensityValueDisplay = document.getElementById('series-min-density-value');
        const seriesTimeGapSlider = document.getElementById('series-time-gap');
        const seriesTimeGapValueDisplay = document.getElementById('series-time-gap-value');
        
        // Check if DOM elements are available
        if (!similarityThresholdSlider || !thresholdValueDisplay || !timeSpanSlider || 
            !timeSpanValueDisplay || !minGroupSizeSlider || !minGroupSizeValueDisplay || 
            !workerCountSlider || !workerCountValueDisplay) {
            console.warn('Some DOM elements not found, skipping analysis settings initialization');
            return false;
        }
        
        // Initialize date toggle and restore last range from DB if URL absent
        if (dateEnabledToggle && dateFromInput && dateToInput) {
            try {
                const dateEnabledSetting = await db.getSetting('dateEnabled');
                if (dateEnabledSetting !== null) {
                    dateEnabledToggle.checked = Boolean(dateEnabledSetting);
                }
                
                // Import from urlStateManager to check URL
                const urlParams = new URLSearchParams(window.location.search);
                const hasDateFromURL = urlParams.has('dateFrom') || urlParams.has('dateTo');
                
                if (!hasDateFromURL) {
                    const savedFrom = await db.getSetting('dateFrom');
                    const savedTo = await db.getSetting('dateTo');
                    if (savedFrom) dateFromInput.value = savedFrom;
                    if (savedTo) dateToInput.value = savedTo;
                    
                    // Set default if nothing saved
                    if (!savedFrom && !savedTo) {
                        const today = new Date();
                        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
                        dateFromInput.value = lastMonth.toISOString().split('T')[0];
                        dateToInput.value = today.toISOString().split('T')[0];
                    }
                }
            } catch (e) {
                // Non-fatal
                console.warn('Error initializing date settings:', e);
            }
        }

        // Initialize similarity threshold
        const savedThreshold = await db.getSetting('similarityThreshold');
        const threshold = savedThreshold !== null ? Number(savedThreshold) : 0.90;
        const validThreshold = (!isNaN(threshold) && threshold >= 0.5 && threshold <= 0.99) ? threshold : 0.90;
        
        similarityThresholdSlider.value = validThreshold;
        thresholdValueDisplay.textContent = validThreshold.toFixed(2);
        
        if (savedThreshold === null) {
            await db.setSetting('similarityThreshold', validThreshold);
        }
        
        // Initialize time span
        const savedTimeSpan = await db.getSetting('timeSpanHours');
        const timeSpan = savedTimeSpan !== null ? Number(savedTimeSpan) : 8;
        const validTimeSpan = (!isNaN(timeSpan) && timeSpan >= 0 && timeSpan <= 24) ? timeSpan : 8;
        
        timeSpanSlider.value = validTimeSpan;
        timeSpanValueDisplay.textContent = validTimeSpan === 0 ? 'Disabled (compare all)' : `${validTimeSpan} hours`;
        
        if (savedTimeSpan === null) {
            await db.setSetting('timeSpanHours', validTimeSpan);
        }
        
        // Initialize min group size
        const savedMinGroupSize = await db.getSetting('minGroupSize');
        const minGroupSize = savedMinGroupSize !== null ? Number(savedMinGroupSize) : 3;
        const validMinGroupSize = (!isNaN(minGroupSize) && minGroupSize >= 2 && minGroupSize <= 20) ? minGroupSize : 3;
        
        minGroupSizeSlider.value = validMinGroupSize;
        minGroupSizeValueDisplay.textContent = `${validMinGroupSize} photos`;
        
        if (savedMinGroupSize === null) {
            await db.setSetting('minGroupSize', validMinGroupSize);
        }
        
        // Initialize sort method
        if (resultsSortSelect) {
            const savedResultsSort = await db.getSetting('resultsSort');
            const resultsSort = savedResultsSort !== null ? savedResultsSort : 'group-size';
            resultsSortSelect.value = resultsSort;
            
            if (savedResultsSort === null) {
                await db.setSetting('resultsSort', resultsSort);
            }
        }
        
        // Initialize worker count
        const savedWorkerCount = await db.getSetting('workerCount');
        const workerCount = savedWorkerCount !== null ? Number(savedWorkerCount) : 4;
        const validWorkerCount = (!isNaN(workerCount) && workerCount >= 1 && workerCount <= 8) ? workerCount : 4;
        
        workerCountSlider.value = validWorkerCount;
        workerCountValueDisplay.textContent = `${validWorkerCount} worker${validWorkerCount === 1 ? '' : 's'}`;
        
        if (savedWorkerCount === null) {
            await db.setSetting('workerCount', validWorkerCount);
        }
        
        console.log(`Worker count initialized to: ${validWorkerCount}`);
        
        // Initialize series analysis settings
        if (seriesMinGroupSizeSlider && seriesMinGroupSizeValueDisplay) {
            const savedSeriesMinGroupSize = await db.getSetting('seriesMinGroupSize');
            const seriesMinGroupSize = savedSeriesMinGroupSize !== null ? Number(savedSeriesMinGroupSize) : 20;
            const validSeriesMinGroupSize = (!isNaN(seriesMinGroupSize) && seriesMinGroupSize >= 5 && seriesMinGroupSize <= 100) ? seriesMinGroupSize : 20;
            
            seriesMinGroupSizeSlider.value = validSeriesMinGroupSize;
            seriesMinGroupSizeValueDisplay.textContent = `${validSeriesMinGroupSize} photos`;
            
            if (savedSeriesMinGroupSize === null) {
                await db.setSetting('seriesMinGroupSize', validSeriesMinGroupSize);
            }
        }
        
        if (seriesMinDensitySlider && seriesMinDensityValueDisplay) {
            const savedSeriesMinDensity = await db.getSetting('seriesMinDensity');
            const seriesMinDensity = savedSeriesMinDensity !== null ? Number(savedSeriesMinDensity) : 3;
            const validSeriesMinDensity = (!isNaN(seriesMinDensity) && seriesMinDensity >= 0.5 && seriesMinDensity <= 10) ? seriesMinDensity : 3;
            
            seriesMinDensitySlider.value = validSeriesMinDensity;
            seriesMinDensityValueDisplay.textContent = `${validSeriesMinDensity.toFixed(1)} photos/min`;
            
            if (savedSeriesMinDensity === null) {
                await db.setSetting('seriesMinDensity', validSeriesMinDensity);
            }
        }
        
        if (seriesTimeGapSlider && seriesTimeGapValueDisplay) {
            const savedSeriesTimeGap = await db.getSetting('seriesMaxTimeGap');
            const seriesTimeGap = savedSeriesTimeGap !== null ? Number(savedSeriesTimeGap) : 5;
            const validSeriesTimeGap = (!isNaN(seriesTimeGap) && seriesTimeGap >= 1 && seriesTimeGap <= 60) ? seriesTimeGap : 5;
            
            seriesTimeGapSlider.value = validSeriesTimeGap;
            seriesTimeGapValueDisplay.textContent = `${validSeriesTimeGap} minutes`;
            
            if (savedSeriesTimeGap === null) {
                await db.setSetting('seriesMaxTimeGap', validSeriesTimeGap);
            }
        }
        
        console.log('Analysis settings initialized successfully');
        
        return true;
    } catch (error) {
        console.error('Error initializing analysis settings:', error);
        
        // Set default values if database fails
        const similarityThresholdSlider = document.getElementById('similarity-threshold');
        const thresholdValueDisplay = document.getElementById('threshold-value');
        const timeSpanSlider = document.getElementById('time-span');
        const timeSpanValueDisplay = document.getElementById('time-span-value');
        const minGroupSizeSlider = document.getElementById('min-group-size');
        const minGroupSizeValueDisplay = document.getElementById('min-group-size-value');
        const resultsSortSelect = document.getElementById('results-sort');
        const workerCountSlider = document.getElementById('worker-count');
        const workerCountValueDisplay = document.getElementById('worker-count-value');
        
        if (similarityThresholdSlider) similarityThresholdSlider.value = 0.90;
        if (thresholdValueDisplay) thresholdValueDisplay.textContent = '0.90';
        if (timeSpanSlider) timeSpanSlider.value = 8;
        if (timeSpanValueDisplay) timeSpanValueDisplay.textContent = '8 hours';
        if (minGroupSizeSlider) minGroupSizeSlider.value = 3;
        if (minGroupSizeValueDisplay) minGroupSizeValueDisplay.textContent = '3 photos';
        if (resultsSortSelect) resultsSortSelect.value = 'group-size';
        if (workerCountSlider) workerCountSlider.value = 4;
        if (workerCountValueDisplay) workerCountValueDisplay.textContent = '4 workers';
        
        // Save default worker count
        try {
            await db.setSetting('workerCount', 4);
        } catch (dbError) {
            console.error('Error saving default worker count:', dbError);
        }
        
        return false;
    }
}

/**
 * Get similarity threshold setting
 * @returns {Promise<number>} - Similarity threshold value
 */
export async function getSimilarityThreshold() {
    try {
        const threshold = await db.getSetting('similarityThreshold');
        return threshold !== null ? threshold : 0.90;
    } catch (error) {
        console.error('Error getting similarity threshold:', error);
        return 0.90;
    }
}

/**
 * Get time span hours setting
 * @returns {Promise<number>} - Time span in hours
 */
export async function getTimeSpanHours() {
    try {
        const timeSpan = await db.getSetting('timeSpanHours');
        return timeSpan !== null ? timeSpan : 8;
    } catch (error) {
        console.error('Error getting time span:', error);
        return 8;
    }
}

/**
 * Get sort method setting
 * @returns {Promise<string>} - Sort method
 */
export async function getSortMethod() {
    try {
        const sortMethod = await db.getSetting('resultsSort');
        return sortMethod !== null ? sortMethod : 'group-size';
    } catch (error) {
        console.error('Error getting sort method:', error);
        return 'group-size';
    }
}

/**
 * Get worker count setting
 * @returns {Promise<number>} - Number of parallel workers
 */
export async function getWorkerCount() {
    try {
        const workerCount = await db.getSetting('workerCount');
        return (workerCount != null) ? workerCount : 4;
    } catch (error) {
        console.error('Error getting worker count:', error);
        return 4;
    }
}

/**
 * Get minimum group size setting
 * @returns {Promise<number>} - Minimum group size
 */
export async function getMinGroupSize() {
    try {
        const minGroupSize = await db.getSetting('minGroupSize');
        return minGroupSize !== null ? minGroupSize : 3;
    } catch (error) {
        console.error('Error getting min group size:', error);
        return 3;
    }
}

/**
 * Get series minimum group size setting
 * @returns {Promise<number>} - Series minimum group size
 */
export async function getSeriesMinGroupSize() {
    try {
        const minGroupSize = await db.getSetting('seriesMinGroupSize');
        return minGroupSize !== null ? minGroupSize : 20;
    } catch (error) {
        console.error('Error getting series min group size:', error);
        return 20;
    }
}

/**
 * Get series minimum density setting
 * @returns {Promise<number>} - Series minimum density (photos per minute)
 */
export async function getSeriesMinDensity() {
    try {
        const minDensity = await db.getSetting('seriesMinDensity');
        return minDensity !== null ? minDensity : 3;
    } catch (error) {
        console.error('Error getting series min density:', error);
        return 3;
    }
}

/**
 * Get series maximum time gap setting
 * @returns {Promise<number>} - Series maximum time gap in minutes
 */
export async function getSeriesMaxTimeGap() {
    try {
        const maxTimeGap = await db.getSetting('seriesMaxTimeGap');
        return maxTimeGap !== null ? maxTimeGap : 5;
    } catch (error) {
        console.error('Error getting series max time gap:', error);
        return 5;
    }
}

