export interface PwaState {
  ready: boolean;
  updateAvailable: boolean;
  updating: boolean;
  error: string | null;
}

/** Activation never reloads another tab or interrupts its in-memory edits. */
export class PwaController {
  state: PwaState = { ready: false, updateAvailable: false, updating: false, error: null };
  private listeners = new Set<() => void>();
  private registration: ServiceWorkerRegistration | null = null;
  private registering: Promise<void> | null = null;
  private watching = new WeakSet<ServiceWorker>();
  private hadController: boolean;
  private lastCheck = 0;

  constructor(
    private container: ServiceWorkerContainer,
    private scope: string,
    private reload: () => void,
  ) {
    this.hadController = Boolean(container.controller);
    container.addEventListener('controllerchange', () => {
      this.publish({ ready: true, updateAvailable: this.hadController });
      this.hadController = true;
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;

  private publish(patch: Partial<PwaState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private watch(worker: ServiceWorker | null) {
    if (!worker || this.watching.has(worker)) return;
    this.watching.add(worker);
    const changed = () => {
      if (worker.state === 'installed' && this.registration?.active)
        this.publish({ updateAvailable: true, error: null });
      else if (worker.state === 'activated') this.publish({ ready: true, error: null });
    };
    worker.addEventListener('statechange', changed);
    changed();
  }

  start(): Promise<void> {
    if (this.registering) return this.registering;
    if (this.registration) return Promise.resolve();
    this.registering = this.container
      .register(`${this.scope}sw.js`, { scope: this.scope, updateViaCache: 'none' })
      .then((registration) => {
        this.registration = registration;
        this.lastCheck = Date.now();
        this.publish({
          ready: Boolean(registration.active),
          updateAvailable: Boolean(registration.waiting),
          error: null,
        });
        registration.addEventListener('updatefound', () => this.watch(registration.installing));
        this.watch(registration.installing);
        this.watch(registration.waiting);
      })
      .catch(() => {
        this.publish({ error: 'Offline access could not be prepared. Reconnect and try again.' });
      })
      .finally(() => {
        this.registering = null;
      });
    return this.registering;
  }

  async checkForUpdates(force = false): Promise<void> {
    await this.start();
    if (!this.registration || (!force && Date.now() - this.lastCheck < 60 * 60 * 1000)) return;
    this.lastCheck = Date.now();
    try {
      await this.registration.update();
      this.publish({ error: null });
    } catch {
      this.publish({ error: 'Could not check for updates. Reconnect and try again.' });
    }
  }

  async update(prepareReload: () => Promise<void>): Promise<void> {
    if (!this.state.updateAvailable || this.state.updating) return;
    this.publish({ updating: true, error: null });
    try {
      await prepareReload();
      const waiting = this.registration?.waiting;
      if (waiting) {
        await new Promise<void>((resolve, reject) => {
          const changed = () => {
            clearTimeout(timeout);
            this.container.removeEventListener('controllerchange', changed);
            resolve();
          };
          const timeout = setTimeout(() => {
            this.container.removeEventListener('controllerchange', changed);
            reject(new Error('The update is not ready yet. Please try again.'));
          }, 15_000);
          this.container.addEventListener('controllerchange', changed);
          try {
            waiting.postMessage({ type: 'SKIP_WAITING' });
          } catch (error) {
            clearTimeout(timeout);
            this.container.removeEventListener('controllerchange', changed);
            reject(error);
          }
        });
      }
      // Recheck identity and local writes if they changed during activation.
      await prepareReload();
      this.reload();
    } catch (error) {
      this.publish({ error: error instanceof Error ? error.message : 'Could not update the app.' });
    } finally {
      this.publish({ updating: false });
    }
  }
}
