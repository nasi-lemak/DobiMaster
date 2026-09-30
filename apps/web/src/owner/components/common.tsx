import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, cx, EmptyState, ErrorBox, inputClass, PageLoader } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { errorMessage } from '../lib/queries';
import { useMe } from '../lib/session';
import type { Severity } from '../lib/types';
import { SEVERITY_LABEL } from '../lib/labels';
import { Icon, type IconName } from './icons';

// ---------------------------------------------------------------------------------------------
// Page chrome

export function PageHeader({ title, subtitle, back, actions }: { title: ReactNode; subtitle?: ReactNode; back?: string | true; actions?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header className="no-print mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        {back && (
          <button
            type="button"
            onClick={() => (back === true ? navigate(-1) : navigate(back))}
            className="-ml-2 mt-0.5 rounded-full p-1.5 text-ink-2 hover:bg-surface-2"
            aria-label="Back"
          >
            <Icon name="back" />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight lg:text-2xl">{title}</h1>
          {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, action, children, className, id }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  // Always label the section by its heading so it is a named landmark (screen readers, e2e locators).
  const autoId = useId();
  const headingId = id ?? autoId;
  return (
    <section className={cx('mt-6', className)} aria-labelledby={headingId}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Loading / error wrapper for a react-query result. */
export function QueryState({ q, children }: { q: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }; children: () => ReactNode }) {
  if (q.isPending) return <PageLoader />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 403)
      return <EmptyState title="Not available to you">This belongs to a branch or area your role can't open.</EmptyState>;
    if (q.error instanceof ApiError && q.error.status === 404) return <EmptyState title="Not found">It may have been removed.</EmptyState>;
    return <ErrorBox message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  }
  return <>{children()}</>;
}

export function MutationError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-critical-ink">
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
      {errorMessage(error)}
    </p>
  );
}

// ---------------------------------------------------------------------------------------------
// Status: always icon + label, never colour alone.

export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'info' | 'neutral';

const TONE: Record<Tone, { cls: string; icon: IconName }> = {
  good: { cls: 'bg-good/10 text-good-ink', icon: 'checkCircle' },
  warning: { cls: 'bg-warning/15 text-warning-ink', icon: 'alert' },
  serious: { cls: 'bg-serious/10 text-serious-ink', icon: 'alert' },
  critical: { cls: 'bg-critical/10 text-critical-ink', icon: 'xCircle' },
  info: { cls: 'bg-series-1/10 text-info-ink', icon: 'info' },
  neutral: { cls: 'bg-surface-2 text-ink-2', icon: 'info' },
};

export function StatusTag({ tone, children, icon, className }: { tone: Tone; children: ReactNode; icon?: IconName; className?: string }) {
  const t = TONE[tone];
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', t.cls, className)}>
      <Icon name={icon ?? t.icon} className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}

export const severityTone = (s: Severity): Tone => (s === 'high' ? 'critical' : s === 'medium' ? 'serious' : 'warning');

export function SeverityTag({ severity, withWord = false }: { severity: Severity; withWord?: boolean }) {
  return (
    <StatusTag tone={severityTone(severity)}>
      {SEVERITY_LABEL[severity]}
      {withWord ? ' priority' : ''}
    </StatusTag>
  );
}

// ---------------------------------------------------------------------------------------------
// Figures

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-good-ink',
  warning: 'text-warning-ink',
  serious: 'text-serious-ink',
  critical: 'text-critical-ink',
  info: 'text-info-ink',
  neutral: 'text-muted',
};

/** Stat tile: label · value · optional hint. A status tone adds an icon next to the label (never colour alone). */
export function StatTile({ label, value, hint, tone, to }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; to?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-1 text-xs font-medium text-muted">
        {tone && tone !== 'neutral' && <Icon name={TONE[tone].icon} className={cx('h-3.5 w-3.5', TONE_TEXT[tone])} />}
        {label}
      </div>
      <div className="mt-1 whitespace-nowrap text-2xl font-semibold leading-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </>
  );
  const cls = 'relative block rounded-2xl border border-line bg-surface p-3.5';
  return to ? (
    <Link to={to} className={cx(cls, 'hover:bg-surface-2')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Horizontal meter. The track is a lighter step of the fill, per the meter contract. */
export function Meter({ value, tone = 'info', label, className }: { value: number; tone?: Tone; label: string; className?: string }) {
  const fill = { good: 'bg-good', warning: 'bg-warning', serious: 'bg-serious', critical: 'bg-critical', info: 'bg-series-1', neutral: 'bg-muted' }[tone];
  const track = { good: 'bg-good/15', warning: 'bg-warning/20', serious: 'bg-serious/15', critical: 'bg-critical/15', info: 'bg-series-1/15', neutral: 'bg-surface-2' }[tone];
  const pctv = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pctv)}
      className={cx('h-2 w-full overflow-hidden rounded-full', track, className)}
    >
      <div className={cx('h-full rounded-full', fill)} style={{ width: `${pctv}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Inputs

export function Segmented<T extends string | number>({ label, options, value, onChange, size = 'md' }: { label: string; options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-xl bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-[10px] font-medium transition',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            o.value === value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ShopSelect({ value, onChange, allowAll = true, label = 'Shop', className }: { value: string; onChange: (id: string) => void; allowAll?: boolean; label?: string; className?: string }) {
  const me = useMe();
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cx(inputClass, 'py-2 pr-8')}>
        {allowAll && <option value="">All shops</option>}
        {me.shops.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-3 py-1.5', disabled && 'opacity-50')}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className={cx(
          'relative mt-0.5 inline-block h-5 w-9 shrink-0 rounded-full transition peer-focus-visible:outline-2 peer-focus-visible:outline-brand',
          checked ? 'bg-brand' : 'bg-surface-2 ring-1 ring-line',
        )}
      >
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------------------------
// Modal / bottom sheet

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    (first ?? ref.current)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx('flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-line bg-surface shadow-xl sm:rounded-3xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="font-semibold">
            {title}
          </h2>
          <button type="button" data-close onClick={onClose} aria-label="Close" className="-mr-2 rounded-full p-1.5 text-muted hover:bg-surface-2">
            <Icon name="x" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** A button that asks for confirmation before running a destructive action. */
export function ConfirmButton({
  children,
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  pending,
  error,
  variant = 'secondary',
  size = 'sm',
  danger = true,
  className,
}: {
  children: ReactNode;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<unknown> | void;
  pending?: boolean;
  error?: unknown;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  danger?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => setOpen(true)} disabled={pending}>
        {children}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={danger ? 'danger' : 'primary'}
              disabled={pending}
              onClick={async () => {
                try {
                  await onConfirm();
                  setOpen(false);
                } catch {
                  /* error shown below via `error` */
                }
              }}
            >
              {pending ? 'Working…' : confirmLabel}
            </Button>
          </>
        }
      >
        <div className="text-sm text-ink-2">{message}</div>
        <MutationError error={error} />
      </Modal>
    </>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard blocked: the text is selectable anyway */
        }
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} className="h-4 w-4" />
      {copied ? 'Copied' : label}
    </Button>
  );
}

/** Responsive table wrapper: scrolls horizontally inside its card, never the page. */
export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('relative overflow-x-auto rounded-2xl border border-line bg-surface', className)}>
      <table className="w-full min-w-max border-collapse text-sm">{children}</table>
    </div>
  );
}

export const th = 'border-b border-line px-3 py-2 text-left text-xs font-medium text-muted';
export const td = 'border-b border-line px-3 py-2 align-top';
