import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

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
    base: pages ? '/turnip-tycoon/' : '/',
    plugins: [react(), ...(pages ? [] : [cloudflare({ configPath: 'wrangler.dev.jsonc' })])],
    ...(pages ? { build: { outDir: 'dist/pages' } } : {}),
    server: { port: 5173, strictPort: true },
  };
});
