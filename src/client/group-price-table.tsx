import { Fragment, useId, useMemo } from 'react';
import { Link } from 'react-router';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { predictWeek, type PredictionResult } from '../prediction';
import type { SharedPlayerWeek } from '../shared/groups';
import { dayName, dayShortName, PATTERNS, patternPercent, percent, slotShortName } from './advice';
import './group-price-table.css';

const DAY_INDEXES = [0, 1, 2, 3, 4, 5];

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
  const period = slot === undefined ? t`Sunday buy` : slotShortName(slot);
  const range =
    slot !== undefined && prediction.status === 'possible' ? prediction.slots[slot] : null;
  const className = now ? 'price-now' : undefined;
  if (value !== null) {
    return (
      <td className={className}>
        <span
          className={`group-price-value ${slot === undefined ? 'price-buy' : 'price-reported'}`}
          title={t`${period}: ${value} bells reported`}
        >
          {value}
          <span className="sr-only">
            {' '}
            <Trans comment="Follows a price">bells reported</Trans>
          </span>
        </span>
      </td>
    );
  }
  if (range) {
    const { min, max } = range;
    return (
      <td className={className}>
        <span
          className="group-price-value price-predicted"
          title={t`${period}: possible minimum ${min}, maximum ${max} bells`}
        >
          {min === max ? min : `${min}–${max}`}
          <span className="sr-only">
            {' '}
            <Trans comment="Follows a price or a range of prices">bells predicted</Trans>
          </span>
        </span>
      </td>
    );
  }
  return (
    <td className={`group-price-missing${now ? ' price-now' : ''}`}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">
        {slot === undefined ? t`Not entered` : t`Not entered, no forecast available`}
      </span>
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
        aria-label={t`Full week group prices`}
        aria-describedby={`${id}-legend`}
        tabIndex={0}
      >
        <table className="group-price-table">
          <caption className="sr-only">
            <Trans>
              Group prices in bells per turnip. Reported prices are solid; predictions are possible
              ranges in dashed boxes.
            </Trans>
          </caption>
          <colgroup>
            <col className="price-name-column" />
          </colgroup>
          <colgroup>
            <col className="price-buy-column" />
          </colgroup>
          {DAY_INDEXES.map((day) => (
            <colgroup key={day} span={2} />
          ))}
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="price-name-cell">
                <Trans>Island</Trans>
              </th>
              <th scope="col" rowSpan={2}>
                {dayShortName(0)}
                <span className="price-header-detail">
                  <Trans comment="Under “Sun”: the Sunday buy price column">Buy</Trans>
                </span>
              </th>
              {DAY_INDEXES.map((day) => (
                <th key={day} scope="colgroup" colSpan={2}>
                  {dayShortName(day + 1)}
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
                  <span className="sr-only">{dayName(Math.floor(slot / 2) + 1)} </span>
                  {slot % 2
                    ? t({ message: 'PM', comment: 'Afternoon, as a column heading' })
                    : t({ message: 'AM', comment: 'Morning, as a column heading' })}
                  {slot === currentSlot && (
                    <span className="sr-only">
                      {' '}
                      <Trans comment="Marks the current half-day's column">(now)</Trans>
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, week, prediction, patterns }) => {
              const name = player.displayName;
              return (
                <Fragment key={player.id}>
                  <tr
                    className={`${prediction.status === 'possible' ? 'price-row-with-patterns' : ''}${player.id === owner ? ' price-row-self' : ''}`}
                  >
                    <th scope="row" className="price-name-cell">
                      <Link
                        to={
                          player.id === owner
                            ? '/'
                            : `/players/${player.id}/weeks/${week.weekStart}`
                        }
                        className="price-player-link"
                      >
                        {player.displayName}
                      </Link>
                      {player.id === owner && (
                        <span className="you-label">
                          <Trans comment="A tag after your own name in a list">you</Trans>
                        </span>
                      )}
                      {prediction.status !== 'possible' && (
                        <span
                          className={`price-forecast-status${prediction.status === 'inconsistent' ? ' forecast-unmatched' : ''}`}
                        >
                          {prediction.status === 'needs-input'
                            ? t`No forecast yet`
                            : t`No matching forecast`}
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
                            aria-label={t`${name}’s selling pattern probabilities`}
                          >
                            {patterns.map(({ id, name: patternName, probability }) => (
                              <li
                                key={id}
                                className={probability === 0 ? 'pattern-ruled-out' : undefined}
                              >
                                <span>{i18n._(patternName)}</span>
                                <strong>
                                  {probability === 0 ? percent(0) : patternPercent(probability)}
                                </strong>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="price-table-legend" id={`${id}-legend`}>
        <span>
          <i className="price-key-reported" />
          <Trans>Reported</Trans>
        </span>
        <span>
          <i className="price-key-predicted" />
          <Trans>Could be (min–max)</Trans>
        </span>
        <span>
          — <Trans>Unavailable</Trans>
        </span>
      </div>
    </div>
  );
}
