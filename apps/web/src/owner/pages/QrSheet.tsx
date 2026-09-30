import { useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui';
import { QueryState } from '../components/common';
import { Icon } from '../components/icons';
import { typeLabel } from '../lib/labels';
import { useApi } from '../lib/queries';

interface Sheet {
  shop: { name: string; url: string; svg: string };
  items: Array<{ code: string; type: string; capacityKg: number; url: string; svg: string }>;
}

/**
 * Printable A4 sticker sheet. The QR SVGs are generated server-side by the `qrcode` library from our own
 * URLs, so injecting them as markup is safe. Stickers are always black-on-white regardless of theme.
 */
export function QrSheetPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useApi<Sheet>(['owner', 'qr-sheet', id], `/owner/shops/${id}/qr-sheet`);

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
        <p className="hidden text-sm text-muted sm:block">A4 · print at 100% scale · cut along the dashed lines</p>
        <Button size="sm" onClick={() => window.print()}>
          <Icon name="print" className="h-4 w-4" /> Print
        </Button>
      </div>
      <div className="mx-auto max-w-[210mm] p-4 print:max-w-none print:p-0">
        <QueryState q={q}>
          {() => {
            const s = q.data!;
            return (
              <div className="bg-white text-black">
                <div className="grid grid-cols-2 gap-0 sm:grid-cols-3 print:grid-cols-3">
                  <Sticker svg={s.shop.svg} big={s.shop.name} small="Shop page · availability & hours" url={s.shop.url} shop />
                  {s.items.map((m) => (
                    <Sticker key={m.code} svg={m.svg} big={m.code} small={`${typeLabel(m.type)} · ${m.capacityKg} kg`} url={m.url} />
                  ))}
                </div>
                {s.items.length === 0 && <p className="p-6 text-center text-sm">This shop has no machines yet.</p>}
              </div>
            );
          }}
        </QueryState>
      </div>
    </div>
  );
}

function Sticker({ svg, big, small, url, shop }: { svg: string; big: string; small: string; url: string; shop?: boolean }) {
  return (
    <div className="flex break-inside-avoid flex-col items-center border border-dashed border-black/30 p-3 text-center" style={{ minHeight: '68mm' }}>
      <div className="qr-svg w-[36mm] max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className={shop ? 'mt-1 text-base font-bold leading-tight' : 'mt-1 text-5xl font-black leading-none tracking-tight'}>{big}</div>
      <div className="mt-1 text-[10px] font-medium uppercase tracking-wide">{small}</div>
      <div className="mt-1.5 text-[9px] leading-snug">
        Scan for timer, help &amp; instructions
        <br />
        Imbas untuk pemasa &amp; bantuan
        <br />
        扫码计时与求助
      </div>
      <div className="mt-1 break-all text-[7px] opacity-60">{url}</div>
    </div>
  );
}
