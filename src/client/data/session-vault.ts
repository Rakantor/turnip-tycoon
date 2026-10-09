import type { SessionResponse } from '../../shared/api';
import { t } from '@lingui/core/macro';
import type { TurnipDatabase } from './database';
import type { ProfileRemoval } from '../../shared/profile-data';
import { blockedProfileKey, eraseProfileCopies } from './profile-storage';

type SealedToken = { key: CryptoKey; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer };
type SessionRecord = {
  revision: string;
  session: SessionResponse | null;
  sealed?: SealedToken;
  creating?: boolean;
  removal?: ProfileRemoval;
};
export type StoredSession = {
  revision: string | null;
  session: SessionResponse | null;
  token: string | null;
  creating: boolean;
  removal?: ProfileRemoval;
  /** Survives returning to welcome and reconnecting any profile. */
  cleanups?: Record<string, string>;
};

function sessionRecord(
  value: unknown,
): (Omit<SessionRecord, 'revision'> & { revision: string | null }) | undefined {
  if (!value) return undefined;
  // Same-origin installations originally saved the public session directly.
  return 'revision' in (value as object)
    ? (value as SessionRecord)
    : { revision: null, session: value as SessionResponse };
}

export class IdentityChangedError extends Error {
  constructor() {
    super(t`Your profile changed in another tab. Please try again.`);
    this.name = 'IdentityChangedError';
  }
}

export function publicSession(value: SessionResponse): SessionResponse {
  // Access responses may also contain a recovery code and a device token.
  return { player: value.player, deviceId: value.deviceId, hasRecoveryCode: value.hasRecoveryCode };
}

export class SessionVault {
  constructor(
    private db: TurnipDatabase,
    readonly bearer: boolean,
  ) {}

