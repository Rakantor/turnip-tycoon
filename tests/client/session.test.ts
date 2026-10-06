import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '../../src/shared/api';
import { ApiError } from '../../src/client/data/api';
import { TurnipDatabase } from '../../src/client/data/database';
import { SessionVault, IdentityChangedError } from '../../src/client/data/session-vault';
import { SessionController } from '../../src/client/data/session-controller';
import { WeekStore, weekKey } from '../../src/client/data/sync';
import { PendingEdits, withPendingEdits } from '../../src/client/data/pending-edits';
import { emptyOwnWeek } from '../../src/shared/week';

const tokenA = 'a'.repeat(64);
const tokenB = 'b'.repeat(64);
const session = (name: string): SessionResponse => ({
  player: { id: name, displayName: name, friendCode: name, islandName: null },
  deviceId: `device-${name}`,
  hasRecoveryCode: false,
});
const databases: TurnipDatabase[] = [];
function makeVault(bearer = true) {
  const db = new TurnipDatabase(`session-test-${crypto.randomUUID()}`);
  databases.push(db);
  return { db, vault: new SessionVault(db, bearer) };
}
function serialLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(run: () => Promise<T>): Promise<T> => {
    const result = tail.then(run, run);
    tail = result.catch(() => undefined);
    return result;
  };
}
/** Most tests start from an answered welcome dialog (a skip), as before deferral. */
function harness(vault: SessionVault, lock = serialLock(), answered = true) {
  const network =
    vi.fn<(path: string, options?: { method?: string; body?: unknown }) => Promise<unknown>>();
  let credential: string | null = null;
  const broadcast = vi.fn();
  const currentResponse = vi.fn(() => true);
  const attach = vi.fn<(owner: string) => Promise<void>>().mockResolvedValue(undefined);
  const forget = vi.fn<(owner: string) => Promise<void>>().mockResolvedValue(undefined);
  const forgetShared = vi.fn<(owner: string) => Promise<void>>().mockResolvedValue(undefined);
  const controller = new SessionController({
    vault,
    lock,
    request: async <T>(path: string, options?: { method?: string; body?: unknown }) =>
      (await network(path, options)) as T,
    credential: (value) => {
      credential = value;
    },
    currentResponse,
    invalidateResponses: () => undefined,
    publish: () => undefined,
    attach,
    forgetShared,
    forget,
    broadcast,
    deviceName: () => 'Test device',
  });
  if (answered) void controller.answerWelcome(null);
  return {
    controller,
    network,
    broadcast,
    currentResponse,
    attach,
    forgetShared,
    forget,
    credential: () => credential,
  };
}
function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', 'Not connected');

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe('device credential storage', () => {
  it('restores an encrypted credential after reopening IndexedDB without caching recovery secrets', async () => {
    const { db, vault } = makeVault();
    const access = { ...session('one'), sessionToken: tokenA, recoveryCode: 'do-not-cache' };
    await vault.save(access, tokenA, null, () => true);
    const row = (await db.meta.get('session'))!.value as {
      sealed: { key: CryptoKey; ciphertext: ArrayBuffer };
    };
    expect(row.sealed.key.extractable).toBe(false);
    expect(JSON.stringify(row)).not.toContain(tokenA);
    expect(JSON.stringify(row)).not.toContain('do-not-cache');
    expect(new TextDecoder().decode(row.sealed.ciphertext)).not.toContain(tokenA);
    db.close();
    await db.open();
    expect(await new SessionVault(db, true).read()).toMatchObject({
      session: session('one'),
      token: tokenA,
    });
  });

  it('atomically rejects stale identity writes and retains a matching token/profile', async () => {
    const { vault } = makeVault();
    const revision = await vault.save(session('one'), tokenA, null, () => true);
    await vault.save(session('two'), tokenB, revision, () => true);
    await expect(vault.save(session('one'), tokenA, revision, () => true)).rejects.toBeInstanceOf(
      IdentityChangedError,
    );
    expect(await vault.read()).toMatchObject({ session: session('two'), token: tokenB });
  });

  it('keeps a stable revision for unchanged metadata refreshes', async () => {
    const { vault } = makeVault();
    const revision = await vault.save(session('one'), tokenA, null, () => true);
    expect(await vault.save(session('one'), tokenA, revision, () => true)).toBe(revision);
  });
});

