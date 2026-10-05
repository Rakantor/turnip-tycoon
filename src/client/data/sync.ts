import { emptyOwnWeek, inputsOf, type OwnWeeklyInputs, type WeekMutation } from '../../shared/week';
import { ApiError } from './api';
import { type LocalWeek, ownWeek, type StoredWeek, TurnipDatabase } from './database';
import { mergeWeek, sameEntries, sameTrades } from './merge';
import { shiftWeek } from '../../shared/calendar';
import { inferPreviousPattern } from '../../prediction/previous-pattern';

export interface WeekTransport {
  get(weekStart: string): Promise<StoredWeek>;
  put(weekStart: string, body: WeekMutation): Promise<{ revision: number }>;
  isActive(owner: string): boolean;
}

export const weekKey = (owner: string, weekStart: string) => `${owner}|${weekStart}`;
function fresh(owner: string, weekStart: string): LocalWeek {
  return {
    key: weekKey(owner, weekStart),
    owner,
    weekStart,
    data: emptyOwnWeek(owner, weekStart),
    hydrated: false,
    version: 0,
    dirty: false,
    fields: [],
    slots: [],
  };
}
function mergeTouched(target: StoredWeek, local: LocalWeek): StoredWeek {
  const data = { ...target, prices: [...target.prices] };
  for (const field of local.fields) Object.assign(data, { [field]: local.data[field] });
  for (const slot of local.slots) data.prices[slot] = local.data.prices[slot];
  return data;
}
/** Unsent edits start from the version this device last read from the server. */
function startEdits(row: LocalWeek): void {
  if (row.dirty) return;
  if (row.hydrated) row.base = { ...row.data, prices: [...row.data.prices] };
  else delete row.base;
}
/** Combined trades that differ from the server's must be sent with the next save. */
function sendTradesIfChanged(row: LocalWeek, remote: StoredWeek): void {
  if (
    !row.fields.includes('trades') &&
    !sameTrades(ownWeek(row.data).trades, ownWeek(remote).trades)
  )
    row.fields.push('trades');
}
/**
 * Another device saved this week while this one had unsent edits. Entries only one of
 * them changed combine; the player chooses only where both changed the same entry.
 */
function reconcile(row: LocalWeek, remote: StoredWeek): void {
  if (!row.base) {
    // Edits saved before this device kept a base: the whole week is one choice, except
    // trades this device never edited, which follow the server either way.
    row.conflict = remote;
    if (!row.fields.includes('trades')) row.data = { ...row.data, trades: remote.trades };
    return;
  }
  const merged = mergeWeek(ownWeek(row.base), ownWeek(row.data), ownWeek(remote), 'local');
  delete row.pending;
  row.version++;
  if (merged.conflicts.length) {
    // Shows this device's side, everything else combined, until the player chooses.
    row.data = { ...merged.week, revision: row.data.revision };
    row.conflict = remote;
    return;
  }
  row.data = merged.week;
  row.base = remote;
  if (sameEntries(merged.week, ownWeek(remote))) {
    row.dirty = false;
    row.fields = [];
    row.slots = [];
    row.syncedAt = Date.now();
    delete row.base;
  } else sendTradesIfChanged(row, remote);
}

/** A pending mutation is immutable until acknowledged, including across page reloads. */
export class WeekStore {
  private flights = new Map<string, Promise<void>>();
  constructor(
    public db: TurnipDatabase,
    private transport: WeekTransport,
  ) {}

  private async freshWithDefaults(owner: string, weekStart: string): Promise<LocalWeek> {
    const row = fresh(owner, weekStart);
    if (owner === 'unassigned') return row;
    const previous = await this.db.weeks.get(weekKey(owner, shiftWeek(weekStart, -1)));
    row.data.previousPattern = inferPreviousPattern(
      previous?.conflict ? undefined : previous?.data,
      owner,
      weekStart,
    );
    return row;
  }

