import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function hosting(mode: string, base: string, origin: string) {
  vi.stubEnv('MODE', mode);
  vi.stubEnv('BASE_URL', base);
  vi.stubGlobal('location', { origin });
  vi.resetModules();
  return import('../../src/client/urls');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('app URLs', () => {
  it('keeps local development links on browser routes', async () => {
    const { appUrl, hashRouting } = await hosting('development', '/', 'http://localhost:5173');
    expect(hashRouting).toBe(false);
    expect(appUrl('/groups/join?code=TURNIP')).toBe(
      'http://localhost:5173/groups/join?code=TURNIP',
    );
    expect(appUrl('/settings?pair=ABC-123')).toBe('http://localhost:5173/settings?pair=ABC-123');
  });

  it('keeps shared invitations and pairing links inside the Pages project and hash route', async () => {
    const { appUrl, hashRouting } = await hosting(
      'pages',
      '/turnip-tycoon/',
      'https://rakantor.github.io',
    );
    expect(hashRouting).toBe(true);
    expect(appUrl('/groups/join?code=TURNIP')).toBe(
      'https://rakantor.github.io/turnip-tycoon/#/groups/join?code=TURNIP',
    );
    expect(appUrl('/settings?pair=ABC%20123')).toBe(
      'https://rakantor.github.io/turnip-tycoon/#/settings?pair=ABC%20123',
    );
    expect(new URL(appUrl('/players/123/weeks/2026-10-04')).pathname).toBe('/turnip-tycoon/');
  });

  it('preserves a configured subpath for browser routes', async () => {
    const { appUrl } = await hosting('production', '/turnips/', 'https://example.com');
    expect(appUrl('/settings?pair=ABC-123')).toBe(
      'https://example.com/turnips/settings?pair=ABC-123',
    );
  });

  it('loads icons and attribution from the Pages project, outside the hash route', async () => {
    const { assetUrl } = await hosting('pages', '/turnip-tycoon/', 'https://rakantor.github.io');
    expect(assetUrl('icons/brand-96.webp')).toBe('/turnip-tycoon/icons/brand-96.webp');
    expect(assetUrl('/licenses/turnip-prophet/NOTICE')).toBe(
      '/turnip-tycoon/licenses/turnip-prophet/NOTICE',
    );
  });

  it('resolves the install manifest and its icons within either hosting base', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
      id?: string;
      scope: string;
      start_url: string;
      icons: { src: string }[];
    };
    for (const base of ['https://example.com/', 'https://rakantor.github.io/turnip-tycoon/']) {
      const manifestUrl = new URL('manifest.webmanifest', base);
      for (const path of [manifest.scope, manifest.start_url]) {
        expect(new URL(path, manifestUrl).href).toBe(base);
      }
      // Unlike other manifest URLs, an explicit ID resolves against the origin.
      // Omitting it uses start_url and avoids collisions between Pages projects.
      const startUrl = new URL(manifest.start_url, manifestUrl);
      const id = manifest.id ? new URL(manifest.id, startUrl.origin) : startUrl;
      expect(id.href).toBe(base);
      for (const icon of manifest.icons) {
        expect(new URL(icon.src, manifestUrl).href).toMatch(`${base}icons/`);
      }
    }
  });
});
