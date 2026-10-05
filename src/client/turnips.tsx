import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, Minus, Pencil, Plus, X } from 'lucide-react';
import {
  averageCost,
  heldCost,
  madeSoFar,
  totalsOf,
  TRADE_QUANTITY_MAX,
  tradesProblem,
  unsold,
  weekResult,
  type Trade,
} from '../shared/ledger';
import { PURCHASE_PRICE_RANGE, SELLING_PRICE_RANGE, type OwnWeekRecord } from '../shared/week';
import { slotName } from './advice';
import { Button } from './ui';
import './turnips.css';

export const bells = (value: number) => Math.round(value).toLocaleString();
export const signedBells = (value: number) => `${value < 0 ? '−' : '+'}${bells(Math.abs(value))}`;
/** Averages show one decimal only when they aren't whole. */
export const average = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const tone = (value: number) => (value < 0 ? 'bells-down' : 'bells-up');

/** Where focus goes when a closed sheet's opener is gone. */
const TRADES_ID = 'week-trades';
/** The card holding the week's turnips, where the Sunday card's turnips field leads. */
export const TURNIPS_ID = 'week-turnips';

interface SheetRequest {
  kind: Trade['kind'];
  editing?: Trade;
}

function TradeList({
  trades,
  onEdit,
}: {
  trades: readonly Trade[];
  onEdit?: (trade: Trade) => void;
}) {
  return (
    <ul className="trade-list">
      {trades.map((trade) => {
        const what = `${bells(trade.quantity)} at ${trade.price}`;
        const amount = trade.quantity * trade.price;
        return (
          <li key={trade.id} className="trade-row" data-kind={trade.kind}>
            <span className={`trade-tag trade-${trade.kind}`}>
              {trade.kind === 'buy' ? 'Bought' : 'Sold'}
            </span>
            <span className="trade-when">
              {trade.kind === 'buy' ? 'Sunday' : slotName(trade.slot)}
            </span>
            <span className="trade-amount">{what}</span>
            <span className={`trade-bells ${trade.kind === 'buy' ? 'bells-down' : 'bells-up'}`}>
              {signedBells(trade.kind === 'buy' ? -amount : amount)}
            </span>
            {onEdit && (
              <button
                type="button"
                className="trade-edit"
                aria-label={`Edit ${trade.kind === 'buy' ? 'purchase' : 'sale'} of ${what}`}
                onClick={() => onEdit(trade)}
              >
                <Pencil size={17} aria-hidden="true" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Tile({
  label,
  value,
  detail,
  variant,
  valueTone,
  wide = false,
}: {
  label: ReactNode;
  value: string;
  detail?: ReactNode;
  variant?: 'leaf' | 'gold' | 'clay';
  valueTone?: string;
  wide?: boolean;
}) {
  return (
    <div className={`turnips-tile${variant ? ` tile-${variant}` : ''}${wide ? ' tile-wide' : ''}`}>
      <dt>{label}</dt>
      <dd className={`tile-value${valueTone ? ` ${valueTone}` : ''}`}>{value}</dd>
      {detail && <dd className="tile-detail">{detail}</dd>}
    </div>
  );
}

const digits = (value: string, length: number) => value.replace(/\D/g, '').slice(0, length);

/** Logs or edits one purchase or sale; nothing changes until it's saved. */
function TradeSheet({
  request,
  week,
  saleSlots,
  currentSlot,
  onSave,
  onClose,
  returnFocus,
}: {
  request: SheetRequest;
  week: OwnWeekRecord;
  /** Half-days a sale can be logged for, oldest first. */
  saleSlots: number[];
  currentSlot: number | null;
  onSave: (trades: Trade[]) => void;
  onClose: () => void;
  /** Where focus goes when the button that opened the sheet no longer exists. */
  returnFocus?: HTMLElement | null;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const { editing } = request;
  const [newId] = useState(() => crypto.randomUUID());
  const others = week.trades.filter((trade) => trade.id !== editing?.id);
  const before = totalsOf(others);
  const held = unsold(before);
  const defaultSlot = editing?.kind === 'sell' ? editing.slot : (saleSlots.at(-1) ?? 0);
  const priceFor = (kind: Trade['kind'], slot: number) =>
    String((kind === 'buy' ? week.purchasePrice : week.prices[slot]) ?? '');
  const [kind, setKind] = useState(editing?.kind ?? request.kind);
  const [slot, setSlot] = useState(defaultSlot);
  const [quantity, setQuantity] = useState(() =>
    String(editing?.quantity ?? (request.kind === 'sell' ? held : 4000)),
  );
  const [price, setPrice] = useState(() =>
    editing ? String(editing.price) : priceFor(request.kind, defaultSlot),
  );
  const [priceTouched, setPriceTouched] = useState(Boolean(editing));
  const [removeError, setRemoveError] = useState('');

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  const close = () => dialog.current?.close();

  const count = Number(quantity) || 0;
  const each = Number(price) || 0;
  const trade: Trade =
    kind === 'buy'
      ? { id: editing?.id ?? newId, kind, quantity: count, price: each }
      : { id: editing?.id ?? newId, kind, quantity: count, price: each, slot };
  const trades = editing
    ? week.trades.map((entry) => (entry.id === editing.id ? trade : entry))
    : [...week.trades, trade];
  const after = totalsOf(trades);
  const range = kind === 'buy' ? PURCHASE_PRICE_RANGE : SELLING_PRICE_RANGE;
  const problem = tradesProblem(trades);
  const error = !count
    ? 'Enter how many turnips.'
    : count % 10
      ? 'Turnips come in bunches of 10.'
      : count > TRADE_QUANTITY_MAX
        ? `Log at most ${bells(TRADE_QUANTITY_MAX)} turnips at a time.`
        : !each
          ? 'Enter the price per turnip.'
          : each < range.min || each > range.max
            ? `${kind === 'buy' ? 'Daisy Mae charges' : 'Nook’s Cranny pays'} ${range.min}–${range.max} bells.`
            : problem === 'oversold'
              ? kind === 'sell'
                ? `You’re holding ${bells(held)}. Log what you bought first.`
                : 'Your sales need more turnips than that.'
              : problem === 'too-many'
                ? 'A week holds at most 40 purchases and sales.'
                : problem
                  ? 'Check this entry.'
                  : '';
  const amounts =
    kind === 'sell'
      ? [...new Set([held, 4000, 3000])].filter((amount) => amount > 0 && amount <= held)
      : [8000, 6000, 4000, 3000];
  const total = count * each;
  const gain = madeSoFar(after) - madeSoFar(before);
  const costBefore = averageCost(before);
  const costAfter = averageCost(after);
  const summary =
    kind === 'sell'
      ? [
          { label: 'You get', value: `${bells(total)} bells`, className: 'summary-total' },
          { label: 'These cost you', value: bells(total - gain), className: '' },
          { label: 'Profit on these', value: signedBells(gain), className: tone(gain) },
        ]
      : [
          { label: 'You pay', value: `${bells(total)} bells`, className: 'summary-total' },
          {
            label: 'Average cost',
            value:
              costAfter === null
                ? '—'
                : costBefore === null
                  ? average(costAfter)
                  : `${average(costBefore)} → ${average(costAfter)}`,
            className: '',
          },
        ];

  function switchTo(next: Trade['kind']) {
    setKind(next);
    setQuantity(String(next === 'sell' ? held : 4000));
    setPrice(priceFor(next, slot));
    setPriceTouched(false);
  }
  function save() {
    if (error) return;
    onSave(trades);
    close();
  }
  function remove() {
    if (tradesProblem(others)) {
      setRemoveError('Your sales need these turnips. Change or remove a sale first.');
      return;
    }
    onSave(others);
    close();
  }

  const title = editing
    ? `Edit ${kind === 'buy' ? 'purchase' : 'sale'}`
    : kind === 'buy'
      ? 'Log a purchase'
      : 'Log a sale';
  return (
    <dialog
      ref={dialog}
      className="trade-sheet"
      aria-labelledby={`${id}-title`}
      onClose={() => {
        onClose();
        requestAnimationFrame(() => {
          const lost = !document.activeElement || document.activeElement === document.body;
          if (lost) returnFocus?.focus();
        });
      }}
      onClick={(event) => {
        // A tap on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) close();
      }}
    >
      <form
        className="trade-sheet-body"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="trade-sheet-heading">
          <h2 id={`${id}-title`}>{title}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={close}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {!editing && saleSlots.length > 0 && (
          <div className="segmented" role="group" aria-label="Kind of trade">
            <button
              type="button"
              aria-pressed={kind === 'sell'}
              onClick={() => kind !== 'sell' && switchTo('sell')}
            >
              Sold
            </button>
            <button
              type="button"
              aria-pressed={kind === 'buy'}
              onClick={() => kind !== 'buy' && switchTo('buy')}
            >
              Bought
            </button>
          </div>
        )}
        <div className="field sheet-field">
          {kind === 'sell' ? (
            <>
              <label htmlFor={`${id}-when`}>When</label>
              <select
                id={`${id}-when`}
                value={slot}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setSlot(next);
                  if (!priceTouched) setPrice(priceFor('sell', next));
                }}
              >
                {[...new Set([...saleSlots, defaultSlot])]
                  .sort((left, right) => left - right)
                  .map((option) => (
                    <option key={option} value={option}>
                      {slotName(option)}
                      {option === currentSlot ? ' (now)' : ''}
                    </option>
                  ))}
              </select>
            </>
          ) : (
            <>
              <span className="field-label">When</span>
              <p className="sheet-static">Sunday, from Daisy Mae</p>
            </>
          )}
        </div>
        <div className="field sheet-field">
          <label htmlFor={`${id}-quantity`}>Turnips</label>
          <div className="amount-row">
            <button
              type="button"
              className="amount-step"
              aria-label="100 fewer"
              onClick={() => setQuantity(String(Math.max(0, count - 100)))}
            >
              <Minus size={18} aria-hidden="true" />
            </button>
            <input
              id={`${id}-quantity`}
              className="sheet-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={count ? bells(count) : quantity}
              onChange={(event) => setQuantity(digits(event.target.value, 6))}
            />
            <button
              type="button"
              className="amount-step"
              aria-label="100 more"
              onClick={() => setQuantity(String(Math.min(TRADE_QUANTITY_MAX, count + 100)))}
            >
              <Plus size={18} aria-hidden="true" />
            </button>
          </div>
          {amounts.length > 0 && (
            <div className="amount-picks" role="group" aria-label="Quick amounts">
              {amounts.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  aria-pressed={count === amount}
                  onClick={() => setQuantity(String(amount))}
                >
                  {bells(amount)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="field sheet-field">
          <label htmlFor={`${id}-price`}>Bells per turnip</label>
          <input
            id={`${id}-price`}
            className="sheet-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={price}
            onChange={(event) => {
              setPrice(digits(event.target.value, 3));
              setPriceTouched(true);
            }}
          />
        </div>
        <div className="sheet-summary">
          {summary.map((row) => (
            <p key={row.label}>
              <span>{row.label}</span>
              <strong className={row.className}>{row.value}</strong>
            </p>
          ))}
          <p className="sheet-after">
            Holding {bells(held)} → {bells(unsold(after))} turnips
          </p>
        </div>
        {(error || removeError) && (
          <p className="sheet-error" role="alert">
            {removeError || error}
          </p>
        )}
        <Button type="submit" disabled={Boolean(error)}>
          {editing ? 'Save' : kind === 'buy' ? 'Log purchase' : 'Log sale'}
        </Button>
        {editing && (
          <button type="button" className="text-button sheet-remove" onClick={remove}>
            Remove this {kind === 'buy' ? 'purchase' : 'sale'}
          </button>
        )}
      </form>
    </dialog>
  );
}

/**
 * The Sunday card's turnips: how many were bought, read-only like a price box.
 * Empty, it logs a purchase; otherwise it leads to the card with the week's trades.
 */
export function SundayTurnips({
  week,
  editable,
  onTrades,
}: {
  week: OwnWeekRecord;
  editable: boolean;
  onTrades: (trades: Trade[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const { bought } = totalsOf(week.trades);
  const count = bells(bought);
  if (!bought && !editable)
    return (
      <span className="sunday-turnips">
        <span aria-hidden="true">—</span>
        <span className="sr-only">No turnips bought</span>
      </span>
    );
  function showTurnips() {
    const card = document.getElementById(TURNIPS_ID);
    if (!card) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    card.focus({ preventScroll: true });
  }
  return (
    <>
      <button
        type="button"
        className={`sunday-turnips${bought ? '' : ' is-empty'}${count.length > 6 ? ' is-long' : ''}`}
        aria-label={
          bought
            ? `${count} turnips bought. Go to your turnips`
            : 'No turnips bought. Log a purchase'
        }
        onClick={bought ? showTurnips : () => setAdding(true)}
      >
        {bought ? count : <Plus size={18} aria-hidden="true" />}
      </button>
      {adding && (
        <TradeSheet
          request={{ kind: 'buy' }}
          week={week}
          saleSlots={[]}
          currentSlot={null}
          onSave={onTrades}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

/**
 * This week's turnips, laid out by the hold-or-sell card around its forecast:
 * the tiles, the log buttons, and the week's trades.
 */
export function WeekTurnips({
  week,
  slot,
  onTrades,
}: {
  week: OwnWeekRecord;
  /** The current half-day, or null on Sunday, when nothing can be sold. */
  slot: number | null;
  onTrades: (trades: Trade[]) => void;
}) {
  const [request, setRequest] = useState<SheetRequest | null>(null);
  const actions = useRef<HTMLDivElement>(null);
  const totals = totalsOf(week.trades);
  const held = unsold(totals);
  const canSell = slot !== null && held > 0;
  const price = slot === null ? null : week.prices[slot];
  const sellAll = canSell && price !== null ? held * price - heldCost(totals) : null;
  const sold = madeSoFar(totals);
  return (
    <>
      {week.trades.length > 0 && (
        <dl className="turnips-tiles">
          {sellAll !== null && (
            <Tile
              label={
                <>
                  Sell all now<span className="tile-narrow"> at {price}</span>
                </>
              }
              value={signedBells(sellAll)}
              detail={
                <>
                  <span className="tile-roomy">
                    at {price}
                    {totals.sold ? ' · ' : ''}
                  </span>
                  {totals.sold ? `week total ${signedBells(sold + sellAll)}` : null}
                </>
              }
              variant="gold"
              valueTone={tone(sellAll)}
              wide
            />
          )}
          {totals.sold > 0 && (
            <Tile
              label="Made so far"
              value={signedBells(sold)}
              detail={`on the ${bells(totals.sold)} sold`}
              variant={sold < 0 ? 'clay' : 'leaf'}
              valueTone={tone(sold)}
            />
          )}
          {held > 0 && (
            <Tile label="Holding" value={bells(held)} detail={`cost ${bells(heldCost(totals))}`} />
          )}
        </dl>
      )}
      <div className="turnips-actions" ref={actions}>
        <Button secondary={canSell} onClick={() => setRequest({ kind: 'buy' })}>
          <Plus size={18} aria-hidden="true" />
          Log a purchase
        </Button>
        {canSell && (
          <Button onClick={() => setRequest({ kind: 'sell' })}>
            <Plus size={18} aria-hidden="true" />
            Log a sale
          </Button>
        )}
      </div>
      {week.trades.length > 0 && (
        <section
          className="turnips-trades"
          id={TRADES_ID}
          tabIndex={-1}
          aria-labelledby={`${TRADES_ID}-title`}
        >
          <h3 id={`${TRADES_ID}-title`}>This week’s trades</h3>
          <TradeList
            trades={week.trades}
            onEdit={(trade) => setRequest({ kind: trade.kind, editing: trade })}
          />
        </section>
      )}
      {request && (
        <TradeSheet
          key={request.editing?.id ?? request.kind}
          request={request}
          week={week}
          saleSlots={slot === null ? [] : Array.from({ length: slot + 1 }, (_, index) => index)}
          currentSlot={slot}
          onSave={onTrades}
          onClose={() => setRequest(null)}
          returnFocus={
            document.getElementById(TRADES_ID) ?? actions.current?.querySelector('button')
          }
        />
      )}
    </>
  );
}

/** A finished week's turnips. Last week can still be changed; older weeks are read-only. */
export function PastTurnips({
  week,
  lastWeek,
  editable,
  onTrades,
}: {
  week: OwnWeekRecord;
  lastWeek: boolean;
  editable: boolean;
  onTrades: (trades: Trade[]) => void;
}) {
  const id = useId();
  const [request, setRequest] = useState<SheetRequest | null>(null);
  if (!week.trades.length && !editable) return null;
  const totals = totalsOf(week.trades);
  const result = weekResult(totals);
  const rotted = unsold(totals);
  const cost = averageCost(totals);
  return (
    <section className="past-turnips" id={TURNIPS_ID} tabIndex={-1} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{lastWeek ? 'Last week’s turnips' : 'Turnips'}</h2>
      {week.trades.length === 0 ? (
        <p className="muted">No turnips logged.</p>
      ) : (
        <>
          <div className={`turnips-result ${result < 0 ? 'result-loss' : ''}`}>
            <span className="tile-label">Week result</span>
            <strong className={tone(result)}>{signedBells(result)}</strong>
            <span className="tile-detail">
              {bells(totals.earned)} earned − {bells(totals.spent)} spent
            </span>
          </div>
          <dl className="turnips-tiles">
            <Tile
              label="Bought"
              value={bells(totals.bought)}
              detail={cost === null ? undefined : `at ${average(cost)}`}
            />
            <Tile
              label="Sold"
              value={bells(totals.sold)}
              detail={totals.sold ? `for ${bells(totals.earned)}` : undefined}
            />
            {rotted > 0 && (
              <Tile
                label="Rotted"
                value={bells(rotted)}
                detail={`cost ${bells(heldCost(totals))}`}
                variant="clay"
                valueTone="bells-down"
              />
            )}
          </dl>
          {editable && rotted > 0 && (
            <div className="turnips-rotted">
              <CircleAlert size={20} aria-hidden="true" />
              <div>
                <p className="rotted-title">{bells(rotted)} turnips rotted on Sunday.</p>
                <p>Sold them and forgot to log it?</p>
                <Button secondary onClick={() => setRequest({ kind: 'sell' })}>
                  <Plus size={18} aria-hidden="true" />
                  Log a sale
                </Button>
              </div>
            </div>
          )}
          <div className="turnips-trades" id={TRADES_ID} tabIndex={-1}>
            <TradeList
              trades={week.trades}
              onEdit={
                editable ? (trade) => setRequest({ kind: trade.kind, editing: trade }) : undefined
              }
            />
          </div>
        </>
      )}
      {editable && (
        <div className="turnips-actions">
          <Button secondary onClick={() => setRequest({ kind: 'buy' })}>
            <Plus size={18} aria-hidden="true" />
            Log a purchase
          </Button>
        </div>
      )}
      {request && (
        <TradeSheet
          key={request.editing?.id ?? request.kind}
          request={request}
          week={week}
          saleSlots={Array.from({ length: 12 }, (_, index) => index)}
          currentSlot={null}
          onSave={onTrades}
          onClose={() => setRequest(null)}
          returnFocus={document.getElementById(TRADES_ID)}
        />
      )}
    </section>
  );
}
