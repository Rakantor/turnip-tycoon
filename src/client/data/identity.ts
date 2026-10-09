import { useEffect, useSyncExternalStore } from 'react';
import { t } from '@lingui/core/macro';
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
  deviceName: () => (/Mobi|Android/i.test(navigator.userAgent) ? t`My phone` : t`My computer`),
  publish: (next) => {
    // A profile shown without a removal may be edited again, even after an earlier cleanup.
    if (!next.removal) pendingEdits.allow(next.session?.player.id ?? 'unassigned');
    activeIdentity.owner = next.session?.player.id ?? null;
    activeIdentity.connected = next.status === 'ready';
    setExpectedPlayer(activeIdentity.owner);
    for (const listener of listeners) listener();
  },
  attach: async (owner) => {
    pendingEdits.allow(owner);
    await pendingEdits.attachDrafts(owner);
    if (activeIdentity.owner !== owner || !activeIdentity.connected) return;
    await weekStore.attachDrafts(owner);
    if (activeIdentity.owner === owner && activeIdentity.connected) {
      void resumeWeeks(owner).catch(() => undefined);
    }
  },
  forgetShared: forgetSharedGroups,
  forget: async (owner) => {
    pendingEdits.forget(owner);
    pendingEdits.forget('unassigned');
    await forgetSharedGroups(owner);
  },
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
const answerWelcome = (displayName: string | null) => controller.answerWelcome(displayName);
const startAfterRemoval = () => controller.startAfterRemoval();

/**
 * Read current state after async local writes, rather than a stale render. Public legal
 * pages never start the controller, so they hold no profile access to lose.
 */
export const canReloadIdentity = () => !started || controller.state.canReload;

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
  // Returning to an already-open tab counts as online use even on a cached screen.
  // Background tabs do not keep device access alive indefinitely.
  let checkedAt = Date.now();
  const checkVisibleSession = () => {
    const now = Date.now();
    if (document.visibilityState !== 'visible' || (now >= checkedAt && now - checkedAt < 60_000))
      return;
    checkedAt = now;
    void controller.retry(true);
  };
  globalThis.addEventListener('focus', checkVisibleSession);
  document.addEventListener('visibilitychange', checkVisibleSession);
  void retry();
}

export function useIdentity(enabled = true) {
  const current = useSyncExternalStore(subscribe, snapshot);
  // Public legal pages must open even without storage, a profile, or an API connection.
  useEffect(() => {
    if (enabled) start();
  }, [enabled]);
  return {
    ...current,
    retry,
    adopt,
    beginIdentityChange,
    restartInterruptedCreation,
    answerWelcome,
    removeProfile: (owner: string) => controller.removeProfile(owner),
    clearRemovalAccess: () => controller.clearRemovalAccess(),
    startAfterRemoval,
  };
}
