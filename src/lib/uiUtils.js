import { db } from './db.js';

/**
 * UI Utilities Module
 * Pure utility functions for UI operations
 */

/**
 * Update status message (legacy support - status panel was removed)
 * @param {string} text - Status text to display
 * @param {boolean} showProgress - Whether to show progress bar
 * @param {number} progressValue - Progress value
 * @param {number} progressMax - Maximum progress value
 */
export function updateStatus(text, showProgress = false, progressValue = 0, progressMax = 100) {
    // Status panel was removed - just log to console for debugging
    console.log(`[Status] ${text}`);
    
    // Legacy support for any code still referencing these elements
    const statusText = document.getElementById('status-text');
    const progressBar = document.getElementById('progress-bar');
    
    if (statusText) statusText.textContent = text;
    if (progressBar) {
        if (showProgress) {
            progressBar.style.display = 'block';
            progressBar.value = progressValue;
            progressBar.max = progressMax;
        } else {
            progressBar.style.display = 'none';
        }
    }
}

/**
 * Check if date filter is enabled
 * @returns {boolean} - True if date filter is enabled
 */
export function isDateFilterEnabled() {
    const dateEnabledToggle = document.getElementById('date-enabled-toggle');
    return dateEnabledToggle ? dateEnabledToggle.checked : true;
}

/**
 * Apply date filter enabled/disabled UI state
 */
export function applyDateEnabledUI() {
    const dateFromInput = document.getElementById('date-from');
    const dateToInput = document.getElementById('date-to');
    const disabled = !isDateFilterEnabled();
    
    if (dateFromInput) dateFromInput.disabled = disabled;
    if (dateToInput) dateToInput.disabled = disabled;
    
    const switchText = document.querySelector('.switch-text');
    if (switchText) {
        switchText.textContent = disabled ? 'Disabled' : 'Enabled';
    }
}

/**
 * Get date filter configuration
 * @returns {Object|null} - Date filter object or null if disabled
 */
export function getDateFilter() {
    if (!isDateFilterEnabled()) {
        return null;
    }
    
    const dateFromInput = document.getElementById('date-from');
    const dateToInput = document.getElementById('date-to');
    const fromDate = dateFromInput?.value;
    const toDate = dateToInput?.value;
    
    if (!fromDate && !toDate) {
        return null; // No date filter
    }
    
    return {
        from: fromDate ? new Date(fromDate + 'T00:00:00').getTime() : null,
        to: toDate ? new Date(toDate + 'T23:59:59').getTime() : null
    };
}

/**
 * Set default date range (last month)
 */
export function setDefaultDateRange() {
    const dateFromInput = document.getElementById('date-from');
    const dateToInput = document.getElementById('date-to');
    
    // Set default to last month
    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
    
    if (dateFromInput) dateFromInput.value = lastMonth.toISOString().split('T')[0];
    if (dateToInput) dateToInput.value = today.toISOString().split('T')[0];
}

/**
 * Initialize collapsible panels with persistence
 */
export async function initializeCollapsiblePanels() {
    const panels = document.querySelectorAll('.panel[data-panel-key]');
    
    for (const panel of panels) {
        const key = panel.getAttribute('data-panel-key');
        const toggleBtn = panel.querySelector('.panel-toggle');
        if (!toggleBtn) continue;

        // Restore state from DB
        try {
            const stored = await db.getSetting(`ui.panel.${key}.expanded`);
            const isExpanded = stored === null ? true : Boolean(stored);
            applyPanelExpandedState(panel, toggleBtn, isExpanded);
        } catch (e) {
            applyPanelExpandedState(panel, toggleBtn, true);
        }

        // Add event listener
        toggleBtn.addEventListener('click', async () => {
            const currentlyExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
            const next = !currentlyExpanded;
            applyPanelExpandedState(panel, toggleBtn, next);
            try {
                await db.setSetting(`ui.panel.${key}.expanded`, next);
            } catch (e) {
                console.warn('Failed to persist panel state', key, e);
            }
        });
    }
}

/**
 * Apply expanded/collapsed state to a panel
 * @param {HTMLElement} panel - Panel element
 * @param {HTMLElement} toggleBtn - Toggle button element
 * @param {boolean} expanded - Whether panel should be expanded
 */
export function applyPanelExpandedState(panel, toggleBtn, expanded) {
    if (expanded) {
        panel.classList.remove('collapsed');
        toggleBtn.setAttribute('aria-expanded', 'true');
        toggleBtn.textContent = '▾';
    } else {
        panel.classList.add('collapsed');
        toggleBtn.setAttribute('aria-expanded', 'false');
        toggleBtn.textContent = '▸';
    }
}

