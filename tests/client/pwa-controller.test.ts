import { afterEach, describe, expect, it, vi } from 'vitest';
import { PwaController } from '../../src/client/pwa-controller';

class Worker extends EventTarget {
  postMessage = vi.fn();
  constructor(public state: ServiceWorkerState) {
    super();
  }
  transition(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

function harness(installed = true) {
  const active = installed ? new Worker('activated') : null;
  const registration = Object.assign(new EventTarget(), {
    active,
    waiting: null as Worker | null,
    installing: null as Worker | null,
    update: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
  const container = Object.assign(new EventTarget(), {
    controller: active,
    register: vi
      .fn<() => Promise<ServiceWorkerRegistration>>()
      .mockResolvedValue(registration as unknown as ServiceWorkerRegistration),
  });
  const reload = vi.fn();
  const controller = new PwaController(
    container as unknown as ServiceWorkerContainer,
    '/turnip-tycoon/',
    reload,
  );
  const activate = (worker: Worker) => {
    registration.waiting = null;
    registration.installing = null;
    registration.active = worker;
    container.controller = worker;
    worker.transition('activated');
    container.dispatchEvent(new Event('controllerchange'));
  };
  const discover = () => {
    const worker = new Worker('installing');
    registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    registration.waiting = worker;
    worker.transition('installed');
    return worker;
  };
  return { controller, container, registration, reload, activate, discover };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PWA update lifecycle', () => {
  it('prepares offline access on the first install without prompting or reloading', async () => {
    const h = harness(false);
    await h.controller.start();
    expect(h.container.register).toHaveBeenCalledExactlyOnceWith('/turnip-tycoon/sw.js', {
      scope: '/turnip-tycoon/',
      updateViaCache: 'none',
    });
    expect(h.controller.state).toMatchObject({ ready: false, updateAvailable: false });
    const worker = h.discover();
    expect(h.controller.state.updateAvailable).toBe(false);
    expect(worker.postMessage).not.toHaveBeenCalled();
    h.activate(worker);
    expect(h.controller.state).toMatchObject({ ready: true, updateAvailable: false });
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('leaves a waiting update alone until the user requests it and local saves complete', async () => {
    const h = harness();
    await h.controller.start();
    const worker = h.discover();
    expect(h.controller.state.updateAvailable).toBe(true);
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();

    const saved = deferred();
    const prepare = vi.fn<() => Promise<void>>().mockReturnValueOnce(saved.promise);
    prepare.mockResolvedValue(undefined);
    worker.postMessage.mockImplementation(() => h.activate(worker));
    const updating = h.controller.update(prepare);
    expect(h.controller.state.updating).toBe(true);
    expect(worker.postMessage).not.toHaveBeenCalled();
    saved.resolve();
    await updating;
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SKIP_WAITING' });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.controller.state.updating).toBe(false);
  });

  it('recognizes an update that was already waiting when the page opened', async () => {
    const h = harness();
    const worker = new Worker('installed');
    h.registration.waiting = worker;
    await h.controller.start();
    expect(h.controller.state).toMatchObject({ ready: true, updateAvailable: true });
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('blocks activation and reload when a local write or profile guard fails', async () => {
    const h = harness();
    await h.controller.start();
    const worker = h.discover();
    await h.controller.update(async () => {
      throw new Error('Could not save these prices on this device.');
    });
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.controller.state).toMatchObject({
      updating: false,
      updateAvailable: true,
      error: 'Could not save these prices on this device.',
    });
  });

  it('keeps another tab’s drafts open when an update activates elsewhere', async () => {
    const h = harness();
    await h.controller.start();
    const worker = h.discover();
    h.activate(worker);
    expect(h.controller.state).toMatchObject({ ready: true, updateAvailable: true });
    expect(h.reload).not.toHaveBeenCalled();
    expect(worker.postMessage).not.toHaveBeenCalled();

    // Once the user finishes, their explicit action saves locally and reloads
    // the already-activated version without trying to activate it a second time.
    const prepare = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await h.controller.update(prepare);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the page open if saving becomes unsafe while activation is underway', async () => {
    const h = harness();
    await h.controller.start();
    const worker = h.discover();
    worker.postMessage.mockImplementation(() => h.activate(worker));
    const prepare = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Your profile could not be saved.'));
    await h.controller.update(prepare);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.controller.state).toMatchObject({
      ready: true,
      updateAvailable: true,
      updating: false,
      error: 'Your profile could not be saved.',
    });
  });

  it('does not start competing activation attempts from repeated update clicks', async () => {
    const h = harness();
    await h.controller.start();
    const worker = h.discover();
    const saved = deferred();
    const prepare = vi.fn<() => Promise<void>>().mockReturnValue(saved.promise);
    worker.postMessage.mockImplementation(() => h.activate(worker));
    const first = h.controller.update(prepare);
    await h.controller.update(prepare);
    expect(prepare).toHaveBeenCalledTimes(1);
    saved.resolve();
    await first;
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('times out without reloading and never reloads automatically after a late activation', async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.controller.start();
    const worker = h.discover();
    const updating = h.controller.update(async () => undefined);
    await vi.advanceTimersByTimeAsync(15_000);
    await updating;
    expect(h.controller.state).toMatchObject({ updating: false, updateAvailable: true });
    expect(h.controller.state.error).toContain('not ready');
    expect(h.reload).not.toHaveBeenCalled();
    h.activate(worker);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('retries registration failures and throttles automatic update checks', async () => {
    const h = harness();
    h.container.register.mockRejectedValueOnce(new TypeError('Offline'));
    await h.controller.start();
    expect(h.controller.state).toMatchObject({ ready: false });
    expect(h.controller.state.error).toContain('Offline access');
    await h.controller.checkForUpdates();
    expect(h.container.register).toHaveBeenCalledTimes(2);
    expect(h.controller.state).toMatchObject({ ready: true, error: null });
    expect(h.registration.update).not.toHaveBeenCalled();
    await h.controller.checkForUpdates(true);
    expect(h.registration.update).toHaveBeenCalledTimes(1);
    await h.controller.checkForUpdates();
    expect(h.registration.update).toHaveBeenCalledTimes(1);
  });
});
