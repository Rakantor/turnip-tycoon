import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Coins } from 'lucide-react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { currentWeekStart } from '../shared/calendar';
import {
  averageCost,
  averageSale,
  madeSoFar,
  overallProfit,
  totalsOf,
  unsold,
  weekResult,
  type LedgerWeek,
} from '../shared/ledger';
import type { OwnWeekRecord } from '../shared/week';
import { request } from './data/api';
import { ownWeek, type StoredWeek } from './data/database';
import { useLedger } from './data/use-ledger';
import { HistoryLoading } from './history-loading';
import {
  average,
  bells,
  Button,
  messageOf,
  Notice,
  signedBells,
  useApp,
  useReveal,
  weekLabel,
} from './ui';

interface HistoryResponse {
  weeks: StoredWeek[];
  nextCursor: string | null;
}

/** All-time profit: every finished week's result, plus this week's so far. */
function ProfitSummary({ weeks, currentWeek }: { weeks: LedgerWeek[]; currentWeek: string }) {
  const id = useId();
  const finished = weeks.filter((week) => week.weekStart < currentWeek);
  const thisWeek = weeks.find((week) => week.weekStart === currentWeek);
  const overall = overallProfit(weeks, currentWeek);
  const best = finished.reduce<LedgerWeek | null>(
    (top, week) => (!top || weekResult(week) > weekResult(top) ? week : top),
    null,
  );
  const rotted = finished.reduce((total, week) => total + unsold(week), 0);
  const soFar = thisWeek ? madeSoFar(thisWeek) : 0;
  const thisWeekSoFar = signedBells(soFar);
  return (
    <section className="profit-summary" aria-labelledby={`${id}-title`}>
      <div className="profit-total">
        <span className="profit-icon">
          <Coins size={28} aria-hidden="true" />
        </span>
        <div>
          <h2 id={`${id}-title`}>
            <Trans>All-time profit</Trans>
          </h2>
          <p className={`profit-value ${overall < 0 ? 'bells-down' : 'bells-up'}`}>
            {signedBells(overall)}
          </p>
          <p className="profit-note">
            {soFar
              ? t({
                  message: `bells, with this week’s ${thisWeekSoFar} so far`,
                  comment: 'Under the all-time profit, which is in bells',
                })
              : t({ message: 'bells', comment: 'The unit under a price' })}
          </p>
        </div>
      </div>
      <dl className="profit-stats">
        <div>
          <dt>
            <Trans>Weeks traded</Trans>
          </dt>
          <dd className="profit-stat">
            {weeks.filter((week) => week.weekStart <= currentWeek).length}
          </dd>
        </div>
        {best && (
          <div>
            <dt>
              <Trans>Best week</Trans>
            </dt>
            <dd className={`profit-stat ${weekResult(best) < 0 ? 'bells-down' : 'bells-up'}`}>
              {signedBells(weekResult(best))}
            </dd>
            <dd className="profit-note">{weekLabel(best.weekStart)}</dd>
          </div>
        )}
        <div>
          <dt>
            <Trans>Turnips rotted</Trans>
          </dt>
          <dd className="profit-stat">{bells(rotted)}</dd>
        </div>
      </dl>
    </section>
  );
}

export function History() {
  const identity = useApp();
  const owner = identity.session?.player.id ?? null;
  const ledger = useLedger(owner, identity.status === 'ready');
  const currentWeek = currentWeekStart();
  const [weeks, setWeeks] = useState<OwnWeekRecord[]>([]);
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
        setWeeks(result.weeks.map(ownWeek));
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
  const reveal = useReveal(loading && weeks.length === 0);
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
        ...result.weeks
          .filter((week) => !current.some((entry) => entry.weekStart === week.weekStart))
          .map(ownWeek),
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
          <h1>
            <Trans>History</Trans>
          </h1>
        </div>
        <Link className="text-link" to="/">
          <Trans>This week</Trans> <ArrowRight size={16} />
        </Link>
      </div>
      {ledger && ledger.length > 0 && <ProfitSummary weeks={ledger} currentWeek={currentWeek} />}
      {identity.status === 'offline' || identity.status === 'error' ? (
        <div className="sync-message">
          <p>
            <Trans>Connect to load your saved history.</Trans>
          </p>
          <Button
            secondary
            onClick={() => {
              void identity.retry();
            }}
          >
            <Trans>Try again</Trans>
          </Button>
        </div>
      ) : (
        <>
          {error && (
            <>
              <Notice>{error}</Notice>
              <Button secondary onClick={() => setRefreshCount((count) => count + 1)}>
                <Trans>Retry history</Trans>
              </Button>
            </>
          )}
          {weeks.length > 0 && (
            <div className={`history-table-scroll ${reveal}`}>
              {/* Explicit roles keep the table readable when phones stack its rows. */}
              <table className="history-table history-ledger" role="table">
                <caption className="sr-only">
                  <Trans>Past weeks and their profit</Trans>
                </caption>
                <thead role="rowgroup">
                  <tr role="row">
                    <th scope="col" role="columnheader">
                      <Trans>Week</Trans>
                    </th>
                    <th scope="col" role="columnheader">
                      <Trans>
                        Bought for<span className="sr-only">, average per turnip</span>
                      </Trans>
                    </th>
                    <th scope="col" role="columnheader">
                      <Trans>
                        Sold for<span className="sr-only">, average per turnip</span>
                      </Trans>
                    </th>
                    <th scope="col" role="columnheader">
                      <Trans>Turnips</Trans>
                    </th>
                    <th scope="col" role="columnheader" className="history-profit">
                      <Trans>Profit</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {weeks.map((week) => {
                    const totals = totalsOf(week.trades);
                    const cost = averageCost(totals);
                    const sale = averageSale(totals);
                    const rotted = unsold(totals);
                    const result = weekResult(totals);
                    const rottedCount = bells(rotted);
                    return (
                      <tr key={week.weekStart} role="row">
                        <th scope="row" role="rowheader">
                          <Link to={`/weeks/${week.weekStart}`}>{weekLabel(week.weekStart)}</Link>
                        </th>
                        <td role="cell" data-label={t`Bought for`}>
                          {cost === null ? '—' : average(cost)}
                        </td>
                        <td role="cell" data-label={t`Sold for`}>
                          {sale === null ? '—' : average(sale)}
                        </td>
                        <td role="cell" data-label={t`Turnips`}>
                          {totals.bought ? bells(totals.bought) : '—'}
                          {rotted > 0 && (
                            <span className="history-rotted">
                              <Trans>{rottedCount} rotted</Trans>
                            </span>
                          )}
                        </td>
                        <td
                          role="cell"
                          className={`history-profit ${
                            week.trades.length ? (result < 0 ? 'bells-down' : 'bells-up') : ''
                          }`}
                        >
                          {week.trades.length ? signedBells(result) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {loading && weeks.length === 0 && (
            <HistoryLoading
              label={t`Loading saved weeks…`}
              columns={[t`Week`, t`Bought for`, t`Sold for`, t`Turnips`, t`Profit`]}
            />
          )}
          {!loading && !error && weeks.length === 0 && (
            <div className="empty-history">
              <p>
                <Trans>No past weeks yet.</Trans>
              </p>
              <p className="muted">
                <Trans>This week will appear here when a new week starts.</Trans>
              </p>
              <Link to="/">
                <Trans>Enter this week’s prices</Trans>
              </Link>
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
              <Trans>Load older weeks</Trans>
            </Button>
          )}
        </>
      )}
    </main>
  );
}
