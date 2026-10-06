import type { SessionResponse } from '../../shared/api';
import type { ProfileRemoval } from '../../shared/profile-data';
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
  /** No profile on this device yet: the welcome dialog decides how to start one. */
  needsProfile: boolean;
  removal: ProfileRemoval | null;
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
  /** Removes friends' prices while preserving the owner's local work for reconnection. */
  forgetShared: (owner: string) => Promise<void>;
  /** Discards per-tab copies after confirmed local cleanup. */
  forget: (owner: string) => Promise<void>;
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

// These API errors are issued before the deletion transaction can commit.
const DELETION_REJECTIONS = [
  'INVALID_INPUT',
  'INVALID_JSON',
  'JSON_REQUIRED',
  'BODY_TOO_LARGE',
  'INVALID_ORIGIN',
  'HTTPS_REQUIRED',
  'PLAYER_CHANGED',
  'UNAUTHENTICATED',
  'DEVICE_EXPIRED',
  'DEVICE_REMOVED',
];
function deletionRejected(error: unknown): boolean {
  return error instanceof ApiError && DELETION_REJECTIONS.includes(error.code);
}

function transientFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === 'TimeoutError') ||
    (error instanceof ApiError && error.status >= 500)
  );
}

export class SessionController {
  state: IdentityState = {
    session: null,
    status: 'connecting',
    error: null,
    creationInterrupted: false,
    canReload: false,
    needsProfile: false,
    removal: null,
  };
  private stored: StoredSession = { ...EMPTY };
  /** The welcome dialog's answer; a profile is only created once there is one. */
  private answer: { displayName?: string } | null = null;
  private awaitingAnswer = false;
  private durable: StoredSession = { ...EMPTY };
  private unsaved = false;
  private generation = 0;
  private bootstrap: Promise<void> | null = null;
  private refreshRequested = false;
  private removing = false;
  private removalFailure: { owner: string; message: string } | null = null;
  private cleanups: Map<string, string> | null = null;
  /** The completed removal whose per-tab copies this tab has already forgotten. */
  private forgottenRemoval: string | null = null;

  constructor(private deps: Dependencies) {}

  private async observeCleanups(saved: StoredSession) {
    if (!this.cleanups) {
      // A new tab has no snapshots from before historical cleanups. Establish its
      // baseline without discarding drafts just entered during initial connection.
      this.cleanups = new Map(Object.entries(saved.cleanups ?? {}));
      return;
    }
    for (const [owner, generation] of Object.entries(saved.cleanups ?? {})) {
      if (this.cleanups.get(owner) === generation) continue;
      // A suspended tab may miss both removal and reset. Forget its snapshots and
      // retained patches before publishing access or attaching anonymous drafts.
      // In-memory copies are dropped first; a failed cache delete must not block access.
      await this.deps.forget(owner).catch(() => undefined);
      this.cleanups.set(owner, generation);
    }
  }

  private publish(
    next: Omit<IdentityState, 'creationInterrupted' | 'canReload' | 'needsProfile' | 'removal'>,
  ) {
    this.state = {
      ...next,
      creationInterrupted:
        this.stored.creating && !this.stored.token && ['offline', 'error'].includes(next.status),
      canReload: !this.unsaved && (next.status !== 'connecting' || this.awaitingAnswer),
      needsProfile: this.awaitingAnswer,
      removal: this.stored.removal ?? null,
    };
    this.deps.publish(this.state);
  }