  /** A new local week can use cached history even while disconnected. */
  async initialize(owner: string, weekStart: string): Promise<void> {
    if (owner === 'unassigned') return;
    await this.db.transaction('rw', this.db.weeks, async () => {
      if (await this.db.weeks.get(weekKey(owner, weekStart))) return;
      await this.db.weeks.put(await this.freshWithDefaults(owner, weekStart));
    });
  }

  async edit(
    owner: string,
    weekStart: string,
    patch: Partial<OwnWeeklyInputs>,
    priceSlots?: number[],
  ): Promise<void> {
    await this.db.transaction('rw', this.db.weeks, async () => {
      const row =
        (await this.db.weeks.get(weekKey(owner, weekStart))) ??
        (await this.freshWithDefaults(owner, weekStart));
      startEdits(row);
      for (const field of ['purchasePrice', 'firstBuy', 'previousPattern', 'trades'] as const) {
        if (
          field in patch &&
          (patch[field] !== row.data[field] || field === 'previousPattern' || field === 'trades') &&
          !row.fields.includes(field)
        )
          row.fields.push(field);
      }
      const prices = [...row.data.prices];
      if (patch.prices)
        for (const slot of priceSlots ?? Array.from({ length: 12 }, (_, i) => i)) {
          if (patch.prices[slot] !== prices[slot] && !row.slots.includes(slot))
            row.slots.push(slot);
          prices[slot] = patch.prices[slot];
        }
      row.data = { ...row.data, ...patch, prices };
      row.version++;
      row.dirty = true;
      await this.db.weeks.put(row);
    });
  }

  /** Only anonymous, pre-bootstrap drafts may transfer to a resolved identity. */
  async attachDrafts(owner: string): Promise<void> {
    await this.db.transaction('rw', this.db.weeks, async () => {
      const drafts = await this.db.weeks.where('owner').equals('unassigned').toArray();
      for (const draft of drafts) {
        const target =
          (await this.db.weeks.get(weekKey(owner, draft.weekStart))) ??
          (await this.freshWithDefaults(owner, draft.weekStart));
        startEdits(target);
        target.data = mergeTouched(target.data, draft);
        target.fields = [...new Set([...target.fields, ...draft.fields])];
        target.slots = [...new Set([...target.slots, ...draft.slots])];
        target.version++;
        target.dirty = true;
        await this.db.weeks.put(target);
        await this.db.weeks.delete(draft.key);
      }
    });
  }

  async sync(owner: string, weekStart: string): Promise<void> {
    const key = weekKey(owner, weekStart);
    const existing = this.flights.get(key);
    if (existing) {
      await existing;
      const latest = await this.db.weeks.get(key);
      if (latest?.dirty && !latest.conflict && this.transport.isActive(owner))
        await this.sync(owner, weekStart);
      return;
    }
    const run = async () => {
      await this.run(owner, weekStart);
    };
    const operation =
      typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request(`turnips-week:${key}`, run)
        : run();
    this.flights.set(key, operation);
    try {
      await operation;
    } finally {
      this.flights.delete(key);
    }
  }