describe('welcome dialog', () => {
  it('waits for a name before creating a profile, then sends it along', async () => {
    const { vault } = makeVault();
    const h = harness(vault, serialLock(), false);
    h.network.mockRejectedValue(unauthorized());
    await h.controller.retry();
    expect(h.controller.state).toMatchObject({
      needsProfile: true,
      session: null,
      canReload: true,
    });
    expect(h.network.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);

    h.network
      .mockReset()
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValueOnce({ ...session('one'), sessionToken: tokenA });
    await h.controller.answerWelcome('  Rosalind ');
    expect(h.network).toHaveBeenLastCalledWith('/session', {
      method: 'POST',
      body: { deviceName: 'Test device', displayName: 'Rosalind' },
    });
    expect(h.controller.state).toMatchObject({ status: 'ready', needsProfile: false });
  });

  it('creates no profile when the visitor connects an existing one instead', async () => {
    const { vault } = makeVault();
    const h = harness(vault, serialLock(), false);
    h.network.mockRejectedValue(unauthorized());
    await h.controller.retry();
    expect(h.controller.state.needsProfile).toBe(true);
    await h.controller.adopt({ ...session('two'), sessionToken: tokenB });
    expect(h.controller.state).toMatchObject({
      status: 'ready',
      needsProfile: false,
      session: session('two'),
    });
    expect(h.network.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it('asks on a first open offline and creates the skipped profile once connected', async () => {
    const { vault } = makeVault();
    const h = harness(vault, serialLock(), false);
    h.network.mockRejectedValue(new TypeError('Failed to fetch'));
    await h.controller.retry();
    expect(h.controller.state).toMatchObject({ needsProfile: true, status: 'offline' });
    await h.controller.answerWelcome(null);
    expect(h.controller.state).toMatchObject({ needsProfile: false, status: 'offline' });

    h.network
      .mockReset()
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValueOnce({ ...session('one'), sessionToken: tokenA });
    await h.controller.retry();
    expect(h.network).toHaveBeenLastCalledWith('/session', {
      method: 'POST',
      body: { deviceName: 'Test device' },
    });
    expect(h.controller.state.status).toBe('ready');
  });
});

describe('silent profile connection', () => {
  it('creates once then reloads the existing device without creating another player', async () => {
    const { vault } = makeVault();
    const first = harness(vault);
    first.network
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValueOnce({ ...session('one'), sessionToken: tokenA });
    await first.controller.retry();
    expect(first.controller.state.status).toBe('ready');
    expect(first.credential()).toBe(tokenA);
    expect(first.network).toHaveBeenCalledTimes(2);

    const reloaded = harness(vault);
    reloaded.network.mockImplementation(async () => {
      expect(reloaded.credential()).toBe(tokenA);
      return session('one');
    });
    await reloaded.controller.retry();
    expect(reloaded.network).toHaveBeenCalledExactlyOnceWith('/session', undefined);
    expect(reloaded.controller.state.session).toEqual(session('one'));
    expect(reloaded.broadcast).not.toHaveBeenCalled();
  });

  it('keeps same-origin cookie bootstrapping compatible with its old public cache', async () => {
    const { db, vault } = makeVault(false);
    await db.meta.put({ key: 'session', value: session('one') });
    const h = harness(vault);
    h.network.mockResolvedValue(session('one'));
    await h.controller.retry();
    expect(h.controller.state).toMatchObject({ status: 'ready', session: session('one') });
    expect(h.credential()).toBeNull();
  });

  it('reopens the cached profile offline and confirms access before resuming its edits', async () => {
    const { db, vault } = makeVault();
    await vault.save(session('one'), tokenA, null, () => true);
    db.close();
    await db.open();
    const h = harness(new SessionVault(db, true));
    h.network.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await h.controller.retry();
    expect(h.controller.state).toMatchObject({
      session: session('one'),
      status: 'offline',
      canReload: true,
    });
    expect(h.credential()).toBe(tokenA);
    expect(h.attach).not.toHaveBeenCalled();

    const entered = defer<void>();
    const response = defer<SessionResponse>();
    h.network.mockImplementationOnce(() => {
      entered.resolve();
      return response.promise;
    });
    const reconnecting = h.controller.retry();
    await entered.promise;
    expect(h.controller.state).toMatchObject({ status: 'connecting', canReload: false });
    expect(h.attach).not.toHaveBeenCalled();
    response.resolve(session('one'));
    await reconnecting;
    expect(h.controller.state).toMatchObject({ status: 'ready', canReload: true });
    expect(h.attach).toHaveBeenCalledExactlyOnceWith('one');
    expect(h.network.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });

  it('keeps a never-connected offline calculator anonymous until the API returns', async () => {
    const { vault } = makeVault();
    const h = harness(vault);
    h.network.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await h.controller.retry();
    expect(h.controller.state).toMatchObject({ session: null, status: 'offline', canReload: true });
    expect(h.network).toHaveBeenCalledExactlyOnceWith('/session', undefined);
    expect(h.attach).not.toHaveBeenCalled();
    expect(await vault.read()).toMatchObject({ session: null, creating: false });

    h.network
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValueOnce({ ...session('one'), sessionToken: tokenA });
    await h.controller.retry();
    expect(h.controller.state).toMatchObject({ status: 'ready', session: session('one') });
    expect(h.attach).toHaveBeenCalledExactlyOnceWith('one');
    expect(h.network.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(
      1,
    );
  });

  it('does not create a replacement player for a revoked existing device', async () => {
    const { vault } = makeVault();
    await vault.save(session('one'), tokenA, null, () => true);
    const h = harness(vault);
    h.network.mockRejectedValue(new ApiError(401, 'DEVICE_REMOVED', 'Device removed'));
    await h.controller.retry();
    await h.controller.retry();
    expect(h.network.mock.calls.every(([, options]) => !options?.method)).toBe(true);
    expect(h.controller.state).toMatchObject({
      status: 'error',
      session: null,
      removal: { owner: 'one', phase: 'disconnected' },
    });
    expect(h.forget).toHaveBeenCalledWith('one');
  });

  it.each([
    { bearer: true, code: 'DEVICE_EXPIRED' },
    { bearer: false, code: 'DEVICE_EXPIRED' },
    { bearer: true, code: 'UNAUTHENTICATED' },
    { bearer: false, code: 'UNAUTHENTICATED' },
    { bearer: true, code: 'UNKNOWN' },
    { bearer: false, code: 'UNKNOWN' },
  ])('preserves local work for $code with bearer=$bearer', async ({ bearer, code }) => {
    const { db, vault } = makeVault(bearer);
    const savedToken = bearer ? tokenA : null;
    await vault.save(session('one'), savedToken, null, () => true);
    const store = new WeekStore(db, {
      get: async () => emptyOwnWeek('one', '2026-10-04'),
      put: vi.fn(),
      isActive: () => false,
    });
    await store.edit('one', '2026-10-04', { purchasePrice: 100 });
    await store.edit('unassigned', '2026-10-04', { purchasePrice: 110 });
    const before = await db.weeks.toArray();
    const h = harness(vault);
    h.network.mockRejectedValue(new ApiError(401, code, 'Reconnect'));
    await h.controller.retry();
    await h.controller.retry();
    expect(h.controller.state).toMatchObject({
      status: 'error',
      session: session('one'),
      removal: null,
      needsProfile: false,
    });
    expect(h.controller.state.error).toContain('unsent edits are still on this device');
    expect(await db.weeks.toArray()).toEqual(before);
    expect(await vault.read()).toMatchObject({ session: session('one'), token: savedToken });
    expect(h.forget).not.toHaveBeenCalled();
    expect(h.forgetShared).toHaveBeenCalledWith('one');
    expect(h.attach).not.toHaveBeenCalled();
    expect(h.network.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });

  it('uploads retained edits after reconnecting the same expired profile', async () => {
    const { db, vault } = makeVault();
    await vault.save(session('one'), tokenA, null, () => true);
    const h = harness(vault);
    const put = vi.fn(async () => ({ revision: 1 }));
    const store = new WeekStore(db, {
      get: async () => emptyOwnWeek('one', '2026-10-04'),
      put,
      isActive: () => h.controller.state.status === 'ready',
    });
    await store.edit('one', '2026-10-04', { purchasePrice: 100 });
    h.network.mockRejectedValue(new ApiError(401, 'DEVICE_EXPIRED', 'Expired'));
    await h.controller.retry();
    expect(put).not.toHaveBeenCalled();
    h.attach.mockImplementation((owner) => store.sync(owner, '2026-10-04'));
    await h.controller.adopt({ ...session('one'), deviceId: 'reconnected', sessionToken: tokenB });
    expect(h.controller.state.status).toBe('ready');
    expect(put).toHaveBeenCalledWith('2026-10-04', expect.objectContaining({ purchasePrice: 100 }));
    expect((await db.weeks.toArray())[0].dirty).toBe(false);
  });

  it('still clears an expired profile if a later check confirms device removal', async () => {
    const { db, vault } = makeVault();
    await vault.save(session('one'), tokenA, null, () => true);
    const h = harness(vault);
    h.network.mockRejectedValueOnce(new ApiError(401, 'DEVICE_EXPIRED', 'Expired'));
    await h.controller.retry();
    expect(h.credential()).toBe(tokenA);
    expect(h.controller.state.removal).toBeNull();
    h.network.mockRejectedValueOnce(new ApiError(401, 'DEVICE_REMOVED', 'Removed'));
    await h.controller.retry();
    expect(h.controller.state.removal?.phase).toBe('disconnected');
    expect(h.credential()).toBeNull();
    expect(await db.weeks.toArray()).toEqual([]);
    expect(h.forget).toHaveBeenCalledWith('one');
  });

  it('keeps friends’ saved prices when the device is only offline', async () => {
    const { vault } = makeVault();
    await vault.save(session('one'), tokenA, null, () => true);
    const h = harness(vault);
    h.network.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await h.controller.retry();
    expect(h.controller.state.status).toBe('offline');
    expect(h.forget).not.toHaveBeenCalled();
  });

  it('does not create accounts when storage is unavailable', async () => {
    const { vault } = makeVault();
    vi.spyOn(vault, 'read').mockRejectedValue(new DOMException('Denied', 'SecurityError'));
    const h = harness(vault);
    await h.controller.retry();
    await h.controller.retry();
    expect(h.network).not.toHaveBeenCalled();
    expect(h.controller.state.status).toBe('error');
  });

  it('does not repeat an interrupted account creation after a lost response or reload', async () => {
    const { vault } = makeVault();
    const h = harness(vault);
    h.network
      .mockRejectedValueOnce(unauthorized())
      .mockRejectedValueOnce(new TypeError('Connection lost'));
    await h.controller.retry();
    await h.controller.retry();
    expect(h.network).toHaveBeenCalledTimes(2);
    const reloaded = harness(vault);
    await reloaded.controller.retry();
    expect(reloaded.network).not.toHaveBeenCalled();
    expect(reloaded.controller.state.error).toContain('interrupted');
    expect(reloaded.controller.state.creationInterrupted).toBe(true);
    reloaded.network
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValueOnce({ ...session('two'), sessionToken: tokenB });
    await reloaded.controller.restartInterruptedCreation();
    expect(reloaded.controller.state).toMatchObject({
      status: 'ready',
      creationInterrupted: false,
      session: session('two'),
    });
    expect(reloaded.network).toHaveBeenCalledTimes(2);
  });

  it('cannot restart creation over a profile another tab already connected', async () => {
    const { vault } = makeVault();
    const pending = await vault.beginCreation(null, () => true);
    const h = harness(vault);
    await h.controller.retry();
    expect(h.controller.state.creationInterrupted).toBe(true);
    await vault.save(session('two'), tokenB, pending, () => true);
    await h.controller.restartInterruptedCreation();
    expect(h.network).not.toHaveBeenCalled();
    expect(await vault.read()).toMatchObject({ token: tokenB, session: session('two') });
  });

  it('retains a newly issued token in memory when durable storage fails and retries with that token', async () => {
    const { vault } = makeVault();
    const h = harness(vault);
    const save = vi
      .spyOn(vault, 'save')
      .mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'));
    h.network
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValueOnce({ ...session('one'), sessionToken: tokenA });
    await h.controller.retry();
    expect(h.controller.state).toMatchObject({ status: 'ready', session: session('one') });
    expect(h.controller.state.canReload).toBe(false);
    expect(h.controller.state.error).toContain('could not save');
    expect(h.credential()).toBe(tokenA);
    h.network.mockResolvedValue(session('one'));
    await h.controller.retry();
    expect(save).toHaveBeenCalledTimes(2);
    expect(h.network.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(
      1,
    );
    expect(await vault.read()).toMatchObject({ token: tokenA, session: session('one') });
    expect(h.controller.state.error).toBeNull();
    expect(h.controller.state.canReload).toBe(true);
  });

  it('cannot let a delayed bootstrap overwrite explicitly recovered access', async () => {
    const { vault } = makeVault();
    const h = harness(vault);
    const entered = defer<void>();
    const response = defer<unknown>();
    h.network.mockRejectedValueOnce(unauthorized()).mockImplementationOnce(() => {
      entered.resolve();
      return response.promise;
    });
    const bootstrap = h.controller.retry();
    await entered.promise;
    h.controller.beginIdentityChange();
    const adopting = h.controller.adopt({ ...session('two'), sessionToken: tokenB });
    response.resolve({ ...session('one'), sessionToken: tokenA });
    await Promise.all([bootstrap, adopting]);
    expect(h.controller.state.session).toEqual(session('two'));
    expect(h.credential()).toBe(tokenB);
    expect(await vault.read()).toMatchObject({ token: tokenB, session: session('two') });
  });

  it('preserves recovered in-memory access when another tab only updates the old profile metadata', async () => {
    const { vault } = makeVault();
    await vault.save(session('one'), tokenA, null, () => true);
    const h = harness(vault);
    h.network.mockResolvedValue(session('one'));
    await h.controller.retry();
    vi.spyOn(vault, 'save').mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'));
    await h.controller.adopt({ ...session('two'), sessionToken: tokenB });
    expect(h.controller.state.canReload).toBe(false);
    const previous = await vault.read();
    const changed = session('one');
    changed.player.displayName = 'Renamed in another tab';
    await vault.save(changed, tokenA, previous.revision, () => true);
    h.network.mockImplementation(async () => {
      expect(h.credential()).toBe(tokenB);
      return session('two');
    });
    await h.controller.retry();
    expect(h.controller.state).toMatchObject({
      status: 'ready',
      error: null,
      session: session('two'),
    });
    expect(await vault.read()).toMatchObject({ token: tokenB, session: session('two') });
    expect(h.controller.state.canReload).toBe(true);
  });

  it('lets newer recovery supersede a bootstrap disk commit that finished after cancellation', async () => {
    const { vault } = makeVault();
    const h = harness(vault);
    h.network
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValueOnce({ ...session('one'), sessionToken: tokenA });
    const committed = defer<void>();
    const release = defer<void>();
    const originalSave = vault.save.bind(vault);
    vi.spyOn(vault, 'save').mockImplementationOnce(async (...args) => {
      const revision = await originalSave(...args);
      committed.resolve();
      await release.promise;
      return revision;
    });
    const bootstrap = h.controller.retry();
    await committed.promise;
    h.controller.beginIdentityChange();
    const adopting = h.controller.adopt({ ...session('two'), sessionToken: tokenB });
    release.resolve();
    await Promise.all([bootstrap, adopting]);
    expect(h.controller.state.session).toEqual(session('two'));
    expect(await vault.read()).toMatchObject({ token: tokenB, session: session('two') });
  });

  it('rejects delayed recovery results and old profile updates after an identity switch', async () => {
    const { vault } = makeVault();
    const h = harness(vault);
    await h.controller.adopt({ ...session('two'), sessionToken: tokenB });
    h.currentResponse.mockReturnValueOnce(false);
    await expect(
      h.controller.adopt({ ...session('one'), sessionToken: tokenA }),
    ).rejects.toBeInstanceOf(IdentityChangedError);
    await expect(h.controller.adopt(session('one'))).rejects.toBeInstanceOf(IdentityChangedError);
    expect(await vault.read()).toMatchObject({ token: tokenB, session: session('two') });
  });

  it('reloads the other tab’s committed profile and never replaces it with a stale access response', async () => {
    const { vault } = makeVault();
    await vault.save(session('one'), tokenA, null, () => true);
    const lock = serialLock();
    const first = harness(vault, lock);
    const second = harness(vault, lock);
    first.network.mockResolvedValue(session('one'));
    second.network.mockResolvedValue(session('one'));
    await Promise.all([first.controller.retry(), second.controller.retry()]);
    // Reading metadata in another tab doesn't prevent an intentional switch.
    await first.controller.adopt({ ...session('two'), sessionToken: tokenB });
    await expect(
      second.controller.adopt({ ...session('one'), sessionToken: tokenA }),
    ).rejects.toBeInstanceOf(IdentityChangedError);
    second.network.mockResolvedValue(session('two'));
    await second.controller.retry();
    expect(second.controller.state.session).toEqual(session('two'));
    expect(second.credential()).toBe(tokenB);
    expect(await vault.read()).toMatchObject({ token: tokenB, session: session('two') });
  });
});

describe('profile deletion lifecycle', () => {
  it('keeps cleanup history through reset and reconnection without clearing a new tab’s drafts', async () => {
    const { vault } = makeVault();
    await vault.save(session('one'), tokenA, null, () => true);
    await vault.finishRemoval('one', 'disconnected');
    const removed = await vault.read();
    expect(removed.cleanups?.one).toEqual(expect.any(String));
    await vault.resetRemoval(removed.revision);
    expect((await vault.read()).cleanups).toEqual(removed.cleanups);
    await vault.save(session('one'), tokenB, (await vault.read()).revision, () => true);
    expect((await vault.read()).cleanups).toEqual(removed.cleanups);
    const h = harness(vault);
    h.network.mockResolvedValue(session('one'));
    await h.controller.retry();
    expect(h.forget).not.toHaveBeenCalled();
    await vault.finishRemoval('one', 'disconnected');
    expect((await vault.read()).cleanups?.one).not.toBe(removed.cleanups?.one);
    await vault.resetRemoval((await vault.read()).revision);
    await vault.save(session('one'), tokenB, (await vault.read()).revision, () => true);
    await h.controller.retry();
    expect(h.forget).toHaveBeenCalledWith('one');
  });

  it.each([false, true])(
    'forgets retained patches and snapshots after cleanup (suspended=%s)',
    async (suspended) => {
      const { db, vault } = makeVault();
      await vault.save(session('one'), tokenA, null, () => true);
      const store = new WeekStore(db, {
        get: async () => ({ ...emptyOwnWeek('one', '2026-10-04'), purchasePrice: 110 }),
        put: vi.fn(),
        isActive: () => true,
      });
      const pending = new PendingEdits(async (owner, week, patch) => {
        await store.edit(owner, week, patch);
        return db.weeks.get(weekKey(owner, week));
      });
      await pending.enqueue('one', '2026-10-04', { purchasePrice: 100 });
      await pending.enqueue('one', '2026-10-04', { purchasePrice: 101 });
      vi.spyOn(store, 'edit').mockRejectedValueOnce(new Error('Storage full'));
      await expect(pending.enqueue('one', '2026-10-04', { purchasePrice: 102 })).rejects.toThrow();
      const h = harness(vault);
      h.forget.mockImplementation(async (owner) => {
        pending.forget(owner);
        pending.forget('unassigned');
      });
      h.attach.mockImplementation(async (owner) => {
        pending.allow(owner);
      });
      h.network.mockResolvedValue(session('one'));
      await h.controller.retry();
      await vault.finishRemoval('one', 'disconnected');
      if (!suspended) {
        await h.controller.retry();
        expect(pending.snapshot('one', '2026-10-04').durable).toBeUndefined();
      }
      await vault.resetRemoval((await vault.read()).revision);
      await vault.save(session('one'), tokenB, (await vault.read()).revision, () => true);
      await h.controller.retry();
      expect(pending.snapshot('one', '2026-10-04')).toMatchObject({ edits: [] });
      expect(pending.snapshot('one', '2026-10-04').durable).toBeUndefined();
      await pending.flushAll();
      await store.sync('one', '2026-10-04');
      const row = (await db.weeks.get(weekKey('one', '2026-10-04')))!;
      expect(
        withPendingEdits(row.data, row.version, pending.snapshot('one', row.weekStart))
          .purchasePrice,
      ).toBe(110);
    },
  );

  it('drains a refresh received while removal waits for another tab to switch identity', async () => {
    const { vault } = makeVault();
    await vault.save(session('one'), tokenA, null, () => true);
    const lock = serialLock();
    const h = harness(vault, lock);
    h.network.mockResolvedValue(session('one'));
    await h.controller.retry();
    const entered = defer<void>(),
      release = defer<void>();
    const switching = lock(async () => {
      await vault.save(session('two'), tokenB, (await vault.read()).revision, () => true);
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const removal = h.controller.removeProfile('one');
    const rejected = expect(removal).rejects.toBeInstanceOf(IdentityChangedError);
    h.controller.refresh();
    h.network.mockResolvedValue(session('two'));
    release.resolve();
    await switching;
    await rejected;
    await vi.waitFor(() =>
      expect(h.controller.state).toMatchObject({
        status: 'ready',
        session: session('two'),
        removal: null,
      }),
    );
  });

  it('restores connectivity automatically if saving deletion intent fails', async () => {
    const { vault } = makeVault();
    await vault.save(session('one'), tokenA, null, () => true);
    const h = harness(vault);
    h.network.mockResolvedValue(session('one'));
    await h.controller.retry();
    vi.spyOn(vault, 'beginRemoval').mockRejectedValueOnce(new Error('Storage failed'));
    await expect(h.controller.removeProfile('one')).rejects.toThrow('Storage failed');
    await vi.waitFor(() =>
      expect(h.controller.state).toMatchObject({
        status: 'ready',
        session: session('one'),
        removal: null,
        error: 'Storage failed',
      }),
    );
  });

  it.each([
    [400, 'INVALID_INPUT'],
    [403, 'INVALID_ORIGIN'],
    [409, 'PLAYER_CHANGED'],
    [401, 'UNAUTHENTICATED'],
    [401, 'DEVICE_EXPIRED'],
    [401, 'DEVICE_REMOVED'],
  ] as const)(
    'resumes the profile after a definite %i %s rejection without erasing edits',
    async (status, code) => {
      const { vault, db } = makeVault();
      await vault.save(session('one'), tokenA, null, () => true);
      const store = new WeekStore(db, { get: vi.fn(), put: vi.fn(), isActive: () => false });
      await store.edit('one', '2026-10-04', { purchasePrice: 100 });
      const h = harness(vault);
      h.network.mockResolvedValue(session('one'));
      await h.controller.retry();
      h.network.mockRejectedValueOnce(new ApiError(status, code, 'Rejected before deletion'));
      await expect(h.controller.removeProfile('one')).rejects.toThrow('Rejected before deletion');
      await vi.waitFor(() => expect(h.controller.state.status).toBe('ready'));
      expect(h.controller.state.removal).toBeNull();
      expect(await db.meta.get('blocked-profile:one')).toBeUndefined();
      expect((await db.weeks.toArray())[0]).toMatchObject({
        dirty: true,
        data: { purchasePrice: 100 },
      });
      expect(h.forget).not.toHaveBeenCalled();
    },
  );

  it.each([
    new TypeError('Connection lost'),
    new ApiError(500, 'INTERNAL_ERROR', 'Unknown outcome'),
  ])(
    'keeps an earlier ambiguous deletion unresolved even after a definite rejection',
    async (error) => {
      const { vault } = makeVault();
      await vault.save(session('one'), tokenA, null, () => true);
      const h = harness(vault);
      h.network.mockResolvedValue(session('one'));
      await h.controller.retry();
      h.network.mockRejectedValueOnce(error);
      await expect(h.controller.removeProfile('one')).rejects.toThrow();
      const reloaded = harness(vault);
      await reloaded.controller.retry();
      reloaded.network.mockRejectedValueOnce(new ApiError(409, 'PLAYER_CHANGED', 'Changed'));
      await expect(reloaded.controller.removeProfile('one')).rejects.toThrow();
      expect((await vault.read()).removal?.phase).toBe('pending');
      expect(reloaded.controller.state.removal?.phase).toBe('pending');
    },
  );

  it('keeps an unresolved deletion’s error after a refresh requested during the attempt', async () => {
    const { vault } = makeVault();
    await vault.save(session('one'), tokenA, null, () => true);
    const h = harness(vault);
    h.network.mockResolvedValue(session('one'));
    await h.controller.retry();
    let fail!: (error: unknown) => void;
    h.network.mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    const removal = h.controller.removeProfile('one');
    const rejected = expect(removal).rejects.toThrow('Unknown outcome');
    await vi.waitFor(() => expect(h.network).toHaveBeenCalledWith('/profile', expect.anything()));
    h.controller.refresh();
    fail(new ApiError(500, 'INTERNAL_ERROR', 'Unknown outcome'));
    await rejected;
    await h.controller.retry();
    expect(h.controller.state).toMatchObject({
      status: 'error',
      error: 'Unknown outcome',
      removal: { phase: 'pending' },
    });
  });

  it('connects even if forgetting an earlier cleanup’s cached snapshots fails', async () => {
    const { vault } = makeVault();
    await vault.save(session('one'), tokenA, null, () => true);
    const h = harness(vault);
    h.network.mockResolvedValue(session('one'));
    await h.controller.retry();
    await vault.finishRemoval('one', 'disconnected');
    await vault.resetRemoval((await vault.read()).revision);
    await vault.save(session('one'), tokenB, (await vault.read()).revision, () => true);
    h.forget.mockRejectedValue(new Error('Storage failed'));
    await h.controller.retry();
    expect(h.controller.state).toMatchObject({ status: 'ready', session: session('one') });
    await h.controller.retry();
    expect(h.forget).toHaveBeenCalledTimes(1);
  });

  it('forgets a completed removal’s copies once across repeated checks', async () => {
    const { vault } = makeVault();
    await vault.save(session('one'), tokenA, null, () => true);
    const h = harness(vault);
    h.network.mockResolvedValueOnce(session('one'));
    await h.controller.retry();
    h.network.mockResolvedValueOnce({ deletedPlayerId: 'one' });
    await h.controller.removeProfile('one');
    await h.controller.retry();
    await h.controller.retry();
    expect(h.forget).toHaveBeenCalledTimes(1);
    const reloaded = harness(vault);
    await reloaded.controller.retry();
    await reloaded.controller.retry();
    expect(reloaded.forget).toHaveBeenCalledTimes(1);
  });

  it('cannot cancel an attempt after a different tab replaces its pending revision', async () => {
    const { vault } = makeVault();
    const revision = await vault.save(session('one'), tokenA, null, () => true);
    const first = await vault.beginRemoval('one', revision);
    const second = await vault.beginRemoval('one', first);
    await expect(vault.cancelRemoval('one', first)).rejects.toBeInstanceOf(IdentityChangedError);
    expect((await vault.read()).revision).toBe(second);
    expect((await vault.read()).removal?.phase).toBe('pending');
  });

  it('keeps cookie logout unresolved until the server acknowledges it', async () => {
    const { vault, db } = makeVault(false);
    await vault.save(session('one'), null, null, () => true);
    const store = new WeekStore(db, { get: vi.fn(), put: vi.fn(), isActive: () => false });
    await store.edit('one', '2026-10-04', { purchasePrice: 100 });
    const h = harness(vault);
    h.network.mockResolvedValueOnce(session('one'));
    await h.controller.retry();
    h.network.mockRejectedValue(new TypeError('Offline'));
    await expect(h.controller.removeProfile('one')).rejects.toThrow();
    await expect(h.controller.clearRemovalAccess()).rejects.toThrow();
    expect(h.controller.state.removal?.phase).toBe('pending');
    expect(await db.weeks.count()).toBe(1);
    expect(h.forget).not.toHaveBeenCalled();
    await expect(h.controller.startAfterRemoval()).rejects.toBeInstanceOf(IdentityChangedError);
    await h.controller.retry();
    h.network.mockResolvedValueOnce({ ok: true });
    await h.controller.clearRemovalAccess();
    expect(h.controller.state.removal?.phase).toBe('disconnected');
    expect(await db.weeks.count()).toBe(0);
    h.network.mockRejectedValue(unauthorized());
    await h.controller.startAfterRemoval();
    expect(h.controller.state).toMatchObject({ session: null, needsProfile: true });
  });

  it('can delete a legacy cookie profile even if the normal upgrade save failed', async () => {
    const { vault, db } = makeVault(false);
    await db.meta.put({ key: 'session', value: session('one') });
    vi.spyOn(vault, 'save').mockRejectedValueOnce(new Error('Storage temporarily unavailable'));
    const h = harness(vault);
    h.network.mockResolvedValueOnce(session('one'));
    await h.controller.retry();
    expect((await vault.read()).revision).toBeNull();
    h.network.mockResolvedValueOnce({ deletedPlayerId: 'one' });
    await h.controller.removeProfile('one');
    expect((await vault.read()).removal?.phase).toBe('deleted');
  });

  it('clears access after confirmation and waits for an explicit return to welcome', async () => {
    const { vault } = makeVault();
    await vault.save(session('one'), tokenA, null, () => true);
    const h = harness(vault);
    h.network.mockResolvedValueOnce(session('one'));
    await h.controller.retry();
    h.network.mockResolvedValueOnce({ deletedPlayerId: 'one' });
    await h.controller.removeProfile('one');
    expect(h.controller.state).toMatchObject({
      session: null,
      needsProfile: false,
      removal: { phase: 'deleted' },
    });
    expect(h.credential()).toBeNull();
    expect(await vault.read()).toMatchObject({
      session: null,
      token: null,
      removal: { phase: 'deleted' },
    });
    h.network.mockClear();
    await h.controller.retry();
    expect(h.network).not.toHaveBeenCalled();
    h.network.mockRejectedValue(unauthorized());
    await h.controller.startAfterRemoval();
    expect(h.controller.state).toMatchObject({ needsProfile: true, removal: null });
    expect(h.network.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true);
  });

  it('retains an interrupted deletion across reloads without resuming uploads or creating profiles', async () => {
    const { vault } = makeVault();
    await vault.save(session('one'), tokenA, null, () => true);
    const h = harness(vault);
    h.network.mockResolvedValueOnce(session('one'));
    await h.controller.retry();
    h.network.mockRejectedValueOnce(new TypeError('Connection lost'));
    await expect(h.controller.removeProfile('one')).rejects.toThrow('Connection lost');
    expect(await vault.read()).toMatchObject({ token: tokenA, removal: { phase: 'pending' } });
    const reloaded = harness(vault);
    await reloaded.controller.retry();
    expect(reloaded.network).not.toHaveBeenCalled();
    expect(reloaded.attach).not.toHaveBeenCalled();
    expect(reloaded.controller.state.needsProfile).toBe(false);
    reloaded.network.mockResolvedValueOnce({ deletedPlayerId: 'one' });
    await reloaded.controller.removeProfile('one');
    expect(reloaded.network).toHaveBeenCalledExactlyOnceWith('/profile', {
      method: 'DELETE',
      body: { playerId: 'one', confirm: 'delete' },
    });
    expect(reloaded.controller.state.removal?.phase).toBe('deleted');
  });

  it('does not claim deletion when a retry only proves that access is gone', async () => {
    const { vault } = makeVault();
    const revision = await vault.save(session('one'), tokenA, null, () => true);
    await vault.beginRemoval('one', revision);
    const h = harness(vault);
    await h.controller.retry();
    h.network.mockRejectedValue(unauthorized());
    await expect(h.controller.removeProfile('one')).rejects.toThrow();
    expect(h.controller.state.removal?.phase).toBe('pending');
    await h.controller.clearRemovalAccess();
    expect(h.controller.state.removal?.phase).toBe('disconnected');
    expect(h.credential()).toBeNull();
  });

  it('cannot delete the profile another tab switched to or send a request without durable intent', async () => {
    const { vault } = makeVault();
    await vault.save(session('one'), tokenA, null, () => true);
    const h = harness(vault);
    h.network.mockResolvedValueOnce(session('one'));
    await h.controller.retry();
    const stored = await vault.read();
    await vault.save(session('two'), tokenB, stored.revision, () => true);
    h.network.mockClear();
    await expect(h.controller.removeProfile('one')).rejects.toBeInstanceOf(IdentityChangedError);
    expect(h.network).not.toHaveBeenCalled();
    expect(await vault.read()).toMatchObject({ session: session('two'), token: tokenB });
  });

  it('cannot restore a delayed identity response after a deletion intent is saved', async () => {
    const { vault } = makeVault();
    const revision = await vault.save(session('one'), tokenA, null, () => true);
    await vault.beginRemoval('one', revision);
    await expect(vault.save(session('one'), tokenA, revision, () => true)).rejects.toBeInstanceOf(
      IdentityChangedError,
    );
    expect(await vault.read()).toMatchObject({ removal: { phase: 'pending' } });
  });
});
