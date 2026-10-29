import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { lingui } from '@lingui/vite-plugin';
import { cloudflare } from '@cloudflare/vite-plugin';
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa';

export const pagesPwaOptions: Partial<VitePWAOptions> = {
  strategies: 'generateSW',
  filename: 'sw.js',
  scope: '/',
  // The manifest is checked in, and the app registers the worker itself.
  manifest: false,
  injectRegister: false,
  registerType: 'prompt',
  workbox: {
    cacheId: 'turnip-tycoon',
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: false,
    globPatterns: [
      'index.html',
      'assets/**/*.{js,css,woff,woff2}',
      'favicon.ico',
      'manifest.webmanifest',
      'icons/*.{png,webp}',
      'licenses/turnip-prophet/{COPYRIGHT,LICENSE,NOTICE}',
    ],
    // CJK fonts are fetched on demand, not precached.
    globIgnores: ['assets/cjk-*.woff2'],
    // Pages uses hash routes: only the app's entry document needs a fallback.
    navigateFallback: 'index.html',
    navigateFallbackAllowlist: [/^\/(?:index\.html)?(?:\?.*)?$/],
    // Only the CJK fonts, kept once fetched. API responses are never cached.
    runtimeCaching: [
      {
        urlPattern: /\/assets\/cjk-[^/]+\.woff2$/,
        handler: 'CacheFirst',
        options: { cacheName: 'turnip-tycoon-cjk-fonts', expiration: { maxEntries: 16 } },
      },
    ],
  },
};

/**
 * `pnpm dev` passes the demo profile's device token (scripts/demo.ts). A page opened without a
 * session cookie gets it, so a private window starts on the demo profile, not a new one.
 */
function demoSession(token: string | undefined): Plugin[] {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return [];
  return [
    {
      name: 'turnip-demo-session',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const page =
            request.headers['sec-fetch-dest'] === 'document' ||
            request.headers.accept?.includes('text/html');
          if (page && !/(?:^|;\s*)turnip-session=/.test(request.headers.cookie ?? ''))
            response.setHeader(
              'Set-Cookie',
              `turnip-session=${token}; Max-Age=${30 * 24 * 60 * 60}; Path=/; HttpOnly; SameSite=Strict`,
            );
          next();
        });
      },
    },
  ];
}

export default defineConfig(({ mode }) => {
  const pages = mode === 'pages';
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (pages) {
    const apiUrl = env.VITE_API_URL;
    if (!apiUrl)
      throw new Error('Set VITE_API_URL to the deployed API origin before building Pages.');
    const parsed = new URL(apiUrl);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (
      (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:')) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== '/'
    )
      throw new Error(
        'VITE_API_URL must be an HTTPS origin (loopback HTTP is allowed for testing).',
      );
  }
  return {
    plugins: [
      react(),
      lingui({ macroTransform: true }),
      ...(pages
        ? [VitePWA(pagesPwaOptions)]
        : [
            ...demoSession(process.env.TURNIP_DEMO_SESSION),
            cloudflare({ configPath: 'wrangler.dev.jsonc' }),
          ]),
    ],
    ...(pages ? { build: { outDir: 'dist/pages' } } : {}),
    server: { port: 5173, strictPort: true },
  };
});
