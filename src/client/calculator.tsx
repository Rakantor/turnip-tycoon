import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, ArrowRight, Check, CloudOff, LoaderCircle, Moon, Sun } from 'lucide-react';
import { predictWeek } from '../prediction';
import { uniquePattern } from '../prediction/previous-pattern';
import { currentSlot, currentWeekStart, isEditableWeek, shiftWeek } from '../shared/calendar';
import type { Trade } from '../shared/ledger';
import type { OwnWeeklyInputs, OwnWeekRecord, PatternId } from '../shared/week';
import type { WeekEntry } from './data/merge';
import { useWeek } from './data/use-week';
import { Button, dateFromWeek, Notice, useApp, weekLabel } from './ui';
import { FriendsPanel } from './groups';
import { Forecast, rangeLabel } from './forecast';
import { Outlook } from './outlook';
import { slotShortName, weekAdvice } from './advice';
import { islandOdds } from './odds';
import { HoldOrSell } from './odds-card';
import { canCompletePrice, parsePrice, priceRange } from './price-limits';
import { usePwaReloadGuard } from './pwa';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PATTERNS: { id: PatternId; label: string }[] = [
  { id: 'fluctuating', label: 'Fluctuating' },
  { id: 'large-spike', label: 'Large spike' },
  { id: 'decreasing', label: 'Decreasing' },
  { id: 'small-spike', label: 'Small spike' },
];

