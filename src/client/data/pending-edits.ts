import type { WeekRecord, WeeklyInputs } from '../../shared/week';
import type { LocalWeek } from './database';
import { weekStore } from './runtime';
import { weekKey } from './sync';

export const LOCAL_SAVE_ERROR =
  'Could not save these prices on this device. Your unsaved edits remain on this page. Keep it open and retry before closing it.';

interface PendingEdit {
  sequence: number;
  patch: Partial<WeeklyInputs>;
  priceSlots?: number[];
}

export interface PendingSnapshot {
  edits: readonly PendingEdit[];
  sequence: number;
  error: string | null;
  /** Covers the interval before Dexie's live query observes a successful write. */
  durable?: LocalWeek;
}

const EMPTY: PendingSnapshot = { edits: [], sequence: 0, error: null };
type Persist = (
  owner: string,
  weekStart: string,
  patch: Partial<WeeklyInputs>,
  priceSlots?: number[],
) => Promise<LocalWeek | undefined>;

/** Failed local writes live here across hook remounts; they never imply durability. */
export class PendingEdits {
  private entries = new Map<string, PendingSnapshot>();
  private owners = new Map<string, { owner: string; weekStart: string }>();
  private flights = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();
  private sequence = 0;

  constructor(private persist: Persist) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot(owner: string, weekStart: string): PendingSnapshot {
    return this.entries.get(weekKey(owner, weekStart)) ?? EMPTY;
  }

  private publish(key: string, entry: PendingSnapshot) {
    this.entries.set(key, entry);
    for (const listener of this.listeners) listener();
  }

  enqueue(
    owner: string,
    weekStart: string,
    patch: Partial<WeeklyInputs>,
    priceSlots?: number[],
  ): Promise<void> {
    const key = weekKey(owner, weekStart);
    const current = this.snapshot(owner, weekStart);
    const sequence = ++this.sequence;
    this.owners.set(key, { owner, weekStart });
    this.publish(key, {
      ...current,
      sequence,
      edits: [
        ...current.edits,
        {
          sequence,
          patch: { ...patch, ...(patch.prices ? { prices: [...patch.prices] } : {}) },
          ...(priceSlots ? { priceSlots: [...priceSlots] } : {}),
        },
      ],
    });
    return this.flush(owner, weekStart);
  }

  async flush(owner: string, weekStart: string): Promise<void> {
    const key = weekKey(owner, weekStart);
    const existing = this.flights.get(key);
    if (existing) {
      await existing;
      if (this.snapshot(owner, weekStart).edits.length) await this.flush(owner, weekStart);
      return;
    }
    const run = async () => {
      while (this.snapshot(owner, weekStart).edits.length) {
        const edit = this.snapshot(owner, weekStart).edits[0];
        try {
          const durable = await this.persist(owner, weekStart, edit.patch, edit.priceSlots);
          const latest = this.snapshot(owner, weekStart);
          this.publish(key, {
            ...latest,
            edits: latest.edits.filter((pending) => pending.sequence !== edit.sequence),
            error: null,
            durable: durable ?? latest.durable,
          });
        } catch (error) {
          this.publish(key, { ...this.snapshot(owner, weekStart), error: LOCAL_SAVE_ERROR });
          throw error;
        }
      }
    };
    const operation = run();
    this.flights.set(key, operation);
    try {
      await operation;
    } finally {
      this.flights.delete(key);
    }
  }

  /** Called before durable anonymous drafts attach to the confirmed identity. */
  async attachDrafts(owner: string): Promise<void> {
    if (owner === 'unassigned') return;
    for (const [key, identity] of this.owners) {
      if (identity.owner !== 'unassigned') continue;
      // A started write either commits under its original owner or remains here.
      try {
        await this.flights.get(key);
      } catch {
        /* Transfer the retained patch. */
      }
      const draft = this.entries.get(key);
      if (!draft) continue;
      if (draft.edits.length) {
        const targetKey = weekKey(owner, identity.weekStart);
        const target = this.snapshot(owner, identity.weekStart);
        this.owners.set(targetKey, { owner, weekStart: identity.weekStart });
        this.publish(targetKey, {
          ...target,
          sequence: Math.max(target.sequence, draft.sequence),
          edits: [...target.edits, ...draft.edits].sort(
            (left, right) => left.sequence - right.sequence,
          ),
          error: target.error ?? draft.error,
        });
      }
      this.entries.delete(key);
      this.owners.delete(key);
      for (const listener of this.listeners) listener();
    }
  }
}

/** Apply retained intent over the newest known local record without changing it. */
export function withPendingEdits(
  base: WeekRecord,
  localVersion: number,
  pending: PendingSnapshot,
): WeekRecord {
  const saved =
    pending.durable && pending.durable.version > localVersion ? pending.durable.data : base;
  const result = { ...saved, prices: [...saved.prices] };
  for (const edit of pending.edits) {
    for (const field of ['purchasePrice', 'firstBuy', 'previousPattern'] as const) {
      if (field in edit.patch) Object.assign(result, { [field]: edit.patch[field] });
    }
    if (edit.patch.prices)
      for (const slot of edit.priceSlots ?? Array.from({ length: 12 }, (_, index) => index)) {
        result.prices[slot] = edit.patch.prices[slot];
      }
  }
  return result;
}

export const pendingEdits = new PendingEdits(async (owner, weekStart, patch, priceSlots) => {
  await weekStore.edit(owner, weekStart, patch, priceSlots);
  return weekStore.db.weeks.get(weekKey(owner, weekStart));
});
