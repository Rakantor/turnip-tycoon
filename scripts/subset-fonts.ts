import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import SevenZip from '7z-wasm';
import { Blob, Face } from 'harfbuzzjs';
import subsetFont from 'subset-font';
import {
  CHARACTERS_FILE,
  charactersFor,
  SUBSET_DIR,
  SUBSET_LOCALES,
  SUBSETS,
  type Source,
} from './font-subsets';

// Cuts the CJK fonts down to the characters their catalogs use; run it after a ja, ko, zh-Hans
// or zh-Hant catalog changes. Downloads are checked against pinned hashes and cached in
// node_modules, so later runs work offline.
const CACHE_DIR = resolve(import.meta.dirname, '../node_modules/.cache/turnip-tycoon-fonts');
// Copyright and license fields the OFL asks copies to keep, beside the name fields kept by default.
const LICENSE_NAME_IDS = [0, 13, 14];

async function download(source: Source): Promise<Buffer> {
  const cached = resolve(CACHE_DIR, source.sha256);
  const hit = await readFile(cached).catch(() => null);
  if (hit) return hit;
  console.log(`Downloading ${source.url}`);
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(data).digest('hex');
  if (sha256 !== source.sha256) throw new Error(`${source.url}: unexpected SHA-256 ${sha256}`);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cached, data);
  return data;
}

async function extract(archive: Buffer, member: string): Promise<Buffer> {
  const sevenZip = await SevenZip({ print: () => {}, printErr: () => {} });
  sevenZip.FS.writeFile('/archive.7z', archive);
  sevenZip.callMain(['e', '/archive.7z', '-o/out', member, '-y']);
  return Buffer.from(sevenZip.FS.readFile(`/out/${member}`));
}

async function font(source: Source): Promise<Buffer> {
  const data = await download(source);
  return source.member ? extract(data, source.member) : data;
}

const covered = (data: Buffer) =>
  new Set(
    [...new Face(new Blob(data)).collectUnicodes()].map((code) => String.fromCodePoint(code)),
  );

await mkdir(SUBSET_DIR, { recursive: true });
const characters: Record<string, string> = {};
for (const locale of SUBSET_LOCALES) {
  const wanted = await charactersFor(locale);
  for (const subset of SUBSETS.filter((entry) => entry.locale === locale)) {
    const original = await font(subset.source);
    const has = covered(original);
    const missing = wanted.filter((character) => !has.has(character));
    if (missing.length && !subset.headings)
      throw new Error(`${subset.file} lacks ${missing.join(' ')}; choose another font`);
    const woff2 = await subsetFont(original, wanted.join(''), {
      targetFormat: 'woff2',
      preserveNameIds: LICENSE_NAME_IDS,
    });
    await writeFile(resolve(SUBSET_DIR, subset.file), woff2);
    console.log(
      `${subset.file}: ${wanted.length - missing.length} characters, ${Math.round(woff2.length / 1024)} KB`,
    );
  }
  characters[locale] = wanted.join('');
}
await writeFile(CHARACTERS_FILE, `${JSON.stringify(characters, null, 2)}\n`);
