/**
 * Minimal PNG encoder (grayscale, RGB and 8-bit indexed; adaptive per-row filters; single IDAT).
 * Pure Uint8Array — uses CompressionStream (Node 18+, Workers, browsers); no Buffer/node:zlib.
 */

// ---- CRC32 ---------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- Helpers -------------------------------------------------------------

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}

const TYPE_BYTES = (s: string): Uint8Array => {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
};

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeB = TYPE_BYTES(type);
  const crcSrc = concat([typeB, data]);
  return concat([u32be(data.length), typeB, data, u32be(crc32(crcSrc))]);
}

// ---- Deflate via Web Streams ---------------------------------------------

async function deflateZlib(input: Uint8Array): Promise<Uint8Array> {
  // 'deflate' = RFC 1950 zlib-wrapped — what PNG IDAT needs. 'deflate-raw' (RFC 1951) would be wrong.
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  // TS 5.7 narrows Uint8Array<ArrayBufferLike> away from BufferSource; safe since we never use SharedArrayBuffer.
  void writer.write(input as Uint8Array<ArrayBuffer>);
  void writer.close();

  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return concat(chunks);
}

// ---- Encode --------------------------------------------------------------

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Prepend scanline filter bytes using PNG's Average filter (type 3):
 *   Filt(x) = Orig(x) − floor((Recon(a) + Recon(b)) / 2)
 * where `a` is the same channel of the pixel to the left (x − bpp) and `b` the byte directly
 * above. Encoding may read the ORIGINAL bytes for a/b because the decoder reconstructs those
 * positions exactly before it needs them — the transform is bit-exact reversible, so decoded
 * pixels are byte-identical to `pixels`. Nothing about the image the model sees changes.
 *
 * Chosen over filter=None (the previous behavior): residuals of 5×8 bitmap glyphs on a flat
 * background collapse to mostly zeros, which deflate encodes in both less space and less time —
 * ~34% smaller IDAT at roughly half the compression cost on a representative dense page. That
 * matters because every image is re-uploaded on every turn, so IDAT size is a per-request
 * bandwidth cost. Filtering is pure JS ahead of the compressor, so it stays portable to
 * Workers unlike a deflate-level change (see the CompressionStream note above).
 */
export function filterAverage(pixels: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const rowBytes = width * bpp;
  const stride = rowBytes + 1;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const src = y * rowBytes;
    const dst = y * stride;
    out[dst] = 3; // filter: Average
    for (let x = 0; x < rowBytes; x++) {
      // Off-image neighbors are defined as zero by the spec, not clamped/wrapped.
      const a = x >= bpp ? pixels[src + x - bpp]! : 0;
      const b = y > 0 ? pixels[src - rowBytes + x]! : 0;
      // a + b ≤ 510 so the shift is exact; only the result wraps to a byte.
      out[dst + 1 + x] = (pixels[src + x]! - ((a + b) >> 1)) & 0xff;
    }
  }
  return out;
}

/** Signed magnitude of a filtered byte, the standard PNG filter-selection cost. */
const residualCost = (v: number): number => (v < 128 ? v : 256 - v);

/**
 * Per-row adaptive filtering: for each scanline try None, Sub, Up, Average and Paeth and keep
 * the one whose residuals have the smallest summed magnitude (the heuristic libpng uses).
 * Lossless like any PNG filter: decoded pixels are byte-identical to `pixels`.
 *
 * Measured 2026-09-26 on real pxpipe pages at the claude-opus-5-5 geometry: 83% of the
 * fixed-Average size on grayscale pages and 68% on RGB history pages, with identical
 * pixels. Smaller pages matter beyond bandwidth: history collapse is admitted atomically
 * against `maxImageBytes`, and long sessions were falling back to plain-text history
 * (the `image_bytes` passthrough) because the pages did not fit.
 */
export function filterAdaptive(pixels: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const rowBytes = width * bpp;
  const stride = rowBytes + 1;
  const out = new Uint8Array(stride * height);
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(rowBytes));
  for (let y = 0; y < height; y++) {
    const src = y * rowBytes;
    const up = src - rowBytes;
    let c0 = 0, c1 = 0, c2 = 0, c3 = 0, c4 = 0;
    for (let x = 0; x < rowBytes; x++) {
      const cur = pixels[src + x]!;
      const a = x >= bpp ? pixels[src + x - bpp]! : 0;
      const b = y > 0 ? pixels[up + x]! : 0;
      const c = y > 0 && x >= bpp ? pixels[up + x - bpp]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const v0 = cur;
      const v1 = (cur - a) & 0xff;
      const v2 = (cur - b) & 0xff;
      const v3 = (cur - ((a + b) >> 1)) & 0xff;
      const v4 = (cur - paeth) & 0xff;
      cand[0]![x] = v0; cand[1]![x] = v1; cand[2]![x] = v2; cand[3]![x] = v3; cand[4]![x] = v4;
      c0 += residualCost(v0);
      c1 += residualCost(v1);
      c2 += residualCost(v2);
      c3 += residualCost(v3);
      c4 += residualCost(v4);
    }
    const costs = [c0, c1, c2, c3, c4];
    let best = 0;
    for (let k = 1; k < 5; k++) if (costs[k]! < costs[best]!) best = k;
    const dst = y * stride;
    out[dst] = best;
    out.set(cand[best]!, dst + 1);
  }
  return out;
}

