import {
  createContext,
  useContext,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { LoaderCircle } from 'lucide-react';
import type { useIdentity } from './data/identity';

export const AppContext = createContext<ReturnType<typeof useIdentity> | null>(null);
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('Missing application context.');
  return context;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function defaultDeviceName(): string {
  return /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'My phone or tablet' : 'My computer';
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

export function dateFromWeek(weekStart: string, offset = 0): Date {
  const [year, month, day] = weekStart.split('-').map(Number);
  return new Date(year, month - 1, day + offset, 12);
}

export function weekLabel(weekStart: string): string {
  const start = dateFromWeek(weekStart);
  const end = dateFromWeek(weekStart, 6);
  return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
