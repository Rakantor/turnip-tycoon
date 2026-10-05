import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '../../src/shared/api';
import { ApiError } from '../../src/client/data/api';
import { TurnipDatabase } from '../../src/client/data/database';
import { SessionVault, IdentityChangedError } from '../../src/client/data/session-vault';
import { SessionController } from '../../src/client/data/session-controller';

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
function harness(vault: SessionVault, lock = serialLock()) {
  const network =
    vi.fn<(path: string, options?: { method?: string; body?: unknown }) => Promise<unknown>>();
  let credential: string | null = null;
  const broadcast = vi.fn();
  const currentResponse = vi.fn(() => true);
  const attach = vi.fn<(owner: string) => Promise<void>>().mockResolvedValue(undefined);
  const forget = vi.fn<(owner: string) => Promise<void>>().mockResolvedValue(undefined);
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
    forget,
    broadcast,
    deviceName: () => 'Test device',
  });
  return {
    controller,
    network,
    broadcast,
    currentResponse,
    attach,
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
    h.network.mockRejectedValue(unauthorized());
    await h.controller.retry();
    await h.controller.retry();
    expect(h.network.mock.calls.every(([, options]) => !options?.method)).toBe(true);
    expect(h.controller.state).toMatchObject({ status: 'error', session: session('one') });
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
