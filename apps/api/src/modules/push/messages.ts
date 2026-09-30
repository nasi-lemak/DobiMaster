import type { Locale } from '@dobi/shared';

type Vars = Record<string, string | number>;
type Msg = { title: string; body: string };
type Templates = Record<string, Record<'en' | 'ms' | 'zh', (v: Vars) => Msg>>;

// Server-side notification copy. Tamil falls back to English until translated.
const templates: Templates = {
  cycle_almost_done: {
    en: (v) => ({ title: `${v.machine} almost done`, body: `About ${v.min} min left at ${v.shop}.` }),
    ms: (v) => ({ title: `${v.machine} hampir siap`, body: `Lebih kurang ${v.min} minit lagi di ${v.shop}.` }),
    zh: (v) => ({ title: `${v.machine} 即将完成`, body: `${v.shop}：约剩 ${v.min} 分钟。` }),
  },
  cycle_finished: {
    en: (v) => ({ title: `${v.machine} finished`, body: `Your laundry at ${v.shop} is ready. Please collect it so others can use the machine.` }),
    ms: (v) => ({ title: `${v.machine} sudah siap`, body: `Pakaian anda di ${v.shop} sudah siap. Sila ambil supaya orang lain boleh guna mesin.` }),
    zh: (v) => ({ title: `${v.machine} 已完成`, body: `您在 ${v.shop} 的衣物已洗好，请尽快取走，方便他人使用。` }),
  },
  cycle_uncollected: {
    en: (v) => ({ title: `Laundry still in ${v.machine}`, body: `Finished ${v.min} min ago at ${v.shop}. ${v.policy}` }),
    ms: (v) => ({ title: `Pakaian masih dalam ${v.machine}`, body: `Siap ${v.min} minit lalu di ${v.shop}. ${v.policy}` }),
    zh: (v) => ({ title: `衣物仍在 ${v.machine}`, body: `${v.shop}：已完成 ${v.min} 分钟。${v.policy}` }),
  },
  payment_start_failed: {
    en: (v) => ({ title: `${v.machine} did not start`, body: `We couldn't start the machine. ${v.amount} is being refunded automatically.` }),
    ms: (v) => ({ title: `${v.machine} tidak bermula`, body: `Mesin tidak dapat dimulakan. ${v.amount} sedang dipulangkan secara automatik.` }),
    zh: (v) => ({ title: `${v.machine} 未能启动`, body: `机器未能启动，${v.amount} 将自动退款。` }),
  },
  machine_available: {
    en: (v) => ({ title: `A ${v.type} is free`, body: `${v.machine} at ${v.shop} just became free. It isn't reserved — first come, first served.` }),
    ms: (v) => ({ title: `${v.type} kosong`, body: `${v.machine} di ${v.shop} baru kosong. Tiada tempahan — siapa cepat dia dapat.` }),
    zh: (v) => ({ title: `有空闲${v.type}`, body: `${v.shop} 的 ${v.machine} 刚空出来。不设预留，先到先得。` }),
  },
};

export type PushTemplate = keyof typeof templates;

export function renderPush(template: PushTemplate, locale: Locale | string, vars: Vars): Msg {
  const t = templates[template]!;
  const l = (locale === 'ms' || locale === 'zh' ? locale : 'en') as 'en' | 'ms' | 'zh';
  return t[l](vars);
}
