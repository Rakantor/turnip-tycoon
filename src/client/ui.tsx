import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { LoaderCircle } from 'lucide-react';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import type { useIdentity } from './data/identity';

export const AppContext = createContext<ReturnType<typeof useIdentity> | null>(null);
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('Missing application context.');
  return context;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : t`Something went wrong. Please try again.`;
}

export function defaultDeviceName(): string {
  return /Android|iPhone|iPad/i.test(navigator.userAgent) ? t`My phone or tablet` : t`My computer`;
}

export function Button({
  children,
  busy = false,
  secondary = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; secondary?: boolean }) {
  return (
    <button
      {...props}
      className={`button${secondary ? ' button-secondary' : ''}${props.className ? ` ${props.className}` : ''}`}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input {...props} id={id} aria-describedby={hint ? `${id}-hint` : undefined} />
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Notice({ children, success = false }: { children: ReactNode; success?: boolean }) {
  return (
    <p className={`notice${success ? ' notice-success' : ''}`} role={success ? 'status' : 'alert'}>
      {children}
    </p>
  );
}

/** Placeholders stay invisible this long, so quick responses never flash. */
const PLACEHOLDER_DELAY = 200;

/** A shape standing in for a value that hasn't loaded; sized in ems to match its text. */
export function Placeholder({
  width,
  height,
  round = false,
  className,
}: {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  round?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`placeholder${round ? ' placeholder-round' : ''}${className ? ` ${className}` : ''}`}
      style={{ width, height }}
    />
  );
}

/** Draws a component's frame while its data loads; assistive tech hears only the label. */
export function Loading({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`loading${className ? ` ${className}` : ''}`}>
      <span className="sr-only" role="status">
        {label}
      </span>
      <div className="loading-frame" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}

/** A class that fades content in when it replaces placeholders someone actually saw. */
export function useReveal(placeholder: boolean): string {
  const since = useRef<number | null>(null);
  const [reveal, setReveal] = useState(false);
  useLayoutEffect(() => {
    if (placeholder) {
      since.current ??= performance.now();
      setReveal(false);
    } else if (since.current !== null) {
      setReveal(performance.now() - since.current >= PLACEHOLDER_DELAY);
      since.current = null;
    }
  }, [placeholder]);
  return reveal ? 'reveal' : '';
}

export function dateFromWeek(weekStart: string, offset = 0): Date {
  const [year, month, day] = weekStart.split('-').map(Number);
  return new Date(year, month - 1, day + offset, 12);
}

export function weekLabel(weekStart: string): string {
  const start = dateFromWeek(weekStart);
  const end = dateFromWeek(weekStart, 6);
  return new Intl.DateTimeFormat(i18n.locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).formatRange(start, end);
}
