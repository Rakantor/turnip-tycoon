import { useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router';
import { ArrowRight, ChartSpline } from 'lucide-react';
import { predictWeek, type PredictionResult } from '../prediction';
import { combineChances, oddsAbove } from '../prediction/odds';
import type { WeekRecord } from '../shared/week';
import { oddsPercent, type ChipTone } from './advice';
import { useGroups } from './data/use-groups';
import { PlayerAvatar } from './groups';
import {
  groupOdds,
  islandOdds,
  partOfDay,
  type ForecastMember,
  type GroupOdds,
  type IslandOdds,
} from './odds';
import { useApp } from './ui';
import './odds.css';

function bestCaseFrom(prediction: PredictionResult, fromSlot: number): number {
  return Math.max(0, ...prediction.slots.slice(fromSlot).map((range) => range.max));
}

function verdict(chance: number): { text: string; tone: ChipTone } {
  if (chance < 0.25) return { text: 'Selling now looks good', tone: 'leaf' };
  if (chance > 0.75) return { text: 'Holding looks good', tone: 'gold' };
  return { text: 'Could go either way', tone: 'sand' };
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

function FriendsOdds({ group }: { group: GroupOdds }) {
  const target = group.yours
    ? `your ${group.price}`
    : `${group.holder.player.displayName}’s ${group.price}`;
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
  slot,
}: {
  prediction: PredictionResult;
  own: IslandOdds;
  group: GroupOdds | null;
  slot: number | null;
}) {
  const id = useId();
  const svg = useRef<SVGSVGElement>(null);
  // On Sunday the purchase price is a preset, but nobody can sell at it now.
  const ownNow = slot === null ? null : own.price;
  const presets = useMemo(
    () => [
      ...(own.price === null
        ? []
        : [{ label: `${slot === null ? 'You paid' : 'Your'} ${own.price}`, price: own.price }]),
      ...(group?.bestFriend
        ? [
            {
              label: `${group.bestFriend.member.player.displayName}’s ${group.bestFriend.price}`,
              price: group.bestFriend.price,
            },
          ]
        : []),
    ],
    [own.price, group, slot],
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
          price < group.price
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
  }, [prediction, own.fromSlot, group, ownNow, ownBest, presets]);
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
            <strong>{price < group.price ? 'Now' : oddsPercent(friendsChance)}</strong>
            <span>
              {price < group.price
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
 * friends, beside the forecast. Only shown for the current week.
 */
export function HoldOrSell({
  weekStart,
  week,
  prediction,
  slot,
}: {
  weekStart: string;
  week: WeekRecord;
  prediction: PredictionResult;
  /** The current half-day, or null on Sunday. */
  slot: number | null;
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
  const group = useMemo(
    () => (slot === null ? null : groupOdds(members, owner, slot)),
    [members, owner, slot],
  );
  const own = useMemo(() => islandOdds(week, prediction, slot), [week, prediction, slot]);
  if (prediction.status !== 'possible') return null;

  const { price, odds, fromSlot } = own;
  const showGroup = group !== null && group.islands.some((island) => !island.self);
  let message: string | null = null;
  if (price === null)
    message =
      slot === null
        ? 'Enter what Daisy Mae charged to see your odds.'
        : `Enter this ${partOfDay(slot)}’s price to see your odds.`;
  else if (!odds) message = 'Last chance: Nook’s Cranny closes at 10 PM.';
  else if (odds.certain) message = 'A higher price is coming. Hold on to your turnips!';
  else if (odds.impossible)
    message =
      slot === null
        ? `No price this week will beat the ${price} you paid.`
        : 'This is the highest price your island can reach this week. Sell today.';
  const ring = message === null ? odds : null;
  const best = fromSlot <= 11 && !odds?.impossible ? bestCaseFrom(prediction, fromSlot) : null;
  const chip = ring && slot !== null ? verdict(ring.chance) : null;
  return (
    <section className="odds-card" aria-labelledby={`${id}-title`}>
      <div className="odds-heading">
        <h2 id={`${id}-title`}>Hold or sell?</h2>
        {chip && <span className={`chip chip-${chip.tone}`}>{chip.text}</span>}
      </div>
      <div className="odds-summary">
        <div className="odds-own">
          {ring ? (
            <div className="odds-main">
              <OddsRing chance={ring.chance} />
              <p>
                {slot === null ? (
                  <>
                    chance you can sell for more than the <strong>{price}</strong> you paid this
                    week.
                  </>
                ) : (
                  <>
                    chance of more than <strong>{price}</strong> on your island before Nook’s Cranny
                    closes on Saturday.
                  </>
                )}
              </p>
            </div>
          ) : (
            <p className="odds-message">{message}</p>
          )}
          {best !== null && (
            <p className="odds-best">
              Best case this week: <strong>{best}</strong>
              {slot !== null && price !== null && best > price
                ? `, ${best - price} more than now.`
                : '.'}
            </p>
          )}
          {prediction.tolerance > 0 && price !== null && (
            <p className="hint">
              Some prices are a little off the usual patterns, so treat this as a rough guide.
            </p>
          )}
        </div>
        {group && showGroup && <FriendsOdds group={group} />}
      </div>
      {fromSlot <= 11 && (
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
              slot={slot}
            />
          )}
        </details>
      )}
    </section>
  );
}
