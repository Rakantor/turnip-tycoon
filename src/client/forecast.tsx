import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { PatternId, PredictionResult, PriceRange } from '../prediction';
import { Notice } from './ui';
import './forecast.css';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PATTERNS: { id: PatternId; label: string }[] = [
  { id: 'fluctuating', label: 'Fluctuating' },
  { id: 'large-spike', label: 'Large spike' },
  { id: 'decreasing', label: 'Decreasing' },
  { id: 'small-spike', label: 'Small spike' },
];

export function rangeLabel({ min, max }: PriceRange): string {
  return min === max ? String(min) : `${min}–${max}`;
}

function change(price: number, purchasePrice: number): number {
  return Math.round((price / purchasePrice - 1) * 100);
}

function signed(value: number): string {
  return value > 0 ? `+${value}%` : value < 0 ? `−${Math.abs(value)}%` : '±0%';
}

function ForecastChart({
  prediction,
  prices,
  purchasePrice,
  currentSlot,
  bestSlot,
}: {
  prediction: PredictionResult;
  prices: (number | null)[];
  purchasePrice: number | null;
  currentSlot: number | null;
  bestSlot: number | null;
}) {
  const id = useId();
  const columns = useRef<(HTMLButtonElement | null)[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [focusable, setFocusable] = useState(currentSlot ?? 0);
  const ceiling =
    Math.ceil(
      Math.max(
        100,
        ...prediction.slots.map((slot) => slot.max),
        ...prices.map((price) => price ?? 0),
        purchasePrice ?? 0,
      ) / 100,
    ) * 100;
  // The top 8% of the plot stays clear so a tooltip has room above the tallest bar.
  const height = (price: number) => `${(price / ceiling) * 92}%`;
  const describe = (index: number) => {
    const price = prices[index];
    const slot = prediction.slots[index];
    return `${DAYS[Math.floor(index / 2)]} ${index % 2 ? 'PM' : 'AM'}: ${
      price !== null
        ? `you entered ${price} bells`
        : slot.min === slot.max
          ? `expected ${slot.min} bells`
          : `could be ${slot.min} to ${slot.max} bells`
    }`;
  };

  function select(index: number, focus = false) {
    setSelected(index);
    setFocusable(index);
    if (focus) columns.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const target =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? Math.min(11, index + 1)
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? Math.max(0, index - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? 11
              : null;
    if (event.key === 'Escape') {
      event.preventDefault();
      setSelected(null);
    } else if (target !== null) {
      event.preventDefault();
      select(target, true);
    }
  }

  const active = selected === null ? null : prediction.slots[selected];
  const activePrice = selected === null ? null : prices[selected];
  const center = selected === null ? 0 : ((selected + 0.5) / 12) * 100;
  // The tooltip points at the top of the selected bar, or at the entered price's dot.
  const anchor =
    selected === null || !active
      ? '0px'
      : `calc(${height(activePrice ?? active.max)} + ${activePrice === null ? 10 : 18}px)`;
  const tooltip = useRef<HTMLDivElement>(null);
  const tail = useRef<HTMLSpanElement>(null);

  // Sit just above the anchor, but slide down onto a very tall bar rather than
  // leaving the card: the tooltip may cover the heading, never the page around it.
  useLayoutEffect(() => {
    const place = () => {
      const box = tooltip.current;
      const pointer = tail.current;
      const card = box?.closest('.forecast-card');
      if (!box || !pointer || !card) return;
      box.style.bottom = `calc(${anchor} + 8px)`;
      pointer.style.bottom = anchor;
      const overflow = Math.ceil(
        card.getBoundingClientRect().top + 8 - box.getBoundingClientRect().top,
      );
      if (overflow > 0) {
        box.style.bottom = `calc(${anchor} + 8px - ${overflow}px)`;
        pointer.style.bottom = `calc(${anchor} - ${overflow}px)`;
      }
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, selected]);
  let note: { text: string; tone: string } | null = null;
  if (selected !== null && purchasePrice !== null && active) {
    if (activePrice !== null) {
      const value = change(activePrice, purchasePrice);
      note = { text: `${signed(value)} vs. what you paid`, tone: value >= 0 ? 'up' : 'down' };
    } else {
      const low = change(active.min, purchasePrice);
      const high = change(active.max, purchasePrice);
      note = {
        text:
          low === high
            ? `${signed(low)} vs. what you paid`
            : `${signed(low)} to ${signed(high)} vs. what you paid`,
        tone: low >= 0 ? 'up' : high <= 0 ? 'down' : 'mixed',
      };
    }
  }

  return (
    <div className="forecast-chart">
      <p id={`${id}-instructions`} className="sr-only">
        Select a half-day to see its possible range. Use the arrow keys to move between half-days,
        Home or End to jump to the first or last, and Escape to close the details.
      </p>
      <div className="chart-plot">
        <div className="chart-guides" aria-hidden="true">
          {[ceiling / 2, ceiling].map((tick) => (
            <span key={tick} className="chart-gridline" style={{ bottom: height(tick) }}>
              <span>{tick}</span>
            </span>
          ))}
          {purchasePrice !== null && (
            <span className="chart-buy-line" style={{ bottom: height(purchasePrice) }} />
          )}
        </div>
        <div
          className="chart-columns"
          role="group"
          aria-label="Weekly price forecast by half-day"
          aria-describedby={`${id}-instructions`}
        >
          {prediction.slots.map((slot, index) => {
            const price = prices[index];
            const classes = [
              'chart-column',
              selected === index && 'is-selected',
              currentSlot === index && 'is-now',
              bestSlot === index && 'is-best',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={index}
                ref={(element) => {
                  columns.current[index] = element;
                }}
                type="button"
                className={classes}
                aria-label={describe(index)}
                aria-pressed={selected === index}
                tabIndex={index === focusable ? 0 : -1}
                onClick={() => (selected === index ? setSelected(null) : select(index))}
                onKeyDown={(event) => onKeyDown(event, index)}
              >
                <span className="chart-track">
                  {price === null ? (
                    <span
                      className="chart-bar"
                      style={{ bottom: height(slot.min), height: height(slot.max - slot.min) }}
                    />
                  ) : (
                    <>
                      <span className="chart-dot" style={{ bottom: height(price) }} />
                      <span className="chart-dot-label" style={{ bottom: height(price) }}>
                        {price}
                      </span>
                    </>
                  )}
                </span>
                <span className="chart-half">{index % 2 ? 'PM' : 'AM'}</span>
              </button>
            );
          })}
        </div>
        <div className="chart-overlay" aria-live="polite">
          {selected !== null && active && (
            <>
              <div
                ref={tooltip}
                className="chart-tooltip"
                style={{
                  left: `clamp(var(--tip-half), ${center}%, calc(100% - var(--tip-half)))`,
                }}
              >
                <div className="chart-tooltip-heading">
                  <strong>
                    {DAYS[Math.floor(selected / 2)]} {selected % 2 ? 'PM' : 'AM'}
                  </strong>
                  <button
                    type="button"
                    className="chart-tooltip-close"
                    aria-label="Close half-day details"
                    onClick={() => {
                      setSelected(null);
                      columns.current[selected]?.focus();
                    }}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
                {activePrice !== null ? (
                  <dl className="chart-tooltip-values">
                    <div>
                      <dt>You entered</dt>
                      <dd className="value-entered">{activePrice}</dd>
                    </div>
                  </dl>
                ) : (
                  <dl className="chart-tooltip-values">
                    <div>
                      <dt>Low</dt>
                      <dd>{active.min}</dd>
                    </div>
                    <span className="chart-tooltip-dash" aria-hidden="true">
                      –
                    </span>
                    <div>
                      <dt>High</dt>
                      <dd className="value-high">{active.max}</dd>
                    </div>
                  </dl>
                )}
                <p className={`chart-tooltip-note${note ? ` note-${note.tone}` : ''}`}>
                  {note?.text ?? 'bells per turnip'}
                </p>
              </div>
              <span
                ref={tail}
                className="chart-tooltip-tail"
                style={{ left: `${center}%` }}
                aria-hidden="true"
              />
            </>
          )}
        </div>
      </div>
      <div className="chart-days" aria-hidden="true">
        {DAYS.map((day, dayIndex) => (
          <span
            key={day}
            className={
              selected !== null && Math.floor(selected / 2) === dayIndex ? 'is-selected' : undefined
            }
          >
            {day.slice(0, 3)}
          </span>
        ))}
      </div>
    </div>
  );
}

function PatternOdds({ prediction }: { prediction: PredictionResult }) {
  const id = useId();
  const patterns = PATTERNS.map((pattern) => ({
    ...pattern,
    probability: prediction.patterns.find((result) => result.id === pattern.id)?.probability ?? 0,
  })).sort((left, right) => right.probability - left.probability);
  return (
    <section className="pattern-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>This week’s pattern</h2>
      <ul className="pattern-list" aria-label="Possible patterns">
        {patterns.map((pattern) => (
          <li
            key={pattern.id}
            className={pattern.probability === 0 ? 'pattern-ruled-out' : undefined}
          >
            <span className="pattern-name">{pattern.label}</span>
            <strong>
              {pattern.probability === 0
                ? 'Ruled out'
                : pattern.probability < 0.001
                  ? '<0.1%'
                  : `${(pattern.probability * 100).toFixed(1)}%`}
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
      <p className="hint">
        Ranges show possible outcomes, not a guarantee. Each new price helps narrow them down.
      </p>
    </section>
  );
}

export function Forecast({
  prediction,
  prices,
  purchasePrice,
  currentSlot = null,
  bestSlot = null,
  shared = false,
}: {
  prediction: PredictionResult;
  prices: (number | null)[];
  purchasePrice: number | null;
  currentSlot?: number | null;
  bestSlot?: number | null;
  shared?: boolean;
}) {
  const id = useId();
  return (
    <div className="forecast">
      <section className="forecast-card" aria-labelledby={`${id}-title`}>
        <div className="forecast-card-heading">
          <h2 id={`${id}-title`}>How the week could go</h2>
          {prediction.status === 'possible' && (
            <div className="chart-legend" aria-hidden="true">
              <span>
                <i className="legend-dot" /> {shared ? 'Reported' : 'Your price'}
              </span>
              <span>
                <i className="legend-range" /> Could be
              </span>
              {purchasePrice !== null && (
                <span>
                  <i className="legend-buy" /> {shared ? 'Bought for' : 'You paid'} {purchasePrice}
                </span>
              )}
            </div>
          )}
        </div>
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
              : 'No pattern matches these prices. Check your entries and week settings. Your prices have been kept.'}
          </Notice>
        )}
        {prediction.status === 'possible' && (
          <ForecastChart
            prediction={prediction}
            prices={prices}
            purchasePrice={purchasePrice}
            currentSlot={currentSlot}
            bestSlot={bestSlot}
          />
        )}
      </section>
      {prediction.status === 'possible' && <PatternOdds prediction={prediction} />}
    </div>
  );
}