  private async run(owner: string, weekStart: string): Promise<void> {
    const key = weekKey(owner, weekStart);
    if (!this.transport.isActive(owner)) return;
    let row = await this.db.weeks.get(key);
    if (row?.conflict) return;
    // Reconcile a lost acknowledgement before fetching a newer server revision.
    if (!row?.pending) {
      const remote = await this.transport.get(weekStart);
      if (!this.transport.isActive(owner)) return;
      await this.db.transaction('rw', this.db.weeks, async () => {
        row = (await this.db.weeks.get(key)) ?? fresh(owner, weekStart);
        if (row.pending || row.conflict) return;
        // Only a never-saved week receives a default. A saved Unknown is a choice.
        let defaults = remote;
        if (remote.revision === 0) {
          const previous = await this.db.weeks.get(weekKey(owner, shiftWeek(weekStart, -1)));
          // The server supersedes a clean cache; only unsynced prior edits are newer.
          if (previous && !previous.conflict && (previous.dirty || previous.pending)) {
            defaults = {
              ...remote,
              previousPattern: inferPreviousPattern(previous.data, owner, weekStart),
            };
          }
        }
        if (!row.hydrated) {
          row.data = mergeTouched(defaults, row);
          row.hydrated = true;
          row.syncedAt = Date.now();
          // Edits made before the first read now sit on top of the server's version.
          if (row.dirty) row.base = defaults;
        } else if (!row.dirty) {
          row.data = defaults;
          row.syncedAt = Date.now();
        } else if (remote.revision !== row.data.revision) reconcile(row, remote);
        await this.db.weeks.put(row);
      });
    }
    // Each combined retry follows another device's save; stop after a few in a row.
    let combined = 0;
    while (this.transport.isActive(owner)) {
      const pending = await this.db.transaction('rw', this.db.weeks, async () => {
        const current = await this.db.weeks.get(key);
        if (!current || current.conflict || !current.dirty) return null;
        if (!current.pending) {
          current.pending = {
            ...inputsOf(current.data),
            // Untouched trades are left out, so the server keeps whatever it holds.
            ...(current.fields.includes('trades') ? { trades: ownWeek(current.data).trades } : {}),
            mutationId: crypto.randomUUID(),
            baseRevision: current.data.revision,
            version: current.version,
          };
          await this.db.weeks.put(current);
        }
        return current.pending;
      });
      if (!pending) return;
      if (!this.transport.isActive(owner)) return;
      try {
        const { version, ...body } = pending;
        const result = await this.transport.put(weekStart, body);
        await this.db.transaction('rw', this.db.weeks, async () => {
          const current = await this.db.weeks.get(key);
          if (current?.pending?.mutationId !== pending.mutationId) return;
          current.data.revision = result.revision;
          current.hydrated = true;
          current.syncedAt = Date.now();
          delete current.pending;
          if (current.version === version) {
            current.dirty = false;
            current.fields = [];
            current.slots = [];
            delete current.base;
          } else if (current.base) {
            // Later edits now sit on top of what the server just accepted.
            current.base = {
              ...current.base,
              purchasePrice: pending.purchasePrice,
              firstBuy: pending.firstBuy,
              previousPattern: pending.previousPattern,
              prices: [...pending.prices],
              ...(pending.trades ? { trades: pending.trades } : {}),
              revision: result.revision,
            };
          }
          await this.db.weeks.put(current);
        });
      } catch (error) {
        if (error instanceof ApiError && error.code === 'REVISION_CONFLICT' && error.week) {
          const remote = error.week;
          const resolved = await this.db.transaction('rw', this.db.weeks, async () => {
            const current = await this.db.weeks.get(key);
            if (current?.pending?.mutationId !== pending.mutationId) return false;
            reconcile(current, remote);
            await this.db.weeks.put(current);
            return !current.conflict;
          });
          // Combined without a conflict: save the result on top of the other device's.
          if (resolved && ++combined < 3) continue;
          return;
        }
        throw error;
      }
    }
  }

  async resolve(owner: string, weekStart: string, choice: 'local' | 'remote'): Promise<void> {
    await this.db.transaction('rw', this.db.weeks, async () => {
      const row = await this.db.weeks.get(weekKey(owner, weekStart));
      if (!row?.conflict) return;
      if (row.base) {
        // Only the entries both devices changed take the chosen side.
        const merged = mergeWeek(
          ownWeek(row.base),
          ownWeek(row.data),
          ownWeek(row.conflict),
          choice,
        );
        row.data = merged.week;
        row.dirty = !sameEntries(merged.week, ownWeek(row.conflict));
        if (row.dirty) {
          row.base = row.conflict;
          sendTradesIfChanged(row, row.conflict);
        } else {
          row.fields = [];
          row.slots = [];
          delete row.base;
        }
      } else {
        row.data =
          choice === 'remote' ? row.conflict : { ...row.data, revision: row.conflict.revision };
        row.dirty = choice === 'local';
        if (choice === 'remote') {
          row.fields = [];
          row.slots = [];
        }
      }
      row.hydrated = true;
      row.version++;
      delete row.pending;
      delete row.conflict;
      await this.db.weeks.put(row);
    });
  }
}
