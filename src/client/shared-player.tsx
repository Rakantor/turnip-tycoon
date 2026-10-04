import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, ArrowRight, Eye, History as HistoryIcon } from 'lucide-react';
import type { Player } from '../shared/api';
import type { WeekRecord } from '../shared/week';
import { currentWeekStart } from '../shared/calendar';
import { predictWeek } from '../prediction';
import { ApiError, request } from './data/api';
import { clearSharedGroups } from './data/use-groups';
import { PlayerAvatar } from './groups';
import { Forecast } from './forecast';
import { Button, dateFromWeek, messageOf, Notice, useApp, weekLabel } from './ui';

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
function sharedError(error: unknown, owner: string) {
  if (error instanceof ApiError && [403, 404].includes(error.status)) {
    clearSharedGroups(owner);
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

function SharedWeekContent({ player, week }: SharedWeekResponse) {
  const prediction = useMemo(() => predictWeek(week), [week]);
  return (
    <>
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
            <span className="muted">Bells per turnip</span>
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
          <p className="hint">“—” means this player hasn’t entered a price.</p>
          <section
            className="shared-input-details"
            aria-labelledby="shared-prediction-details-title"
          >
            <h3 id="shared-prediction-details-title" className="forecast-section-heading">
              Prediction details
            </h3>
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
        <Forecast prediction={prediction} prices={week.prices} shared />
      </div>
    </>
  );
}

export function SharedPlayer() {
  const identity = useApp();
  const { playerId = '', weekStart = '' } = useParams();
  const owner = identity.session?.player.id ?? '';
  const key = `${owner}:${playerId}:${weekStart}`;
  const [result, setResult] = useState<{ key: string; data: SharedWeekResponse } | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    setResult(null);
    setError('');
    if (!isWeek(weekStart)) {
      setError('This week is not available.');
      return;
    }
    if (identity.status !== 'ready' || !owner) return;
    let active = true;
    void request<SharedWeekResponse>(`/players/${encodeURIComponent(playerId)}/weeks/${weekStart}`)
      .then((data) => {
        if (active) setResult({ key, data });
      })
      .catch((error: unknown) => {
        if (active) setError(sharedError(error, owner));
      });
    return () => {
      active = false;
    };
  }, [identity.status, key, owner, playerId, weekStart, reload]);
  const shown = identity.status === 'ready' && result?.key === key ? result.data : null;
  return (
    <main className="page shared-player-page" id="main-content">
      <Link className="text-link back-to-friends" to="/groups">
        <ArrowLeft size={16} />
        Back to friends
      </Link>
      {identity.status === 'offline' || identity.status === 'error' ? (
        <ConnectionNeeded />
      ) : error ? (
        <div className="shared-error">
          <Notice>{error}</Notice>
          <Button secondary onClick={() => setReload((value) => value + 1)}>
            Try again
          </Button>
        </div>
      ) : shown ? (
        <SharedWeekContent {...shown} />
      ) : (
        <p className="muted" role="status">
          Loading shared prices…
        </p>
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
        if (attempt === generation.current) setError(sharedError(error, owner));
      })
      .finally(() => {
        if (attempt === generation.current) setLoading(false);
      });
    return () => {
      generation.current = attempt + 1;
    };
  }, [identity.status, key, owner, playerId, reload]);
  const shown = identity.status === 'ready' && result?.key === key ? result.data : null;
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
        setError(sharedError(error, owner));
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
            <div className="history-table-scroll">
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
          {loading && (
            <p className="muted" role="status">
              Loading shared history…
            </p>
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
