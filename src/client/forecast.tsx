import { useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Sparkles } from 'lucide-react';
import type { PredictionResult } from '../prediction';
import { Notice } from './ui';
import './forecast.css';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ForecastChart({
  prediction,
  prices,
}: {
  prediction: PredictionResult;
  prices: (number | null)[];
}) {
  const id = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const width = 480;
  const height = 230;
  const left = 35;
  const right = 12;
  const top = 15;
  const bottom = 45;
  const ceiling =
    Math.ceil(
      Math.max(
        100,
        ...prediction.slots.map((slot) => slot.max),
        ...prices.map((price) => price ?? 0),
      ) / 100,
    ) * 100;
  const x = (index: number) => left + (index * (width - left - right)) / 11;
  const y = (price: number) => height - bottom - (price / ceiling) * (height - top - bottom);
  const upper = prediction.slots.map((slot, index) => `${x(index)},${y(slot.max)}`).join(' ');
  const lower = [...prediction.slots]
    .reverse()
    .map((slot, index) => `${x(11 - index)},${y(slot.min)}`)
    .join(' ');
  const ticks = [0, ceiling / 2, ceiling];
  const activeIndex = selectedIndex ?? 0;
  const activeSlot = prediction.slots[activeIndex];
  const selectedDay = DAYS[Math.floor(activeIndex / 2)];
  const selectedPeriod = activeIndex % 2 ? 'PM' : 'AM';
  const reportedPrice = prices[activeIndex];
  const selectedDescription = `${selectedDay} ${selectedPeriod}: potential minimum ${activeSlot.min} bells, maximum ${activeSlot.max} bells.${reportedPrice !== null ? ` Reported price: ${reportedPrice} bells.` : ''}`;

  function selectAtPointer(event: MouseEvent<HTMLDivElement>) {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const nearest = Math.round(((point.x - left) / (width - left - right)) * 11);
    setSelectedIndex(Math.max(0, Math.min(11, nearest)));
    event.currentTarget.focus({ preventScroll: true });
  }

  function selectWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    let nextIndex = activeIndex;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        nextIndex = Math.min(11, activeIndex + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        nextIndex = Math.max(0, activeIndex - 1);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = 11;
        break;
      case 'Enter':
      case ' ':
        break;
      case 'Escape':
        event.preventDefault();
        setSelectedIndex(null);
        return;
      default:
        return;
    }
    event.preventDefault();
    setSelectedIndex(nextIndex);
  }

  return (
    <div className="forecast-interaction">
      <p id={`${id}-instructions`} className="forecast-chart-instructions">
        Tap or click a half-day to see its range.
        <span className="sr-only">
          {' '}
          Use arrow keys to move between half-days, Home or End to jump to the first or last
          half-day, and Escape to dismiss the tooltip.
        </span>
      </p>
      <div className="forecast-chart-wrap">
        <div
          className="chart-scroll forecast-chart-control"
          role="slider"
          tabIndex={0}
          aria-label="Weekly price forecast, half-day"
          aria-describedby={`${id}-instructions`}
          aria-valuemin={0}
          aria-valuemax={11}
          aria-valuenow={activeIndex}
          aria-valuetext={selectedDescription}
          onClick={selectAtPointer}
          onFocus={() => setSelectedIndex((current) => current ?? 0)}
          onKeyDown={selectWithKeyboard}
        >
          <svg
            ref={svgRef}
            className="forecast-chart"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-labelledby={`${id}-title ${id}-description`}
          >
            <desc id={`${id}-description`}>
              The shaded area shows possible minimum and maximum prices. Solid dots are prices you
              entered. Select a half-day for its exact range, or see Forecast ranges below.
            </desc>
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="chart-grid"
                />
                <text x={left - 6} y={y(tick) + 4} textAnchor="end" className="chart-label">
                  {tick}
                </text>
              </g>
            ))}
            <polygon points={`${upper} ${lower}`} className="chart-range" />
            <polyline points={upper} className="chart-bound" />
            <polyline
              points={[...prediction.slots]
                .map((slot, index) => `${x(index)},${y(slot.min)}`)
                .join(' ')}
              className="chart-bound"
            />
            {prices.map(
              (price, index) =>
                price !== null && (
                  <g key={index}>
                    {index > 0 && prices[index - 1] !== null && (
                      <line
                        x1={x(index - 1)}
                        y1={y(prices[index - 1]!)}
                        x2={x(index)}
                        y2={y(price)}
                        className="chart-observed-line"
                      />
                    )}
                    <circle cx={x(index)} cy={y(price)} r={4} className="chart-observed">
                      <title>
                        {DAYS[Math.floor(index / 2)]} {index % 2 ? 'PM' : 'AM'}: {price} bells
                        reported
                      </title>
                    </circle>
                  </g>
                ),
            )}
            {selectedIndex !== null && (
              <g className="chart-selection" aria-hidden="true">
                <line
                  x1={x(selectedIndex)}
                  x2={x(selectedIndex)}
                  y1={top}
                  y2={height - bottom}
                  className="chart-selection-guide"
                />
                {[activeSlot.min, activeSlot.max].map((price, index) => (
                  <circle
                    key={index}
                    cx={x(selectedIndex)}
                    cy={y(price)}
                    r={4.5}
                    className="chart-selection-point"
                  />
                ))}
              </g>
            )}
            {prediction.slots.map((slot, index) => (
              <text
                key={index}
                x={x(index)}
                y={height - bottom + 18}
                textAnchor="middle"
                className="chart-label"
              >
                <tspan x={x(index)}>{DAYS[Math.floor(index / 2)].slice(0, 3)}</tspan>
                <tspan x={x(index)} dy="14">
                  {index % 2 ? 'PM' : 'AM'}
                </tspan>
                <title>
                  {slot.min}–{slot.max} bells
                </title>
              </text>
            ))}
          </svg>
        </div>
        {selectedIndex !== null && (
          <div
            className="forecast-chart-tooltip"
            role="tooltip"
            style={{ left: `clamp(90px, ${(x(selectedIndex) / width) * 100}%, calc(100% - 90px))` }}
          >
            <strong className="forecast-tooltip-day">
              {selectedDay} <span>{selectedPeriod}</span>
            </strong>
            <dl className="forecast-tooltip-range">
              <div>
                <dt>Min</dt>
                <dd>{activeSlot.min}</dd>
              </div>
              <div>
                <dt>Max</dt>
                <dd>{activeSlot.max}</dd>
              </div>
            </dl>
            <span className="forecast-tooltip-unit">potential bells per turnip</span>
            {reportedPrice !== null && (
              <span className="forecast-tooltip-reported">Reported: {reportedPrice} bells</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function Forecast({
  prediction,
  prices,
  shared = false,
}: {
  prediction: PredictionResult;
  prices: (number | null)[];
  shared?: boolean;
}) {
  return (
    <aside className="forecast" aria-labelledby="forecast-title">
      {prediction.status === 'needs-input' && (
        <div className="forecast-empty">
          <span className="forecast-empty-icon">
            <Sparkles size={27} aria-hidden="true" />
          </span>
          <p>{shared ? 'No forecast yet.' : 'A little data goes a long way.'}</p>
          <p className="muted">
            {shared
              ? 'This player hasn’t entered prices for this week.'
              : 'Add the prices you know. Leave the rest blank.'}
          </p>
        </div>
      )}
      {prediction.status === 'inconsistent' && (
        <Notice>
          {shared
            ? 'No pattern matches these reported prices.'
            : 'No pattern matches these prices. Check your entries and prediction details. Your prices have been kept.'}
        </Notice>
      )}
      {prediction.status === 'possible' && (
        <>
          <ForecastChart prediction={prediction} prices={prices} />
          <div className="chart-legend">
            <span>
              <i className="legend-range" /> Possible range
            </span>
            <span>
              <i className="legend-dot" /> Entered price
            </span>
          </div>
          <ul className="pattern-list" aria-label="Possible patterns">
            {prediction.patterns.map((pattern) => (
              <li key={pattern.id}>
                <span>{pattern.label}</span>
                <strong>
                  {pattern.probability < 0.001 ? '<0.1' : (pattern.probability * 100).toFixed(1)}%
                </strong>
                <span className="probability-track" aria-hidden="true">
                  <span style={{ width: `${pattern.probability * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
          {prediction.tolerance > 0 && (
            <p className="hint">
              These matches allow a {prediction.tolerance}-bell rounding difference.
            </p>
          )}
          <section className="forecast-ranges" aria-labelledby="forecast-ranges-title">
            <h3 id="forecast-ranges-title" className="forecast-section-heading">
              Forecast ranges
            </h3>
            <table>
              <caption className="sr-only">
                Possible price ranges for every morning and afternoon, in bells
              </caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">AM</th>
                  <th scope="col">PM</th>
                </tr>
              </thead>
              <tbody>
                {DAYS.map((day, dayIndex) => (
                  <tr key={day}>
                    <th scope="row">{day.slice(0, 3)}</th>
                    {[0, 1].map((period) => {
                      const index = dayIndex * 2 + period;
                      const slot = prediction.slots[index];
                      return (
                        <td key={period}>
                          {prices[index] !== null ? (
                            <>
                              <strong>{prices[index]}</strong>
                              <span className="sr-only"> reported</span>
                            </>
                          ) : slot.min === slot.max ? (
                            slot.min
                          ) : (
                            `${slot.min}–${slot.max}`
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <p className="hint forecast-note">
            Ranges show possible outcomes, not a guarantee. Each new price helps narrow them down.
          </p>
        </>
      )}
    </aside>
  );
}
