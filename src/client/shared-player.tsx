import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, ArrowRight, Eye, History as HistoryIcon } from 'lucide-react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { Player } from '../shared/api';
import type { WeekRecord } from '../shared/week';
import { currentWeekStart } from '../shared/calendar';
import { predictWeek } from '../prediction';
import { ApiError, request } from './data/api';
import { forgetSharedPlayer, savedPlayerWeek } from './data/use-groups';
import { dayName, patternName } from './advice';
import { PlayerAvatar } from './player-avatar';
import { Forecast } from './forecast';
import { HistoryLoading } from './history-loading';
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
const DAY_INDEXES = [0, 1, 2, 3, 4, 5];
const historyColumns = () => [t`Week`, t`Bought for`, t`Best entered`, t`Entries`];

function HalfDayHeadings({ scope }: { scope?: 'col' }) {
  return (
    <tr>
      <th scope={scope}>
        <Trans>Day</Trans>
      </th>
      <th scope={scope}>{t({ message: 'AM', comment: 'Morning, as a column heading' })}</th>
      <th scope={scope}>{t({ message: 'PM', comment: 'Afternoon, as a column heading' })}</th>
    </tr>
  );
}
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
    return t`This player is no longer available through your groups.`;
  }
  return messageOf(error);
}
function ConnectionNeeded() {
  const identity = useApp();
  return (
    <div className="group-connection">
      <p>
        <Trans>Connect to load this player’s shared prices.</Trans>
      </p>
      <Button
        secondary
        onClick={() => {
          void identity.retry();
        }}
      >
        <Trans>Reconnect</Trans>
      </Button>
    </div>
  );
}

function SharedWeekLoading() {
  return (
    <Loading label={t`Loading shared prices…`}>
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
            <h2>
              <Trans>Weekly prices</Trans>
            </h2>
          </div>
          <div className="shared-buy-price">
            <div>
              <span className="section-eyebrow">{dayName(0)}</span>
              <h3>
                <Trans>Bought for</Trans>
              </h3>
            </div>
            <strong>
              <Placeholder width="1.6em" />
            </strong>
          </div>
          <table className="shared-price-table">
            <thead>
              <HalfDayHeadings />
            </thead>
            <tbody>
              {DAY_INDEXES.map((day) => (
                <tr key={day}>
                  <th>{dayName(day + 1)}</th>
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
              <h2>
                <Trans>How the week could go</Trans>
              </h2>
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
  const name = player.displayName;
  const notEntered = t`Not entered`;
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
          <Trans>Past weeks</Trans>
        </Link>
      </div>
      <div className="shared-week-label">
        <span className="week-chip">{weekLabel(week.weekStart)}</span>
        <span className="muted">
          <Eye size={14} />
          <Trans>Shared view · read only</Trans>
        </span>
      </div>
      <div className="calculator-layout shared-calculator-layout">
        <section className="shared-prices-card" aria-labelledby="shared-prices-title">
          <div className="card-heading">
            <h2 id="shared-prices-title">
              <Trans>Weekly prices</Trans>
            </h2>
          </div>
          <div className="shared-buy-price">
            <div>
              <span className="section-eyebrow">{dayName(0)}</span>
              <h3>
                <Trans>Bought for</Trans>
              </h3>
            </div>
            <strong>
              {week.purchasePrice ?? '—'}{' '}
              <small>
                {week.purchasePrice !== null
                  ? t({ message: 'bells', comment: 'The unit under a price' })
                  : notEntered}
              </small>
            </strong>
          </div>
          <table className="shared-price-table">
            <caption className="sr-only">
              <Trans>{name}’s reported prices, Monday through Saturday</Trans>
            </caption>
            <thead>
              <HalfDayHeadings scope="col" />
            </thead>
            <tbody>
              {DAY_INDEXES.map((index) => (
                <tr key={index}>
                  <th scope="row">{dayName(index + 1)}</th>
                  <td>
                    {week.prices[index * 2] ?? (
                      <span className="muted" aria-label={notEntered}>
                        —
                      </span>
                    )}
                  </td>
                  <td>
                    {week.prices[index * 2 + 1] ?? (
                      <span className="muted" aria-label={notEntered}>
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
                <dt>
                  <Trans>First purchase on their island</Trans>
                </dt>
                <dd>{week.firstBuy === null ? t`Unknown` : week.firstBuy ? t`Yes` : t`No`}</dd>
              </div>
              <div>
                <dt>
                  <Trans>Previous pattern</Trans>
                </dt>
                <dd>{week.previousPattern ? patternName(week.previousPattern) : t`Unknown`}</dd>
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
  const failed = !valid ? t`This week is not available.` : error?.key === key ? error.message : '';
  const disconnected = identity.status === 'offline' || identity.status === 'error';
  const loading = !shown && !failed && (!disconnected || checked !== key);
  const reveal = useReveal(loading);
  return (
    <main className="page shared-player-page" id="main-content">
      <Link className="text-link back-to-friends" to="/groups">
        <ArrowLeft size={16} />
        <Trans>Back to friends</Trans>
      </Link>
      {shown ? (
        <SharedWeekContent {...shown} className={reveal} />
      ) : failed ? (
        <div className="shared-error">
          <Notice>{failed}</Notice>
          {valid && (
            <Button secondary onClick={() => setReload((value) => value + 1)}>
              <Trans>Try again</Trans>
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
  const name = shown?.player.displayName ?? '';
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
        <Trans>Back to friends</Trans>
      </Link>
      <div className="page-heading">
        <div>
          <h1>{shown ? t`${name}’s history` : t`Shared history`}</h1>
          <p>
            <Trans>Previous weeks, shared with your groups.</Trans>
          </p>
        </div>
        {shown && (
          <Link className="text-link" to={`/players/${playerId}/weeks/${currentWeekStart()}`}>
            <Trans>This week</Trans> <ArrowRight size={16} />
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
                <Trans>Try again</Trans>
              </Button>
            </>
          )}
          {shown && shown.weeks.length > 0 && (
            <div className={`history-table-scroll ${reveal}`}>
              <table className="history-table">
                <caption className="sr-only">
                  <Trans>Shared past weekly prices</Trans>
                </caption>
                <thead>
                  <tr>
                    {historyColumns().map((column) => (
                      <th key={column} scope="col">
                        {column}
                      </th>
                    ))}
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
            <HistoryLoading label={t`Loading shared history…`} columns={historyColumns()} />
          )}
          {shown && !loading && !error && shown.weeks.length === 0 && (
            <div className="empty-history">
              <p>
                <Trans>No past weeks yet.</Trans>
              </p>
              <p className="muted">
                <Trans>Saved weeks will appear here when a new week starts.</Trans>
              </p>
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
              <Trans>Load older weeks</Trans>
            </Button>
          )}
        </>
      )}
    </main>
  );
}
