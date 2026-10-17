import { Fragment, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Bug, CalendarCheck, LayoutGrid, List, ShoppingBasket, Store, Trophy } from 'lucide-react';
import { i18n } from '@lingui/core';
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
  type LedgerTotals,
  type LedgerWeek,
} from '../shared/ledger';
import type { OwnWeekRecord } from '../shared/week';
import { dayShortName } from './advice';
import { useHistory } from './data/use-history';
import { useLedger } from './data/use-ledger';
import { BellBag, Turnip } from './icons';
import {
  average,
  bells,
  Button,
  dateFromWeek,
  Loading,
  messageOf,
  Notice,
  Placeholder,
  signedBells,
  useApp,
  useReveal,
  weekLabel,
} from './ui';
import './history.css';

/** Cards show each week's prices as a little chart; the list keeps a week to one row. */
type Layout = 'cards' | 'list';

/** All-time profit: every finished week's result, plus this week's so far, and how it went. */
function ProfitSummary({ weeks, currentWeek }: { weeks: LedgerWeek[]; currentWeek: string }) {
  const id = useId();
  const traded = weeks.filter((week) => week.weekStart <= currentWeek);
  const overall = overallProfit(weeks, currentWeek);
  const best = traded
    .filter((week) => week.weekStart < currentWeek)
    .reduce<LedgerWeek | null>(
      (top, week) => (!top || weekResult(week) > weekResult(top) ? week : top),
      null,
    );
  const sold = traded.reduce((total, week) => total + week.sold, 0);
  return (
    <section className="profit-summary" aria-labelledby={`${id}-title`}>
      <div className={`profit-total${overall < 0 ? ' is-loss' : ''}`}>
        <span className="profit-icon">
          <BellBag size={30} aria-hidden="true" />
        </span>
        <div>
          <h2 id={`${id}-title`}>
            <Trans>All-time profit</Trans>
          </h2>
          <p className="profit-value">{signedBells(overall)}</p>
        </div>
      </div>
      <dl className="profit-stats">
        {best && (
          <div className="profit-best">
            <dt>
              <Trophy size={16} aria-hidden="true" />
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
            <CalendarCheck size={16} aria-hidden="true" />
            <Trans>Weeks traded</Trans>
          </dt>
          <dd className="profit-stat">{traded.length}</dd>
        </div>
        <div>
          <dt>
            <Turnip size={16} aria-hidden="true" />
            <Trans>Turnips sold</Trans>
          </dt>
          <dd className="profit-stat">{bells(sold)}</dd>
        </div>
      </dl>
    </section>
  );
}

/** A little calendar page for the week, topped in the colour of its result. */
function WeekTile({
  weekStart,
  tone,
  current,
}: {
  weekStart: string;
  tone: 'up' | 'down' | 'even';
  current: boolean;
}) {
  const start = dateFromWeek(weekStart);
  const end = dateFromWeek(weekStart, 6);
  const label = weekLabel(weekStart);
  return (
    <Link
      to={current ? '/' : `/weeks/${weekStart}`}
      className={`week-tile week-${tone}`}
      aria-label={label}
      title={label}
    >
      <span className="week-tile-month">{i18n.date(start, { month: 'short' })}</span>
      <span className="week-tile-days">
        {i18n.number(start.getDate())}–{i18n.number(end.getDate())}
      </span>
    </Link>
  );
}

/**
 * Average prices and turnip counts, each value marked by an icon and named for screen readers.
 * Rotted turnips come last, so on a narrow row they are what moves to a second line. This
 * week's unsold turnips are still held, not rotted.
 */
function WeekFigures({ totals, current }: { totals: LedgerTotals; current: boolean }) {
  const cost = averageCost(totals);
  const sale = averageSale(totals);
  const rotted = current ? 0 : unsold(totals);
  return (
    <dl className="week-figures">
      <div className="week-figure">
        <dt className="sr-only">
          <Trans>
            Bought for<span className="sr-only">, average per turnip</span>
          </Trans>
        </dt>
        <dd>
          <ShoppingBasket size={16} aria-hidden="true" />
          {cost === null ? '—' : average(cost)}
        </dd>
      </div>
      <div className="week-figure">
        <dt className="sr-only">
          <Trans>
            Sold for<span className="sr-only">, average per turnip</span>
          </Trans>
        </dt>
        <dd>
          <Store size={16} aria-hidden="true" />
          {sale === null ? '—' : average(sale)}
        </dd>
      </div>
      <div className="week-figure">
        <dt className="sr-only">
          <Trans>Turnips</Trans>
        </dt>
        <dd>
          <Turnip size={16} aria-hidden="true" />
          {bells(totals.bought)}
        </dd>
      </div>
      {rotted > 0 && (
        <div className="week-figure week-rotted">
          <dt className="sr-only">
            <Trans>Rotted</Trans>
          </dt>
          <dd>
            <Bug size={14} aria-hidden="true" />
            {bells(rotted)}
          </dd>
        </div>
      )}
    </dl>
  );
}

/** The week's twelve prices: gold where you sold, with a dashed line at what you paid. */
function WeekChart({ week }: { week: OwnWeekRecord }) {
  const paid = averageCost(totalsOf(week.trades)) ?? week.purchasePrice;
  // A sale logged without that half-day's price still shows, at the price it fetched.
  const sales = new Map<number, number>();
  for (const trade of week.trades)
    if (trade.kind === 'sell')
      sales.set(trade.slot, Math.max(trade.price, sales.get(trade.slot) ?? 0));
  // Ordinary weeks share a 200-bell scale, so they compare; a spike gets the whole height.
  const scale = Math.max(
    200,
    paid ?? 0,
    ...week.prices.map((price) => price ?? 0),
    ...sales.values(),
  );
  const height = (value: number) => `${Math.max(4, (value / scale) * 100)}%`;
  return (
    <div className="week-chart" aria-hidden="true">
      <div className="week-chart-bars">
        {week.prices.map((price, slot) => {
          const value = price ?? sales.get(slot) ?? null;
          return (
            <span
              key={slot}
              className={`week-chart-bar${sales.has(slot) ? ' is-sold' : ''}${value === null ? ' is-empty' : ''}`}
              style={value === null ? undefined : { height: height(value) }}
            />
          );
        })}
        {paid !== null && <span className="week-chart-paid" style={{ bottom: height(paid) }} />}
      </div>
      <div className="week-chart-days">
        {[1, 2, 3, 4, 5, 6].map((day) => (
          <span key={day}>{dayShortName(day)}</span>
        ))}
      </div>
    </div>
  );
}

/** A past week, or this week once a sale gives it a result so far. */
function HistoryWeek({
  week,
  layout,
  current,
}: {
  week: OwnWeekRecord;
  layout: Layout;
  current: boolean;
}) {
  const totals = totalsOf(week.trades);
  const traded = week.trades.length > 0;
  // Turnips still held this week don't count yet, as in the all-time profit.
  const result = current ? madeSoFar(totals) : weekResult(totals);
  return (
    <li className={layout === 'cards' ? 'week-card' : 'week-row'}>
      <WeekTile
        weekStart={week.weekStart}
        tone={!traded || result === 0 ? 'even' : result > 0 ? 'up' : 'down'}
        current={current}
      />
      {traded ? (
        <dl className="week-result">
          {current ? (
            <dt className="week-so-far">
              <Trans>Made so far</Trans>
            </dt>
          ) : (
            <dt className="sr-only">
              <Trans>Profit</Trans>
            </dt>
          )}
          <dd className={result < 0 ? 'bells-down' : 'bells-up'}>{signedBells(result)}</dd>
        </dl>
      ) : (
        <span className="week-result" aria-hidden="true">
          —
        </span>
      )}
      {layout === 'cards' && <WeekChart week={week} />}
      {traded ? (
        <WeekFigures totals={totals} current={current} />
      ) : (
        <p className="week-idle">
          <Trans>No turnips logged.</Trans>
        </p>
      )}
    </li>
  );
}

/** What the icons stand for; in the list on wide screens, it heads the columns. */
function WeekKey({ layout }: { layout: Layout }) {
  return (
    <div className={`week-key key-${layout}`} aria-hidden="true">
      <span className="key-week" />
      <span>
        <ShoppingBasket size={15} />
        {layout === 'cards' && <i className="key-paid" />}
        {t`Bought for`}
      </span>
      <span>
        <Store size={15} />
        {layout === 'cards' && <i className="key-sold" />}
        {t`Sold for`}
      </span>
      <span>
        <Turnip size={15} />
        {t`Turnips`}
      </span>
      <span className="key-rotted">
        <Bug size={15} />
        {t`Rotted`}
      </span>
      <span className="key-profit">{t`Profit`}</span>
    </div>
  );
}

function WeeksLoading({ layout }: { layout: Layout }) {
  return (
    <Loading label={t`Loading saved weeks…`}>
      <ul className={layout === 'cards' ? 'week-cards' : 'week-list'}>
        {[0, 1, 2].map((row) => (
          <li key={row} className={layout === 'cards' ? 'week-card' : 'week-row'}>
            <Placeholder className="week-tile-placeholder" />
            <span className="week-result">
              <Placeholder width="4.5em" />
            </span>
            {layout === 'cards' && <Placeholder className="placeholder-block week-chart" />}
            <span className="week-figures">
              <Placeholder width="9em" />
            </span>
          </li>
        ))}
      </ul>
    </Loading>
  );
}

/** Weeks of the current year come first, unlabelled; earlier years get a heading. */
function byYear(weeks: OwnWeekRecord[]): { year: string; weeks: OwnWeekRecord[] }[] {
  const groups: { year: string; weeks: OwnWeekRecord[] }[] = [];
  for (const week of weeks) {
    const year = week.weekStart.slice(0, 4);
    if (groups.at(-1)?.year === year) groups.at(-1)!.weeks.push(week);
    else groups.push({ year, weeks: [week] });
  }
  return groups;
}

export function History() {
  const identity = useApp();
  const owner = identity.session?.player.id ?? null;
  const ledger = useLedger(owner, identity.status === 'ready');
  const currentWeek = currentWeekStart();
  const [layout, setLayout] = useState<Layout>('cards');
  const offline = identity.status === 'offline' || identity.status === 'error';
  const history = useHistory(owner, identity.status === 'ready', currentWeek);
  const { weeks, nextCursor } = history;
  // Until a list arrives from this device or the server, there is nothing to show yet.
  const waiting =
    (owner !== null && !history.hydrated) ||
    history.loading ||
    (!offline && !history.listed && !history.error);
  const reveal = useReveal(waiting && weeks.length === 0);
  const groups = useMemo(() => byYear(weeks), [weeks]);
  const cardsLabel = t({ message: 'Cards', comment: 'History layout: a card for each week' });
  const listLabel = t({ message: 'List', comment: 'History layout: a row for each week' });
  return (
    <main className={`page history-page history-${layout}`} id="main-content">
      <div className="page-heading">
        <div>
          <h1>
            <Trans>History</Trans>
          </h1>
        </div>
        <div
          className="segmented-control layout-toggle"
          role="group"
          aria-label={t({
            message: 'Layout',
            comment: 'Switches History between cards and a list',
          })}
        >
          <button
            type="button"
            aria-pressed={layout === 'cards'}
            aria-label={cardsLabel}
            title={cardsLabel}
            onClick={() => setLayout('cards')}
          >
            <LayoutGrid size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-pressed={layout === 'list'}
            aria-label={listLabel}
            title={listLabel}
            onClick={() => setLayout('list')}
          >
            <List size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      {ledger && ledger.length > 0 && <ProfitSummary weeks={ledger} currentWeek={currentWeek} />}
      {history.error !== null && (
        <>
          <Notice>{messageOf(history.error)}</Notice>
          <Button secondary onClick={history.retry}>
            <Trans>Retry history</Trans>
          </Button>
        </>
      )}
      {weeks.length > 0 && (
        <section className={`history-weeks ${reveal}`} aria-label={t`Past weeks and their profit`}>
          <WeekKey layout={layout} />
          {groups.map((group) => (
            <Fragment key={group.year}>
              {group.year !== currentWeek.slice(0, 4) && (
                <h2 className="history-year">
                  {i18n.date(dateFromWeek(group.weeks[0].weekStart), { year: 'numeric' })}
                </h2>
              )}
              <ul className={layout === 'cards' ? 'week-cards' : 'week-list'}>
                {group.weeks.map((week) => (
                  <HistoryWeek
                    key={week.weekStart}
                    week={week}
                    layout={layout}
                    current={week.weekStart === currentWeek}
                  />
                ))}
              </ul>
            </Fragment>
          ))}
        </section>
      )}
      {waiting && weeks.length === 0 && <WeeksLoading layout={layout} />}
      {!waiting && history.listed && history.error === null && weeks.length === 0 && (
        <div className="empty-history">
          <p>
            <Trans>No past weeks yet.</Trans>
          </p>
          <p className="muted">
            <Trans>This week will appear here once you sell turnips.</Trans>
          </p>
          <Link to="/">
            <Trans>Enter this week’s prices</Trans>
          </Link>
        </div>
      )}
      {nextCursor && identity.status === 'ready' && (
        <Button
          secondary
          busy={history.loading}
          onClick={() => {
            void history.more();
          }}
        >
          <Trans>Load older weeks</Trans>
        </Button>
      )}
      {/* Offline, the weeks saved on this device show; older ones wait for a connection. */}
      {offline && !waiting && (!history.listed || nextCursor) && (
        <div className="sync-message">
          <p>
            {history.listed ? (
              <Trans>Connect to load older weeks.</Trans>
            ) : (
              <Trans>Connect to load your saved history.</Trans>
            )}
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
      )}
    </main>
  );
}
