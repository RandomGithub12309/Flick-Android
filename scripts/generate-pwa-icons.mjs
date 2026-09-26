/**
 * Regenerates the PWA icons in public/__grok/ from the Flick wordmark geometry
 * in public/favicon.svg.
 *
 * Chrome only offers "Install app" when the manifest declares BOTH a 192x192
 * and a 512x512 PNG. The platform scaffold ships a single 180x180 placeholder,
 * which is below the threshold — so the install prompt never appears and the
 * app's own "Install to your home screen" copy is a dead promise.
 *
 * There is no image library in this project and no browser binary available in
 * CI, so the favicon's five rounded rects are rasterized here and encoded to
 * PNG directly (zlib is the only dependency, and it ships with Node).
 *
 *   node scripts/generate-pwa-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "__grok");

/** Matches public/favicon.svg — a 32x32 viewBox, two stacked cards. */
const INK = {
  background: [0x09, 0x09, 0x0b],
  backCard: [0xa1, 0xa1, 0xaa],
  frontCard: [0xec, 0xe7, 0xdc],
  text: [0x14, 0x14, 0x16],
};

const SHAPES = [
  { x: 11, y: 5, w: 12, h: 16, r: 3, fill: INK.backCard },
  { x: 8, y: 9, w: 14, h: 18, r: 3.5, fill: INK.frontCard },
  { x: 11, y: 13, w: 8, h: 2.2, r: 1.1, fill: INK.text },
  { x: 11, y: 17, w: 5.5, h: 2, r: 1, fill: INK.text },
];

/** Supersampling factor per axis. 3x3 is enough to keep the card edges smooth. */
const SS = 3;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Minimal 8-bit RGBA PNG encoder — no filters, one zlib stream. */
function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour + alpha
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter type 0 (None)
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Signed distance to a rounded rectangle; negative inside. */
function roundedRectSdf(px, py, x, y, w, h, r) {
  const cx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const cy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const ax = Math.max(cx, 0);
  const ay = Math.max(cy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(cx, cy), 0) - r;
}

function blend(buf, idx, rgb, alpha) {
  if (alpha <= 0) return;
  const inv = 1 - alpha;
  buf[idx] = Math.round(rgb[0] * alpha + buf[idx] * inv);
  buf[idx + 1] = Math.round(rgb[1] * alpha + buf[idx + 1] * inv);
  buf[idx + 2] = Math.round(rgb[2] * alpha + buf[idx + 2] * inv);
  buf[idx + 3] = Math.max(buf[idx + 3], Math.round(alpha * 255));
}

/**
 * @param size    output edge in px
 * @param artScale fraction of the canvas the 32-unit design occupies
 * @param rounded  round the background corners (false for maskable, which the
 *                 OS clips into its own shape)
 */
function render(size, artScale, rounded) {
  const buf = Buffer.alloc(size * size * 4, 0);
  const unit = (size * artScale) / 32;
  const offset = (size - size * artScale) / 2;
  const px = (v) => v * unit;

  const rects = [
    // Background is in canvas pixels, not design units — it always covers the
    // full edge. (Scaling it like the cards left the canvas transparent.)
    { x: 0, y: 0, w: size, h: size, r: rounded ? px(8) : 0, fill: INK.background },
    ...SHAPES.map((s) => ({
      ...s,
      x: px(s.x) + offset,
      y: px(s.y) + offset,
      w: px(s.w),
      h: px(s.h),
      r: px(s.r),
    })),
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      for (const rect of rects) {
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const fx = x + (sx + 0.5) / SS;
            const fy = y + (sy + 0.5) / SS;
            if (roundedRectSdf(fx, fy, rect.x, rect.y, rect.w, rect.h, rect.r) < 0) hits++;
          }
        }
        if (hits) blend(buf, idx, rect.fill, hits / (SS * SS));
      }
    }
  }
  return encodePng(buf, size, size);
}

// icon-180 is kept: the platform's own tests assert that path still exists.
const TARGETS = [
  { file: "icon-180.png", size: 180, artScale: 1, rounded: true },
  { file: "icon-192.png", size: 192, artScale: 1, rounded: true },
  { file: "icon-512.png", size: 512, artScale: 1, rounded: true },
  // Maskable safe zone is the central 80%; 0.72 keeps the cards clear of the
  // circle an OEM launcher clips to.
  { file: "icon-maskable-512.png", size: 512, artScale: 0.72, rounded: false },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const t of TARGETS) {
  const png = render(t.size, t.artScale, t.rounded);
  writeFileSync(join(OUT_DIR, t.file), png);
  const dims = `${t.size}x${t.size}`;
  console.log(`${t.file.padEnd(26)} ${dims.padEnd(10)} ${png.length} bytes`);
}
