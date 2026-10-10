import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { pagesPwaOptions } from '../../vite.config';

type PrecacheEntry = { url: string; revision: string | null };

// Observe the generated worker's Workbox calls rather than just its source options.
function inspectWorker(source: string) {
  const calls = {
    entries: [] as PrecacheEntry[],
    prefix: '',
    routes: [] as NavigationRoute[],
    runtime: [] as { pattern: RegExp; handler: CacheFirst }[],
    messages: [] as ((event: { data: { type: string } }) => void)[],
    skipWaits: 0,
    claims: 0,
    cleanups: 0,
  };
  class NavigationRoute {
    constructor(
      readonly handler: string,
      readonly options: { allowlist: RegExp[] },
    ) {}
  }
  class ExpirationPlugin {
    constructor(readonly options: { maxEntries: number }) {}
  }
  class CacheFirst {
    constructor(readonly options: { cacheName: string; plugins: ExpirationPlugin[] }) {}
  }
  const workbox = {
    setCacheNameDetails: ({ prefix }: { prefix: string }) => {
      calls.prefix = prefix;
    },
    clientsClaim: () => calls.claims++,
    precacheAndRoute: (entries: PrecacheEntry[]) => {
      calls.entries = entries;
    },
    cleanupOutdatedCaches: () => calls.cleanups++,
    createHandlerBoundToURL: (url: string) => url,
    registerRoute: (route: NavigationRoute | RegExp, handler?: CacheFirst) => {
      if (route instanceof NavigationRoute) calls.routes.push(route);
      else calls.runtime.push({ pattern: route, handler: handler! });
    },
    NavigationRoute,
    CacheFirst,
    ExpirationPlugin,
  };
  const define = (_modules: string[], factory: (api: typeof workbox) => void) => factory(workbox);
  runInNewContext(source, {
    define,
    self: {
      define,
      skipWaiting: () => calls.skipWaits++,
      addEventListener: (name: string, handler: (typeof calls.messages)[number]) => {
        if (name === 'message') calls.messages.push(handler);
      },
    },
  });
  return calls;
}

describe('Pages service worker build', () => {
  let fixture: string;
  let first: ReturnType<typeof inspectWorker>;
  let updated: ReturnType<typeof inspectWorker>;

  async function buildFixture(version: number) {
    await writeFile(join(fixture, 'entry.js'), `console.log('fixture version ${version}');`);
    await build({
      configFile: false,
      root: fixture,
      mode: 'pages',
      logLevel: 'silent',
      plugins: [VitePWA(pagesPwaOptions)],
      build: { outDir: 'dist', emptyOutDir: true },
    });
    return inspectWorker(await readFile(join(fixture, 'dist/sw.js'), 'utf8'));
  }

  beforeAll(async () => {
    fixture = await mkdtemp(join(tmpdir(), 'turnip-pwa-build-'));
    await cp(resolve('public'), join(fixture, 'public'), { recursive: true });
    await mkdir(join(fixture, 'public/api'));
    await writeFile(join(fixture, 'public/api/session.json'), '{"secret":"never cache"}');
    await writeFile(join(fixture, 'public/debug.html'), 'not an app entry point');
    await mkdir(join(fixture, 'public/assets'));
    await writeFile(join(fixture, 'public/assets/nunito-latin-test.woff2'), 'latin font');
    await writeFile(join(fixture, 'public/assets/cjk-ja-test-0123.woff2'), 'japanese font');
    await writeFile(
      join(fixture, 'index.html'),
      '<!doctype html><html><head></head><body><script type="module" src="/entry.js"></script></body></html>',
    );
    first = await buildFixture(1);
    updated = await buildFixture(2);
  });

  afterAll(async () => {
    if (fixture) await rm(fixture, { recursive: true, force: true });
  });

  it('precaches the static app and its install assets without caching API responses', () => {
    const urls = first.entries.map(({ url }) => url);
    expect(urls).toContain('index.html');
    expect(urls).toContain('manifest.webmanifest');
    expect(urls).toContain('icons/icon-192.png');
    expect(urls).toContain('icons/maskable-512.png');
    expect(urls).toContain('icons/brand-96.webp');
    expect(urls).toContain('licenses/turnip-prophet/LICENSE');
    expect(urls.some((url) => /^assets\/.*\.js$/.test(url))).toBe(true);
    expect(urls).not.toContain('api/session.json');
    expect(urls).not.toContain('debug.html');
    expect(urls.every((url) => !url.startsWith('/') && !url.includes('://'))).toBe(true);
    expect(first.routes).toHaveLength(1);
  });

  it('leaves Japanese, Korean and Chinese fonts to the players who use them', () => {
    const urls = first.entries.map(({ url }) => url);
    expect(urls).toContain('assets/nunito-latin-test.woff2');
    expect(urls).not.toContain('assets/cjk-ja-test-0123.woff2');
    expect(first.runtime).toHaveLength(1);
    const [{ pattern, handler }] = first.runtime;
    expect(pattern.test('https://turniptycoon.app/assets/cjk-ja-test-0123.woff2')).toBe(true);
    expect(pattern.test('https://turniptycoon.app/assets/nunito-latin-test.woff2')).toBe(false);
    expect(pattern.test('https://api.turniptycoon.app/session')).toBe(false);
    expect(handler.options.cacheName).toBe('turnip-tycoon-cjk-fonts');
    expect(handler.options.plugins[0].options.maxEntries).toBeGreaterThan(0);
  });

  it('limits navigation fallback to the app entry point', () => {
    const route = first.routes[0];
    expect(route.handler).toBe('index.html');
    const matches = (path: string) => route.options.allowlist.some((rule) => rule.test(path));
    expect(matches('/')).toBe(true);
    expect(matches('/?source=installed')).toBe(true);
    expect(matches('/index.html')).toBe(true);
    for (const path of [
      '/another-page/',
      '/index.html/extra',
      '/debug.html',
      '/api/session',
      '/assets/missing.js',
      '/licenses/missing',
    ]) {
      expect(matches(path)).toBe(false);
    }
  });

  it('waits for the update message and namespaces its cache', () => {
    expect(first.prefix).toBe('turnip-tycoon');
    expect(first.claims).toBe(1);
    expect(first.cleanups).toBe(1);
    expect(first.skipWaits).toBe(0);
    for (const handler of first.messages) handler({ data: { type: 'unrelated' } });
    expect(first.skipWaits).toBe(0);
    for (const handler of first.messages) handler({ data: { type: 'SKIP_WAITING' } });
    expect(first.skipWaits).toBe(1);
  });

  it('revisions changed app content while retaining unchanged icon revisions', () => {
    const entry = (entries: PrecacheEntry[], url: string) =>
      entries.find((item) => item.url === url);
    expect(entry(updated.entries, 'index.html')?.revision).not.toBe(
      entry(first.entries, 'index.html')?.revision,
    );
    const script = ({ url }: PrecacheEntry) => /^assets\/.*\.js$/.test(url);
    expect(updated.entries.find(script)?.url).not.toBe(first.entries.find(script)?.url);
    expect(entry(updated.entries, 'icons/icon-192.png')?.revision).toBe(
      entry(first.entries, 'icons/icon-192.png')?.revision,
    );
  });
});