function PriceInput({
  value,
  label,
  hint = '—',
  purchase = false,
  current = false,
  best = false,
  readOnly = false,
  onCommit,
  onValidity,
  onDraftChange,
}: {
  value: number | null;
  label: string;
  /** Placeholder for an empty box: the forecast range when there is one. */
  hint?: string;
  purchase?: boolean;
  current?: boolean;
  best?: boolean;
  readOnly?: boolean;
  onCommit: (price: number | null) => void;
  onValidity: (invalid: boolean) => void;
  onDraftChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(value?.toString() ?? '');
  const [error, setError] = useState('');
  const editing = useRef({ focused: false, dirty: false });
  const errorId = useId();
  const rangeId = useId();
  const kind = purchase ? 'purchase' : 'selling';
  const { min, max } = priceRange(kind);
  useEffect(() => {
    if (!editing.current.focused && !editing.current.dirty) {
      setDraft(value?.toString() ?? '');
      setError('');
    }
  }, [value]);
  function commit() {
    editing.current.focused = false;
    if (!editing.current.dirty) {
      setDraft(value?.toString() ?? '');
      return;
    }
    const next = parsePrice(draft.trim(), kind);
    if (next === undefined) {
      setError(`${min}–${max} bells`);
      onValidity(true);
      return;
    }
    setError('');
    editing.current.dirty = false;
    onDraftChange(false);
    onValidity(false);
    setDraft(next?.toString() ?? '');
    onCommit(next);
  }
  return (
    <div
      className={`price-field${purchase ? ' purchase-field' : ''}${current ? ' current-slot' : ''}${best ? ' best-slot' : ''}`}
    >
      <input
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : rangeId}
        inputMode="numeric"
        autoComplete="off"
        type="text"
        value={draft}
        placeholder={hint}
        maxLength={String(max).length}
        readOnly={readOnly}
        onFocus={() => {
          editing.current.focused = true;
        }}
        onChange={(event) => {
          // Keep only digits, and ignore keystrokes that can no longer reach the allowed range.
          const next = event.target.value.replace(/\D/g, '');
          if (!canCompletePrice(next, kind)) return;
          editing.current.dirty = true;
          onDraftChange(true);
          setDraft(next);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <span id={rangeId} className="sr-only">
        {min} to {max} bells
      </span>
      {error && (
        <span id={errorId} className="input-error">
          {error}
        </span>
      )}
    </div>
  );
}

function describeTrade(trade: Trade): string {
  return (
    `${trade.quantity.toLocaleString()} at ${trade.price}` +
    (trade.kind === 'sell' ? ` on ${slotShortName(trade.slot)}` : '')
  );
}

/** One kind of trade for the conflict comparison, such as "4,000 at 98, 6,000 at 94". */
function tradeList(trades: readonly Trade[], kind: Trade['kind']): string {
  const listed = trades.filter((trade) => trade.kind === kind).map(describeTrade);
  return listed.length ? listed.join(', ') : '—';
}

/** An entry both devices changed: what it is, and each device's value. */
function describeEntry(
  entry: WeekEntry,
  mine: OwnWeekRecord,
  theirs: OwnWeekRecord,
): { label: string; mine: string; theirs: string } {
  const pattern = (week: OwnWeekRecord) =>
    PATTERNS.find((item) => item.id === week.previousPattern)?.label ?? 'Unknown';
  const firstBuy = (week: OwnWeekRecord) =>
    week.firstBuy === null ? 'Not sure' : week.firstBuy ? 'Yes' : 'No';
  const both = (value: (week: OwnWeekRecord) => string) => ({
    mine: value(mine),
    theirs: value(theirs),
  });
  if (entry === 'purchasePrice')
    return {
      label: 'Sunday buy price',
      ...both((week) => String(week.purchasePrice ?? '—')),
    };
  if (entry === 'firstBuy') return { label: 'First Daisy Mae purchase', ...both(firstBuy) };
  if (entry === 'previousPattern') return { label: 'Last week’s pattern', ...both(pattern) };
  if (entry === 'trades')
    return {
      label: 'Trades',
      ...both(
        (week) => `Bought ${tradeList(week.trades, 'buy')}; sold ${tradeList(week.trades, 'sell')}`,
      ),
    };
  if (entry.startsWith('price:')) {
    const slot = Number(entry.slice('price:'.length));
    return { label: slotShortName(slot), ...both((week) => String(week.prices[slot] ?? '—')) };
  }
  const id = entry.slice('trade:'.length);
  const find = (week: OwnWeekRecord) => week.trades.find((trade) => trade.id === id);
  const kind = (find(mine) ?? find(theirs))?.kind;
  return {
    label: kind === 'buy' ? 'Purchase' : 'Sale',
    ...both((week) => {
      const trade = find(week);
      return trade ? describeTrade(trade) : 'Removed';
    }),
  };
}

/** After an edit to last week identifies its pattern, offer it to this week's forecast. */
function PatternOffer({ weekStart, pattern }: { weekStart: string; pattern: PatternId }) {
  const identity = useApp();
  const { week, stored, update } = useWeek(
    weekStart,
    identity.session,
    identity.status === 'ready',
  );
  const [applied, setApplied] = useState(false);
  const label = PATTERNS.find((item) => item.id === pattern)!.label.toLowerCase();
  if (applied)
    return (
      <Notice success>
        This week’s forecast now uses {label} as last week’s pattern.{' '}
        <Link to="/">See this week</Link>
      </Notice>
    );
  // This week's saved setting is never changed silently, and needs no offer once it agrees.
  if (!stored || week.previousPattern === pattern) return null;
  return (
    <div className="pattern-offer" role="status">
      <p>
        These prices now point to a <strong>{label}</strong> week. Use that in this week’s forecast?
      </p>
      <Button
        secondary
        onClick={() => {
          update({ previousPattern: pattern });
          setApplied(true);
        }}
      >
        Use for this week
      </Button>
    </div>
  );
}

export function Calculator() {
  const identity = useApp();
  const params = useParams();
  const [owner, setOwner] = useState({ id: identity.session?.player.id ?? null, generation: 0 });
  const playerId = identity.session?.player.id;
  if (playerId && owner.id !== playerId) {
    setOwner({
      id: playerId,
      generation: owner.id === null ? owner.generation : owner.generation + 1,
    });
  }
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const currentWeek = currentWeekStart(now);
  const requestedWeek = params.weekStart;
  const validWeek =
    requestedWeek &&
    /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) &&
    currentWeekStart(dateFromWeek(requestedWeek)) === requestedWeek &&
    requestedWeek <= currentWeek;
  const weekStart = validWeek ? requestedWeek : currentWeek;
  return (
    <WeekCalculator
      key={`${owner.generation}:${weekStart}`}
      weekStart={weekStart}
      now={now}
      isCurrent={weekStart === currentWeek}
      editable={isEditableWeek(weekStart, now)}
    />
  );
}

function WeekCalculator({
  weekStart,
  now,
  isCurrent,
  editable,
}: {
  weekStart: string;
  now: Date;
  isCurrent: boolean;
  /** This week or last week; older weeks are read-only. */
  editable: boolean;
}) {
  const identity = useApp();
  const { week, status, error, update, retry, conflict, conflictEntries, resolveConflict } =
    useWeek(weekStart, identity.session, identity.status === 'ready');
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const [draftFields, setDraftFields] = useState<string[]>([]);
  const [inputGeneration, setInputGeneration] = useState(0);
  const [pendingRemoteReset, setPendingRemoteReset] = useState(false);
  useEffect(() => {
    if (pendingRemoteReset && !conflict) {
      setInputGeneration((generation) => generation + 1);
      setInvalidFields([]);
      setDraftFields([]);
      setPendingRemoteReset(false);
    }
  }, [conflict, pendingRemoteReset]);
  const prediction = useMemo(() => predictWeek(week), [week]);
  const slot = isCurrent ? currentSlot(now) : null;
  const readOnly = !editable;
  const lastWeek = editable && !isCurrent;
  // What last week's prices identified before this visit's first edit. Only a change
  // made here prompts the offer, so a pattern chosen on purpose is never questioned.
  const [patternBefore, setPatternBefore] = useState<PatternId | null>();
  const implied = uniquePattern(prediction);
  function edit(patch: Partial<OwnWeeklyInputs>, changedSlots?: number[]) {
    if (lastWeek && patternBefore === undefined) setPatternBefore(implied);
    update(patch, changedSlots);
  }
  function validity(field: string, invalid: boolean) {
    setInvalidFields((fields) =>
      invalid
        ? [...fields.filter((item) => item !== field), field]
        : fields.filter((item) => item !== field),
    );
  }
  function draftChanged(field: string, dirty: boolean) {
    setDraftFields((fields) =>
      dirty
        ? [...fields.filter((item) => item !== field), field]
        : fields.filter((item) => item !== field),
    );
  }
  const editing = draftFields.length > 0;
  usePwaReloadGuard(
    editing || invalidFields.length > 0
      ? 'Finish or correct your price entry before updating.'
      : null,
  );
  const saveLabel = editing
    ? 'Editing…'
    : status === 'saved'
      ? 'Saved'
      : status === 'loading'
        ? 'Loading saved prices…'
        : status === 'syncing'
          ? 'Saving…'
          : status === 'offline'
            ? 'Offline · saved on this device'
            : status === 'local'
              ? 'Saved on this device · sync pending'
              : status === 'conflict'
                ? 'Changes need review'
                : 'Couldn’t sync';
  const own = isCurrent ? islandOdds(week, prediction, slot) : null;
  const advice = weekAdvice({
    prediction,
    prices: week.prices,
    purchasePrice: week.purchasePrice,
    slot,
    isCurrent,
    odds:
      own?.odds && own.price !== null
        ? { price: own.price, chance: own.odds.chance, certain: own.odds.certain }
        : null,
  });
  const bestSlot = advice.bestSlot;
  // The current week has no selling half-day only on Sunday.
  const sundayToday = isCurrent && slot === null;
  const hintFor = (index: number) =>
    prediction.status === 'possible' && week.prices[index] === null
      ? rangeLabel(prediction.slots[index])
      : '—';
  const shortDate = (offset: number) =>
    dateFromWeek(weekStart, offset).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  return (
    <main id="main-content" className="page calculator-page">
      <div className="page-heading">
        <div>
          <h1>{isCurrent ? 'This week' : lastWeek ? 'Last week' : 'Past week'}</h1>
          <p>{weekLabel(weekStart)}</p>
        </div>
        <div className="week-navigation">
          <Link
            className="icon-button"
            to={`/weeks/${shiftWeek(weekStart, -1)}`}
            aria-label="Previous week"
          >
            <ArrowLeft size={19} />
          </Link>
          {!isCurrent && (
            <Link
              className="icon-button"
              to={
                shiftWeek(weekStart, 1) === currentWeekStart(now)
                  ? '/'
                  : `/weeks/${shiftWeek(weekStart, 1)}`
              }
              aria-label="Next week"
            >
              <ArrowRight size={19} />
            </Link>
          )}
        </div>
      </div>
      {readOnly && (
        <p className="history-note">
          Past weeks are read-only. <Link to="/">Return to this week</Link>
        </p>
      )}
      <Outlook advice={advice} />
      <div className="calculator-layout">
        <section className="weekly-entry" aria-labelledby="prices-title">
          <div className="entry-heading">
            <h2 id="prices-title">{editable ? 'Your prices' : 'Prices'}</h2>
            <div className="entry-status">
              <span className={`save-status status-${editing ? 'editing' : status}`} role="status">
                {editing ? null : status === 'saved' ? (
                  <Check size={15} aria-hidden="true" />
                ) : status === 'syncing' || status === 'loading' ? (
                  <LoaderCircle className="spin" size={15} aria-hidden="true" />
                ) : status === 'offline' ? (
                  <CloudOff size={15} aria-hidden="true" />
                ) : null}
                {saveLabel}
              </span>
            </div>
          </div>
          <div className="week-board">
            <div className={`day-card day-card-sunday${sundayToday ? ' day-today has-tag' : ''}`}>
              <div className="day-card-head">
                <span className="day-name">Sun</span>
                <span className="day-date">{shortDate(0)}</span>
                <span className="day-sub">buy price</span>
                {sundayToday && <span className="day-tag">Today</span>}
              </div>
              <div className="day-card-body">
                <span className="purchase-label" aria-hidden="true">
                  Bought from Daisy Mae
                </span>
                <PriceInput
                  key={inputGeneration}
                  label="Sunday purchase price in bells"
                  value={week.purchasePrice}
                  purchase
                  readOnly={readOnly}
                  onCommit={(purchasePrice) => edit({ purchasePrice })}
                  onValidity={(invalid) => validity('purchase', invalid)}
                  onDraftChange={(dirty) => draftChanged('purchase', dirty)}
                />
              </div>
            </div>
            <div className="period-headings" aria-hidden="true">
              <span />
              <span className="period-am">
                <Sun size={14} /> Morning
              </span>
              <span className="period-pm">
                <Moon size={14} /> Afternoon
              </span>
            </div>
            {DAYS.map((day, dayIndex) => {
              const today = slot !== null && Math.floor(slot / 2) === dayIndex;
              const best = bestSlot !== null && Math.floor(bestSlot / 2) === dayIndex;
              const tag = today ? 'Today' : best ? (isCurrent ? 'Best bet' : 'Best price') : null;
              return (
                <div
                  key={day}
                  className={`day-card${today ? ' day-today' : ''}${best ? ' day-best' : ''}${tag ? ' has-tag' : ''}`}
                >
                  <div className="day-card-head">
                    <span className="day-name">{day.slice(0, 3)}</span>
                    <span className="day-date">{shortDate(dayIndex + 1)}</span>
                    {tag && <span className="day-tag">{tag}</span>}
                  </div>
                  <div className="day-card-body">
                    {[0, 1].map((period) => {
                      const index = dayIndex * 2 + period;
                      return (
                        <div
                          key={period}
                          className={`period-slot ${period ? 'period-pm' : 'period-am'}`}
                        >
                          {period ? (
                            <Moon size={16} aria-hidden="true" />
                          ) : (
                            <Sun size={16} aria-hidden="true" />
                          )}
                          <PriceInput
                            key={inputGeneration}
                            label={`${day} ${period ? 'PM' : 'AM'} sell price in bells`}
                            value={week.prices[index]}
                            hint={hintFor(index)}
                            readOnly={readOnly}
                            current={index === slot}
                            best={index === bestSlot}
                            onCommit={(price) => {
                              const prices = [...week.prices];
                              prices[index] = price;
                              edit({ prices }, [index]);
                            }}
                            onValidity={(invalid) => validity(String(index), invalid)}
                            onDraftChange={(dirty) => draftChanged(String(index), dirty)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {invalidFields.length > 0 && (
            <Notice>
              Correct the highlighted entries. The forecast uses your last valid prices.
            </Notice>
          )}
          {lastWeek &&
            patternBefore !== undefined &&
            implied !== null &&
            implied !== patternBefore && (
              <PatternOffer key={implied} weekStart={shiftWeek(weekStart, 1)} pattern={implied} />
            )}
          {(status === 'error' || status === 'offline') && (
            <div className="sync-message">
              <p>{error ?? 'Your changes will sync when the connection is restored.'}</p>
              <Button
                secondary
                onClick={() => {
                  void (identity.status === 'ready' ? retry() : identity.retry());
                }}
              >
                Try again
              </Button>
            </div>
          )}
          {identity.status === 'error' && status !== 'error' && (
            <div className="sync-message">
              <p>
                {identity.error ??
                  'Connection unavailable. You can keep entering prices on this device.'}
              </p>
              <Button
                secondary
                onClick={() => {
                  void identity.retry();
                }}
              >
                Retry connection
              </Button>
            </div>
          )}
          {identity.status === 'ready' && identity.error && <Notice>{identity.error}</Notice>}
          {conflict && conflictEntries && (
            <div className="conflict-panel" role="alert">
              <h3>Another device changed the same entries</h3>
              <p>Everything else from both devices is combined. Choose which of these to keep.</p>
              <table>
                <thead>
                  <tr>
                    <th>Entry</th>
                    <th>This device</th>
                    <th>Other device</th>
                  </tr>
                </thead>
                <tbody>
                  {conflictEntries.map((entry) => {
                    const described = describeEntry(entry, week, conflict);
                    return (
                      <tr key={entry}>
                        <th>{described.label}</th>
                        <td>{described.mine}</td>
                        <td>{described.theirs}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="button-row">
                <Button
                  onClick={() => {
                    setPendingRemoteReset(false);
                    void resolveConflict('local');
                  }}
                >
                  Keep this device’s entries
                </Button>
                <Button
                  secondary
                  onClick={() => {
                    setPendingRemoteReset(true);
                    void resolveConflict('remote');
                  }}
                >
                  Use other device’s entries
                </Button>
              </div>
            </div>
          )}
          {/* Edits saved before this device kept a base are compared as whole weeks. */}
          {conflict && !conflictEntries && (
            <div className="conflict-panel" role="alert">
              <h3>Another device changed this week</h3>
              <p>Choose which entries to keep. Yours are still here until you choose.</p>
              <details>
                <summary>Compare entries</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Entry</th>
                      <th>This device</th>
                      <th>Other device</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>Purchase</th>
                      <td>{week.purchasePrice ?? '—'}</td>
                      <td>{conflict.purchasePrice ?? '—'}</td>
                    </tr>
                    {DAYS.flatMap((day, dayIndex) =>
                      [0, 1].map((period) => (
                        <tr key={`${day}-${period}`}>
                          <th>
                            {day.slice(0, 3)} {period ? 'PM' : 'AM'}
                          </th>
                          <td>{week.prices[dayIndex * 2 + period] ?? '—'}</td>
                          <td>{conflict.prices[dayIndex * 2 + period] ?? '—'}</td>
                        </tr>
                      )),
                    )}
                    <tr>
                      <th>Bought</th>
                      <td>{tradeList(week.trades, 'buy')}</td>
                      <td>{tradeList(conflict.trades, 'buy')}</td>
                    </tr>
                    <tr>
                      <th>Sold</th>
                      <td>{tradeList(week.trades, 'sell')}</td>
                      <td>{tradeList(conflict.trades, 'sell')}</td>
                    </tr>
                  </tbody>
                </table>
              </details>
              <div className="button-row">
                <Button
                  onClick={() => {
                    setPendingRemoteReset(false);
                    void resolveConflict('local');
                  }}
                >
                  Keep this device’s entries
                </Button>
                <Button
                  secondary
                  onClick={() => {
                    setPendingRemoteReset(true);
                    void resolveConflict('remote');
                  }}
                >
                  Use other device’s entries
                </Button>
              </div>
            </div>
          )}
          <div className="prediction-inputs" role="group" aria-label="Week settings">
            <div className="field">
              <label htmlFor="previous-pattern">Last week’s pattern</label>
              <select
                id="previous-pattern"
                value={week.previousPattern ?? 'unknown'}
                disabled={readOnly}
                onChange={(event) =>
                  edit({
                    previousPattern:
                      event.target.value === 'unknown' ? null : (event.target.value as PatternId),
                  })
                }
              >
                <option value="unknown">Unknown</option>
                {PATTERNS.map((pattern) => (
                  <option key={pattern.id} value={pattern.id}>
                    {pattern.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="first-buy">First Daisy Mae purchase on this island?</label>
              <select
                id="first-buy"
                value={week.firstBuy === null ? 'unknown' : week.firstBuy ? 'yes' : 'no'}
                disabled={readOnly}
                onChange={(event) =>
                  edit({
                    firstBuy:
                      event.target.value === 'unknown' ? null : event.target.value === 'yes',
                  })
                }
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
                <option value="unknown">Not sure</option>
              </select>
            </div>
          </div>
        </section>
        <Forecast
          prediction={prediction}
          prices={week.prices}
          purchasePrice={week.purchasePrice}
          currentSlot={slot}
          bestSlot={bestSlot}
          lead={
            isCurrent && (
              <HoldOrSell weekStart={weekStart} week={week} prediction={prediction} slot={slot} />
            )
          }
        />
      </div>
      {isCurrent && <FriendsPanel weekStart={weekStart} week={week} />}
    </main>
  );
}
