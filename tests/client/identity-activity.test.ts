import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TurnipDatabase } from '../../src/client/data/database';
import { SessionVault } from '../../src/client/data/session-vault';
import { apiOrigin } from '../../src/client/data/api-config';

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: (effect: () => void) => effect(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));

let database: TurnipDatabase;
beforeEach(async () => {
  vi.resetModules();
  database = (await import('../../src/client/data/database')).database;
  await database.open();
});

afterEach(async () => {
  await database.delete();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('rechecks an active tab after a minute without keeping hidden tabs alive', async () => {
  const { useIdentity } = await import('../../src/client/data/identity');
  const session = {
    player: { id: 'one', displayName: 'Maple', friendCode: 'MAPL-E123-4567', islandName: null },
    deviceId: 'device',
    hasRecoveryCode: false,
  };
  await new SessionVault(database, Boolean(apiOrigin)).save(
    session,
    apiOrigin ? 'a'.repeat(64) : null,
    null,
    () => true,
  );
  const windowEvents = new EventTarget();
  const documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('navigator', { userAgent: 'Test', onLine: true });
  vi.stubGlobal('document', documentEvents);
  vi.stubGlobal('addEventListener', windowEvents.addEventListener.bind(windowEvents));
  vi.stubGlobal('BroadcastChannel', undefined);
  const fetch = vi.fn(async () => Response.json(session));
  vi.stubGlobal('fetch', fetch);
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  useIdentity();
  await vi.waitFor(() => expect(useIdentity().status).toBe('ready'));
  expect(fetch).toHaveBeenCalledTimes(1);

  now += 61_000;
  windowEvents.dispatchEvent(new Event('focus'));
  // A background check confirms access without interrupting the ready profile.
  expect(useIdentity().status).toBe('ready');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  documentEvents.dispatchEvent(new Event('visibilitychange'));
  expect(fetch).toHaveBeenCalledTimes(2);

  now += 61_000;
  documentEvents.visibilityState = 'hidden';
  windowEvents.dispatchEvent(new Event('focus'));
  documentEvents.dispatchEvent(new Event('visibilitychange'));
  expect(fetch).toHaveBeenCalledTimes(2);

  documentEvents.visibilityState = 'visible';
  documentEvents.dispatchEvent(new Event('visibilitychange'));
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

  // A dropped connection is reported by the requests that need it, not by this check.
  now += 61_000;
  fetch.mockRejectedValueOnce(new TypeError('Offline'));
  windowEvents.dispatchEvent(new Event('focus'));
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(useIdentity()).toMatchObject({ status: 'ready', error: null });
});

it('lets an unstarted legal page reload for an app update', async () => {
  const { canReloadIdentity } = await import('../../src/client/data/identity');
  expect(canReloadIdentity()).toBe(true);
});

it('accepts edits for a profile reconnected elsewhere while this tab resumes offline', async () => {
  const { useIdentity } = await import('../../src/client/data/identity');
  const { pendingEdits } = await import('../../src/client/data/pending-edits');
  const session = {
    player: { id: 'one', displayName: 'Maple', friendCode: 'MAPL-E123-4567', islandName: null },
    deviceId: 'device',
    hasRecoveryCode: false,
  };
  const token = apiOrigin ? 'a'.repeat(64) : null;
  const vault = new SessionVault(database, Boolean(apiOrigin));
  await vault.save(session, token, null, () => true);
  const windowEvents = new EventTarget();
  vi.stubGlobal('navigator', { userAgent: 'Test', onLine: true });
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('addEventListener', windowEvents.addEventListener.bind(windowEvents));
  vi.stubGlobal('BroadcastChannel', undefined);
  const fetch = vi.fn(async () => Response.json(session));
  vi.stubGlobal('fetch', fetch);
  useIdentity();
  await vi.waitFor(() => expect(useIdentity().status).toBe('ready'));
  // Another tab disconnected and reconnected this profile while this tab was suspended.
  await vault.finishRemoval('one', 'disconnected');
  await vault.resetRemoval((await vault.read()).revision);
  await vault.save(session, token, (await vault.read()).revision, () => true);
  fetch.mockRejectedValue(new TypeError('Offline'));
  windowEvents.dispatchEvent(new Event('turnip-session-stale'));
  await vi.waitFor(() => expect(useIdentity().status).toBe('offline'));
  await pendingEdits.enqueue('one', '2026-10-04', { purchasePrice: 100 });
  expect((await database.weeks.get('one|2026-10-04'))?.data.purchasePrice).toBe(100);
});

it.each([false, true])(
  'allows anonymous edits after a remote reset (stale button=%s)',
  async (staleButton) => {
    const { useIdentity } = await import('../../src/client/data/identity');
    const { pendingEdits } = await import('../../src/client/data/pending-edits');
    const session = {
      player: { id: 'one', displayName: 'Maple', friendCode: 'MAPL-E123-4567', islandName: null },
      deviceId: 'device',
      hasRecoveryCode: false,
    };
    const vault = new SessionVault(database, Boolean(apiOrigin));
    await vault.save(session, apiOrigin ? 'a'.repeat(64) : null, null, () => true);
    const windowEvents = new EventTarget();
    vi.stubGlobal('navigator', { userAgent: 'Test', onLine: true });
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    vi.stubGlobal('addEventListener', windowEvents.addEventListener.bind(windowEvents));
    vi.stubGlobal('BroadcastChannel', undefined);
    const fetch = vi.fn(async () => Response.json(session));
    vi.stubGlobal('fetch', fetch);
    useIdentity();
    await vi.waitFor(() => expect(useIdentity().status).toBe('ready'));
    fetch.mockResolvedValueOnce(Response.json({ deletedPlayerId: 'one' }));
    await useIdentity().removeProfile('one');
    expect(useIdentity().removal?.phase).toBe('deleted');
    // The other tab returned to welcome; this tab has not observed its new revision yet.
    await vault.resetRemoval((await vault.read()).revision);
    fetch.mockRejectedValue(new TypeError('Offline'));
    if (staleButton) await expect(useIdentity().startAfterRemoval()).rejects.toThrow('another tab');
    else windowEvents.dispatchEvent(new Event('turnip-session-stale'));
    await vi.waitFor(() =>
      expect(useIdentity()).toMatchObject({ needsProfile: true, removal: null }),
    );
    await useIdentity().answerWelcome(null);
    await pendingEdits.enqueue('unassigned', '2026-10-04', { purchasePrice: 100 });
    expect((await database.weeks.get('unassigned|2026-10-04'))?.data.purchasePrice).toBe(100);
  },
);
