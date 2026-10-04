import type { SessionResponse } from '../../shared/api';
import { ApiError } from './api';
import {
  IdentityChangedError,
  publicSession,
  type SessionVault,
  type StoredSession,
} from './session-vault';

type CredentialResponse = SessionResponse & { sessionToken?: string };
export type IdentityState = {
  session: SessionResponse | null;
  status: 'connecting' | 'ready' | 'offline' | 'error';
  error: string | null;
  creationInterrupted: boolean;
  /** Reloading must not discard profile access held only in this tab. */
  canReload: boolean;
};
type Dependencies = {
  vault: SessionVault;
  request: <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;
  lock: <T>(run: () => Promise<T>) => Promise<T>;
  credential: (token: string | null) => void;
  currentResponse: (value: object) => boolean;
  invalidateResponses: () => void;
  publish: (state: IdentityState) => void;
  attach: (owner: string) => Promise<void>;
  broadcast: () => void;
  deviceName: () => string;
};

const STORAGE_WARNING =
  'This browser could not save your profile access. Keep this tab open and create a recovery code in Settings.';
const EMPTY: StoredSession = { revision: null, session: null, token: null, creating: false };
function sameIdentity(left: StoredSession, right: StoredSession): boolean {
  return (
    left.token === right.token &&
    left.session?.player.id === right.session?.player.id &&
    left.session?.deviceId === right.session?.deviceId
  );
}

export class SessionController {
  state: IdentityState = {
    session: null,
    status: 'connecting',
    error: null,
    creationInterrupted: false,
    canReload: false,
  };
  private stored: StoredSession = { ...EMPTY };
  private durable: StoredSession = { ...EMPTY };
  private unsaved = false;
  private generation = 0;
  private bootstrap: Promise<void> | null = null;
  private refreshRequested = false;

  constructor(private deps: Dependencies) {}

  private publish(next: Omit<IdentityState, 'creationInterrupted' | 'canReload'>) {
    this.state = {
      ...next,
      creationInterrupted:
        this.stored.creating && !this.stored.token && ['offline', 'error'].includes(next.status),
      canReload: !this.unsaved && next.status !== 'connecting',
    };
    this.deps.publish(this.state);
  }

  private async load(attempt: number) {
    try {
      const saved = await this.deps.vault.read();
      if (attempt !== this.generation) return;
      // A failed durable write must not replace this tab's usable credential with
      // its older cache on retry. A newer tab's committed identity still wins.
      if (
        this.unsaved &&
        (saved.revision === this.stored.revision || sameIdentity(saved, this.durable))
      ) {
        this.stored.revision = saved.revision;
      } else {
        this.stored = saved;
        this.unsaved = false;
      }
      this.durable = saved;
    } catch {
      if (this.deps.vault.bearer && !this.stored.token) {
        throw new Error(
          'This browser could not read saved profile access. Enable browser storage or connect an existing profile.',
        );
      }
    }
    if (attempt !== this.generation) return;
    this.deps.credential(this.stored.token);
    this.publish({ session: this.stored.session, status: 'connecting', error: null });
  }

  private async apply(value: CredentialResponse, attempt: number, broadcast: boolean) {
    if (attempt !== this.generation) return;
    const session = publicSession(value);
    const token = value.sessionToken ?? this.stored.token;
    if (this.deps.vault.bearer && (!token || !/^[a-f0-9]{64}$/.test(token))) {
      throw new Error('The server did not return a valid device credential.');
    }
    let revision = this.stored.revision;
    let warning: string | null = null;
    try {
      revision = await this.deps.vault.save(
        session,
        token,
        revision,
        () => attempt === this.generation,
      );
      // Remember our own committed write even if an access intent invalidated
      // the UI update while IndexedDB was finishing its transaction.
      this.durable = { session, token, revision, creating: false };
      this.unsaved = false;
    } catch (error) {
      if (error instanceof IdentityChangedError || attempt !== this.generation) throw error;
      this.unsaved = true;
      if (this.deps.vault.bearer) warning = STORAGE_WARNING;
    }
    if (attempt !== this.generation) return;
    this.stored = { session, token, revision, creating: false };
    this.deps.credential(token);
    this.publish({ session, status: 'ready', error: warning });
    // Only anonymous drafts can be attached; another profile's edits remain its own.
    await this.deps.attach(session.player.id).catch(() => undefined);
    if (broadcast && !this.unsaved && attempt === this.generation) this.deps.broadcast();
  }

