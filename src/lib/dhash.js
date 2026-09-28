const HASH_SIZE = 8; // 8×8 grid → 64-bit hash (stored as two 32-bit ints)

export function computeDHash(img) {
    const canvas = document.createElement('canvas');
    canvas.width = HASH_SIZE + 1;
    canvas.height = HASH_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, HASH_SIZE + 1, HASH_SIZE);
    const data = ctx.getImageData(0, 0, HASH_SIZE + 1, HASH_SIZE).data;

    // Convert to grayscale and compare adjacent pixels in each row
    let hi = 0, lo = 0;
    for (let y = 0; y < HASH_SIZE; y++) {
        for (let x = 0; x < HASH_SIZE; x++) {
            const i = (y * (HASH_SIZE + 1) + x) * 4;
            const j = (y * (HASH_SIZE + 1) + x + 1) * 4;
            const gray1 = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            const gray2 = data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114;
            const bit = y * HASH_SIZE + x;
            const val = gray1 > gray2 ? 1 : 0;
            if (bit < 32) hi |= (val << bit);
            else          lo |= (val << (bit - 32));
        }
    }
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
