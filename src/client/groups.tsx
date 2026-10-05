import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowRight, Check, Copy, Plane, Plus, Share2, Users, X } from 'lucide-react';
import { predictWeek, type PredictionResult } from '../prediction';
import { currentSlot, currentWeekStart } from '../shared/calendar';
import type { GroupSummary, SharedPlayerWeek } from '../shared/groups';
import type { WeekRecord } from '../shared/week';
import { oddsPercent } from './advice';
import { useGroups } from './data/use-groups';
import { useWeek } from './data/use-week';
import { GroupPriceTable } from './group-price-table';
import {
  deadline,
  groupOdds,
  islandReason,
  notCountedNote,
  partOfDay,
  type ForecastMember,
  type GroupOdds,
} from './odds';
import {
  Button,
  Field,
  Loading,
  messageOf,
  Notice,
  Placeholder,
  useApp,
  useReveal,
  weekLabel,
} from './ui';
import { appUrl } from './urls';
import { clearWelcomeJoin, isWelcomeJoin } from './welcome-join';
import './groups.css';

type GroupData = ReturnType<typeof useGroups>;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const PERIODS = ['Sunday buy price', ...DAYS.flatMap((day) => [`${day} AM`, `${day} PM`])];
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
  return member.player.id === owner ? 'Your island' : `${member.player.displayName}’s island`;
}
function weekLink(member: SharedPlayerWeek, owner: string): string {
  return member.player.id === owner
    ? '/'
    : `/players/${member.player.id}/weeks/${member.week.weekStart}`;
}
export function PlayerAvatar({ name, small = false }: { name: string; small?: boolean }) {
  const letters = name
    .split(/[\s-]+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return (
    <span className={`player-avatar${small ? ' player-avatar-small' : ''}`} aria-hidden="true">
      {letters}
    </span>
  );
}

function ForecastSummary({ prediction }: { prediction: PredictionResult }) {
  if (prediction.status === 'needs-input')
    return <span className="member-forecast forecast-none">No forecast yet</span>;
  if (prediction.status === 'inconsistent')
    return <span className="member-forecast forecast-unmatched">Prices don’t match a pattern</span>;
  const likely = prediction.patterns[0];
  return (
    <span className={`member-forecast${likely.id === 'decreasing' ? ' forecast-falling' : ''}`}>
      {likely.label} · {Math.round(likely.probability * 100)}%
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
export function PriceSparkline({
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
  return (
    <div className="beat-odds">
      <p className="beat-odds-head">
        <strong>{odds.certain ? 'Certain' : oddsPercent(odds.chance)}</strong>
        <span>
          {odds.certain ? '' : 'chance '}someone beats {odds.price} {deadline(slot)}
        </span>
      </p>
      <span className="beat-meter" aria-hidden="true">
        <span style={{ width: `${odds.chance * 100}%` }} />
      </span>
      <ul className="beat-list" aria-label="Chance for each island">
        {odds.islands.map((island) => (
          <li key={island.member.player.id}>
            <PlayerAvatar name={island.member.player.displayName} small />
            <span className="beat-who">
              <span className="beat-name">
                {island.self ? 'You' : island.member.player.displayName}
              </span>
              <span className="beat-why">{islandReason(island)}</span>
              {island.alreadyAbove !== null && island.alreadyAbove > 0 && (
                <span className="beat-nudge">
                  No price yet this {partOfDay(slot)}. {oddsPercent(island.alreadyAbove)} chance
                  it’s already above {odds.price}.
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

function RightNow({
  players,
  owner,
  period,
  nowPeriod,
}: {
  players: SharedPlayerWeek[];
  owner: string;
  /** The half-day compared: 0 is Sunday's buy price, then Monday AM onward. */
  period: number;
  nowPeriod: number;
}) {
  const members = useMemo(
    () => players.map((member) => ({ ...member, prediction: predictWeek(member.week) })),
    [players],
  );
  const scale = useMemo(() => sparkScale(members), [members]);
  const sorted = byPeriod(members, period);
  const best = sorted.length > 0 && reportedPrice(sorted[0], period) !== null ? sorted[0] : null;
  const rest = best ? sorted.slice(1) : sorted;
  const yourPurchase = members.find((member) => member.player.id === owner)?.week.purchasePrice;
  const bestPrice = best ? reportedPrice(best, period) : null;
  const ratio =
    best && bestPrice !== null && period > 0 && yourPurchase ? bestPrice / yourPurchase : null;
  // Odds look ahead from now, so they only fit the current selling half-day.
  const odds = period === nowPeriod && period > 0 ? groupOdds(members, owner, period - 1) : null;
  const tag =
    period === 0
      ? 'Cheapest Sunday price'
      : period === nowPeriod
        ? `Best price right now · until ${period % 2 ? 'noon' : '10 PM'}`
        : `Best ${PERIODS[period]} price`;
  return (
    <div className="right-now">
      {best && bestPrice !== null ? (
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
              <small>bells</small>
            </div>
          </div>
          <div className="best-price-detail">
            <p>
              {ratio === null
                ? period === 0
                  ? 'Lowest buy price in your groups.'
                  : `Highest ${PERIODS[period]} price in your groups.`
                : best.player.id === owner
                  ? `That’s ${ratio.toFixed(1)}× what you paid.`
                  : `${ratio.toFixed(1)}× what you paid for yours.`}
            </p>
            <PriceSparkline week={best.week} prediction={best.prediction} scale={scale} />
          </div>
          {odds && <BeatOdds odds={odds} slot={period - 1} />}
          <Link className="button" to={weekLink(best, owner)}>
            {best.player.id === owner ? 'Open your week' : `Open ${best.player.displayName}’s week`}
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </section>
      ) : (
        <p className="right-now-empty">Nobody has shared a {PERIODS[period]} price yet.</p>
      )}
      {rest.length > 0 && (
        <>
          <h3 className="friend-list-heading">{best ? 'Everyone else' : 'Everyone'}</h3>
          <ul className="friend-list">
            {rest.map((member) => {
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
                        {self && <span className="you-label">you</span>}
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
                        {price === null ? 'Not entered' : PERIODS[period]}
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

function GroupForm({
  data,
  initialCode = '',
  onDone,
}: {
  data: GroupData;
  initialCode?: string;
  onDone?: () => void;
}) {
  const [mode, setMode] = useState<'create' | 'join'>(initialCode ? 'join' : 'create');
  const [name, setName] = useState('');
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  // Someone who chose “Save and join” in the welcome dialog joins without a second tap.
  const autoJoin = useRef(Boolean(initialCode) && isWelcomeJoin(initialCode));
  useEffect(() => {
    if (!autoJoin.current || data.status !== 'ready') return;
    autoJoin.current = false;
    clearWelcomeJoin();
    void submit();
  });
  async function submit() {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const group =
        mode === 'create' ? await data.create(name.trim()) : await data.join(code.trim());
      setDone(`${mode === 'create' ? 'Created' : 'Joined'} ${group.name}.`);
      setName('');
      setCode('');
      onDone?.();
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="group-form-wrap">
      <div className="segmented-control" aria-label="Group action">
        <button
          type="button"
          aria-pressed={mode === 'create'}
          onClick={() => {
            setMode('create');
            setError('');
          }}
        >
          Create a group
        </button>
        <button
          type="button"
          aria-pressed={mode === 'join'}
          onClick={() => {
            setMode('join');
            setError('');
          }}
        >
          Join a group
        </button>
      </div>
      <form
        className="group-entry-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {mode === 'create' ? (
          <Field
            label="Group name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Sunday turnip crew"
            maxLength={60}
            required
            autoComplete="off"
          />
        ) : (
          <Field
            label="Group code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="Paste a group code"
            maxLength={24}
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        )}
        <Button
          type="submit"
          busy={busy}
          disabled={
            data.status === 'offline' ||
            data.status === 'loading' ||
            (mode === 'create' ? !name.trim() : !code.trim())
          }
        >
          {mode === 'create' ? <Plus size={16} /> : <Users size={16} />}
          {mode === 'create' ? 'Create group' : 'Join group'}
        </Button>
      </form>
      <p className="hint">
        Up to 8 players. Members can see each other’s name, friend code, weekly prices and history.
      </p>
      {error && <Notice>{error}</Notice>}
      {done && <Notice success>{done}</Notice>}
    </div>
  );
}

/**
 * One seat per place in the group: members first (you, then by name), then open
 * seats that share the group link. Four to a row, three on the narrowest phones.
 */
function GroupSeats({
  group,
  players,
  owner,
  onInvite,
}: {
  group: GroupSummary;
  players: SharedPlayerWeek[];
  owner: string;
  onInvite: () => void;
}) {
  const members = players
    .filter((member) => member.groupIds.includes(group.id))
    .sort(
      (left, right) =>
        Number(right.player.id === owner) - Number(left.player.id === owner) ||
        left.player.displayName.localeCompare(right.player.displayName),
    );
  const open = Math.max(0, group.capacity - Math.max(group.memberCount, members.length));
  return (
    <ul className="group-seats" aria-label={`${group.name} players`}>
      {members.map((member) => {
        const self = member.player.id === owner;
        return (
          <li key={member.player.id} className={self ? 'group-seat-self' : undefined}>
            <Link
              to={weekLink(member, owner)}
              aria-label={self ? 'Your week' : `${member.player.displayName}’s week`}
            >
              <PlayerAvatar name={member.player.displayName} />
              <span className="group-seat-name">{self ? 'You' : member.player.displayName}</span>
            </Link>
          </li>
        );
      })}
      {Array.from({ length: open }, (_, index) => (
        <li key={`open-${index}`} className="group-seat-open">
          <button type="button" onClick={onInvite} aria-label={`Invite a player to ${group.name}`}>
            <span className="group-seat-invite">
              <Plus size={18} aria-hidden="true" />
            </span>
            <span className="group-seat-name">Invite</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function GroupDetails({
  group,
  data,
  owner,
}: {
  group: GroupSummary;
  data: GroupData;
  owner: string;
}) {
  const [message, setMessage] = useState('');
  const [fallbackLink, setFallbackLink] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  async function share() {
    const url = appUrl(`/groups/join?code=${encodeURIComponent(group.code)}`);
    if (navigator.share) {
      try {
        await navigator.share({
          title: group.name,
          text: `Join ${group.name} on Turnip Tycoon`,
          url,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Group link copied.');
      setFallbackLink('');
    } catch {
      setFallbackLink(url);
      setMessage('Copy this group link to share it.');
    }
  }
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(group.code);
      setMessage('Group code copied.');
    } catch {
      setMessage('Select and copy the group code above.');
    }
  }
  async function leave() {
    setLeaving(true);
    setMessage('');
    try {
      await data.leave(group.id);
    } catch (error) {
      setMessage(messageOf(error));
    } finally {
      setLeaving(false);
    }
  }
  return (
    <section className="group-detail-card" aria-label={`${group.name} details`}>
      <div className="group-card-heading">
        <div>
          <h3>{group.name}</h3>
          <p>
            {group.memberCount} of {group.capacity} players
          </p>
        </div>
        <span className="group-badge">
          <Users size={18} />
        </span>
      </div>
      <GroupSeats
        group={group}
        players={data.players}
        owner={owner}
        onInvite={() => {
          void share();
        }}
      />
      <div className="group-code-line">
        <span>Group code</span>
        <code>{group.code}</code>
        <button
          className="icon-button"
          type="button"
          aria-label={`Copy ${group.name} group code`}
          onClick={() => {
            void copyCode();
          }}
        >
          <Copy size={15} />
        </button>
      </div>
      <div className="group-card-actions">
        <Button
          secondary
          onClick={() => {
            void share();
          }}
          disabled={group.memberCount >= group.capacity}
        >
          <Share2 size={15} />
          {group.memberCount >= group.capacity ? 'Group full' : 'Share group link'}
        </Button>
        <button
          className="text-button muted"
          type="button"
          disabled={data.status === 'offline'}
          onClick={() => setConfirmLeave(true)}
        >
          Leave group
        </button>
      </div>
      {confirmLeave && (
        <div className="leave-confirmation">
          <p>
            Leave {group.name}? You’ll stop sharing with players unless you share another group.
          </p>
          <div>
            <Button secondary onClick={() => setConfirmLeave(false)}>
              Stay
            </Button>
            <Button
              busy={leaving}
              onClick={() => {
                void leave();
              }}
            >
              Leave group
            </Button>
          </div>
        </div>
      )}
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
      {fallbackLink && (
        <input
          aria-label="Group share link"
          className="share-fallback"
          readOnly
          value={fallbackLink}
          onFocus={(event) => event.target.select()}
        />
      )}
    </section>
  );
}

function ConnectionMessage({ data }: { data: GroupData }) {
  const identity = useApp();
  if (data.status === 'offline' && !data.players.length)
    return (
      <div className="group-connection">
        <p>Connect to see your friends’ shared prices.</p>
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
          Try again
        </Button>
      </div>
    );
  return null;
}

function FriendsPostcardLoading() {
  return (
    <Loading label="Loading your groups…">
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
    <Loading label="Loading your groups…" className="friends-comparison">
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
  let headline: string;
  let detail: string;
  if (bestOther && other !== null && period === 0) {
    const cheaper = mine === null || other < mine;
    headline = cheaper
      ? `Daisy Mae is selling for ${other} on ${bestOther.player.displayName}’s island`
      : `Your ${mine} is the best Sunday deal in your groups`;
    detail = cheaper
      ? mine === null
        ? 'The lowest Sunday price in your groups.'
        : `That’s ${mine - other} bells cheaper than yours.`
      : `Next best: ${other} on ${bestOther.player.displayName}’s island.`;
  } else if (bestOther && other !== null && (mine === null || other > mine)) {
    headline = `${bestOther.player.displayName}’s island is buying at ${other}!`;
    const deadline = period % 2 ? 'noon' : '10 PM';
    detail = purchase
      ? other >= purchase
        ? `That’s ${(other / purchase).toFixed(1)}× what you paid — fly over before ${deadline}.`
        : `That’s less than the ${purchase} you paid.`
      : `The best ${PERIODS[period]} price in your groups.`;
  } else if (bestOther && other !== null && mine !== null) {
    headline = `Your ${mine} beats everyone right now!`;
    detail = `Next best: ${other} on ${bestOther.player.displayName}’s island.`;
  } else {
    headline = `No friends have shared a ${PERIODS[period]} price yet`;
    detail =
      friendCount === 0
        ? 'Share your group link to bring friends along.'
        : `${friendCount} ${friendCount === 1 ? 'friend' : 'friends'} in your groups. Check back later.`;
  }
  return (
    <section className="friends-panel" aria-labelledby="friends-panel-title">
      <h2 id="friends-panel-title" className="sr-only">
        Friends’ prices
      </h2>
      <ConnectionMessage data={data} />
      {loading && <FriendsPostcardLoading />}
      {data.status === 'ready' && !data.groups.length && (
        <div className={`friends-postcard friends-postcard-invite ${reveal}`}>
          <span className="friends-postcard-icon">
            <Users size={26} aria-hidden="true" />
          </span>
          <div className="friends-postcard-text">
            <p className="friends-postcard-title">A good price is better shared.</p>
            <p>Start a group with friends to compare prices and forecasts.</p>
          </div>
          <Link className="button" to="/groups">
            Create or join a group <ArrowRight size={17} aria-hidden="true" />
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
            See the island board <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      )}
    </section>
  );
}

export function Groups() {
  const identity = useApp();
  const [params, setParams] = useSearchParams();
  const linkCode = params.get('code') ?? '';
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
  const [showForm, setShowForm] = useState(false);
  const [view, setView] = useState<'now' | 'week'>('now');
  const owner = identity.session?.player.id ?? '';
  // The board's copy can be a minute old; your own prices come from this device.
  const own = useWeek(weekStart, identity.session, identity.status === 'ready');
  const shared = withOwnWeek(data.players, owner, own.stored ? own.week : null);
  const existingSelection = data.groups.some((group) => group.id === selectedGroup)
    ? selectedGroup
    : 'all';
  const players =
    existingSelection === 'all'
      ? shared
      : shared.filter((member) => member.groupIds.includes(existingSelection));
  const hasGroups = data.groups.length > 0;
  const loading = data.status === 'loading' && !hasGroups;
  const reveal = useReveal(loading);
  const formOpen = linkCode || showForm || (!hasGroups && data.status === 'ready');
  return (
    <main className="page groups-page" id="main-content">
      <div className="page-heading">
        <div>
          <h1>Friends</h1>
          <p>Island board · {weekLabel(weekStart)}</p>
        </div>
        {hasGroups && (
          <Button secondary onClick={() => setShowForm(!showForm)}>
            {showForm ? <X size={16} /> : <Plus size={16} />}
            {showForm ? 'Close' : 'Create or join'}
          </Button>
        )}
      </div>
      <ConnectionMessage data={data} />
      {formOpen && (
        <section className="group-create-card">
          <div className="section-heading">
            <div>
              <span className="section-eyebrow">Friends &amp; groups</span>
              <h2>
                {linkCode
                  ? 'Join your friends'
                  : hasGroups
                    ? 'Room for another group?'
                    : 'Bring your friends along'}
              </h2>
            </div>
            <span className="group-badge">
              <Users size={22} aria-hidden="true" />
            </span>
          </div>
          <p className="muted">Compare your prices and find a good time to sell, together.</p>
          <GroupForm
            key={linkCode || 'group-form'}
            data={data}
            initialCode={linkCode}
            onDone={() => {
              setShowForm(false);
              setParams({});
            }}
          />
        </section>
      )}
      {loading && <IslandBoardLoading />}
      {hasGroups && (
        <>
          <section
            className={`friends-comparison ${reveal}`}
            aria-label="Friends’ prices this week"
          >
            <div className="friends-toolbar">
              <div className="group-filters" role="group" aria-label="Show group">
                <button
                  type="button"
                  aria-pressed={existingSelection === 'all'}
                  onClick={() => setSelectedGroup('all')}
                >
                  All friends <span>{data.players.length}</span>
                </button>
                {data.groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    aria-pressed={existingSelection === group.id}
                    onClick={() => setSelectedGroup(group.id)}
                  >
                    {group.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="view-bar">
              <div className="segmented-control view-toggle" role="group" aria-label="Price view">
                <button type="button" aria-pressed={view === 'now'} onClick={() => setView('now')}>
                  Right now
                </button>
                <button
                  type="button"
                  aria-pressed={view === 'week'}
                  onClick={() => setView('week')}
                >
                  Full week
                </button>
              </div>
              {/* Compare is hidden for now. To bring it back, keep a chosen period in state
                  (null meaning the current half-day), pass it to RightNow, and restore:
              {view === 'now' && (
                <label className="period-select">
                  Compare
                  <select value={period} onChange={(event) => setPeriod(Number(event.target.value))}>
                    {PERIODS.map((label, index) => (
                      <option key={label} value={index}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )} */}
            </div>
            {view === 'now' ? (
              <RightNow players={players} owner={owner} period={period} nowPeriod={period} />
            ) : (
              <GroupPriceTable players={players} owner={owner} currentSlot={currentSlot(now)} />
            )}
          </section>
          <section className={`your-groups ${reveal}`} aria-labelledby="your-groups-title">
            <div className="section-heading">
              <h2 id="your-groups-title">Your groups</h2>
            </div>
            <div className="group-card-grid">
              {data.groups.map((group) => (
                <GroupDetails key={group.id} group={group} data={data} owner={owner} />
              ))}
            </div>
          </section>
        </>
      )}
      {identity.session && (
        <div className="your-friend-code">
          <Check size={15} aria-hidden="true" />
          <span>
            Your friend code <strong>{identity.session.player.friendCode}</strong>
          </span>
          <Link to="/settings">Edit your name</Link>
        </div>
      )}
    </main>
  );
}
