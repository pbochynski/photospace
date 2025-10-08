/**
 * Debug Console Module
 * Provides a mobile-friendly debug console for logging and error tracking
 */

export class DebugConsole {
    constructor() {
        this.isVisible = false;
        this.isMinimized = false;
        this.entries = [];
        this.maxEntries = 1000;
        this.setupDOM();
        this.overrideConsole();
    }

    setupDOM() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initializeDOM());
        } else {
            this.initializeDOM();
        }
    }

    initializeDOM() {
        this.debugConsole = document.getElementById('debug-console');
        this.debugContent = document.getElementById('debug-content');
        this.debugShowBtn = document.getElementById('debug-show-btn');
        this.debugToggle = document.getElementById('debug-toggle');
        this.debugClear = document.getElementById('debug-clear');
        this.debugClose = document.getElementById('debug-close');

        if (!this.debugShowBtn) return; // Elements not ready yet

        // Event listeners
        this.debugShowBtn.addEventListener('click', () => this.show());
        this.debugToggle.addEventListener('click', () => this.toggleMinimize());
        this.debugClear.addEventListener('click', () => this.clear());
        this.debugClose.addEventListener('click', () => this.hide());

        // Auto-show on mobile devices
        if (this.isMobile()) {
            this.show();
        }
    }

    isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    overrideConsole() {
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;
        const originalInfo = console.info;

        console.log = (...args) => {
            originalLog.apply(console, args);
            this.addEntry('log', args);
        };

        console.error = (...args) => {
            originalError.apply(console, args);
            this.addEntry('error', args);
        };

        console.warn = (...args) => {
            originalWarn.apply(console, args);
            this.addEntry('warn', args);
        };

        console.info = (...args) => {
            originalInfo.apply(console, args);
            this.addEntry('info', args);
        };

        // Catch unhandled errors
        window.addEventListener('error', (event) => {
            this.addEntry('error', [`Uncaught Error: ${event.error?.message || event.message}`, event.error?.stack || '']);
        });

        window.addEventListener('unhandledrejection', (event) => {
            this.addEntry('error', [`Unhandled Promise Rejection: ${event.reason}`]);
        });
    }

    addEntry(level, args) {
        const timestamp = new Date().toLocaleTimeString();
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        const entry = { timestamp, level, message };
        this.entries.push(entry);

        // Keep only recent entries
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(-this.maxEntries);
        }

        this.render();
    }

    render() {
        if (!this.debugContent) return;

        const html = this.entries.map(entry => 
            `<div class="debug-entry ${entry.level}">
                <span class="timestamp">[${entry.timestamp}]</span> ${entry.message}
            </div>`
        ).join('');

        this.debugContent.innerHTML = html;
        this.debugContent.scrollTop = this.debugContent.scrollHeight;
    }

    show() {
        if (!this.debugConsole) return;
        this.debugConsole.style.display = 'flex';
        this.debugShowBtn.style.display = 'none';
        this.isVisible = true;
    }

    hide() {
        if (!this.debugConsole) return;
        this.debugConsole.style.display = 'none';
        this.debugShowBtn.style.display = 'block';
        this.isVisible = false;
        this.isMinimized = false;
    }

    toggleMinimize() {
        if (!this.debugContent) return;
        this.isMinimized = !this.isMinimized;
        this.debugContent.style.display = this.isMinimized ? 'none' : 'block';
        this.debugToggle.textContent = this.isMinimized ? '□' : '_';
    }

    clear() {
        this.entries = [];
        this.render();
    }
}

/**
 * Initialize and export a singleton debug console instance
 * @returns {DebugConsole} The debug console instance
 */
export function initializeDebugConsole() {
    const debugConsole = new DebugConsole();
    
    // Make debug console globally accessible for worker messages
    window.debugConsole = debugConsole;
    
    return debugConsole;
}

