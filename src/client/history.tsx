import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { currentWeekStart } from '../shared/calendar';
import type { WeekRecord } from '../shared/week';
import { request } from './data/api';
import { Button, messageOf, Notice, useApp, weekLabel } from './ui';

interface HistoryResponse {
  weeks: WeekRecord[];
  nextCursor: string | null;
}

export function History() {
  const identity = useApp();
  const [weeks, setWeeks] = useState<WeekRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);
  useEffect(() => {
    if (identity.status !== 'ready' || !identity.session) return;
    let current = true;
    setLoading(true);
    setError('');
    void request<HistoryResponse>(`/weeks?before=${currentWeekStart()}&limit=20`)
      .then((result) => {
        if (!current) return;
        setWeeks(result.weeks);
        setNextCursor(result.nextCursor);
      })
      .catch((error: unknown) => {
        if (current) setError(messageOf(error));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [identity.status, identity.session, refreshCount]);
  async function more() {
    if (!nextCursor) return;
    setLoading(true);
    setError('');
    try {
      const result = await request<HistoryResponse>(
        `/weeks?before=${encodeURIComponent(nextCursor)}&limit=20`,
      );
      setWeeks((current) => [
        ...current,
        ...result.weeks.filter(
          (week) => !current.some((entry) => entry.weekStart === week.weekStart),
        ),
      ]);
      setNextCursor(result.nextCursor);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="page history-page" id="main-content">
      <div className="page-heading">
        <div>
          <h1>History</h1>
        </div>
        <Link className="text-link" to="/">
          This week <ArrowRight size={16} />
        </Link>
      </div>
      {identity.status === 'offline' || identity.status === 'error' ? (
        <div className="sync-message">
          <p>Connect to load your saved history.</p>
          <Button
            secondary
            onClick={() => {
              void identity.retry();
            }}
          >
            Try again
          </Button>
        </div>
      ) : (
        <>
          {error && (
            <>
              <Notice>{error}</Notice>
              <Button secondary onClick={() => setRefreshCount((count) => count + 1)}>
                Retry history
              </Button>
            </>
          )}
          {weeks.length > 0 && (
            <div className="history-table-scroll">
              <table className="history-table">
                <caption className="sr-only">Past weekly prices</caption>
                <thead>
                  <tr>
                    <th scope="col">Week</th>
                    <th scope="col">Bought for</th>
                    <th scope="col">Best entered</th>
                    <th scope="col">Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week) => {
                    const prices = week.prices.filter((price): price is number => price !== null);
                    return (
                      <tr key={week.weekStart}>
                        <th scope="row">
                          <Link to={`/weeks/${week.weekStart}`}>{weekLabel(week.weekStart)}</Link>
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
              Loading saved weeks…
            </p>
          )}
          {!loading && !error && weeks.length === 0 && (
            <div className="empty-history">
              <p>No past weeks yet.</p>
              <p className="muted">This week will appear here when a new week starts.</p>
              <Link to="/">Enter this week’s prices</Link>
            </div>
          )}
          {nextCursor && (
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
