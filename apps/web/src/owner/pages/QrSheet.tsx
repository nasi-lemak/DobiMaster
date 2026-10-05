import { useParams } from 'react-router';
import { QueryState } from '../components/common';
import { PrintShell } from '../components/PrintShell';
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
  const q = useApi<Sheet>(['owner', 'qr-sheet', id], `/owner/shops/${id}/qr-sheet`);

  return (
    <PrintShell hint="A4 · print at 100% scale · cut along the dashed lines">
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
    </PrintShell>
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
