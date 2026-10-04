import type { SessionResponse } from '../../shared/api';
import type { TurnipDatabase } from './database';

type SealedToken = { key: CryptoKey; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer };
type SessionRecord = {
  revision: string;
  session: SessionResponse | null;
  sealed?: SealedToken;
  creating?: boolean;
};
export type StoredSession = {
  revision: string | null;
  session: SessionResponse | null;
  token: string | null;
  creating: boolean;
};

export class IdentityChangedError extends Error {
  constructor() {
    super('Your profile changed in another tab. Please try again.');
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
    const value = (await this.db.meta.get('session'))?.value;
    if (!value) return { revision: null, session: null, token: null, creating: false };
    // Preserve the public-profile cache of existing same-origin installations.
    if (!this.bearer && !('revision' in (value as object))) {
      return { revision: null, session: value as SessionResponse, token: null, creating: false };
    }
    const record = value as SessionRecord;
    let token: string | null = null;
    if (record.sealed) {
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: record.sealed.iv },
        record.sealed.key,
        record.sealed.ciphertext,
      );
      token = new TextDecoder().decode(plaintext);
      if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('The saved device credential is invalid.');
    }
    if (this.bearer && record.session && !token) {
      throw new Error('The saved profile is missing its device credential.');
    }
    return {
      revision: record.revision,
      session: record.session,
      token,
      creating: record.creating ?? false,
    };
  }

  private async replace(record: SessionRecord, revision: string | null, current: () => boolean) {
    await this.db.transaction('rw', this.db.meta, async () => {
      const previous = (await this.db.meta.get('session'))?.value as SessionRecord | undefined;
      if (!current() || (previous?.revision ?? null) !== revision) throw new IdentityChangedError();
      await this.db.meta.put({ key: 'session', value: record });
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
      const record = (await this.db.meta.get('session'))?.value as SessionRecord | undefined;
      if (!current() || !record?.creating || record.session || record.revision !== revision) {
        throw new IdentityChangedError();
      }
      await this.db.meta.delete('session');
    });
  }

  async save(
    value: SessionResponse,
    token: string | null,
    revision: string | null,
    current: () => boolean,
  ): Promise<string> {
    const existing = await this.read();
    if (existing.revision !== revision) throw new IdentityChangedError();
    if (
      existing.revision &&
      existing.token === token &&
      JSON.stringify(existing.session) === JSON.stringify(publicSession(value))
    ) {
      // A metadata refresh must not manufacture an identity change in other tabs.
      return this.db.transaction('r', this.db.meta, async () => {
        const saved = (await this.db.meta.get('session'))?.value as SessionRecord | undefined;
        if (!current() || saved?.revision !== revision) throw new IdentityChangedError();
        return existing.revision!;
      });
    }
    const record: SessionRecord = { revision: crypto.randomUUID(), session: publicSession(value) };
    if (this.bearer) {
      if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Missing device credential.');
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
