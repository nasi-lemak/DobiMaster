import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { MachineState } from '@dobi/shared';

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink hover:opacity-90',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2',
  danger: 'bg-critical text-white hover:opacity-90',
};

export function Button({ variant = 'primary', size = 'md', className, block, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; block?: boolean }) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:opacity-50 disabled:pointer-events-none',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : size === 'lg' ? 'px-5 py-3.5 text-base' : 'px-4 py-2.5 text-sm',
        block && 'w-full',
        variants[variant],
        className,
      )}
    />
  );
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx('rounded-2xl bg-surface border border-line', className)}>
      {children}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-label="Loading" className={cx('inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex justify-center py-16 text-muted">
      <Spinner />
    </div>
  );
}

export function ErrorBox({ message, onRetry, retryLabel = 'Try again' }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="rounded-2xl border border-line bg-surface p-4 text-sm">
      <p className="text-critical-ink">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line p-6 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

/**
 * Machine state visuals. Colour always comes with an icon and a text label (never colour alone).
 * Colours are the reserved status palette; "running" uses the brand/info blue.
 */
export const STATE_STYLE: Record<MachineState, { dot: string; text: string; bg: string; icon: string }> = {
  available: { dot: 'bg-good', text: 'text-good-ink', bg: 'bg-good/10', icon: '●' },
  running: { dot: 'bg-series-1', text: 'text-info-ink', bg: 'bg-series-1/10', icon: '◐' },
  finished: { dot: 'bg-warning', text: 'text-warning-ink', bg: 'bg-warning/15', icon: '◉' },
  offline: { dot: 'bg-muted', text: 'text-muted', bg: 'bg-surface-2', icon: '○' },
  fault: { dot: 'bg-critical', text: 'text-critical-ink', bg: 'bg-critical/10', icon: '✕' },
  maintenance: { dot: 'bg-serious', text: 'text-serious-ink', bg: 'bg-serious/10', icon: '⚙' },
  disabled: { dot: 'bg-muted', text: 'text-muted', bg: 'bg-surface-2', icon: '–' },
};

export function StateBadge({ state, label, className }: { state: MachineState; label: string; className?: string }) {
  const s = STATE_STYLE[state];
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', s.bg, s.text, className)}>
      <span aria-hidden className="text-[10px] leading-none">
        {s.icon}
      </span>
      {label}
    </span>
  );
}

export function Pill({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warning' | 'critical' | 'info' | 'serious'; className?: string }) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-2',
    good: 'bg-good/10 text-good-ink',
    warning: 'bg-warning/15 text-warning-ink',
    critical: 'bg-critical/10 text-critical-ink',
    serious: 'bg-serious/10 text-serious-ink',
    info: 'bg-series-1/10 text-info-ink',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>;
}

export function Field({ label, hint, children, error }: { label: string; hint?: string; children: ReactNode; error?: string | null }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-critical-ink">{error}</span>}
    </label>
  );
}

export const inputClass = 'w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-2 focus:outline-brand';