  async read(): Promise<StoredSession> {
    const { record, cleanups } = await this.db.transaction('r', this.db.meta, async () => ({
      record: sessionRecord((await this.db.meta.get('session'))?.value),
      cleanups: ((await this.db.meta.get('profile-cleanups'))?.value ?? {}) as Record<
        string,
        string
      >,
    }));
    if (!record) return { revision: null, session: null, token: null, creating: false, cleanups };
    let token: string | null = null;
    if (record.sealed) {
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: record.sealed.iv },
        record.sealed.key,
        record.sealed.ciphertext,
      );
      token = new TextDecoder().decode(plaintext);
      if (!/^[a-f0-9]{64}$/.test(token))
        throw new Error(t`The saved device credential is invalid.`);
    }
    if (this.bearer && record.session && !token) {
      throw new Error(t`The saved profile is missing its device credential.`);
    }
    return {
      revision: record.revision,
      session: record.session,
      token,
      creating: record.creating ?? false,
      removal: record.removal,
      cleanups,
    };
  }

  private async replace(record: SessionRecord, revision: string | null, current: () => boolean) {
    await this.db.transaction('rw', this.db.meta, async () => {
      const previous = sessionRecord((await this.db.meta.get('session'))?.value);
      if (!current() || previous?.removal || (previous?.revision ?? null) !== revision)
        throw new IdentityChangedError();
      await this.db.meta.put({ key: 'session', value: record });
      if (record.session) await this.db.meta.delete(blockedProfileKey(record.session.player.id));
    });
    return record.revision;
  }

  async beginCreation(revision: string | null, current: () => boolean): Promise<string> {
    return this.replace(
      { revision: crypto.randomUUID(), session: null, creating: true },
      revision,
      current,
    );
  }

  async clearInterruptedCreation(revision: string | null, current: () => boolean): Promise<void> {
    await this.db.transaction('rw', this.db.meta, async () => {
      const record = sessionRecord((await this.db.meta.get('session'))?.value);
      if (!current() || !record?.creating || record.session || record.revision !== revision) {
        throw new IdentityChangedError();
      }
      await this.db.meta.delete('session');
    });
  }

  async beginRemoval(owner: string, revision: string | null): Promise<string> {
    return this.db.transaction('rw', this.db.meta, async () => {
      const record = sessionRecord((await this.db.meta.get('session'))?.value);
      if (
        record?.revision !== revision ||
        record.session?.player.id !== owner ||
        (record.removal && record.removal.phase !== 'pending')
      )
        throw new IdentityChangedError();
      const nextRevision = crypto.randomUUID();
      await this.db.meta.put({ key: blockedProfileKey(owner), value: 'pending' });
      await this.db.meta.put({
        key: 'session',
        value: { ...record, revision: nextRevision, removal: { owner, phase: 'pending' } },
      });
      return nextRevision;
    });
  }

  /** Only the controller that received a definite rejection may undo its own attempt. */
  async cancelRemoval(owner: string, revision: string): Promise<string> {
    return this.db.transaction('rw', this.db.meta, async () => {
      const record = sessionRecord((await this.db.meta.get('session'))?.value);
      const blocked = await this.db.meta.get(blockedProfileKey(owner));
      if (
        record?.revision !== revision ||
        record.session?.player.id !== owner ||
        record.removal?.owner !== owner ||
        record.removal.phase !== 'pending' ||
        blocked?.value !== 'pending'
      )
        throw new IdentityChangedError();
      const next = { ...record, revision: crypto.randomUUID() };
      delete next.removal;
      await this.db.meta.put({ key: 'session', value: next });
      await this.db.meta.delete(blockedProfileKey(owner));
      return next.revision;
    });
  }

  async finishRemoval(owner: string, phase: 'deleted' | 'disconnected'): Promise<void> {
    await this.db.transaction('rw', this.db.meta, this.db.weeks, async () => {
      const record = sessionRecord((await this.db.meta.get('session'))?.value);
      if (record?.session?.player.id !== owner && record?.removal?.owner !== owner)
        throw new IdentityChangedError();
      await this.db.meta.put({ key: blockedProfileKey(owner), value: phase });
      await eraseProfileCopies(this.db, owner, phase);
      const cleanups = ((await this.db.meta.get('profile-cleanups'))?.value ?? {}) as Record<
        string,
        string
      >;
      await this.db.meta.put({
        key: 'profile-cleanups',
        value: { ...cleanups, [owner]: crypto.randomUUID() },
      });
      await this.db.meta.put({
        key: 'session',
        value: {
          revision: crypto.randomUUID(),
          session: null,
          removal: { owner, phase },
        } satisfies SessionRecord,
      });
    });
  }

  async resetRemoval(revision: string | null): Promise<void> {
    await this.db.transaction('rw', this.db.meta, async () => {
      const record = sessionRecord((await this.db.meta.get('session'))?.value);
      if (record?.revision !== revision || !record.removal || record.removal.phase === 'pending')
        throw new IdentityChangedError();
      await this.db.meta.put({
        key: 'session',
        value: { revision: crypto.randomUUID(), session: null },
      });
    });
  }

  async save(
    value: SessionResponse,
    token: string | null,
    revision: string | null,
    current: () => boolean,
  ): Promise<string> {
    const existing = await this.read();
    if (existing.removal) throw new IdentityChangedError();
    if (existing.revision !== revision) throw new IdentityChangedError();
    if (
      existing.revision &&
      existing.token === token &&
      JSON.stringify(existing.session) === JSON.stringify(publicSession(value))
    ) {
      // A metadata refresh must not manufacture an identity change in other tabs.
      return this.db.transaction('r', this.db.meta, async () => {
        const saved = sessionRecord((await this.db.meta.get('session'))?.value);
        if (!current() || saved?.removal || saved?.revision !== revision)
          throw new IdentityChangedError();
        return existing.revision!;
      });
    }
    const record: SessionRecord = { revision: crypto.randomUUID(), session: publicSession(value) };
    if (this.bearer) {
      if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error(t`Missing device credential.`);
      // Non-extractable keys avoid plaintext credentials in the database. This
      // does not protect against XSS: same-origin scripts can still use the key.
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(token),
      );
      record.sealed = { key, iv, ciphertext };
    }
    return this.replace(record, revision, current);
  }
}
