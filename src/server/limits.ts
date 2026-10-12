import type { Context } from 'hono';
import type { AppEnvironment } from './app';
import { ApiError } from './errors';

/** What Cloudflare's rate limiting binding offers; tests pass counters of their own. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RateLimits {
  /** Per client address: new profiles, which a person starts once in a long while. */
  profiles?: RateLimiter;
  /** Per client address and endpoint: pairing and recovery, the writes a script could repeat. */
  client?: RateLimiter;
  /** Across everyone: new profiles, so a flood spread over many addresses still has a ceiling. */
  creation?: RateLimiter;
}

/** How long a refused client is told to wait: the bindings count per minute. */
export const RATE_LIMIT_SECONDS = 60;

/** Counts this attempt against `limiter`, by the caller's address unless a key is given. */
export async function throttle(
  c: Context<AppEnvironment>,
  limiter: RateLimiter | undefined,
  scope: string,
  key = c.req.header('CF-Connecting-IP') ?? 'unknown',
): Promise<void> {
  if (!limiter) return;
  const { success } = await limiter.limit({ key: `${scope}:${key}` });
  if (success) return;
  c.header('Retry-After', String(RATE_LIMIT_SECONDS));
  throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.');
}
