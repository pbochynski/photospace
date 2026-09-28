const HASH_SIZE = 8; // 8×8 grid → 64-bit hash

export function computeAHash(img) {
    const canvas = document.createElement('canvas');
    canvas.width = HASH_SIZE;
    canvas.height = HASH_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, HASH_SIZE, HASH_SIZE);
    const data = ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE).data;

    // Convert to grayscale
    const grays = [];
    for (let i = 0; i < HASH_SIZE * HASH_SIZE; i++) {
        grays.push(data[i*4] * 0.299 + data[i*4+1] * 0.587 + data[i*4+2] * 0.114);
    }

    // Compare each pixel to the mean
    const avg = grays.reduce((a, b) => a + b, 0) / grays.length;
    let hi = 0, lo = 0;
    grays.forEach((g, bit) => {
        const val = g > avg ? 1 : 0;
        if (bit < 32) hi |= (val << bit);
        else          lo |= (val << (bit - 32));
    });
    return [hi >>> 0, lo >>> 0];
}

export function hammingDistance([h1, l1], [h2, l2]) {
    let d = 0;
    let xh = h1 ^ h2;
    let xl = l1 ^ l2;
    while (xh) { d += xh & 1; xh >>>= 1; }
    while (xl) { d += xl & 1; xl >>>= 1; }
    return d;
}

// Complete-linkage greedy clustering: first unassigned photo is the anchor.
// A candidate joins the cluster only if it's within threshold of ALL current members.
// This prevents drift where A~B and B~C but A is unlike C.
// Returns an array of cluster IDs in the same order as input ids.
export function clusterByHash(ids, hashMap, threshold) {
    const n = ids.length;
    const labels = new Array(n).fill(-1);
    let clusterLabel = 0;

    for (let i = 0; i < n; i++) {
        if (labels[i] !== -1) continue;
        labels[i] = clusterLabel;
        const members = [i];

        for (let j = i + 1; j < n; j++) {
            if (labels[j] !== -1) continue;
            const hj = hashMap.get(ids[j]);
            if (!hj) continue;
            const fitsAll = members.every(m => {
                const hm = hashMap.get(ids[m]);
                return hm && hammingDistance(hm, hj) <= threshold;
            });
            if (fitsAll) {
                labels[j] = clusterLabel;
                members.push(j);
            }
        }

        clusterLabel++;
    }

    return labels;
}
