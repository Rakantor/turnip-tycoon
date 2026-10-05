import { useEffect, useSyncExternalStore } from 'react';
import {
  invalidateIdentityResponses,
  isCurrentIdentityResponse,
  request,
  setExpectedPlayer,
  setSessionToken,
} from './api';
import { apiOrigin, identityNamespace } from './api-config';
import { database } from './database';
import { activeIdentity, resumeWeeks, weekStore } from './runtime';
import { pendingEdits } from './pending-edits';
import { SessionController } from './session-controller';
import { SessionVault } from './session-vault';
import { forgetSharedGroups } from './use-groups';

const listeners = new Set<() => void>();
let started = false;
let channel: BroadcastChannel | null = null;
const controller = new SessionController({
  vault: new SessionVault(database, Boolean(apiOrigin)),
  request,
  credential: setSessionToken,
  currentResponse: isCurrentIdentityResponse,
  invalidateResponses: invalidateIdentityResponses,
  lock: (run) =>
    navigator.locks ? navigator.locks.request(`${identityNamespace}:identity`, run) : run(),
  deviceName: () => (/Mobi|Android/i.test(navigator.userAgent) ? 'My phone' : 'My computer'),
  publish: (next) => {
    activeIdentity.owner = next.session?.player.id ?? null;
    activeIdentity.connected = next.status === 'ready';
    setExpectedPlayer(activeIdentity.owner);
    for (const listener of listeners) listener();
  },
  attach: async (owner) => {
    await pendingEdits.attachDrafts(owner);
    if (activeIdentity.owner !== owner || !activeIdentity.connected) return;
    await weekStore.attachDrafts(owner);
    if (activeIdentity.owner === owner && activeIdentity.connected) {
      void resumeWeeks(owner).catch(() => undefined);
    }
  },
  forget: forgetSharedGroups,
  broadcast: () => channel?.postMessage({ type: 'identity' }),
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => controller.state;
const retry = () => controller.retry();
const adopt = controller.adopt.bind(controller);
const beginIdentityChange = () => controller.beginIdentityChange();
const restartInterruptedCreation = () => controller.restartInterruptedCreation();

/** Read current state after async local writes, rather than a stale render. */
export const canReloadIdentity = () => controller.state.canReload;

function start() {
  if (started) return;
  started = true;
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(`${identityNamespace}:identity`);
    channel.onmessage = () => controller.refresh();
  }
  globalThis.addEventListener('online', () => {
    void retry();
  });
  globalThis.addEventListener('turnip-session-stale', () => controller.refresh());
  void retry();
}

export function useIdentity() {
  const current = useSyncExternalStore(subscribe, snapshot);
  useEffect(start, []);
  return { ...current, retry, adopt, beginIdentityChange, restartInterruptedCreation };
}
