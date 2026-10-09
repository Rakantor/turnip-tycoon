import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa';

export const pagesPwaOptions: Partial<VitePWAOptions> = {
  strategies: 'generateSW',
  filename: 'sw.js',
  scope: '/',
  // The checked-in manifest and native registration retain control of their lifecycle.
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
    // Pages uses hash routes: only the app's entry document needs a fallback.
    navigateFallback: 'index.html',
    navigateFallbackAllowlist: [/^\/(?:index\.html)?(?:\?.*)?$/],
    // User data stays in the existing IndexedDB store; API responses are never cached.
    runtimeCaching: [],
  },
};

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
      ...(pages ? [VitePWA(pagesPwaOptions)] : [cloudflare({ configPath: 'wrangler.dev.jsonc' })]),
    ],
    ...(pages ? { build: { outDir: 'dist/pages' } } : {}),
    server: { port: 5173, strictPort: true },
  };
});
