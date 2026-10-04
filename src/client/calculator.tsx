import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, ArrowRight, Check, CloudOff, LoaderCircle, Sun, Moon } from 'lucide-react';
import { predictWeek } from '../prediction';
import { currentSlot, currentWeekStart, shiftWeek } from '../shared/calendar';
import type { PatternId } from '../shared/week';
import { useWeek } from './data/use-week';
import { Button, dateFromWeek, Notice, useApp, weekLabel } from './ui';
import { FriendsPanel } from './groups';
import { Forecast } from './forecast';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PATTERNS: { id: PatternId; label: string }[] = [
  { id: 'fluctuating', label: 'Fluctuating' },
  { id: 'large-spike', label: 'Large spike' },
  { id: 'decreasing', label: 'Decreasing' },
  { id: 'small-spike', label: 'Small spike' },
];

function RefreshPrices({
  availableAt,
  lastRefreshedAt,
  disabled,
  onRefresh,
}: {
  availableAt: number;
  lastRefreshedAt: number;
  disabled: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState('');
  useEffect(() => {
    setNow(Date.now());
    if (availableAt <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [availableAt]);
  const remaining = Math.max(0, Math.ceil((availableAt - now) / 1000));
  return (
    <>
      <div className="refresh-row">
        <button
          type="button"
          className="text-button"
          disabled={disabled || remaining > 0}
          onClick={() => {
            setError('');
            void onRefresh().catch(() => setError('Could not refresh prices. Try again.'));
          }}
        >
          Refresh{remaining > 0 ? ` (${remaining}s)` : ''}
        </button>
        {lastRefreshedAt > 0 && (
          <span className="hint">
            Updated{' '}
            {new Date(lastRefreshedAt).toLocaleTimeString(undefined, {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>
      {error && <Notice>{error}</Notice>}
    </>
  );
}

function PriceInput({
  value,
  label,
  purchase = false,
  current = false,
  readOnly = false,
  onCommit,
  onValidity,
  onDraftChange,
}: {
  value: number | null;
  label: string;
  purchase?: boolean;
  current?: boolean;
  readOnly?: boolean;
  onCommit: (price: number | null) => void;
  onValidity: (invalid: boolean) => void;
  onDraftChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(value?.toString() ?? '');
  const [error, setError] = useState('');
  const editing = useRef({ focused: false, dirty: false });
  const errorId = useId();
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
    const text = draft.trim();
    const min = purchase ? 90 : 1;
    const max = purchase ? 110 : 660;
    if (text !== '' && (!/^\d+$/.test(text) || Number(text) < min || Number(text) > max)) {
      setError(`${min}–${max} whole bells`);
      onValidity(true);
      return;
    }
    setError('');
    editing.current.dirty = false;
    onDraftChange(false);
    onValidity(false);
    const next = text === '' ? null : Number(text);
    setDraft(next?.toString() ?? '');
    onCommit(next);
  }
  return (
    <div className={`price-field${current ? ' current-slot' : ''}`}>
      <input
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        inputMode="numeric"
        autoComplete="off"
        type="text"
        value={draft}
        placeholder="—"
        maxLength={6}
        readOnly={readOnly}
        onFocus={() => {
          editing.current.focused = true;
        }}
        onChange={(event) => {
          editing.current.dirty = true;
          onDraftChange(true);
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      {error && (
        <span id={errorId} className="input-error">
          {error}
        </span>
      )}
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
    />
  );
}

function WeekCalculator({
  weekStart,
  now,
  isCurrent,
}: {
  weekStart: string;
  now: Date;
  isCurrent: boolean;
}) {
  const identity = useApp();
  const {
    week,
    status,
    error,
    update,
    retry,
    refresh,
    refreshAvailableAt,
    lastRefreshedAt,
    conflict,
    resolveConflict,
  } = useWeek(weekStart, identity.session, identity.status === 'ready');
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
  const readOnly = !isCurrent;
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
  return (
    <main id="main-content" className="page calculator-page">
      <div className="page-heading">
        <div>
          <h1>{isCurrent ? 'This week' : 'Past week'}</h1>
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
      {!isCurrent && (
        <p className="history-note">
          Past weeks are read-only. <Link to="/">Return to this week</Link>
        </p>
      )}
      <div className="calculator-layout">
        <section className="weekly-entry" aria-labelledby="prices-title">
          <div className="purchase-row">
            <div>
              <span className="field-label">Sunday purchase price</span>
            </div>
            <PriceInput
              key={inputGeneration}
              label="Sunday purchase price in bells"
              value={week.purchasePrice}
              purchase
              readOnly={readOnly}
              onCommit={(purchasePrice) => update({ purchasePrice })}
              onValidity={(invalid) => validity('purchase', invalid)}
              onDraftChange={(dirty) => draftChanged('purchase', dirty)}
            />
          </div>
          <table className="price-table">
            <caption className="sr-only">
              Enter your Monday through Saturday selling prices in bells
            </caption>
            <thead>
              <tr>
                <th scope="col">Sell prices</th>
                <th scope="col">
                  <Sun size={14} aria-hidden="true" /> AM <span>before noon</span>
                </th>
                <th scope="col">
                  <Moon size={14} aria-hidden="true" /> PM <span>after noon</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, dayIndex) => (
                <tr key={day}>
                  <th scope="row">
                    <span className="day-long">{day}</span>
                    <span className="day-short">{day.slice(0, 3)}</span>
                    <span className="day-date">
                      {dateFromWeek(weekStart, dayIndex + 1).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </th>
                  {[0, 1].map((period) => {
                    const index = dayIndex * 2 + period;
                    return (
                      <td key={period}>
                        <PriceInput
                          key={inputGeneration}
                          label={`${day} ${period ? 'PM' : 'AM'} sell price in bells`}
                          value={week.prices[index]}
                          readOnly={readOnly}
                          current={index === slot}
                          onCommit={(price) => {
                            const prices = [...week.prices];
                            prices[index] = price;
                            update({ prices }, [index]);
                          }}
                          onValidity={(invalid) => validity(String(index), invalid)}
                          onDraftChange={(dirty) => draftChanged(String(index), dirty)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="save-row">
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
          <RefreshPrices
            availableAt={refreshAvailableAt}
            lastRefreshedAt={lastRefreshedAt}
            disabled={identity.status !== 'ready' || status === 'syncing' || status === 'loading'}
            onRefresh={refresh}
          />
          {invalidFields.length > 0 && (
            <Notice>
              Correct the highlighted entries. The forecast uses your last valid prices.
            </Notice>
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
          {conflict && (
            <div className="conflict-panel" role="alert">
              <h3>Another device changed this week</h3>
              <p>Choose which prices to keep. Your entries are still here until you choose.</p>
              <details>
                <summary>Compare prices</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Price</th>
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
                  Keep this device’s prices
                </Button>
                <Button
                  secondary
                  onClick={() => {
                    setPendingRemoteReset(true);
                    void resolveConflict('remote');
                  }}
                >
                  Use other device’s prices
                </Button>
              </div>
            </div>
          )}
          <section className="prediction-inputs" aria-labelledby="prediction-details-title">
            <div className="field">
              <label htmlFor="first-buy">First Daisy Mae purchase on this island?</label>
              <select
                id="first-buy"
                value={week.firstBuy === null ? 'unknown' : week.firstBuy ? 'yes' : 'no'}
                disabled={readOnly}
                onChange={(event) =>
                  update({
                    firstBuy:
                      event.target.value === 'unknown' ? null : event.target.value === 'yes',
                  })
                }
              >
                <option value="unknown">Not sure</option>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="previous-pattern">Last week’s pattern</label>
              <select
                id="previous-pattern"
                value={week.previousPattern ?? 'unknown'}
                disabled={readOnly}
                onChange={(event) =>
                  update({
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
          </section>
        </section>
        <Forecast prediction={prediction} prices={week.prices} />
      </div>
      {isCurrent && <FriendsPanel weekStart={weekStart} week={week} />}
    </main>
  );
}