  private async load(attempt: number, quiet = false) {
    const previous = this.stored;
    try {
      const saved = await this.deps.vault.read();
      if (attempt !== this.generation) return;
      // A failed durable write must not replace this tab's usable credential with
      // its older cache on retry. A newer tab's committed identity still wins.
      if (
        this.unsaved &&
        !saved.removal &&
        JSON.stringify(saved.cleanups) === JSON.stringify(this.durable.cleanups) &&
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
    await this.observeCleanups(this.durable);
    if (attempt !== this.generation) return;
    this.deps.credential(this.stored.token);
    // A background check keeps an unchanged ready identity usable while it confirms access.
    if (quiet && !this.stored.removal && sameIdentity(previous, this.stored)) return;
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
      this.durable = { session, token, revision, creating: false, cleanups: this.durable.cleanups };
      this.unsaved = false;
    } catch (error) {
      if (error instanceof IdentityChangedError || attempt !== this.generation) throw error;
      this.unsaved = true;
      if (this.deps.vault.bearer) warning = STORAGE_WARNING;
    }
    if (attempt !== this.generation) return;
    this.stored = { session, token, revision, creating: false, cleanups: this.durable.cleanups };
    this.awaitingAnswer = false;
    this.deps.credential(token);
    const removalError =
      this.removalFailure?.owner === session.player.id ? this.removalFailure.message : null;
    this.removalFailure = null;
    this.publish({ session, status: 'ready', error: warning ?? removalError });
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
        if (saved) await this.observeCleanups(saved);
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

  /** `background` rechecks access without interrupting a ready identity. */
  retry(background = false): Promise<void> {
    if (this.removing) {
      if (!background) this.refreshRequested = true;
      return Promise.resolve();
    }
    if (this.bootstrap) return this.bootstrap;
    const attempt = this.generation;
    const quiet = background && this.state.status === 'ready';
    if (!quiet) this.publish({ ...this.state, status: 'connecting', error: null });
    const run = async () => {
      try {
        await this.load(attempt, quiet);
        if (attempt !== this.generation) return;
        if (this.stored.removal) {
          const { owner, phase } = this.stored.removal;
          if (phase !== 'pending' && this.forgottenRemoval !== this.stored.revision) {
            await this.deps.forget(owner).catch(() => undefined);
            if (attempt !== this.generation) return;
            this.forgottenRemoval = this.stored.revision;
          }
          this.awaitingAnswer = false;
          // Keep the reason a deletion attempt failed visible after deferred refreshes.
          const failure =
            phase === 'pending' && this.removalFailure?.owner === owner
              ? this.removalFailure.message
              : null;
          this.publish({ session: this.stored.session, status: 'error', error: failure });
          return;
        }
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
          const lost = this.stored.session?.player.id;
          if (lost && error.code === 'DEVICE_REMOVED') {
            await this.discardAccess(lost, 'disconnected');
            return;
          }
          if (lost) {
            await this.deps.forgetShared(lost).catch(() => undefined);
            if (attempt !== this.generation) return;
            throw new Error(
              `${error.code === 'DEVICE_EXPIRED' ? 'This device’s access expired.' : 'This device needs to reconnect.'} Your saved prices and unsent edits are still on this device. Connect the same profile again or use a recovery code in Settings.`,
              { cause: error },
            );
          }
          if (this.deps.vault.bearer && (this.stored.token || this.stored.session)) {
            throw new Error(
              'This device is no longer connected. Connect your profile again or use a recovery code in Settings.',
              { cause: error },
            );
          }
          // A new profile waits for the welcome dialog: a name, a skip, or connecting
          // an existing profile instead, which then leaves no empty profile behind.
          if (!this.answer) {
            this.awaitingAnswer = true;
            this.publish({ session: null, status: 'connecting', error: null });
            return;
          }
          if (this.deps.vault.bearer) {
            this.stored.revision = await this.deps.vault.beginCreation(
              this.stored.revision,
              () => attempt === this.generation,
            );
            this.stored.creating = true;
            this.durable = { ...this.stored };
            if (attempt !== this.generation) return;
          }
          const { displayName } = this.answer;
          session = await this.deps.request<CredentialResponse>('/session', {
            method: 'POST',
            body: { deviceName: this.deps.deviceName(), ...(displayName ? { displayName } : {}) },
          });
          this.answer = null;
        }
        await this.apply(session, attempt, false);
      } catch (error) {
        if (attempt !== this.generation) return;
        // Requests report their own connection failures; a background check only acts on lost access.
        if (quiet && this.state.status === 'ready' && transientFailure(error)) return;
        // Opening for the first time while offline still shows the welcome dialog.
        if (
          error instanceof TypeError &&
          !this.stored.session &&
          !this.stored.token &&
          !this.answer
        )
          this.awaitingAnswer = true;
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
      this.drainRefresh();
    });
    return this.bootstrap;
  }

  refresh() {
    this.refreshRequested = true;
    if (this.removing) return;
    this.generation++;
    this.publish({ ...this.state, status: 'connecting', error: null });
    this.drainRefresh();
  }

  private drainRefresh() {
    if (!this.refreshRequested || this.removing || this.bootstrap) return;
    this.refreshRequested = false;
    void this.retry();
  }

  private async discardAccess(owner: string, phase: 'deleted' | 'disconnected') {
    await this.deps.vault.finishRemoval(owner, phase);
    this.stored = await this.deps.vault.read();
    await this.observeCleanups(this.stored);
    this.forgottenRemoval = this.stored.revision;
    this.removalFailure = null;
    this.durable = this.stored;
    this.unsaved = false;
    this.answer = null;
    this.awaitingAnswer = false;
    this.deps.credential(null);
    this.publish({ session: null, status: 'error', error: null });
    this.deps.broadcast();
  }

  /**
   * The welcome dialog's answer: a name, or null to skip and go by the friend
   * code's first block. Creation resumes at once, or when the device reconnects.
   */
  answerWelcome(displayName: string | null): Promise<void> {
    this.answer = displayName?.trim() ? { displayName: displayName.trim() } : {};
    if (!this.awaitingAnswer) return Promise.resolve();
    this.awaitingAnswer = false;
    this.publish({ session: this.state.session, status: this.state.status, error: null });
    return this.retry();
  }

  beginIdentityChange() {
    this.generation++;
    this.refreshRequested = false;
    this.deps.invalidateResponses();
  }

  /** Keep the credential on an ambiguous failure so the confirmed request can be retried. */
  async removeProfile(owner: string): Promise<void> {
    if (this.removing) return;
    this.removing = true;
    this.removalFailure = null;
    this.beginIdentityChange();
    this.answer = null;
    this.awaitingAnswer = false;
    this.publish({ ...this.state, status: 'connecting', error: null });
    let began = false;
    try {
      await this.deps.lock(async () => {
        if (this.stored.session?.player.id !== owner) throw new IdentityChangedError();
        // A rejected retry cannot settle an earlier request whose outcome is unknown.
        const previous = await this.deps.vault.read();
        const retrying = previous.removal?.phase === 'pending';
        const revision = await this.deps.vault.beginRemoval(owner, this.stored.revision);
        began = true;
        this.stored.revision = revision;
        this.stored.removal = { owner, phase: 'pending' };
        this.publish({ ...this.state, status: 'connecting', error: null });
        this.deps.broadcast();
        let result: { deletedPlayerId: string };
        try {
          result = await this.deps.request<{ deletedPlayerId: string }>('/profile', {
            method: 'DELETE',
            body: { playerId: owner, confirm: 'delete' },
          });
        } catch (error) {
          if (!retrying && deletionRejected(error)) {
            this.stored.revision = await this.deps.vault.cancelRemoval(owner, revision);
            delete this.stored.removal;
            this.deps.broadcast();
            this.refreshRequested = true;
          }
          throw error;
        }
        if (result.deletedPlayerId !== owner) throw new IdentityChangedError();
        await this.discardAccess(owner, 'deleted');
      });
    } catch (error) {
      if (!began) this.refreshRequested = true;
      const message =
        error instanceof Error
          ? error.message
          : this.stored.removal
            ? 'Could not confirm deletion.'
            : 'Could not request deletion.';
      // A deferred refresh republishes this, whether the profile resumed or remains pending.
      this.removalFailure = { owner, message };
      this.publish({ ...this.state, status: 'error', error: message });
      throw error;
    } finally {
      this.removing = false;
      this.drainRefresh();
    }
  }

  /** Explicitly discard a failed request's local access, without claiming server deletion. */
  async clearRemovalAccess(): Promise<void> {
    const owner = this.stored.removal?.owner;
    const revision = this.stored.revision;
    if (!owner || this.removing) return;
    this.removing = true;
    this.beginIdentityChange();
    try {
      await this.deps.lock(async () => {
        const saved = await this.deps.vault.read();
        if (
          saved.revision !== revision ||
          saved.removal?.owner !== owner ||
          saved.removal.phase !== 'pending'
        )
          throw new IdentityChangedError();
        try {
          await this.deps.request('/logout', { method: 'POST', body: {} });
        } catch (error) {
          // A bearer credential can be discarded locally. HttpOnly cookies require
          // the server's acknowledgement before returning to the welcome flow.
          if (!this.deps.vault.bearer) throw error;
        }
        await this.discardAccess(owner, 'disconnected');
      });
    } finally {
      this.removing = false;
      this.drainRefresh();
    }
  }

  async startAfterRemoval(): Promise<void> {
    try {
      await this.deps.lock(async () => {
        await this.deps.vault.resetRemoval(this.stored.revision);
        this.stored = await this.deps.vault.read();
        this.durable = this.stored;
        this.answer = null;
        this.deps.broadcast();
      });
      await this.retry();
    } catch (error) {
      this.refresh();
      throw error;
    }
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
