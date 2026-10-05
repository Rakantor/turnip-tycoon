import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, ArrowRight, Eye, History as HistoryIcon } from 'lucide-react';
import type { Player } from '../shared/api';
import type { WeekRecord } from '../shared/week';
import { currentWeekStart } from '../shared/calendar';
import { predictWeek } from '../prediction';
import { ApiError, request } from './data/api';
import { forgetSharedPlayer, savedPlayerWeek } from './data/use-groups';
import { PlayerAvatar } from './groups';
import { Forecast } from './forecast';
import { HistoryLoading } from './history';
import {
  Button,
  dateFromWeek,
  Loading,
  messageOf,
  Notice,
  Placeholder,
  useApp,
  useReveal,
  weekLabel,
} from './ui';

interface SharedWeekResponse {
  player: Player;
  week: WeekRecord;
}
interface SharedHistoryResponse {
  player: Player;
  weeks: WeekRecord[];
  nextCursor: string | null;
}
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function isWeek(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    currentWeekStart(dateFromWeek(value)) === value &&
    value <= currentWeekStart()
  );
}
function accessLost(error: unknown): boolean {
  return error instanceof ApiError && [403, 404].includes(error.status);
}
function sharedError(error: unknown, owner: string, playerId: string) {
  if (accessLost(error)) {
    void forgetSharedPlayer(owner, playerId).catch(() => undefined);
    return 'This player is no longer available through your groups.';
  }
  return messageOf(error);
}
function ConnectionNeeded() {
  const identity = useApp();
  return (
    <div className="group-connection">
      <p>Connect to load this player’s shared prices.</p>
      <Button
        secondary
        onClick={() => {
          void identity.retry();
        }}
      >
        Reconnect
      </Button>
    </div>
  );
}

function SharedWeekLoading() {
  return (
    <Loading label="Loading shared prices…">
      <div className="page-heading shared-player-heading">
        <div className="shared-player-identity">
          <Placeholder round className="shared-avatar-placeholder" />
          <div>
            <h1>
              <Placeholder width="5em" />
            </h1>
            <p className="friend-code">
              <Placeholder width="12em" />
            </p>
          </div>
        </div>
      </div>
      <div className="shared-week-label">
        <Placeholder className="week-chip-placeholder" />
      </div>
      <div className="calculator-layout shared-calculator-layout">
        <div className="shared-prices-card">
          <div className="card-heading">
            <h2>Weekly prices</h2>
          </div>
          <div className="shared-buy-price">
            <div>
              <span className="section-eyebrow">SUNDAY</span>
              <h3>Bought for</h3>
            </div>
            <strong>
              <Placeholder width="1.6em" />
            </strong>
          </div>
          <table className="shared-price-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>AM</th>
                <th>PM</th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day) => (
                <tr key={day}>
                  <th>{day}</th>
                  <td>
                    <Placeholder width="1.6em" />
                  </td>
                  <td>
                    <Placeholder width="1.6em" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="forecast">
          <div className="forecast-card">
            <div className="forecast-card-heading">
              <h2>How the week could go</h2>
            </div>
            <Placeholder className="placeholder-block forecast-chart-placeholder" />
          </div>
        </div>
      </div>
    </Loading>
  );
}

