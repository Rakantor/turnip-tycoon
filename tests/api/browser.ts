import { expect } from 'vitest';
import type { createApp } from '../../src/server/app';
import type { AccessResponse, ApiErrorResponse, SessionResponse } from '../../src/shared/api';

export const origin = 'https://turnip.test';
export const sessionCookie = '__Host-turnip-session';
export const pairingCookie = '__Host-turnip-pairing';

interface RequestOptions {
  origin?: string | null;
  contentType?: string | null;
  rawBody?: string;
  playerId?: string;
}

/** Separate cookie jars represent separate browsers, including HttpOnly cookies. */
export class Browser {
  readonly cookies = new Map<string, string>();

  constructor(readonly app: ReturnType<typeof createApp>) {}

  async request(method: string, path: string, body?: unknown, options: RequestOptions = {}) {
    const headers = new Headers();
    if (options.playerId) headers.set('X-Player-Id', options.playerId);
    if (method !== 'GET') {
      if (options.origin !== null) headers.set('Origin', options.origin ?? origin);
      if (options.contentType !== null)
        headers.set('Content-Type', options.contentType ?? 'application/json');
    }
    if (this.cookies.size) {
      headers.set(
        'Cookie',
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    }
    const response = await this.app.request(`${origin}${path}`, {
      method,
      headers,
      body: options.rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(';')[0]!;
      const separator = first.indexOf('=');
      const name = first.slice(0, separator);
      const value = first.slice(separator + 1);
      if (/Max-Age=0(?:;|$)/i.test(cookie) || !value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }
}

export async function expectError(response: Response, status?: number) {
  if (status !== undefined) expect(response.status).toBe(status);
  else expect(response.status).toBeGreaterThanOrEqual(400);
  const result = (await response.json()) as ApiErrorResponse;
  expect(result).toEqual({ error: { code: expect.any(String), message: expect.any(String) } });
  expect(result.error.code.length).toBeGreaterThan(0);
  expect(result.error.message.length).toBeGreaterThan(0);
  return result;
}

export async function createPlayer(browser: Browser, name = 'Maple'): Promise<AccessResponse> {
  const response = await browser.request('POST', '/api/session', {
    deviceName: `${name}'s phone`,
  });
  expect(response.status).toBe(201);
  const session = (await response.json()) as SessionResponse;
  const profile = await browser.request('PATCH', '/api/profile', { displayName: name });
  expect(profile.status).toBe(200);
  const { player } = (await profile.json()) as Pick<SessionResponse, 'player'>;
  const recovery = await browser.request('POST', '/api/recovery/rotate', {});
  expect(recovery.status).toBe(200);
  const { recoveryCode } = (await recovery.json()) as { recoveryCode: string };
  return { ...session, player, recoveryCode, hasRecoveryCode: true };
}
