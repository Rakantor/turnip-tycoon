import { useEffect, useSyncExternalStore } from 'react';
import { t } from '@lingui/core/macro';
import { PwaController, type PwaState } from './pwa-controller';
import { canReloadIdentity } from './data/identity';
import { pendingEdits } from './data/pending-edits';

const inactive: PwaState = { ready: false, updateAvailable: false, updating: false, error: null };
let controller: PwaController | null = null;
const guards = new Set<() => string | null>();

export function startPwa() {
  if (
    controller ||
    import.meta.env.MODE !== 'pages' ||
    !import.meta.env.PROD ||
    !('serviceWorker' in navigator)
  )
    return;
  controller = new PwaController(navigator.serviceWorker, import.meta.env.BASE_URL, () =>
    location.reload(),
  );
  void controller.start();
  const check = () => {
    if (navigator.onLine && document.visibilityState === 'visible')
      void controller?.checkForUpdates();
  };
  window.addEventListener('online', check);
  document.addEventListener('visibilitychange', check);
}

const subscribe = (listener: () => void) => controller?.subscribe(listener) ?? (() => undefined);
const snapshot = () => controller?.snapshot() ?? inactive;

export function usePwa() {
  const state = useSyncExternalStore(subscribe, snapshot);
  return { ...state, supported: controller !== null };
}

export function usePwaReloadGuard(message: string | null) {
  useEffect(() => {
    const guard = () => message;
    guards.add(guard);
    return () => {
      guards.delete(guard);
    };
  }, [message]);
}

export async function updatePwa() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await controller?.update(async () => {
    // Let React publish blur validation and disable edits before checking guards.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    for (const guard of guards) {
      const message = guard();
      if (message) throw new Error(message);
    }
    await pendingEdits.flushAll();
    if (!canReloadIdentity())
      throw new Error(
        t`Your profile is still connecting or could not be saved. Try again shortly.`,
      );
  });
}
