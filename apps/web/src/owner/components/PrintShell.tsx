import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/ui';
import { Icon } from './icons';

/** A4 printable page without the app chrome: Back / hint / Print toolbar, always black-on-white paper. */
export function PrintShell({ hint, toolbar, children }: { hint: string; toolbar?: ReactNode; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-dvh bg-bg print:bg-white">
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print { html, body { background: #fff !important; } }
        .qr-svg svg { width: 100%; height: auto; display: block; }
      `}</style>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-3">
        <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-2 hover:bg-surface-2">
          <Icon name="back" className="h-4 w-4" /> Back
        </button>
        <p className="hidden text-sm text-muted sm:block">{hint}</p>
        <div className="flex items-center gap-2">
          {toolbar}
          <Button size="sm" onClick={() => window.print()}>
            <Icon name="print" className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>
      <div className="mx-auto max-w-[210mm] p-4 print:max-w-none print:p-0">{children}</div>
    </div>
  );
}
