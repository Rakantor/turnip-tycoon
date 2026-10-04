import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { z } from 'zod';
import type { AppEnvironment } from './app';
import { ApiError } from './errors';

export const SESSION_SECONDS = 180 * 24 * 60 * 60;
export const PAIRING_SECONDS = 10 * 60;
const MAX_BODY_BYTES = 16 * 1024;
const CORS_METHODS = ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'];
const CORS_HEADERS = ['authorization', 'content-type', 'x-player-id', 'x-pairing-token'];

export type CredentialMode = 'cookie' | 'bearer';

export function validateFrontendOrigin(origin: string | undefined): string {
  if (origin) {
    try {
      const url = new URL(origin);
      if (
        url.origin === origin &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      )
        return origin;
    } catch {
      // Configuration errors must fail closed before accepting any credentials.
    }
  }
  throw new Error('Bearer authentication requires a valid FRONTEND_ORIGIN.');
}

/** Handle browser policy before opening a database connection, including OPTIONS. */
export function crossOriginRequest(c: Context, frontendOrigin: string): Response | undefined {
  c.header('Vary', 'Origin', { append: true });
  const origin = c.req.header('Origin');
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method);
  if (
    (origin !== undefined && origin !== frontendOrigin) ||
    ((mutation || c.req.method === 'OPTIONS') && origin !== frontendOrigin)
  )
    throw new ApiError(403, 'INVALID_ORIGIN', 'Open this request from the app.');

  if (origin === frontendOrigin) c.header('Access-Control-Allow-Origin', frontendOrigin);
  if (c.req.method !== 'OPTIONS') return;

  const requestedMethod = c.req.header('Access-Control-Request-Method');
  const requestedHeaders = c.req.header('Access-Control-Request-Headers');
  if (
    !requestedMethod ||
    !CORS_METHODS.includes(requestedMethod) ||
    (requestedHeaders !== undefined &&
      requestedHeaders
        .split(',')
        .some((header) => !CORS_HEADERS.includes(header.trim().toLowerCase())))
  )
    throw new ApiError(403, 'INVALID_PREFLIGHT', 'This browser request is not allowed.');

  c.header('Access-Control-Allow-Methods', CORS_METHODS.join(', '));
  c.header('Access-Control-Allow-Headers', CORS_HEADERS.join(', '));
  return c.body(null, 204);
}

export function secureTransport(c: Context): boolean {
  const url = new URL(c.req.url);
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    return false;
  throw new ApiError(400, 'HTTPS_REQUIRED', 'Use HTTPS to connect securely.');
}

function cookieName(c: Context, kind: 'session' | 'pairing'): string {
  return `${secureTransport(c) ? '__Host-' : ''}turnip-${kind}`;
}

export function readCredential(
  c: Context<AppEnvironment>,
  kind: 'session' | 'pairing',
): string | undefined {
  const token =
    c.get('credentialMode') === 'bearer'
      ? kind === 'session'
        ? /^Bearer ([a-f0-9]{64})$/i.exec(c.req.header('Authorization') ?? '')?.[1]
        : c.req.header('X-Pairing-Token')
      : getCookie(c, cookieName(c, kind));
  return token && /^[a-f0-9]{64}$/.test(token) ? token : undefined;
}

export function writeCredential(
  c: Context<AppEnvironment>,
  kind: 'session' | 'pairing',
  token: string,
): void {
  if (c.get('credentialMode') === 'bearer') return;
  setCookie(c, cookieName(c, kind), token, {
    httpOnly: true,
    secure: secureTransport(c),
    sameSite: 'Strict',
    path: '/',
    maxAge: token ? (kind === 'session' ? SESSION_SECONDS : PAIRING_SECONDS) : 0,
  });
}

export function checkOrigin(c: Context): void {
  if (c.req.header('Origin') !== new URL(c.req.url).origin) {
    throw new ApiError(403, 'INVALID_ORIGIN', 'Open this request from the app.');
  }
  const site = c.req.header('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') {
    throw new ApiError(403, 'INVALID_ORIGIN', 'Open this request from the app.');
  }
}

// Check actual streamed bytes as well as Content-Length, which clients can omit.
export async function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'JSON_REQUIRED', 'Send a JSON request.');
  }
  const declaredLength = Number(c.req.header('Content-Length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES)
    throw new ApiError(413, 'BODY_TOO_LARGE', 'The request is too large.');
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw new ApiError(400, 'INVALID_JSON', 'Send a JSON request body.');
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let length = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ApiError(413, 'BODY_TOO_LARGE', 'The request is too large.');
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_JSON', 'The request body could not be read.');
  } finally {
    reader.releaseLock();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Send valid JSON.');
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(
      400,
      'INVALID_INPUT',
      result.error.issues[0]?.message ?? 'Check the supplied fields.',
    );
  }
  return result.data;
}