  async adopt(value: CredentialResponse): Promise<void> {
    if (!this.deps.currentResponse(value)) throw new IdentityChangedError();
    // Invalidate bootstrap before waiting on the lock, including its pending disk write.
    const attempt = ++this.generation;
    this.publish({ ...this.state, status: 'connecting', error: null });
    try {
      await this.deps.lock(async () => {
        let saved: StoredSession | null = null;
        try {
          saved = await this.deps.vault.read();
        } catch {
          // Recovery/pairing can still establish access in this tab with blocked storage.
        }
        if (attempt !== this.generation || !this.deps.currentResponse(value)) {
          throw new IdentityChangedError();
        }
        if (saved && saved.revision !== this.stored.revision) {
          // A bootstrap marker created by our invalidated attempt carries no identity.
          const ownCommittedWrite =
            saved.revision === this.durable.revision && sameIdentity(saved, this.durable);
          if (!saved.creating && !sameIdentity(saved, this.stored) && !ownCommittedWrite)
            throw new IdentityChangedError();
          this.stored.revision = saved.revision;
        }
        if (
          this.deps.vault.bearer &&
          !value.sessionToken &&
          (value.player.id !== this.stored.session?.player.id ||
            value.deviceId !== this.stored.session?.deviceId)
        ) {
          throw new IdentityChangedError();
        }
        await this.apply(value, attempt, true);
      });
    } catch (error) {
      if (attempt === this.generation)
        this.publish({
          ...this.state,
          status: 'error',
          error: error instanceof Error ? error.message : 'Could not connect this profile.',
        });
      throw error;
    }
  }

  retry(): Promise<void> {
    if (this.bootstrap) return this.bootstrap;
    const attempt = this.generation;
    this.publish({ ...this.state, status: 'connecting', error: null });
    const run = async () => {
      try {
        await this.load(attempt);
        if (attempt !== this.generation) return;
        if (this.deps.vault.bearer && this.stored.creating && !this.stored.token) {
          throw new Error(
            'Profile creation was interrupted. Connect an existing profile or use a recovery code in Settings.',
          );
        }
        let session: CredentialResponse;
        try {
          session = await this.deps.request<CredentialResponse>('/session');
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 401) throw error;
          if (attempt !== this.generation) return;
          if (this.deps.vault.bearer) {
            if (this.stored.token || this.stored.session) {
              throw new Error(
                'This device is no longer connected. Connect your profile again or use a recovery code in Settings.',
                { cause: error },
              );
            }
            this.stored.revision = await this.deps.vault.beginCreation(
              this.stored.revision,
              () => attempt === this.generation,
            );
            this.stored.creating = true;
            this.durable = { ...this.stored };
            if (attempt !== this.generation) return;
          }
          session = await this.deps.request<CredentialResponse>('/session', {
            method: 'POST',
            body: { deviceName: this.deps.deviceName() },
          });
        }
        await this.apply(session, attempt, false);
      } catch (error) {
        if (attempt !== this.generation) return;
        this.publish({
          ...this.state,
          status: error instanceof TypeError ? 'offline' : 'error',
          error:
            error instanceof Error
              ? error.message
              : 'Waiting for a connection. Your prices stay on this device.',
        });
      }
    };
    this.bootstrap = this.deps.lock(run).finally(() => {
      this.bootstrap = null;
      if (this.refreshRequested) {
        this.refreshRequested = false;
        void this.retry();
      }
    });
    return this.bootstrap;
  }

  refresh() {
    this.generation++;
    this.publish({ ...this.state, status: 'connecting', error: null });
    if (this.bootstrap) this.refreshRequested = true;
    else void this.retry();
  }

  beginIdentityChange() {
    this.generation++;
    this.refreshRequested = false;
    this.deps.invalidateResponses();
  }

  async restartInterruptedCreation(): Promise<void> {
    if (!this.state.creationInterrupted) return;
    const attempt = ++this.generation;
    this.deps.invalidateResponses();
    try {
      await this.deps.lock(async () => {
        await this.deps.vault.clearInterruptedCreation(
          this.stored.revision,
          () => attempt === this.generation,
        );
        this.stored = { ...EMPTY };
        this.durable = { ...EMPTY };
        this.unsaved = false;
      });
      await this.retry();
    } catch (error) {
      if (attempt !== this.generation) return;
      this.publish({
        ...this.state,
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not restart profile creation.',
      });
    }
  }
}
