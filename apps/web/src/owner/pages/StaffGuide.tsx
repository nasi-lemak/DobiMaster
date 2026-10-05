import { useState } from 'react';
import { Segmented } from '../components/common';
import { PrintShell } from '../components/PrintShell';
import { useMe } from '../lib/session';

type Lang = 'en' | 'ms' | 'zh';
interface Guide {
  title: string;
  signIn: (url: string) => string;
  sections: Array<{ h: string; steps: string[] }>;
  rulesTitle: string;
  rules: string[];
}

// The dashboard is in English, so button names stay in English (in quotes) in every language.
const GUIDES: Record<Lang, Guide> = {
  en: {
    title: 'Staff guide',
    signIn: (url) => `Sign in on your phone at ${url} with the email and password from your invitation. Tip: add it to your home screen.`,
    sections: [
      { h: 'Every opening', steps: ['Checklists → today’s “Daily opening check”.', 'Tick each item as you do it. Some items need a photo.'] },
      {
        h: 'A machine is broken',
        steps: [
          'Machines → tap the machine → “Mark faulty…” and say what is wrong. Customers now see it as out of order.',
          'Fixed? → “Clear fault”.',
          'Waiting for a technician? → “Mark maintenance…” with a reason customers will see, e.g. “Technician coming Friday”. When it works again → “Return to service”.',
        ],
      },
      { h: 'Machine shows busy but is empty', steps: ['Tap the machine → “Emptied — mark as free” (or “Clear check-in”).'] },
      {
        h: 'A customer reports a problem',
        steps: ['Tickets → open the report → check the machine and do what is needed.', 'Set the status to In progress, then Resolved. Add a note of what you found.', 'Money back is approved by the owner or manager.'],
      },
      { h: 'Collecting cash', steps: ['Collections → “Record collection” → the amount for each machine (and its counter reading, if it has one) → “Save collection”.'] },
      { h: 'Maintenance done', steps: ['Maintenance → on the item (e.g. dryer lint duct) → “Log as done now”.'] },
    ],
    rulesTitle: 'Please remember',
    rules: [
      'Customers’ phone numbers and photos are private. Use them only for that report; never copy or share them.',
      'If the app is down, the shop still works: coins and machines don’t need it.',
    ],
  },
  ms: {
    title: 'Panduan pekerja',
    signIn: (url) => `Log masuk di telefon anda di ${url} dengan e-mel dan kata laluan daripada jemputan anda. Tip: tambahkannya ke skrin utama.`,
    sections: [
      { h: 'Setiap kali buka kedai', steps: ['Checklists → “Daily opening check” hari ini.', 'Tandakan setiap perkara semasa anda melakukannya. Sesetengah perkara perlukan gambar.'] },
      {
        h: 'Mesin rosak',
        steps: [
          'Machines → tekan mesin → “Mark faulty…” dan nyatakan masalahnya. Pelanggan kini melihatnya sebagai rosak.',
          'Sudah dibaiki? → “Clear fault”.',
          'Menunggu juruteknik? → “Mark maintenance…” dengan sebab yang pelanggan akan lihat, cth. “Juruteknik datang hari Jumaat”. Bila berfungsi semula → “Return to service”.',
        ],
      },
      { h: 'Mesin tunjuk sibuk tetapi kosong', steps: ['Tekan mesin → “Emptied — mark as free” (atau “Clear check-in”).'] },
      {
        h: 'Pelanggan lapor masalah',
        steps: ['Tickets → buka laporan → periksa mesin dan buat apa yang perlu.', 'Tukar status kepada In progress, kemudian Resolved. Tambah nota tentang apa yang anda dapati.', 'Bayaran balik diluluskan oleh pemilik atau pengurus.'],
      },
      { h: 'Kutip duit syiling', steps: ['Collections → “Record collection” → jumlah bagi setiap mesin (dan bacaan kaunter, jika ada) → “Save collection”.'] },
      { h: 'Penyelenggaraan selesai', steps: ['Maintenance → pada perkara itu (cth. saluran habuk pengering) → “Log as done now”.'] },
    ],
    rulesTitle: 'Sila ingat',
    rules: [
      'Nombor telefon dan gambar pelanggan adalah sulit. Gunakannya hanya untuk laporan itu; jangan sekali-kali salin atau kongsikan.',
      'Jika aplikasi tidak berfungsi, kedai tetap beroperasi: syiling dan mesin tidak memerlukannya.',
    ],
  },
  zh: {
    title: '员工指南',
    signIn: (url) => `用手机打开 ${url}，以邀请中的电邮和密码登录。提示：可把它添加到主屏幕。`,
    sections: [
      { h: '每次开店', steps: ['Checklists → 今天的 “Daily opening check”。', '每完成一项就打勾。部分项目需要拍照。'] },
      {
        h: '机器坏了',
        steps: [
          'Machines → 点选机器 → “Mark faulty…”，并写明问题。顾客会看到该机器暂停使用。',
          '修好了？→ “Clear fault”。',
          '等技术员？→ “Mark maintenance…”，填写顾客会看到的原因，例如“技术员星期五来”。恢复正常后 → “Return to service”。',
        ],
      },
      { h: '机器显示使用中，但其实是空的', steps: ['点选机器 → “Emptied — mark as free”（或 “Clear check-in”）。'] },
      {
        h: '顾客报告问题',
        steps: ['Tickets → 打开报告 → 检查机器并处理。', '把状态改为 In progress，然后 Resolved，并备注你发现的情况。', '退款由店主或经理批准。'],
      },
      { h: '收硬币', steps: ['Collections → “Record collection” → 填写每台机器的金额（如有计数器，也填读数）→ “Save collection”。'] },
      { h: '完成保养', steps: ['Maintenance → 在该项目上（例如烘干机棉絮管道）→ “Log as done now”。'] },
    ],
    rulesTitle: '请记住',
    rules: ['顾客的电话号码和照片属于隐私，只能用于该报告，切勿复制或分享。', '即使应用无法使用，店铺照常运作：投币和机器都不依赖它。'],
  },
};

/** One A4 page for the back room, in the staff member's language. */
export function StaffGuidePage() {
  const me = useMe();
  const [lang, setLang] = useState<Lang>('ms');
  const g = GUIDES[lang];
  const url = `${window.location.origin}/owner`;
  return (
    <PrintShell
      hint="A4 · pick the language, then print"
      toolbar={
        <Segmented
          label="Language"
          size="sm"
          value={lang}
          onChange={setLang}
          options={[
            { value: 'ms', label: 'BM' },
            { value: 'en', label: 'EN' },
            { value: 'zh', label: '中文' },
          ]}
        />
      }
    >
      <article lang={lang === 'zh' ? 'zh-Hans' : lang} className="bg-white px-[10mm] py-[8mm] text-black">
        <header className="border-b-2 border-black pb-[3mm]">
          <h1 className="text-3xl font-black">
            {g.title} · {me.tenant.name}
          </h1>
          <p className="mt-1 text-base">{g.signIn(url)}</p>
        </header>
        <div className="mt-[4mm] grid grid-cols-2 gap-x-[8mm] gap-y-[4mm]">
          {g.sections.map((s) => (
            <section key={s.h} className="break-inside-avoid">
              <h2 className="text-lg font-bold">{s.h}</h2>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] leading-snug">
                {s.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <section className="mt-[5mm] rounded-lg border-2 border-black p-[3mm] break-inside-avoid">
          <h2 className="text-lg font-bold">{g.rulesTitle}</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] leading-snug">
            {g.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      </article>
    </PrintShell>
  );
}