/** Encode a single-channel (grayscale) buffer as PNG bytes. pixels is row-major, length = width × height. */
export async function encodeGrayPng(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  if (pixels.length !== width * height) {
    throw new Error(`encodeGrayPng: pixels.length=${pixels.length} != ${width}×${height}=${width * height}`);
  }

  // IHDR: width(4) height(4) bitDepth=8 colorType=0(gray) compress=0 filter=0 interlace=0
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = 8;
  ihdr[9] = 0; // colorType 0 = grayscale; bytes 10-12 already zero

  const compressed = await deflateZlib(filterAdaptive(pixels, width, height, 1));

  return concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Encode an RGB (3 bytes/pixel, R,G,B) buffer as PNG bytes (colorType 2 = truecolor). length = width × height × 3. */
export async function encodeRgbPng(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  if (pixels.length !== width * height * 3) {
    throw new Error(`encodeRgbPng: pixels.length=${pixels.length} != ${width}×${height}×3=${width * height * 3}`);
  }

  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = 8; // bit depth per channel
  ihdr[9] = 2; // colorType 2 = truecolor RGB; bytes 10-12 already zero

  const compressed = await deflateZlib(filterAdaptive(pixels, width, height, 3));

  return concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Encode palette indices (1 byte/pixel) as an 8-bit indexed PNG (colorType 3).
 *  `palette` is RGB triples, at most 256 of them. */
export async function encodeIndexedPng(
  indices: Uint8Array,
  palette: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  if (indices.length !== width * height) {
    throw new Error(`encodeIndexedPng: indices.length=${indices.length} != ${width}x${height}`);
  }
  if (palette.length % 3 !== 0 || palette.length === 0 || palette.length > 256 * 3) {
    throw new Error(`encodeIndexedPng: palette must hold 1..256 RGB triples, got ${palette.length} bytes`);
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = 8; // bits per palette index
  ihdr[9] = 3; // colorType 3 = indexed-color
  const compressed = await deflateZlib(filterAdaptive(indices, width, height, 1));
  return concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('PLTE', palette),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/**
 * Encode an RGB buffer in the smallest LOSSLESS form available: grayscale when every pixel
 * has R=G=B, indexed when the page uses at most 256 distinct colors, truecolor otherwise.
 * All three decode to byte-identical RGB pixels, so the model sees exactly the same image
 * and Anthropic bills the same visual tokens (billing is by pixel dimensions, not bytes).
 *
 * Why it matters: colorByRole history pages are built as RGB, but most of them carry no
 * colored ink at all (182 distinct gray levels, R=G=B on every pixel), so they paid 3 bytes
 * per pixel for a grayscale image. Measured on real pages (2026-09-26): 48.7% of the bytes.
 * Palette order is first-seen scan order, so the output is deterministic for a given page.
 */
export async function encodeRgbPngSmallest(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const n = width * height;
  if (pixels.length !== n * 3) {
    throw new Error(`encodeRgbPngSmallest: pixels.length=${pixels.length} != ${width}x${height}x3`);
  }
  let gray = true;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    if (pixels[o] !== pixels[o + 1] || pixels[o] !== pixels[o + 2]) { gray = false; break; }
  }
  if (gray) {
    const g = new Uint8Array(n);
    for (let i = 0; i < n; i++) g[i] = pixels[i * 3]!;
    return encodeGrayPng(g, width, height);
  }
  const index = new Map<number, number>();
  const idx = new Uint8Array(n);
  const pal: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const key = (pixels[o]! << 16) | (pixels[o + 1]! << 8) | pixels[o + 2]!;
    let k = index.get(key);
    if (k === undefined) {
      if (index.size >= 256) return encodeRgbPng(pixels, width, height);
      k = index.size;
      index.set(key, k);
      pal.push(pixels[o]!, pixels[o + 1]!, pixels[o + 2]!);
    }
    idx[i] = k;
  }
  return encodeIndexedPng(idx, Uint8Array.from(pal), width, height);
}

/** Base64-encode bytes. Chunks to avoid call-stack blow-up from String.fromCharCode(...bigArray). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
