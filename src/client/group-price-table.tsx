import { Fragment, useId, useMemo } from 'react';
import { Link } from 'react-router';
import { predictWeek, type PredictionResult } from '../prediction';
import type { SharedPlayerWeek } from '../shared/groups';
import './group-price-table.css';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PATTERNS = [
  { id: 'fluctuating', label: 'Fluctuating' },
  { id: 'large-spike', label: 'Large spike' },
  { id: 'small-spike', label: 'Small spike' },
  { id: 'decreasing', label: 'Decreasing' },
];

function PriceCell({
  value,
  prediction,
  slot,
  now = false,
}: {
  value: number | null;
  prediction: PredictionResult;
  slot?: number;
  now?: boolean;
}) {
  const period =
    slot === undefined ? 'Sunday buy' : `${DAYS[Math.floor(slot / 2)]} ${slot % 2 ? 'PM' : 'AM'}`;
  const range =
    slot !== undefined && prediction.status === 'possible' ? prediction.slots[slot] : null;
  const className = now ? 'price-now' : undefined;
  if (value !== null) {
    return (
      <td className={className}>
        <span
          className={`group-price-value ${slot === undefined ? 'price-buy' : 'price-reported'}`}
          title={`${period}: ${value} bells reported`}
        >
          {value}
          <span className="sr-only"> bells reported</span>
        </span>
      </td>
    );
  }
  if (range) {
    return (
      <td className={className}>
        <span
          className="group-price-value price-predicted"
          title={`${period}: possible minimum ${range.min}, maximum ${range.max} bells`}
        >
          {range.min === range.max ? range.min : `${range.min}–${range.max}`}
          <span className="sr-only"> bells predicted</span>
        </span>
      </td>
    );
  }
  return (
    <td className={`group-price-missing${now ? ' price-now' : ''}`}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">Not entered{slot !== undefined && ', no forecast available'}</span>
    </td>
  );
}

export function GroupPriceTable({
  players,
  owner,
  currentSlot = null,
}: {
  players: SharedPlayerWeek[];
  owner: string;
  currentSlot?: number | null;
}) {
  const id = useId();
  const rows = useMemo(
    () =>
      [...players]
        .sort((a, b) => a.player.displayName.localeCompare(b.player.displayName))
        .map((member) => {
          const prediction = predictWeek(member.week);
          const patterns = PATTERNS.map((pattern) => ({
            ...pattern,
            probability:
              prediction.patterns.find((result) => result.id === pattern.id)?.probability ?? 0,
          })).sort((a, b) => b.probability - a.probability);
          return { ...member, prediction, patterns };
        }),
    [players],
  );
  const slots = Array.from({ length: 12 }, (_, index) => index);
  return (
    <div className="group-price-overview">
      <div
        className="group-price-scroll"
        role="region"
        aria-label="Full week group prices"
        aria-describedby={`${id}-legend`}
        tabIndex={0}
      >
        <table className="group-price-table">
          <caption className="sr-only">
            Group prices in bells per turnip. Reported prices are solid; predictions are possible
            ranges in dashed boxes.
          </caption>
          <colgroup>
            <col className="price-name-column" />
          </colgroup>
          <colgroup>
            <col className="price-buy-column" />
          </colgroup>
          {DAYS.map((day) => (
            <colgroup key={day} span={2} />
          ))}
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="price-name-cell">
                Island
              </th>
              <th scope="col" rowSpan={2}>
                Sun<span className="price-header-detail">Buy</span>
              </th>
              {DAYS.map((label) => (
                <th key={label} scope="colgroup" colSpan={2}>
                  {label.slice(0, 3)}
                </th>
              ))}
            </tr>
            <tr>
              {slots.map((slot) => (
                <th
                  key={slot}
                  scope="col"
                  className={slot === currentSlot ? 'price-now' : undefined}
                >
                  <span className="sr-only">{DAYS[Math.floor(slot / 2)]} </span>
                  {slot % 2 ? 'PM' : 'AM'}
                  {slot === currentSlot && <span className="sr-only"> (now)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, week, prediction, patterns }) => (
              <Fragment key={player.id}>
                <tr
                  className={`${prediction.status === 'possible' ? 'price-row-with-patterns' : ''}${player.id === owner ? ' price-row-self' : ''}`}
                >
                  <th scope="row" className="price-name-cell">
                    <Link
                      to={
                        player.id === owner ? '/' : `/players/${player.id}/weeks/${week.weekStart}`
                      }
                      className="price-player-link"
                    >
                      {player.displayName}
                    </Link>
                    {player.id === owner && <span className="you-label">you</span>}
                    {prediction.status !== 'possible' && (
                      <span
                        className={`price-forecast-status${prediction.status === 'inconsistent' ? ' forecast-unmatched' : ''}`}
                      >
                        {prediction.status === 'needs-input'
                          ? 'No forecast yet'
                          : 'No matching forecast'}
                      </span>
                    )}
                  </th>
                  <PriceCell value={week.purchasePrice} prediction={prediction} />
                  {slots.map((slot) => (
                    <PriceCell
                      key={slot}
                      slot={slot}
                      value={week.prices[slot]}
                      prediction={prediction}
                      now={slot === currentSlot}
                    />
                  ))}
                </tr>
                {prediction.status === 'possible' && (
                  <tr
                    className={`price-pattern-row${player.id === owner ? ' price-row-self' : ''}`}
                  >
                    <td colSpan={slots.length + 2}>
                      <div className="price-pattern-summary">
                        <ul
                          className="price-pattern-probabilities"
                          aria-label={`${player.displayName}’s selling pattern probabilities`}
                        >
                          {patterns.map(({ id, label, probability }) => (
                            <li
                              key={id}
                              className={probability === 0 ? 'pattern-ruled-out' : undefined}
                            >
                              <span>{label}</span>
                              <strong>
                                {probability === 0
                                  ? '0'
                                  : probability < 0.001
                                    ? '<0.1'
                                    : (probability * 100).toFixed(1)}
                                %
                              </strong>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="price-table-legend" id={`${id}-legend`}>
        <span>
          <i className="price-key-reported" />
          Reported
        </span>
        <span>
          <i className="price-key-predicted" />
          Could be (min–max)
        </span>
        <span>— Unavailable</span>
      </div>
    </div>
  );
}