function SharedWeekContent({
  player,
  week,
  className,
}: SharedWeekResponse & { className?: string }) {
  const prediction = useMemo(() => predictWeek(week), [week]);
  return (
    <div className={className}>
      <div className="page-heading shared-player-heading">
        <div className="shared-player-identity">
          <PlayerAvatar name={player.displayName} />
          <div>
            <h1>{player.displayName}</h1>
            <p className="friend-code">{player.friendCode}</p>
          </div>
        </div>
        <Link className="text-link" to={`/players/${player.id}/history`}>
          <HistoryIcon size={16} />
          Past weeks
        </Link>
      </div>
      <div className="shared-week-label">
        <span className="week-chip">{weekLabel(week.weekStart)}</span>
        <span className="muted">
          <Eye size={14} />
          Shared view · read only
        </span>
      </div>
      <div className="calculator-layout shared-calculator-layout">
        <section className="shared-prices-card" aria-labelledby="shared-prices-title">
          <div className="card-heading">
            <h2 id="shared-prices-title">Weekly prices</h2>
          </div>
          <div className="shared-buy-price">
            <div>
              <span className="section-eyebrow">SUNDAY</span>
              <h3>Bought for</h3>
            </div>
            <strong>
              {week.purchasePrice ?? '—'}{' '}
              <small>{week.purchasePrice !== null ? 'bells' : 'Not entered'}</small>
            </strong>
          </div>
          <table className="shared-price-table">
            <caption className="sr-only">
              {player.displayName}’s reported prices, Monday through Saturday
            </caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">AM</th>
                <th scope="col">PM</th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, index) => (
                <tr key={day}>
                  <th scope="row">{day}</th>
                  <td>
                    {week.prices[index * 2] ?? (
                      <span className="muted" aria-label="Not entered">
                        —
                      </span>
                    )}
                  </td>
                  <td>
                    {week.prices[index * 2 + 1] ?? (
                      <span className="muted" aria-label="Not entered">
                        —
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <section
            className="shared-input-details"
            aria-labelledby="shared-prediction-details-title"
          >
            <dl>
              <div>
                <dt>First purchase on their island</dt>
                <dd>{week.firstBuy === null ? 'Unknown' : week.firstBuy ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt>Previous pattern</dt>
                <dd>{week.previousPattern ? week.previousPattern.replace('-', ' ') : 'Unknown'}</dd>
              </div>
            </dl>
          </section>
        </section>
        <Forecast
          prediction={prediction}
          prices={week.prices}
          purchasePrice={week.purchasePrice}
          shared
        />
      </div>
    </div>
  );
}

export function SharedPlayer() {
  const identity = useApp();
  const { playerId = '', weekStart = '' } = useParams();
  const owner = identity.session?.player.id ?? '';
  const key = `${owner}:${playerId}:${weekStart}`;
  const valid = isWeek(weekStart);
  const [result, setResult] = useState<{ key: string; data: SharedWeekResponse } | null>(null);
  const [checked, setChecked] = useState('');
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    setError(null);
    if (!valid || !owner) return;
    let active = true;
    let denied = false;
    // This week's saved copy shows straight away, including offline.
    void savedPlayerWeek(owner, weekStart, playerId)
      .then((saved) => {
        if (!active) return;
        if (saved && !denied)
          setResult((current) => (current?.key === key ? current : { key, data: saved }));
        setChecked(key);
      })
      .catch(() => {
        if (active) setChecked(key);
      });
    if (identity.status === 'ready') {
      void request<SharedWeekResponse>(
        `/players/${encodeURIComponent(playerId)}/weeks/${weekStart}`,
      )
        .then((data) => {
          if (active) setResult({ key, data });
        })
        .catch((error: unknown) => {
          if (!active) return;
          if (accessLost(error)) {
            denied = true;
            setResult(null);
          }
          setError({ key, message: sharedError(error, owner, playerId) });
        });
    }
    return () => {
      active = false;
    };
  }, [identity.status, key, owner, playerId, weekStart, reload, valid]);
  const shown = result?.key === key ? result.data : null;
  const failed = !valid ? 'This week is not available.' : error?.key === key ? error.message : '';
  const disconnected = identity.status === 'offline' || identity.status === 'error';
  const loading = !shown && !failed && (!disconnected || checked !== key);
  const reveal = useReveal(loading);
  return (
    <main className="page shared-player-page" id="main-content">
      <Link className="text-link back-to-friends" to="/groups">
        <ArrowLeft size={16} />
        Back to friends
      </Link>
      {shown ? (
        <SharedWeekContent {...shown} className={reveal} />
      ) : failed ? (
        <div className="shared-error">
          <Notice>{failed}</Notice>
          {valid && (
            <Button secondary onClick={() => setReload((value) => value + 1)}>
              Try again
            </Button>
          )}
        </div>
      ) : loading ? (
        <SharedWeekLoading />
      ) : (
        <ConnectionNeeded />
      )}
    </main>
  );
}

export function SharedHistory() {
  const identity = useApp();
  const { playerId = '' } = useParams();
  const owner = identity.session?.player.id ?? '';
  const key = `${owner}:${playerId}`;
  const [result, setResult] = useState<{ key: string; data: SharedHistoryResponse } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const attempt = ++generation.current;
    setResult(null);
    setError('');
    setLoading(true);
    if (identity.status !== 'ready' || !owner) return;
    void request<SharedHistoryResponse>(
      `/players/${encodeURIComponent(playerId)}/weeks?before=${currentWeekStart()}&limit=20`,
    )
      .then((data) => {
        if (attempt === generation.current) setResult({ key, data });
      })
      .catch((error: unknown) => {
        if (attempt === generation.current) setError(sharedError(error, owner, playerId));
      })
      .finally(() => {
        if (attempt === generation.current) setLoading(false);
      });
    return () => {
      generation.current = attempt + 1;
    };
  }, [identity.status, key, owner, playerId, reload]);
  const shown = identity.status === 'ready' && result?.key === key ? result.data : null;
  const reveal = useReveal(loading && !shown);
  async function more() {
    if (!shown?.nextCursor) return;
    const attempt = generation.current;
    setLoading(true);
    setError('');
    try {
      const data = await request<SharedHistoryResponse>(
        `/players/${encodeURIComponent(playerId)}/weeks?before=${encodeURIComponent(shown.nextCursor)}&limit=20`,
      );
      if (attempt !== generation.current) return;
      setResult((previous) =>
        previous?.key === key
          ? {
              key,
              data: {
                ...data,
                weeks: [
                  ...previous.data.weeks,
                  ...data.weeks.filter(
                    (week) => !previous.data.weeks.some((old) => old.weekStart === week.weekStart),
                  ),
                ],
              },
            }
          : previous,
      );
    } catch (error) {
      if (attempt === generation.current) {
        setError(sharedError(error, owner, playerId));
        setResult(null);
      }
    } finally {
      if (attempt === generation.current) setLoading(false);
    }
  }
  return (
    <main className="page history-page shared-player-page" id="main-content">
      <Link className="text-link back-to-friends" to="/groups">
        <ArrowLeft size={16} />
        Back to friends
      </Link>
      <div className="page-heading">
        <div>
          <h1>{shown ? `${shown.player.displayName}’s history` : 'Shared history'}</h1>
          <p>Previous weeks, shared with your groups.</p>
        </div>
        {shown && (
          <Link className="text-link" to={`/players/${playerId}/weeks/${currentWeekStart()}`}>
            This week <ArrowRight size={16} />
          </Link>
        )}
      </div>
      {identity.status === 'offline' || identity.status === 'error' ? (
        <ConnectionNeeded />
      ) : (
        <>
          {error && (
            <>
              <Notice>{error}</Notice>
              <Button secondary onClick={() => setReload((value) => value + 1)}>
                Try again
              </Button>
            </>
          )}
          {shown && shown.weeks.length > 0 && (
            <div className={`history-table-scroll ${reveal}`}>
              <table className="history-table">
                <caption className="sr-only">Shared past weekly prices</caption>
                <thead>
                  <tr>
                    <th scope="col">Week</th>
                    <th scope="col">Bought for</th>
                    <th scope="col">Best entered</th>
                    <th scope="col">Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.weeks.map((week) => {
                    const prices = week.prices.filter((price): price is number => price !== null);
                    return (
                      <tr key={week.weekStart}>
                        <th scope="row">
                          <Link to={`/players/${playerId}/weeks/${week.weekStart}`}>
                            {weekLabel(week.weekStart)}
                          </Link>
                        </th>
                        <td>{week.purchasePrice ?? '—'}</td>
                        <td>{prices.length ? Math.max(...prices) : '—'}</td>
                        <td>{prices.length}/12</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {loading && !shown && (
            <HistoryLoading
              label="Loading shared history…"
              columns={['Week', 'Bought for', 'Best entered', 'Entries']}
            />
          )}
          {shown && !loading && !error && shown.weeks.length === 0 && (
            <div className="empty-history">
              <p>No past weeks yet.</p>
              <p className="muted">Saved weeks will appear here when a new week starts.</p>
            </div>
          )}
          {shown?.nextCursor && (
            <Button
              secondary
              busy={loading}
              onClick={() => {
                void more();
              }}
            >
              Load older weeks
            </Button>
          )}
        </>
      )}
    </main>
  );
}
