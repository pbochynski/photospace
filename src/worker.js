import Human from 'https://cdn.jsdelivr.net/npm/@vladmandic/human/dist/human.esm.js';

let workerId = 'Unknown';

const originalConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };

function sendConsoleToMain(level, args) {
    const prefixedArgs = [`[Worker ${workerId}]`, ...args];
    self.postMessage({
        type: 'console', level,
        args: prefixedArgs.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg))
    });
    originalConsole[level].apply(console, prefixedArgs);
}

console.log = (...args) => sendConsoleToMain('log', args);
console.error = (...args) => sendConsoleToMain('error', args);
console.warn = (...args) => sendConsoleToMain('warn', args);
console.info = (...args) => sendConsoleToMain('info', args);

self.addEventListener('error', (e) => sendConsoleToMain('error', [`Worker Error: ${e.message}`]));
self.addEventListener('unhandledrejection', (e) => sendConsoleToMain('error', [`Worker Unhandled Rejection: ${e.reason}`]));

const humanConfig = {
    modelBasePath: 'https://cdn.jsdelivr.net/npm/@vladmandic/human/models',
    filter: { enabled: false },
    face: { enabled: true, detector: { enabled: true, rotation: false }, mesh: { enabled: false }, iris: { enabled: false }, description: { enabled: false }, emotion: { enabled: false } },
    body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false },
};

let human = null;
let humanReady = false;

async function initHuman() {
    if (humanReady) return;
    try {
        human = new Human(humanConfig);
        await human.load();
        humanReady = true;
        console.log('Human face detection initialized');
    } catch (e) {
        console.warn('Human init failed:', e.message);
    }
}

function estimateSharpness(data, width, height) {
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
    let sum = 0, count = 0;
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const lap = Math.abs(-gray[idx-width-1]-gray[idx-width]-gray[idx-width+1]-gray[idx-1]+8*gray[idx]-gray[idx+1]-gray[idx+width-1]-gray[idx+width]-gray[idx+width+1]);
            sum += lap; count++;
        }
    }
    return Math.min(100, (count > 0 ? sum / count : 0) * 2);
}

function estimateExposure(data, width, height) {
    const total = width * height;
    let brightnessSum = 0, overexposed = 0, underexposed = 0;
    for (let i = 0; i < total; i++) {
        const idx = i * 4;
        const b = (data[idx] + data[idx+1] + data[idx+2]) / 3;
        brightnessSum += b;
        if (b > 240) overexposed++;
        if (b < 15) underexposed++;
    }
    const avg = brightnessSum / total;
    const brightPenalty = Math.abs(avg - 128) / 128;
    const clipPenalty = (overexposed + underexposed) / total * 2;
    return Math.max(0, 100 - brightPenalty * 30 - clipPenalty * 100);
}

async function detectFaces(blob) {
    if (!humanReady || !human) return { detected: false, score: 0 };
    try {
        const bmp = await createImageBitmap(blob);
        const result = await human.detect(bmp);
        bmp.close();
        if (result.face?.length > 0) {
            const best = result.face.reduce((b, f) => (f.score||0) > (b.score||0) ? f : b, result.face[0]);
            return { detected: true, score: (best.score||0)*100, count: result.face.length };
        }
        return { detected: false, score: 0, count: 0 };
    } catch (e) {
        console.warn('Face detection error:', e.message);
        return { detected: false, score: 0 };
    }
}

self.onmessage = async (event) => {
    const { type, workerId: id, fileId, blob, fetchUrl, authToken } = event.data;

    if (type === 'init') {
        workerId = id || workerId;
        await initHuman();
        self.postMessage({ type: 'ready', workerId });
        return;
    }

    if (type === 'process_photo') {
        try {
            let imageBlob = blob;
            if (!imageBlob && fetchUrl && authToken) {
                const res = await fetch(fetchUrl, { headers: { Authorization: `Bearer ${authToken}` } });
                if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
                imageBlob = await res.blob();
            }
            if (!imageBlob) throw new Error('No image data');

            const bmp = await createImageBitmap(imageBlob);
            const { width, height } = bmp;
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bmp, 0, 0);
            bmp.close();
            const imageData = ctx.getImageData(0, 0, width, height);

            const sharpness = estimateSharpness(imageData.data, width, height);
            const exposure = estimateExposure(imageData.data, width, height);
            const faceResult = await detectFaces(imageBlob);

            let qualityScore = sharpness * 0.5 + exposure * 0.3;
            if (faceResult.detected) qualityScore += faceResult.score * 0.2;

            self.postMessage({
                type: 'quality_result', fileId,
                qualityMetrics: { sharpness: Math.round(sharpness), exposure: Math.round(exposure), face: faceResult, qualityScore: Math.round(Math.min(100, qualityScore)) }
            });
        } catch (e) {
            self.postMessage({ type: 'quality_error', fileId, error: e.message });
        }
    }
};
