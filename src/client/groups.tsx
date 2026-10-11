import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowRight, Plane, UserPlus, Users } from 'lucide-react';
import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { predictWeek, type PredictionResult } from '../prediction';
import { currentSlot, currentWeekStart } from '../shared/calendar';
import type { SharedPlayerWeek } from '../shared/groups';
import type { WeekRecord } from '../shared/week';
import { oddsPercent, patternName, percent, slotShortName } from './advice';
import { useGroups } from './data/use-groups';
import { useWeek } from './data/use-week';
import { GroupPriceTable } from './group-price-table';
import { WaitingForYou, YourPeople } from './people';
import { PlayerAvatar } from './player-avatar';
import {
  afterClosing,
  beatsBy,
  groupOdds,
  islandReason,
  notCountedNote,
  type ForecastMember,
  type GroupOdds,
} from './odds';
import { Button, Loading, Notice, Placeholder, useApp, useReveal, weekLabel } from './ui';
import './groups.css';

type GroupData = ReturnType<typeof useGroups>;
/** The half-days compared: 0 is Sunday's buy price, then Monday AM onward. */
function periodName(period: number): string {
  return period === 0 ? t`Sunday buy price` : slotShortName(period - 1);
}
function timesPaid(ratio: number): string {
  return i18n.number(ratio, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function initialPeriod(): number {
  return (currentSlot() ?? -1) + 1;
}
function reportedPrice(member: SharedPlayerWeek, period: number): number | null {
  return period === 0 ? member.week.purchasePrice : (member.week.prices[period - 1] ?? null);
}
/** Highest selling price first; on Sunday the cheapest purchase price is best. */
function byPeriod<T extends SharedPlayerWeek>(players: T[], period: number): T[] {
  return [...players].sort((left, right) => {
    const a = reportedPrice(left, period);
    const b = reportedPrice(right, period);
    if (a === null)
      return b === null ? left.player.displayName.localeCompare(right.player.displayName) : 1;
    if (b === null) return -1;
    return period === 0 ? a - b : b - a;
  });
}
/** Your island as this device has it, which can be newer than the board's saved copy. */
function withOwnWeek<T extends SharedPlayerWeek>(
  players: T[],
  owner: string,
  week: WeekRecord | null | undefined,
): T[] {
  if (!week) return players;
  return players.map((member) => (member.player.id === owner ? { ...member, week } : member));
}
function islandName(member: SharedPlayerWeek, owner: string): string {
  const name = member.player.displayName;
  return member.player.id === owner ? t`Your island` : t`${name}’s island`;
}
function weekLink(member: SharedPlayerWeek, owner: string): string {
  return member.player.id === owner
    ? '/'
    : `/players/${member.player.id}/weeks/${member.week.weekStart}`;
}
function ForecastSummary({ prediction }: { prediction: PredictionResult }) {
  if (prediction.status === 'needs-input')
    return (
      <span className="member-forecast forecast-none">
        <Trans>No forecast yet</Trans>
      </span>
    );
  if (prediction.status === 'inconsistent')
    return (
      <span className="member-forecast forecast-unmatched">
        <Trans>Prices don’t match a pattern</Trans>
      </span>
    );
  const likely = prediction.patterns[0];
  return (
    <span className={`member-forecast${likely.id === 'decreasing' ? ' forecast-falling' : ''}`}>
      {patternName(likely.id)} · {percent(likely.probability)}
    </span>
  );
}

/** Upper bound shared by every sparkline in a list, so heights compare across players. */
function sparkScale(members: ForecastMember[]): number {
  return Math.max(
    200,
    ...members.flatMap(({ week, prediction }) => [
      ...week.prices.map((price) => price ?? 0),
      ...(prediction.status === 'possible' ? prediction.slots.map((slot) => slot.max) : []),
    ]),
  );
}

/** Twelve tiny columns: solid for reported prices, a floating range for forecasts. */
function PriceSparkline({
  week,
  prediction,
  scale,
}: {
  week: WeekRecord;
  prediction: PredictionResult;
  scale: number;
}) {
  const height = (value: number) => `${Math.min(100, (value / scale) * 100)}%`;
  return (
    <span className="sparkline" aria-hidden="true">
      {week.prices.map((price, index) => {
        const range = prediction.status === 'possible' ? prediction.slots[index] : null;
        return (
          <span key={index} className="spark-column">
            {price !== null ? (
              <span className="spark-reported" style={{ height: height(price) }} />
            ) : range ? (
              <span
                className="spark-predicted"
                style={{ bottom: height(range.min), height: height(range.max - range.min) }}
              />
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/** Inside the best-price card: the chance someone beats it before Saturday closes. */
function BeatOdds({ odds, slot }: { odds: GroupOdds; slot: number }) {
  const note = notCountedNote(odds);
  const price = odds.price;
  return (
    <div className="beat-odds">
      <p className="beat-odds-head">
        <strong>{odds.certain ? t`Certain` : oddsPercent(odds.chance)}</strong>
        <span>{beatsBy(odds, slot)}</span>
      </p>
      <span className="beat-meter" aria-hidden="true">
        <span style={{ width: `${odds.chance * 100}%` }} />
      </span>
      <ul className="beat-list" aria-label={t`Chance for each island`}>
        {odds.islands.map((island) => (
          <li key={island.member.player.id}>
            <PlayerAvatar name={island.member.player.displayName} small />
            <span className="beat-who">
              <span className="beat-name">
                {island.self ? t`You` : island.member.player.displayName}
              </span>
              <span className="beat-why">{islandReason(island)}</span>
              {island.alreadyAbove !== null && island.alreadyAbove > 0 && (
                <span className="beat-nudge">
                  {alreadyAbove(slot, oddsPercent(island.alreadyAbove), price)}
                </span>
              )}
            </span>
            <span className="beat-chance">{oddsPercent(island.chance)}</span>
          </li>
        ))}
      </ul>
      {note && <p className="beat-note">{note}</p>}
    </div>
  );
}

function alreadyAbove(slot: number, chance: string, price: number): string {
  return slot % 2
    ? t`No price yet this afternoon. ${chance} chance it’s already above ${price}.`
    : t`No price yet this morning. ${chance} chance it’s already above ${price}.`;
}

function RightNow({
  players,
  owner,
  period,
  nowPeriod,
  closed,
}: {
  players: SharedPlayerWeek[];
  owner: string;
  /** The half-day compared: 0 is Sunday's buy price, then Monday AM onward. */
  period: number;
  nowPeriod: number;
  /** After 10 PM, tonight's half-day is over. */
  closed: boolean;
}) {
  const members = useMemo(
    () => players.map((member) => ({ ...member, prediction: predictWeek(member.week) })),
    [players],
  );
  const scale = useMemo(() => sparkScale(members), [members]);
  const sorted = byPeriod(members, period);
  const reported = sorted.length > 0 && reportedPrice(sorted[0], period) !== null;
  // Odds look ahead from now, so they only fit the current selling half-day.
  const odds =
    period === nowPeriod && period > 0 ? groupOdds(members, owner, period - 1, closed) : null;
  // Until anyone shares this half-day's price, the card shows the latest one shared.
  const shown = reported ? period : odds ? odds.priceSlot + 1 : null;
  const best = reported ? sorted[0] : (odds?.holder ?? null);
  const yourPurchase = members.find((member) => member.player.id === owner)?.week.purchasePrice;
  const bestPrice = best && shown !== null ? reportedPrice(best, shown) : null;
  const ratio =
    best && bestPrice !== null && period > 0 && yourPurchase ? bestPrice / yourPurchase : null;
  const shownName = periodName(shown ?? period);
  const tag =
    shown === 0
      ? t`Cheapest Sunday price`
      : shown === nowPeriod && !closed
        ? period % 2
          ? t`Best price right now · until noon`
          : t`Best price right now · until 10 PM`
        : t`Best ${shownName} price`;
  const name = best?.player.displayName ?? '';
  const times = ratio === null ? '' : timesPaid(ratio);
  const periodLabel = periodName(period);
  return (
    <div className="right-now">
      {!reported && (
        <p className="right-now-empty">
          {period === 0
            ? t`Nobody has shared a Sunday buy price yet.`
            : t`Nobody has shared a ${periodLabel} price yet.`}
        </p>
      )}
      {best && bestPrice !== null && shown !== null && (
        <section className="best-price-card" aria-label={tag}>
          <span className="best-price-tag">
            <Plane size={14} aria-hidden="true" />
            {tag}
          </span>
          <div className="best-price-main">
            <PlayerAvatar name={best.player.displayName} />
            <div className="best-price-identity">
              <strong>{islandName(best, owner)}</strong>
              <ForecastSummary prediction={best.prediction} />
            </div>
            <div className="best-price-value">
              {bestPrice}
              <small>
                <Trans comment="The unit under a price">bells</Trans>
              </small>
            </div>
          </div>
          <div className="best-price-detail">
            <p>
              {ratio === null
                ? shown === 0
                  ? t`Lowest buy price among your friends.`
                  : t`Highest ${shownName} price among your friends.`
                : best.player.id === owner
                  ? t`That’s ${times}× what you paid.`
                  : t`${times}× what you paid for yours.`}
            </p>
            <PriceSparkline week={best.week} prediction={best.prediction} scale={scale} />
          </div>
          {odds && <BeatOdds odds={odds} slot={period - 1} />}
          <Link className="button" to={weekLink(best, owner)}>
            {best.player.id === owner ? t`Open your week` : t`Open ${name}’s week`}
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </section>
      )}
      {/* Everyone stays listed, the best price included, for a quick overview. */}
      {sorted.length > 0 && (
        <>
          <h3 className="friend-list-heading">
            <Trans>Everyone</Trans>
          </h3>
          <ul className="friend-list">
            {sorted.map((member) => {
              const price = reportedPrice(member, period);
              const self = member.player.id === owner;
              return (
                <li key={member.player.id}>
                  <Link
                    className={`friend-row${self ? ' friend-row-self' : ''}`}
                    to={weekLink(member, owner)}
                  >
                    <PlayerAvatar name={member.player.displayName} />
                    <span className="friend-identity">
                      <span className="friend-name">
                        {member.player.displayName}
                        {self && (
                          <span className="you-label">
                            <Trans comment="A tag after your own name in a list">you</Trans>
                          </span>
                        )}
                      </span>
                      <ForecastSummary prediction={member.prediction} />
                    </span>
                    <PriceSparkline
                      week={member.week}
                      prediction={member.prediction}
                      scale={scale}
                    />
                    <span className="friend-price">
                      <span className="reported-price">{price ?? '—'}</span>
                      <span className="friend-period">
                        {price === null ? t`Not entered` : periodLabel}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function ConnectionMessage({ data }: { data: GroupData }) {
  const identity = useApp();
  if (data.status === 'offline' && !data.players.length)
    return (
      <div className="group-connection">
        <p>
          <Trans>Connect to see your friends’ shared prices.</Trans>
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
  if (data.error)
    return (
      <div className="group-connection">
        <Notice>{data.error}</Notice>
        <Button
          secondary
          onClick={() => {
            void data.retry();
          }}
        >
          <Trans>Try again</Trans>
        </Button>
      </div>
    );
  return null;
}

function FriendsPostcardLoading() {
  return (
    <Loading label={t`Loading your friends…`}>
      <div className="friends-postcard">
        <span className="friends-postcard-icon">
          <Plane size={26} />
        </span>
        <div className="friends-postcard-text">
          <p className="friends-postcard-title">
            <Placeholder width="24em" />
          </p>
          <p>
            <Placeholder width="20em" />
          </p>
        </div>
        <Placeholder className="placeholder-button postcard-button-placeholder" />
      </div>
    </Loading>
  );
}

function IslandBoardLoading() {
  return (
    <Loading label={t`Loading your friends…`} className="friends-comparison friends-board">
      <div className="friends-toolbar">
        <div className="group-filters">
          <Placeholder className="placeholder-control" width={120} />
          <Placeholder className="placeholder-control" width={150} />
        </div>
      </div>
      <div className="view-bar">
        <Placeholder className="placeholder-control view-toggle-placeholder" />
      </div>
      <div className="right-now">
        <div className="best-price-card">
          <Placeholder className="best-price-tag-placeholder" />
          <div className="best-price-main">
            <Placeholder round className="best-price-avatar-placeholder" />
            <div className="best-price-identity">
              <strong>
                <Placeholder width="8em" />
              </strong>
              <Placeholder className="member-forecast-placeholder" />
            </div>
            <div className="best-price-value">
              <Placeholder width="1.7em" />
            </div>
          </div>
          <div className="best-price-detail">
            <p>
              <Placeholder width="14em" />
            </p>
          </div>
          <Placeholder className="placeholder-button" width="100%" />
        </div>
        <h3 className="friend-list-heading">
          <Placeholder width="6em" />
        </h3>
        <ul className="friend-list">
          {[0, 1].map((index) => (
            <li key={index}>
              <div className="friend-row">
                <Placeholder round className="friend-avatar-placeholder" />
                <span className="friend-identity">
                  <span className="friend-name">
                    <Placeholder width="6em" />
                  </span>
                  <Placeholder className="member-forecast-placeholder" />
                </span>
                <span className="friend-price">
                  <span className="reported-price">
                    <Placeholder width="1.6em" />
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Loading>
  );
}

export function FriendsPanel({ weekStart, week }: { weekStart: string; week?: WeekRecord }) {
  const identity = useApp();
  const data = useGroups(weekStart, identity.session, identity.status);
  const owner = identity.session?.player.id ?? '';
  const players = withOwnWeek(data.players, owner, week);
  const period = initialPeriod();
  const self = players.find((member) => member.player.id === owner);
  const mine = self ? reportedPrice(self, period) : null;
  const purchase = self?.week.purchasePrice ?? null;
  const [bestOther] = byPeriod(
    players.filter(
      (member) => member.player.id !== owner && reportedPrice(member, period) !== null,
    ),
    period,
  );
  const other = bestOther ? reportedPrice(bestOther, period) : null;
  const friendCount = players.filter((member) => member.player.id !== owner).length;
  const loading = data.status === 'loading' && !players.length;
  const reveal = useReveal(loading);
  const name = bestOther?.player.displayName ?? '';
  const periodLabel = periodName(period);
  let headline: string;
  let detail: string;
  if (bestOther && other !== null && period === 0) {
    const cheaper = mine === null || other < mine;
    const saving = mine === null ? 0 : mine - other;
    headline = cheaper
      ? t`Daisy Mae is selling for ${other} on ${name}’s island`
      : t`Your ${mine} is the best Sunday deal among your friends`;
    detail = cheaper
      ? mine === null
        ? t`The lowest Sunday price among your friends.`
        : plural(saving, {
            one: 'That’s # bell cheaper than yours.',
            other: 'That’s # bells cheaper than yours.',
          })
      : t`Next best: ${other} on ${name}’s island.`;
  } else if (bestOther && other !== null && (mine === null || other > mine)) {
    headline = t`${name}’s island is buying at ${other}!`;
    const times = purchase ? timesPaid(other / purchase) : '';
    detail = purchase
      ? other >= purchase
        ? period % 2
          ? t`That’s ${times}× what you paid — fly over before noon.`
          : t`That’s ${times}× what you paid — fly over before 10 PM.`
        : t`That’s less than the ${purchase} you paid.`
      : t`The best ${periodLabel} price among your friends.`;
  } else if (bestOther && other !== null && mine !== null) {
    headline = t`Your ${mine} beats everyone right now!`;
    detail = t`Next best: ${other} on ${name}’s island.`;
  } else {
    headline =
      period === 0
        ? t`No friends have shared a Sunday buy price yet`
        : t`No friends have shared a ${periodLabel} price yet`;
    detail =
      friendCount === 0
        ? t`Share your friend code or group link to bring friends along.`
        : plural(friendCount, {
            one: '# friend shares prices with you. Check back later.',
            other: '# friends share prices with you. Check back later.',
          });
  }
  const received = data.requests.received;
  const requester = received[0]?.player.displayName ?? '';
  return (
    <section className="friends-panel" aria-labelledby="friends-panel-title">
      <h2 id="friends-panel-title" className="sr-only">
        <Trans>Friends’ prices</Trans>
      </h2>
      <ConnectionMessage data={data} />
      {loading && <FriendsPostcardLoading />}
      {received.length > 0 && (
        <div className={`friends-postcard friends-postcard-invite ${reveal}`}>
          <span className="friends-postcard-icon">
            <UserPlus size={26} aria-hidden="true" />
          </span>
          <div className="friends-postcard-text">
            <p className="friends-postcard-title">
              {received.length === 1
                ? t`${requester} wants to share prices with you`
                : plural(received.length, {
                    one: '# player wants to share prices with you',
                    other: '# players want to share prices with you',
                  })}
            </p>
            <p>
              <Trans>Accept on Friends to compare your prices and forecasts.</Trans>
            </p>
          </div>
          <Link className="button" to="/groups">
            <Trans>See friend requests</Trans> <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      )}
      {data.status === 'ready' &&
        !data.groups.length &&
        !data.friendIds.length &&
        !received.length && (
          <div className={`friends-postcard friends-postcard-invite ${reveal}`}>
            <span className="friends-postcard-icon">
              <Users size={26} aria-hidden="true" />
            </span>
            <div className="friends-postcard-text">
              <p className="friends-postcard-title">
                <Trans>A good price is better shared.</Trans>
              </p>
              <p>
                <Trans>Add friends or start a group to compare prices and forecasts.</Trans>
              </p>
            </div>
            <Link className="button" to="/groups">
              <Trans>Add friends</Trans> <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        )}
      {players.length > 0 && (
        <div className={`friends-postcard ${reveal}`}>
          <span className="friends-postcard-icon">
            <Plane size={26} aria-hidden="true" />
          </span>
          <div className="friends-postcard-text">
            <p className="friends-postcard-title">{headline}</p>
            <p>{detail}</p>
          </div>
          <Link className="button button-light" to="/groups">
            <Trans>See the island board</Trans> <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      )}
    </section>
  );
}

export function Groups() {
  const identity = useApp();
  const [params, setParams] = useSearchParams();
  const groupCode = params.get('code') ?? '';
  const inviteCode = params.get('invite') ?? '';
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const weekStart = currentWeekStart(now);
  // Compare is hidden for now, so the board always shows the current half-day.
  const period = (currentSlot(now) ?? -1) + 1;
  const { groupId } = useParams();
  const data = useGroups(weekStart, identity.session, identity.status);
  const [selectedGroup, setSelectedGroup] = useState(groupId ?? 'all');
  useEffect(() => setSelectedGroup(groupId ?? 'all'), [groupId]);
  const [view, setView] = useState<'now' | 'week'>('now');
  const owner = identity.session?.player.id ?? '';
  // The board's copy can be a minute old; your own prices come from this device.
  const own = useWeek(weekStart, identity.session, identity.status === 'ready');
  const shared = withOwnWeek(data.players, owner, own.stored ? own.week : null);
  const friendIds = new Set(data.friendIds);
  const existingSelection =
    (selectedGroup === 'friends' && friendIds.size > 0) ||
    data.groups.some((group) => group.id === selectedGroup)
      ? selectedGroup
      : 'all';
  // Your own island stays on the board whichever players are shown.
  const players =
    existingSelection === 'all'
      ? shared
      : existingSelection === 'friends'
        ? shared.filter((member) => member.player.id === owner || friendIds.has(member.player.id))
        : shared.filter((member) => member.groupIds.includes(existingSelection));
  const others = (list: SharedPlayerWeek[]) =>
    list.filter((member) => member.player.id !== owner).length;
  // Friends added by code fill the board too, with or without a group.
  const sharing = data.groups.length > 0 || friendIds.size > 0;
  const loading = data.status === 'loading' && !sharing;
  const reveal = useReveal(loading);
  const friendCode = identity.session?.player.friendCode;
  function closeLink(link: 'code' | 'invite', done?: string) {
    if (done) setNotice(done);
    const next = new URLSearchParams(params);
    next.delete(link);
    setParams(next, { replace: true });
  }
  /** On phones the invite card sits below the board; this brings it up. */
  function showInvite() {
    const card = document.getElementById('invite-friends');
    if (!card) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    card.querySelector<HTMLButtonElement>('.people-share .button')?.focus({ preventScroll: true });
  }
  return (
    <main className="page groups-page" id="main-content">
      <div className="page-heading">
        <div>
          <h1>
            <Trans>Friends</Trans>
          </h1>
          <p>{weekLabel(weekStart)}</p>
        </div>
        {friendCode && (
          <Button secondary className="people-jump" onClick={showInvite}>
            <UserPlus size={16} aria-hidden="true" />
            <Trans>Invite</Trans>
          </Button>
        )}
      </div>
      <ConnectionMessage data={data} />
      {notice && <Notice success>{notice}</Notice>}
      <div className={`friends-layout${sharing || loading ? '' : ' friends-layout-solo'}`}>
        <WaitingForYou
          className="friends-waiting"
          data={data}
          owner={owner}
          groupCode={groupCode}
          inviteCode={inviteCode}
          onClose={closeLink}
          onDone={setNotice}
        />
        {loading && <IslandBoardLoading />}
        {sharing && (
          <section
            className={`friends-comparison friends-board ${reveal}`}
            aria-label={t`Friends’ prices this week`}
          >
            <div className="friends-toolbar">
              <div className="group-filters" role="group" aria-label={t`Show players`}>
                <button
                  type="button"
                  aria-pressed={existingSelection === 'all'}
                  onClick={() => setSelectedGroup('all')}
                >
                  <Trans comment="Filter chip: everyone sharing prices with you">All</Trans>{' '}
                  <span>{others(shared)}</span>
                </button>
                {friendIds.size > 0 && (
                  <button
                    type="button"
                    aria-pressed={existingSelection === 'friends'}
                    onClick={() => setSelectedGroup('friends')}
                  >
                    <Trans>Friends</Trans> <span>{friendIds.size}</span>
                  </button>
                )}
                {data.groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    aria-pressed={existingSelection === group.id}
                    onClick={() => setSelectedGroup(group.id)}
                  >
                    {group.name}{' '}
                    <span>
                      {others(shared.filter((member) => member.groupIds.includes(group.id)))}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="view-bar">
              <div
                className="segmented-control view-toggle"
                role="group"
                aria-label={t`Price view`}
              >
                <button type="button" aria-pressed={view === 'now'} onClick={() => setView('now')}>
                  <Trans>Right now</Trans>
                </button>
                <button
                  type="button"
                  aria-pressed={view === 'week'}
                  onClick={() => setView('week')}
                >
                  <Trans>Full week</Trans>
                </button>
              </div>
              {/* Compare is hidden for now. To bring it back, keep a chosen period in state
                  (null meaning the current half-day), pass it to RightNow, and restore:
              {view === 'now' && (
                <label className="period-select">
                  Compare
                  <select value={period} onChange={(event) => setPeriod(Number(event.target.value))}>
                    {Array.from({ length: 13 }, (_, index) => (
                      <option key={index} value={index}>
                        {periodName(index)}
                      </option>
                    ))}
                  </select>
                </label>
              )} */}
            </div>
            {view === 'now' ? (
              <RightNow
                players={players}
                owner={owner}
                period={period}
                nowPeriod={period}
                closed={afterClosing(now)}
              />
            ) : (
              <GroupPriceTable players={players} owner={owner} currentSlot={currentSlot(now)} />
            )}
          </section>
        )}
        {friendCode && (
          <YourPeople
            className={`friends-people ${reveal}`}
            data={data}
            owner={owner}
            friendCode={friendCode}
          />
        )}
      </div>
    </main>
  );
}
