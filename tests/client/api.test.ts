import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseApiOrigin } from '../../src/client/data/api-config';

const token = 'a'.repeat(64);
const claim = 'b'.repeat(64);
const apiUrl = 'https://turnip-api.example.workers.dev';

async function transport(origin = apiUrl, base = '/turnip-tycoon/') {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', origin);
  vi.stubEnv('BASE_URL', base);
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  return { api: await import('../../src/client/data/api'), fetcher };
}
const json = (value: unknown, status = 200) => Response.json(value, { status });
function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('API configuration', () => {
  it.each([
    'http://public.example',
    'https://example.com/api',
    'https://username:password@example.com',
    'https://example.com?secret=token',
    'https://example.com/#fragment',
    '//example.com',
    'javascript:alert(1)',
  ])('rejects unsafe or ambiguous API origin %s', (value) => {
    expect(() => parseApiOrigin(value)).toThrow('VITE_API_URL');
  });

  it('allows HTTPS and explicit HTTP loopback development origins', () => {
    expect(parseApiOrigin('https://example.com/')).toBe('https://example.com');
    expect(parseApiOrigin('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(parseApiOrigin('http://[::1]:8787')).toBe('http://[::1]:8787');
    expect(parseApiOrigin(undefined)).toBeNull();
  });

  it('isolates browser databases for different APIs and GitHub Pages project paths', async () => {
    await transport(apiUrl, '/one/');
    const first = (await import('../../src/client/data/api-config')).identityNamespace;
    await transport(apiUrl, '/two/');
    const second = (await import('../../src/client/data/api-config')).identityNamespace;
    await transport('https://another.example', '/one/');
    const third = (await import('../../src/client/data/api-config')).identityNamespace;
    expect(new Set([first, second, third]).size).toBe(3);
  });
});

describe('API credential transport', () => {
  it('sends bearer credentials without cookies and retains expected-player protection', async () => {
    const { api, fetcher } = await transport();
    api.setSessionToken(token);
    api.setExpectedPlayer('player-one');
    fetcher.mockImplementation(async () => json({ ok: true }));
    await api.request('/profile', { method: 'PATCH', body: { displayName: 'New name' } });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`${apiUrl}/api/profile`, {
      signal: expect.any(AbortSignal),
      method: 'PATCH',
      credentials: 'omit',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Player-Id': 'player-one',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ displayName: 'New name' }),
    });
  });

  it('keeps cookie transport unchanged when no external API is configured', async () => {
    const { api, fetcher } = await transport('');
    api.setSessionToken(token);
    fetcher.mockImplementation(async () => json({ ok: true }));
    await api.request('/session');
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/session', {
      signal: expect.any(AbortSignal),
      method: 'GET',
      credentials: 'same-origin',
      headers: {},
    });
  });

  it('does not silently adopt a recovery token before the identity controller accepts its response', async () => {
    const { api, fetcher } = await transport();
    api.setSessionToken(token);
    fetcher.mockResolvedValueOnce(json({ sessionToken: claim, recoveryCode: 'one-time' }));
    const response = await api.request<object>('/recovery', {
      method: 'POST',
      body: { code: 'secret' },
    });
    expect(api.isCurrentIdentityResponse(response)).toBe(true);
    fetcher.mockResolvedValueOnce(json({ ok: true }));
    await api.request('/profile');
    expect(fetcher.mock.calls[1][1]?.headers).toHaveProperty('Authorization', `Bearer ${token}`);
    api.setSessionToken('c'.repeat(64));
    expect(api.isCurrentIdentityResponse(response)).toBe(false);
  });

  it('invalidates an earlier access response as soon as a newer identity change begins', async () => {
    const { api, fetcher } = await transport();
    const older = defer<Response>();
    fetcher.mockReturnValueOnce(older.promise);
    const recovering = api.request<object>('/recovery', { method: 'POST', body: {} });
    api.invalidateIdentityResponses();
    older.resolve(json({ sessionToken: token }));
    expect(api.isCurrentIdentityResponse(await recovering)).toBe(false);
  });

  it('passes the per-tab pairing claim only to completion and forgets it when expired', async () => {
    const { api, fetcher } = await transport();
    const now = Date.now();
    fetcher.mockResolvedValueOnce(
      json({
        code: 'PAIR-CODE',
        pairingToken: claim,
        expiresAt: new Date(now + 1000).toISOString(),
      }),
    );
    await api.request('/pairing', { method: 'POST', body: {} });
    fetcher.mockImplementation(async () => json({ ok: true }));
    await api.request('/pairing/complete', { method: 'POST', body: {} });
    expect(fetcher.mock.calls[1][1]?.headers).toHaveProperty('X-Pairing-Token', claim);
    await api.request('/profile');
    expect(fetcher.mock.calls[2][1]?.headers).not.toHaveProperty('X-Pairing-Token');
    vi.spyOn(Date, 'now').mockReturnValue(now + 1001);
    await api.request('/pairing/complete', { method: 'POST', body: {} });
    expect(fetcher.mock.calls[3][1]?.headers).not.toHaveProperty('X-Pairing-Token');
  });

  it('ignores an older pairing response and never shares its claim with another tab', async () => {
    const { api, fetcher } = await transport();
    const old = defer<Response>();
    fetcher.mockReturnValueOnce(old.promise);
    const oldRequest = api.request('/pairing', { method: 'POST', body: {} });
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    fetcher.mockResolvedValueOnce(json({ code: 'NEW', pairingToken: claim, expiresAt }));
    await api.request('/pairing', { method: 'POST', body: {} });
    old.resolve(json({ code: 'OLD', pairingToken: 'c'.repeat(64), expiresAt }));
    await oldRequest;
    fetcher.mockImplementation(async () => json({ ok: true }));
    await api.request('/pairing/complete', { method: 'POST', body: {} });
    expect(fetcher.mock.calls[2][1]?.headers).toHaveProperty('X-Pairing-Token', claim);
    const anotherTab = await transport();
    anotherTab.fetcher.mockResolvedValue(json({ ok: true }));
    await anotherTab.api.request('/pairing/complete', { method: 'POST', body: {} });
    expect(anotherTab.fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('X-Pairing-Token');
  });

  it('does not invalidate a new identity because an old in-flight request returns unauthorized', async () => {
    const { api, fetcher } = await transport();
    const dispatch = vi.fn();
    vi.stubGlobal('dispatchEvent', dispatch);
    api.setSessionToken(token);
    const old = defer<Response>();
    fetcher.mockReturnValueOnce(old.promise);
    const request = api.request('/profile');
    api.setSessionToken(claim);
    old.resolve(json({ error: { code: 'PLAYER_CHANGED', message: 'Changed' } }, 401));
    await expect(request).rejects.toThrow('Changed');
    expect(dispatch).not.toHaveBeenCalled();
  });
});
