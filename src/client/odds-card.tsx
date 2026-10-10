import { useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { predictWeek, type PredictionResult } from '../prediction';
import { combineChances, oddsAbove } from '../prediction/odds';
import { totalsOf, unsold, type Trade } from '../shared/ledger';
import type { OwnWeekRecord } from '../shared/week';
import { oddsPercent, percent, slotName } from './advice';
import { useGroups } from './data/use-groups';
import { PlayerAvatar } from './player-avatar';
import {
  afterClosing,
  beforeOpening,
  groupOdds,
  islandOdds,
  reportedPrice,
  type ForecastMember,
  type GroupOdds,
  type IslandOdds,
} from './odds';
import { TURNIPS_ID, WeekTurnips } from './turnips';
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
      ? t`A profit looks likely`
      : chance < 0.25
        ? t`A profit looks unlikely`
        : t`A profit could go either way`;
  if (chance > 0.75) return t`Holding looks good`;
  if (chance < 0.25) return sellNow ? t`Selling now looks good` : t`Selling soon looks good`;
  return t`Could go either way`;
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

/** The group's best price, whose it is, and when it was reported if not this half-day. */
function groupTarget(group: GroupOdds, slot: number): string {
  const { price, priceSlot, yours } = group;
  const name = group.holder.player.displayName;
  if (priceSlot === slot) return yours ? t`your ${price}` : t`${name}’s ${price}`;
  if (Math.floor(priceSlot / 2) === Math.floor(slot / 2))
    return yours ? t`your ${price} from this morning` : t`${name}’s ${price} from this morning`;
  const halfDay = slotName(priceSlot);
  return yours ? t`your ${price} from ${halfDay}` : t`${name}’s ${price} from ${halfDay}`;
}

function FriendsOdds({ group, slot }: { group: GroupOdds; slot: number }) {
  const target = groupTarget(group, slot);
  const chance = oddsPercent(group.chance);
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
        {group.certain ? (
          <Trans>With friends: a higher price than {target} is certain</Trans>
        ) : group.chance === 0 ? (
          <Trans>With friends: nobody can beat {target} this week</Trans>
        ) : (
          <Trans>
            With friends: <strong>{chance}</strong> chance someone beats {target}
          </Trans>
        )}
      </span>
      <ArrowRight size={17} aria-hidden="true" />
    </Link>
  );
}

