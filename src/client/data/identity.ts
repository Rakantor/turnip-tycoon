import { useEffect, useSyncExternalStore } from 'react';
import type { SessionResponse } from '../../shared/api';
import { ApiError, request, setExpectedPlayer } from './api';
import { database } from './database';
import { activeIdentity, resumeWeeks, weekStore } from './runtime';
import { pendingEdits } from './pending-edits';

type IdentityState = {
  session: SessionResponse | null;
  status: 'connecting' | 'ready' | 'offline' | 'error';
  error: string | null;
};
let state: IdentityState = { session: null, status: 'connecting', error: null };
const listeners = new Set<() => void>();
let bootstrap: Promise<void> | null = null;
let generation = 0;
let refreshRequested = false;
let started = false;
let channel: BroadcastChannel | null = null;
function publish(next: IdentityState) {
  state = next;
  activeIdentity.owner = next.session?.player.id ?? null;
  activeIdentity.connected = next.status === 'ready';
  setExpectedPlayer(activeIdentity.owner);
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => state;

async function applySession(
  value: SessionResponse,
  attempt: number,
  broadcast: boolean,
): Promise<void> {
  if (attempt !== generation) return;
  // Recovery responses also contain a one-time secret. Never cache that extra field.
  const session: SessionResponse = {
    player: value.player,
    deviceId: value.deviceId,
    hasRecoveryCode: value.hasRecoveryCode,
  };
  // Keep credentials in the HttpOnly cookie; this cache contains only public profile data.
  try {
    await database.meta.put({ key: 'session', value: session });
  } catch {
    /* Online use still works if storage is unavailable. */
  }
  if (attempt !== generation) return;
  await pendingEdits.attachDrafts(session.player.id);
  if (attempt !== generation) return;
  publish({ session, status: 'ready', error: null });
  try {
    await weekStore.attachDrafts(session.player.id);
    void resumeWeeks(session.player.id).catch(() => undefined);
  } catch {
    /* The editor reports IndexedDB errors without blocking account access. */
  }
  if (broadcast) channel?.postMessage({ type: 'identity' });
}

async function adopt(session: SessionResponse): Promise<void> {
  // A delayed bootstrap response must not undo an explicit pairing/recovery.
  generation++;
  await applySession(session, generation, true);
}

async function retry(): Promise<void> {
  if (bootstrap) return bootstrap;
  const attempt = generation;
  publish({ ...state, status: 'connecting', error: null });
  const run = async () => {
    try {
      let session: SessionResponse;
      try {
        session = await request<SessionResponse>('/session');
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        session = await request<SessionResponse>('/session', {
          method: 'POST',
          body: {
            deviceName: /Mobi|Android/i.test(navigator.userAgent) ? 'My phone' : 'My computer',
          },
        });
      }
      await applySession(session, attempt, false);
    } catch (error) {
      if (attempt !== generation) return;
      publish({
        ...state,
        status: error instanceof ApiError ? 'error' : 'offline',
        error:
          error instanceof ApiError
            ? error.message
            : 'Waiting for a connection. Your prices stay on this device.',
      });
    }
  };
  bootstrap = navigator.locks ? navigator.locks.request('turnips-identity', run) : run();
  try {
    await bootstrap;
  } finally {
    bootstrap = null;
    if (refreshRequested) {
      refreshRequested = false;
      void retry();
    }
  }
}

function refreshIdentity() {
  generation++;
  publish({ ...state, status: 'connecting', error: null });
  if (bootstrap) refreshRequested = true;
  else void retry();
}

async function start(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const cache = await database.meta.get('session');
    if (cache?.value)
      publish({ session: cache.value as SessionResponse, status: 'connecting', error: null });
  } catch {
    /* The price editor reports persistence errors. */
  }
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('turnips-identity');
    channel.onmessage = refreshIdentity;
  }
  globalThis.addEventListener('online', () => {
    void retry();
  });
  globalThis.addEventListener('turnip-session-stale', refreshIdentity);
  await retry();
}

export function useIdentity() {
  const current = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    void start();
  }, []);
  return { ...current, retry, adopt };
}
