import type { WeekRecord } from '../../shared/week';
import { apiOrigin } from './api-config';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public week?: WeekRecord,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let expectedPlayer: string | null = null;
let sessionToken: string | null = null;
let identityVersion = 0;
let pairingAttempt = 0;
let pairing: { token: string; expiresAt: number } | null = null;
const responseIdentities = new WeakMap<object, number>();

export function setExpectedPlayer(id: string | null) {
  if (id !== expectedPlayer) identityVersion++;
  expectedPlayer = id;
}

export function setSessionToken(token: string | null) {
  if (token !== sessionToken) {
    identityVersion++;
    pairingAttempt++;
    pairing = null;
  }
  sessionToken = token;
}

export function isCurrentIdentityResponse(value: object): boolean {
  const version = responseIdentities.get(value);
  return version === undefined || version === identityVersion;
}

export function invalidateIdentityResponses() {
  identityVersion++;
  pairingAttempt++;
}

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('?') || path.includes('#')) {
    // Query strings are built into group/week paths below, never allowed to change the origin.
    if (!/^\/[a-zA-Z0-9/_-]+(?:\?[^#]*)?$/.test(path)) throw new Error('Invalid API path.');
  }
  const version = identityVersion;
  const pairingVersion = path === '/pairing' ? ++pairingAttempt : pairingAttempt;
  const pairingToken = pairing && pairing.expiresAt > Date.now() ? pairing.token : null;
  const publicPath = [
    '/session',
    '/players',
    '/pairing',
    '/pairing/complete',
    '/recovery',
  ].includes(path);
  const response = await fetch(`${apiOrigin ?? ''}/api${path}`, {
    signal: AbortSignal.timeout(15_000),
    method: options.method ?? 'GET',
    credentials: apiOrigin ? 'omit' : 'same-origin',
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(!publicPath && expectedPlayer ? { 'X-Player-Id': expectedPlayer } : {}),
      ...(apiOrigin && sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...(apiOrigin && path === '/pairing/complete' && pairingToken
        ? { 'X-Pairing-Token': pairingToken }
        : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body = (await response.json()) as T & {
    error?: { code: string; message: string };
    week?: WeekRecord;
    pairingToken?: string;
    expiresAt?: string;
  };
  if (!response.ok) {
    if (
      version === identityVersion &&
      !publicPath &&
      (response.status === 401 || body.error?.code === 'PLAYER_CHANGED')
    ) {
      globalThis.dispatchEvent(new Event('turnip-session-stale'));
    }
    throw new ApiError(
      response.status,
      body.error?.code ?? 'REQUEST_FAILED',
      body.error?.message ?? 'Could not reach the server.',
      body.week,
    );
  }
  if (body && typeof body === 'object') responseIdentities.set(body, version);
  if (
    apiOrigin &&
    path === '/pairing' &&
    version === identityVersion &&
    pairingVersion === pairingAttempt &&
    /^[a-f0-9]{64}$/.test(body.pairingToken ?? '') &&
    body.expiresAt
  ) {
    // This claim stays in this tab only. It is never shared with another open tab.
    pairing = { token: body.pairingToken!, expiresAt: Date.parse(body.expiresAt) };
  }
  return body;
}
