import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = `${root}assets/branding/turnip-tycoon-source.webp`;
const web = `${root}public/icons`;
const stores = `${root}assets/app-icons`;
const apple = `${stores}/AppIcon.appiconset`;
await Promise.all([mkdir(web, { recursive: true }), mkdir(apple, { recursive: true })]);

// Trim almost-invisible stray alpha pixels, retaining a two-pixel edge buffer.
const { data, info } = await sharp(source)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
let left = info.width;
let top = info.height;
let right = 0;
let bottom = 0;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] <= 8) continue;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
}
left = Math.max(0, left - 2);
top = Math.max(0, top - 2);
right = Math.min(info.width - 1, right + 2);
bottom = Math.min(info.height - 1, bottom + 2);
const width = right - left + 1;
const height = bottom - top + 1;
const artwork = await sharp(source).extract({ left, top, width, height }).png().toBuffer();

// Measure the actual silhouette so every visible part fits the maskable safe circle.
let radius = 0;
for (let y = top; y <= bottom; y++) {
  for (let x = left; x <= right; x++) {
    if (data[(y * info.width + x) * 4 + 3] <= 8) continue;
    radius = Math.max(radius, Math.hypot(x - (left + right) / 2, y - (top + bottom) / 2));
  }
}
const white = { r: 255, g: 255, b: 255, alpha: 1 };
const clear = { r: 0, g: 0, b: 0, alpha: 0 };
const optimizedPng = { palette: true, quality: 95, effort: 10, compressionLevel: 9, dither: 0.7 };

async function square(size, { transparent = false, maskable = false } = {}) {
  const scale = maskable ? (size * 0.37) / radius : (size * 0.94) / Math.max(width, height);
  const resized = await sharp(artwork)
    .resize(Math.round(width * scale), Math.round(height * scale), { kernel: 'lanczos3' })
    .toBuffer();
  const buffer = await sharp({
    create: { width: size, height: size, channels: 4, background: transparent ? clear : white },
  })
    .composite([{ input: resized, gravity: 'centre' }])
    .png()
    .toBuffer();
  return sharp(buffer);
}

for (const size of [32, 48, 96]) {
  await (
    await square(size, { transparent: true })
  )
    .png(optimizedPng)
    .toFile(`${web}/favicon-${size}.png`);
}
for (const size of [96, 192, 384]) {
  await (
    await square(size, { transparent: true })
  )
    .webp({ quality: 86, alphaQuality: 100, effort: 6 })
    .toFile(`${web}/brand-${size}.webp`);
}
for (const size of [192, 512]) {
  await (await square(size)).removeAlpha().png(optimizedPng).toFile(`${web}/icon-${size}.png`);
  await (
    await square(size, { maskable: true })
  )
    .removeAlpha()
    .png(optimizedPng)
    .toFile(`${web}/maskable-${size}.png`);
}
await (await square(180)).removeAlpha().png(optimizedPng).toFile(`${web}/apple-touch-icon.png`);

// Store uploads use truecolor PNG, no rounded corners, no baked-in shadows.
async function storePng(size, path, alpha) {
  // Reduce redundant colors before re-encoding the required RGB/RGBA upload format.
  const reduced = await (
    await square(size)
  )
    .png({ ...optimizedPng, colours: 256, quality: 98, dither: 0.3 })
    .toBuffer();
  const output = sharp(reduced);
  if (alpha) output.ensureAlpha(1);
  else output.removeAlpha();
  await output.png({ palette: false, compressionLevel: 9 }).toFile(path);
}
await storePng(1024, `${apple}/AppIcon-1024.png`, false);
await storePng(512, `${stores}/google-play-512.png`, true);
await writeFile(
  `${apple}/Contents.json`,
  `${JSON.stringify({ images: [{ filename: 'AppIcon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: { author: 'xcode', version: 1 } }, null, 2)}\n`,
);

// A compact ICO container with full RGBA PNG entries for modern browsers/Windows.
const sizes = [16, 32, 48];
const frames = await Promise.all(
  sizes.map(async (size) =>
    (await square(size, { transparent: true }))
      .png({ palette: false, compressionLevel: 9 })
      .toBuffer(),
  ),
);
const directory = Buffer.alloc(6 + frames.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(frames.length, 4);
let offset = directory.length;
frames.forEach((frame, index) => {
  const entry = 6 + index * 16;
  directory.writeUInt8(sizes[index], entry);
  directory.writeUInt8(sizes[index], entry + 1);
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frame.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
await writeFile(`${root}public/favicon.ico`, Buffer.concat([directory, ...frames]));
console.log('Generated browser, header, Apple touch, PWA, maskable, and store icons.');
