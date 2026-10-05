import { useParams } from 'react-router';
import type { Locale } from '@dobi/shared';
import { translate } from '../../lib/i18n';
import { QueryState } from '../components/common';
import { PrintShell } from '../components/PrintShell';
import { useApi } from '../lib/queries';

interface Sheet {
  shop: { name: string; url: string; svg: string };
}

/** Per-language poster copy. Button names come from the customer app's own translations, so they always match. */
const COPY: Array<{ locale: Locale; headline: string; step1: string; step3: string; note: (report: string) => string }> = [
  {
    locale: 'ms',
    headline: 'Imbas untuk lihat mesin yang kosong — dan dapatkan amaran bila dobi anda hampir siap',
    step1: 'Imbas QR pada mesin anda',
    step3: 'Kami beritahu anda bila hampir siap',
    note: (report) => `Tiada aplikasi, tiada pendaftaran. Mesin bermasalah? Imbas QR mesin → “${report}”.`,
  },
  {
    locale: 'en',
    headline: 'Scan to see free machines — and get told when your laundry is almost done',
    step1: 'Scan the QR on your machine',
    step3: 'We tell you when it’s almost done',
    note: (report) => `No app, no sign-up. Problem with a machine? Scan its QR → “${report}”.`,
  },
  {
    locale: 'zh',
    headline: '扫码查看空闲机器 —— 衣服快洗好时提醒你',
    step1: '扫描机器上的二维码',
    step3: '快好时我们会提醒你',
    note: (report) => `无需下载应用，无需注册。机器有问题？扫描机器二维码 →“${report}”。`,
  },
];

/** A4 wall poster for the shop: big shop QR plus how-it-works in BM / EN / 中文. Always black on white. */
export function PosterPage() {
  const { id = '' } = useParams();
  const q = useApi<Sheet>(['owner', 'qr-sheet', id], `/owner/shops/${id}/qr-sheet`);

  return (
    <PrintShell hint="A4 portrait · print at 100% scale · put it by the entrance or the change machine">
      <QueryState q={q}>
        {() => {
          const s = q.data!;
          const origin = new URL(s.shop.url).origin;
          return (
            // Fixed A4 height (297 mm minus 10 mm margins, with a little slack): the QR takes whatever
            // height is left, so a long shop name shrinks the QR instead of spilling onto a second page.
            <div className="mx-auto flex h-[275mm] flex-col bg-white px-[10mm] py-[8mm] text-black">
              <style>{`.qr-fit svg { height: 100%; width: auto; max-height: 85mm; display: block; }`}</style>
              <header className="text-center">
                <h1 className="text-4xl font-black leading-tight">{s.shop.name}</h1>
                <p className="mt-1 text-sm font-medium uppercase tracking-widest">Mesin kosong · Free machines · 空闲机器</p>
              </header>
              <div className="qr-fit my-[5mm] flex min-h-[45mm] flex-1 justify-center" dangerouslySetInnerHTML={{ __html: s.shop.svg }} />
              <div className="space-y-[5mm]">
                {COPY.map((c) => (
                  <section key={c.locale} className="border-t-2 border-black pt-[3mm]">
                    <h2 className="text-xl font-bold leading-snug">{c.headline}</h2>
                    <ol className="mt-2 grid grid-cols-3 gap-3 text-[15px] leading-snug">
                      <Step n={1} text={c.step1} />
                      <Step n={2} text={`“${translate(c.locale, 'startTimer')}”`} />
                      <Step n={3} text={c.step3} />
                    </ol>
                    <p className="mt-2 text-[13px]">{c.note(translate(c.locale, 'reportProblem'))}</p>
                  </section>
                ))}
              </div>
              <footer className="mt-[5mm] flex items-end justify-between border-t border-black/40 pt-[2mm] text-[9px]">
                <span className="break-all">{s.shop.url}</span>
                <span>
                  Privasi · Privacy · 隐私: {origin}/privacy
                </span>
              </footer>
            </div>
          );
        }}
      </QueryState>
    </PrintShell>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <li className="flex gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-black text-sm font-black">{n}</span>
      <span className="pt-1 font-medium">{text}</span>
    </li>
  );
}