const CHANCE_TARGET =
  'The target is “the 98 you paid” or a price named by when it was reported, like “this morning’s 120”';

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
  const presets = useMemo(() => {
    const ownPrice = own.price;
    const friend = group?.bestFriend;
    const friendName = friend?.member.player.displayName ?? '';
    const friendPrice = friend?.price ?? 0;
    return [
      ...(ownPrice === null
        ? []
        : [
            {
              label: own.priceSlot === null ? t`You paid ${ownPrice}` : t`Your ${ownPrice}`,
              price: ownPrice,
            },
          ]),
      ...(friend ? [{ label: t`${friendName}’s ${friendPrice}`, price: friend.price }] : []),
    ];
  }, [own.price, own.priceSlot, group]);
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
  // Until a price is picked, the best one right now; friends' prices can arrive later.
  const [chosen, setChosen] = useState<number | null>(null);
  // New prices can move the range after one is picked.
  const price = clamp(chosen ?? group?.price ?? own.price ?? low);
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
  const holderName = group?.holder.player.displayName ?? '';
  const groupPrice = group?.price ?? 0;
  return (
    <div className="odds-explorer-body">
      <label className="odds-explorer-label" htmlFor={`${id}-price`}>
        <Trans>
          Selling for more than <output htmlFor={`${id}-price`}>{price}</output> bells
        </Trans>
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
        <div className="odds-presets" role="group" aria-label={t`Prices right now`}>
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
            <i className="odds-key-own" /> <Trans>Your island</Trans>
          </span>
          <strong>{ownNow !== null && price < ownNow ? t`Now` : oddsPercent(ownChance)}</strong>
          <span>
            {ownNow !== null && price < ownNow
              ? t`You have ${ownNow} right now`
              : ownChance === 0
                ? t`Tops out at ${ownBest}`
                : t`By Saturday night`}
          </span>
        </div>
        {group && friendsChance !== null && (
          <div>
            <span className="odds-key">
              <i className="odds-key-friends" /> <Trans>With friends</Trans>
            </span>
            <strong>{groupNow && price < group.price ? t`Now` : oddsPercent(friendsChance)}</strong>
            <span>
              {groupNow && price < group.price
                ? group.yours
                  ? t`You have ${groupPrice} right now`
                  : t`${holderName} has ${groupPrice} right now`
                : friendsChance === 0
                  ? t`Out of reach this week`
                  : t`By Saturday night`}
            </span>
          </div>
        )}
      </div>
      <svg
        ref={svg}
        className="odds-chart"
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        role="img"
        aria-label={t`Chance of selling for more than each price from ${low} to ${high} bells.`}
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
              {percent(chance)}
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

export interface WeekOdds {
  own: IslandOdds;
  /** Friends' odds with yours; null on Sunday or without friends this week. */
  group: GroupOdds | null;
  /** Nook's Cranny has closed for the week. */
  closed: boolean;
  /** Your price to beat can be sold at right now. */
  sellNow: boolean;
  /** So can the group's best price. */
  groupNow: boolean;
}

/**
 * The chance of a better price later this week, on your island and among friends,
 * shared by the hold-or-sell card and the odds explorer. Only for the current week.
 */
export function useWeekOdds(
  weekStart: string,
  week: OwnWeekRecord,
  prediction: PredictionResult,
  now: Date,
  /** The current half-day, or null on Sunday. */
  slot: number | null,
): WeekOdds {
  const identity = useApp();
  const data = useGroups(weekStart, identity.session, identity.status);
  const owner = identity.session?.player.id ?? '';
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
  const shown = group !== null && group.islands.some((island) => !island.self) ? group : null;
  return {
    own,
    group: shown,
    closed,
    // This half-day's price is in and Nook's Cranny is buying: the odds are about selling now.
    sellNow: slot !== null && own.priceSlot === slot && !closed,
    groupNow: shown?.priceSlot === slot && !closed,
  };
}

/** The odds explorer, in its own card under the forecast. Only shown for the current week. */
export function OddsExplorerCard({
  prediction,
  weekOdds,
}: {
  prediction: PredictionResult;
  weekOdds: WeekOdds;
}) {
  const id = useId();
  const { own, group, sellNow, groupNow } = weekOdds;
  if (prediction.status !== 'possible' || own.fromSlot > 11) return null;
  return (
    <section className="odds-explorer-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>
        <Trans>Odds explorer</Trans>
      </h2>
      <OddsExplorer
        prediction={prediction}
        own={own}
        group={group}
        sellNow={sellNow}
        groupNow={groupNow}
      />
    </section>
  );
}

/**
 * The chance of a better price later this week, on your island and among
 * friends, with the turnips you hold. Only shown for the current week.
 */
export function HoldOrSell({
  week,
  prediction,
  now,
  slot,
  weekOdds,
  onTrades,
}: {
  week: OwnWeekRecord;
  prediction: PredictionResult;
  now: Date;
  /** The current half-day, or null on Sunday. */
  slot: number | null;
  weekOdds: WeekOdds;
  onTrades: (trades: Trade[]) => void;
}) {
  const id = useId();
  const { own, group, closed, sellNow } = weekOdds;
  // Without a forecast, the card still holds this week's turnips.
  const possible = prediction.status === 'possible';
  const held = unsold(totalsOf(week.trades));

  const { price, priceSlot, odds } = own;
  // Unless selling now, the price to beat is named: what was paid, or when it was seen.
  const known =
    price === null
      ? ''
      : slot === null || priceSlot === null
        ? t`the ${price} you paid`
        : reportedPrice(price, priceSlot, slot);
  // Every outcome leads with a headline saying what to do; only a missing price has none.
  let headline: string | null = null;
  let message: string | null = null;
  if (price === null)
    message =
      slot === null
        ? t`Enter what Daisy Mae charged to see your odds.`
        : slot % 2
          ? t`Enter this afternoon’s price to see your odds.`
          : t`Enter this morning’s price to see your odds.`;
  else if (!odds) {
    headline = closed ? t`Too late to sell` : t`Sell tonight`;
    message = closed
      ? t`Nook’s Cranny has closed for the week.`
      : t`Last chance: Nook’s Cranny closes at 10 PM.`;
  } else if (odds.certain) {
    headline = slot === null ? t`A profit is certain` : t`Hold on to your turnips`;
    message = t`A higher price is coming.`;
  } else if (odds.impossible) {
    headline =
      slot === null ? t`No profit this week` : sellNow ? t`Sell now` : t`Selling soon looks good`;
    message = sellNow
      ? t`This is the highest price your island can reach this week.`
      : t({ message: `No price left this week will beat ${known}.`, comment: CHANCE_TARGET });
  } else headline = verdict(odds.chance, slot === null, sellNow);
  const halfDay = priceSlot === null ? '' : slotName(priceSlot);
  const sameDay =
    slot !== null && priceSlot !== null && Math.floor(priceSlot / 2) === Math.floor(slot / 2);
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
            <Trans comment="Follows the chance, shown in a ring">
              chance you can sell for more than the <strong>{price}</strong> you paid this week.
            </Trans>
          ) : sellNow ? (
            <Trans comment="Follows the chance, shown in a ring">
              chance of more than <strong>{price}</strong> on your island before Nook’s Cranny
              closes on Saturday.
            </Trans>
          ) : !sameDay ? (
            <Trans comment="Follows the chance, shown in a ring">
              chance of beating {halfDay}’s <strong>{price}</strong> before Nook’s Cranny closes on
              Saturday.
            </Trans>
          ) : priceSlot % 2 ? (
            <Trans comment="Follows the chance, shown in a ring">
              chance of beating this afternoon’s <strong>{price}</strong> before Nook’s Cranny
              closes on Saturday.
            </Trans>
          ) : (
            <Trans comment="Follows the chance, shown in a ring">
              chance of beating this morning’s <strong>{price}</strong> before Nook’s Cranny closes
              on Saturday.
            </Trans>
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
              ? plural(held, {
                  one: 'Hold or sell your # turnip?',
                  other: 'Hold or sell your # turnips?',
                })
              : possible
                ? t`Hold or sell?`
                : t`Your turnips`}
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
            {opensLater && (
              <p className="hint">
                <Trans>Nook’s Cranny opens at 8 AM.</Trans>
              </p>
            )}
            {prediction.tolerance > 0 && price !== null && (
              <p className="hint">
                <Trans>
                  Some prices are a little off the usual patterns, so treat this as a rough guide.
                </Trans>
              </p>
            )}
          </div>
        )}
        <WeekTurnips
          week={week}
          slot={slot}
          onTrades={onTrades}
          beforeTrades={
            possible && group && slot !== null && <FriendsOdds group={group} slot={slot} />
          }
        />
      </div>
    </section>
  );
}
