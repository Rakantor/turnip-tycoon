import { useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router';
import { ArrowRight, ChartSpline } from 'lucide-react';
import { predictWeek, type PredictionResult } from '../prediction';
import { combineChances, oddsAbove } from '../prediction/odds';
import { totalsOf, unsold, type Trade } from '../shared/ledger';
import type { OwnWeekRecord } from '../shared/week';
import { oddsPercent } from './advice';
import { useGroups } from './data/use-groups';
import { PlayerAvatar } from './groups';
import {
  afterClosing,
  beforeOpening,
  groupOdds,
  islandOdds,
  partOfDay,
  reportedWhen,
  type ForecastMember,
  type GroupOdds,
  type IslandOdds,
} from './odds';
import { bells, TURNIPS_ID, WeekTurnips } from './turnips';
import { useApp } from './ui';
import './odds.css';

function bestCaseFrom(prediction: PredictionResult, fromSlot: number): number {
  return Math.max(0, ...prediction.slots.slice(fromSlot).map((range) => range.max));
}

/**
 * What to do, given the chance of a better price later. Turnips can't be sold on
 * Sunday, so there it says whether they look set to make a profit.
 */
function verdict(chance: number, sunday: boolean, sellNow: boolean): string {
  if (sunday)
    return chance > 0.75
      ? 'A profit looks likely'
      : chance < 0.25
        ? 'A profit looks unlikely'
        : 'A profit could go either way';
  if (chance > 0.75) return 'Holding looks good';
  if (chance < 0.25) return sellNow ? 'Selling now looks good' : 'Selling soon looks good';
  return 'Could go either way';
}

function OddsRing({ chance }: { chance: number }) {
  const circumference = 2 * Math.PI * 34;
  return (
    <svg className="odds-ring" viewBox="0 0 84 84" aria-hidden="true">
      <circle className="odds-ring-track" cx="42" cy="42" r="34" />
      {chance > 0 && (
        <circle
          className="odds-ring-fill"
          cx="42"
          cy="42"
          r="34"
          strokeDasharray={`${Math.max(2, chance * circumference)} ${circumference}`}
          transform="rotate(-90 42 42)"
        />
      )}
      <text x="42" y="49" textAnchor="middle">
        {oddsPercent(chance)}
      </text>
    </svg>
  );
}

function FriendsOdds({ group, slot }: { group: GroupOdds; slot: number }) {
  const target =
    (group.yours ? `your ${group.price}` : `${group.holder.player.displayName}’s ${group.price}`) +
    (group.priceSlot === slot ? '' : ` from ${reportedWhen(group.priceSlot, slot)}`);
  const friends = group.islands.filter((island) => !island.self).slice(0, 3);
  return (
    <Link className="odds-friends" to="/groups">
      <span className="odds-friends-avatars">
        {friends.map((island) => (
          <PlayerAvatar
            key={island.member.player.id}
            name={island.member.player.displayName}
            small
          />
        ))}
      </span>
      <span className="odds-friends-text">
        With friends:{' '}
        {group.certain ? (
          <>a higher price than {target} is certain</>
        ) : group.chance === 0 ? (
          <>nobody can beat {target} this week</>
        ) : (
          <>
            <strong>{oddsPercent(group.chance)}</strong> chance someone beats {target}
          </>
        )}
      </span>
      <ArrowRight size={17} aria-hidden="true" />
    </Link>
  );
}

const CHART = { width: 340, height: 196, left: 36, right: 330, top: 10, bottom: 166 };

function niceStep(span: number): number {
  return [10, 20, 25, 50, 100, 200, 250].find((step) => span / step <= 6) ?? 500;
}

/** Pick any price and compare the chance of beating it at home and with friends. */
function OddsExplorer({
  prediction,
  own,
  group,
  sellNow,
  groupNow,
}: {
  prediction: PredictionResult;
  own: IslandOdds;
  group: GroupOdds | null;
  /** Your price to beat can be sold at right now. */
  sellNow: boolean;
  /** So can the group's best price. */
  groupNow: boolean;
}) {
  const id = useId();
  const svg = useRef<SVGSVGElement>(null);
  // What was paid, or an earlier half-day's price, is a preset, but nobody can sell at it now.
  const ownNow = sellNow ? own.price : null;
  const presets = useMemo(
    () => [
      ...(own.price === null
        ? []
        : [
            {
              label: `${own.priceSlot === null ? 'You paid' : 'Your'} ${own.price}`,
              price: own.price,
            },
          ]),
      ...(group?.bestFriend
        ? [
            {
              label: `${group.bestFriend.member.player.displayName}’s ${group.bestFriend.price}`,
              price: group.bestFriend.price,
            },
          ]
        : []),
    ],
    [own.price, own.priceSlot, group],
  );
  const ownBest = bestCaseFrom(prediction, own.fromSlot);
  const {
    low,
    high,
    own: ownCurve,
    friends,
  } = useMemo(() => {
    const anchors = presets.map((preset) => preset.price);
    const anchor = anchors.length
      ? Math.min(...anchors)
      : Math.min(...prediction.slots.slice(own.fromSlot).map((range) => range.min));
    const top = Math.max(
      ownBest,
      ...anchors,
      ...(group?.islands.map((island) => island.odds?.bestCase ?? 0) ?? []),
    );
    const low = Math.max(0, Math.floor((anchor * 0.75) / 10) * 10);
    const high = Math.max(low + 50, Math.ceil((top + 1) / 50) * 50);
    const ownCurve: number[] = [];
    const friends: number[] = [];
    for (let price = low; price <= high; price++) {
      ownCurve.push(
        ownNow !== null && price < ownNow
          ? 1
          : (oddsAbove(prediction, price, own.fromSlot)?.chance ?? 0),
      );
      if (group)
        friends.push(
          groupNow && price < group.price
            ? 1
            : combineChances(
                group.islands.map(
                  (island) =>
                    oddsAbove(island.member.prediction, price, island.fromSlot)?.chance ?? 0,
                ),
              ),
        );
    }
    return { low, high, own: ownCurve, friends };
  }, [prediction, own.fromSlot, group, groupNow, ownNow, ownBest, presets]);
  const clamp = (value: number) => Math.min(high, Math.max(low, Math.round(value)));
  const [chosen, setChosen] = useState(() => group?.price ?? own.price ?? low);
  // New prices can move the range while the explorer is open.
  const price = clamp(chosen);
  const show = (value: number) => setChosen(clamp(value));
  const x = (value: number) =>
    CHART.left + ((value - low) / (high - low)) * (CHART.right - CHART.left);
  const y = (chance: number) => CHART.bottom - chance * (CHART.bottom - CHART.top);
  const path = (curve: number[]) =>
    curve
      .map(
        (chance, index) =>
          `${index ? 'L' : 'M'}${x(low + index).toFixed(1)} ${y(chance).toFixed(1)}`,
      )
      .join('');
  const step = niceStep(high - low);
  const ticks: number[] = [];
  for (let tick = Math.ceil(low / step) * step; tick <= high; tick += step) ticks.push(tick);
  const ownChance = ownCurve[price - low];
  const friendsChance = group ? friends[price - low] : null;
  const fromPointer = (event: PointerEvent<SVGSVGElement>) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const at = ((event.clientX - box.left) / box.width) * CHART.width;
    if (at < CHART.left - 4 || at > CHART.right + 4) return;
    show(low + ((at - CHART.left) / (CHART.right - CHART.left)) * (high - low));
  };
  const holder = group?.yours ? 'You have' : `${group?.holder.player.displayName} has`;
  return (
    <div className="odds-explorer-body">
      <label className="odds-explorer-label" htmlFor={`${id}-price`}>
        Selling for more than <output htmlFor={`${id}-price`}>{price}</output> bells
      </label>
      <input
        id={`${id}-price`}
        type="range"
        min={low}
        max={high}
        step={1}
        value={price}
        onChange={(event) => show(Number(event.target.value))}
      />
      {presets.length > 0 && (
        <div className="odds-presets" role="group" aria-label="Prices right now">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              aria-pressed={preset.price === price}
              onClick={() => show(preset.price)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
      <div className="odds-readout" aria-live="polite">
        <div>
          <span className="odds-key">
            <i className="odds-key-own" /> Your island
          </span>
          <strong>{ownNow !== null && price < ownNow ? 'Now' : oddsPercent(ownChance)}</strong>
          <span>
            {ownNow !== null && price < ownNow
              ? `You have ${ownNow} right now`
              : ownChance === 0
                ? `Tops out at ${ownBest}`
                : 'By Saturday night'}
          </span>
        </div>
        {group && friendsChance !== null && (
          <div>
            <span className="odds-key">
              <i className="odds-key-friends" /> With friends
            </span>
            <strong>{groupNow && price < group.price ? 'Now' : oddsPercent(friendsChance)}</strong>
            <span>
              {groupNow && price < group.price
                ? `${holder} ${group.price} right now`
                : friendsChance === 0
                  ? 'Out of reach this week'
                  : 'By Saturday night'}
            </span>
          </div>
        )}
      </div>
      <svg
        ref={svg}
        className="odds-chart"
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        role="img"
        aria-label={`Chance of selling for more than each price from ${low} to ${high} bells.`}
        onPointerDown={fromPointer}
        onPointerMove={fromPointer}
      >
        {[0, 0.5, 1].map((chance) => (
          <g key={chance}>
            <line
              className="odds-grid"
              x1={CHART.left}
              x2={CHART.right}
              y1={y(chance)}
              y2={y(chance)}
            />
            <text className="odds-axis" x={CHART.left - 6} y={y(chance) + 3.5} textAnchor="end">
              {chance * 100}%
            </text>
          </g>
        ))}
        {ticks.map((tick) => (
          <text
            key={tick}
            className="odds-axis"
            x={x(tick)}
            y={CHART.bottom + 16}
            textAnchor="middle"
          >
            {tick}
          </text>
        ))}
        {group && <path className="odds-line odds-line-friends" d={path(friends)} />}
        <path className="odds-halo" d={path(ownCurve)} />
        <path className="odds-line odds-line-own" d={path(ownCurve)} />
        <line className="odds-cross" x1={x(price)} x2={x(price)} y1={CHART.top} y2={CHART.bottom} />
        {friendsChance !== null && (
          <circle className="odds-dot odds-dot-friends" r="5" cx={x(price)} cy={y(friendsChance)} />
        )}
        <circle className="odds-dot odds-dot-own" r="5" cx={x(price)} cy={y(ownChance)} />
      </svg>
    </div>
  );
}

/**
 * The chance of a better price later this week, on your island and among
 * friends, with the turnips you hold. Only shown for the current week.
 */
export function HoldOrSell({
  weekStart,
  week,
  prediction,
  now,
  slot,
  onTrades,
}: {
  weekStart: string;
  week: OwnWeekRecord;
  prediction: PredictionResult;
  now: Date;
  /** The current half-day, or null on Sunday. */
  slot: number | null;
  onTrades: (trades: Trade[]) => void;
}) {
  const id = useId();
  const identity = useApp();
  const data = useGroups(weekStart, identity.session, identity.status);
  const owner = identity.session?.player.id ?? '';
  const [explorerOpen, setExplorerOpen] = useState(false);
  const friends = useMemo(
    () =>
      data.players
        .filter((member) => member.player.id !== owner)
        .map((member) => ({ ...member, prediction: predictWeek(member.week) })),
    [data.players, owner],
  );
  const self = data.players.find((member) => member.player.id === owner);
  const members = useMemo<ForecastMember[]>(
    () => (self ? [...friends, { ...self, week, prediction }] : friends),
    [friends, self, week, prediction],
  );
  const closed = afterClosing(now);
  const group = useMemo(
    () => (slot === null ? null : groupOdds(members, owner, slot, closed)),
    [members, owner, slot, closed],
  );
  const own = useMemo(
    () => islandOdds(week, prediction, slot, closed),
    [week, prediction, slot, closed],
  );
  // Without a forecast, the card still holds this week's turnips.
  const possible = prediction.status === 'possible';
  const held = unsold(totalsOf(week.trades));

  const { price, priceSlot, odds, fromSlot } = own;
  // This half-day's price is in and Nook's Cranny is buying: the odds are about selling now.
  const sellNow = slot !== null && priceSlot === slot && !closed;
  // Otherwise the price to beat is named: what was paid, or when it was seen.
  const known =
    slot === null || priceSlot === null
      ? `the ${price} you paid`
      : `${reportedWhen(priceSlot, slot)}’s ${price}`;
  const showGroup = group !== null && group.islands.some((island) => !island.self);
  // Every outcome leads with a headline saying what to do; only a missing price has none.
  let headline: string | null = null;
  let message: string | null = null;
  if (price === null)
    message =
      slot === null
        ? 'Enter what Daisy Mae charged to see your odds.'
        : `Enter this ${partOfDay(slot)}’s price to see your odds.`;
  else if (!odds) {
    headline = closed ? 'Too late to sell' : 'Sell tonight';
    message = closed
      ? 'Nook’s Cranny has closed for the week.'
      : 'Last chance: Nook’s Cranny closes at 10 PM.';
  } else if (odds.certain) {
    headline = slot === null ? 'A profit is certain' : 'Hold on to your turnips';
    message = 'A higher price is coming.';
  } else if (odds.impossible) {
    headline =
      slot === null ? 'No profit this week' : sellNow ? 'Sell now' : 'Selling soon looks good';
    message = sellNow
      ? 'This is the highest price your island can reach this week.'
      : `No price left this week will beat ${known}.`;
  } else headline = verdict(odds.chance, slot === null, sellNow);
  // The ring shows whenever there are odds; a certain or impossible outcome is said in words beside it.
  const ring = price !== null ? odds : null;
  const opensLater =
    slot !== null && priceSlot !== slot && !closed && price !== null && beforeOpening(now);
  const summary = (
    <p className={headline === null ? 'odds-message' : 'odds-summary'}>
      {headline !== null && (
        <span className="odds-verdict">
          <mark>{headline}</mark>
        </span>
      )}
      {message ?? (
        <>
          <span className="sr-only">{oddsPercent(ring?.chance ?? 0)} </span>
          {slot === null || priceSlot === null ? (
            <>
              chance you can sell for more than the <strong>{price}</strong> you paid this week.
            </>
          ) : sellNow ? (
            <>
              chance of more than <strong>{price}</strong> on your island before Nook’s Cranny
              closes on Saturday.
            </>
          ) : (
            <>
              chance of beating {reportedWhen(priceSlot, slot)}’s <strong>{price}</strong> before
              Nook’s Cranny closes on Saturday.
            </>
          )}
        </>
      )}
    </p>
  );
  return (
    <section className="odds-card" id={TURNIPS_ID} tabIndex={-1} aria-labelledby={`${id}-title`}>
      <div
        className={`odds-layout${week.trades.length ? ' has-trades' : ''}${possible ? '' : ' no-forecast'}`}
      >
        <div className="odds-heading">
          <h2 id={`${id}-title`}>
            {held > 0
              ? `Hold or sell your ${bells(held)} turnips?`
              : possible
                ? 'Hold or sell?'
                : 'Your turnips'}
          </h2>
        </div>
        {possible && (
          <div className="odds-own">
            {ring ? (
              <div className="odds-main">
                <OddsRing chance={ring.chance} />
                {summary}
              </div>
            ) : (
              summary
            )}
            {opensLater && <p className="hint">Nook’s Cranny opens at 8 AM.</p>}
            {prediction.tolerance > 0 && price !== null && (
              <p className="hint">
                Some prices are a little off the usual patterns, so treat this as a rough guide.
              </p>
            )}
          </div>
        )}
        <WeekTurnips week={week} slot={slot} onTrades={onTrades} />
        {possible && group && showGroup && slot !== null && (
          <FriendsOdds group={group} slot={slot} />
        )}
        {possible && fromSlot <= 11 && (
          <details
            className="odds-explorer"
            onToggle={(event) => setExplorerOpen(event.currentTarget.open)}
          >
            <summary>
              <ChartSpline size={16} aria-hidden="true" />
              Odds explorer
            </summary>
            {explorerOpen && (
              <OddsExplorer
                prediction={prediction}
                own={own}
                group={showGroup ? group : null}
                sellNow={sellNow}
                groupNow={group?.priceSlot === slot && !closed}
              />
            )}
          </details>
        )}
      </div>
    </section>
  );
}
