import type { I18nText, MachineType, OpeningHours, Program } from './index.js';

/**
 * Sensible starting points for a new shop: typical Malaysian self-service programs, prices and
 * multilingual instructions. Owners edit everything afterwards; these just avoid a blank page.
 */

export const HOURS_24: OpeningHours = { '1': { open: '00:00', close: '24:00' }, '2': { open: '00:00', close: '24:00' }, '3': { open: '00:00', close: '24:00' }, '4': { open: '00:00', close: '24:00' }, '5': { open: '00:00', close: '24:00' }, '6': { open: '00:00', close: '24:00' }, '7': { open: '00:00', close: '24:00' } };

export function sameHoursEveryDay(open: string, close: string): OpeningHours {
  const d = { open, close };
  return { '1': d, '2': d, '3': d, '4': d, '5': d, '6': d, '7': d };
}

export function washerPrograms(baseSen: number, stepSen = 100, durations: [number, number, number] = [30, 35, 40]): Program[] {
  return [
    { id: 'cold', name: { en: 'Cold', ms: 'Sejuk', zh: '冷水' }, durationMin: durations[0], priceSen: baseSen },
    { id: 'warm', name: { en: 'Warm', ms: 'Suam', zh: '温水' }, durationMin: durations[1], priceSen: baseSen + stepSen },
    { id: 'hot', name: { en: 'Hot', ms: 'Panas', zh: '热水' }, durationMin: durations[2], priceSen: baseSen + 2 * stepSen },
  ];
}

export function dryerPrograms(baseSen = 400, stepSen = 100): Program[] {
  return [
    { id: 'd24', name: { en: '24 min', ms: '24 minit', zh: '24 分钟' }, durationMin: 24, priceSen: baseSen },
    { id: 'd32', name: { en: '32 min', ms: '32 minit', zh: '32 分钟' }, durationMin: 32, priceSen: baseSen + stepSen },
    { id: 'd40', name: { en: '40 min', ms: '40 minit', zh: '40 分钟' }, durationMin: 40, priceSen: baseSen + 2 * stepSen },
  ];
}

export function washerInstructions(detergentAuto: boolean): I18nText {
  return detergentAuto
    ? {
        en: '1. Load clothes and close the door firmly.\n2. Insert coins or pay by QR.\n3. Choose Cold / Warm / Hot and press START.\nDo not add your own detergent — it is dosed automatically.',
        ms: '1. Masukkan pakaian dan tutup pintu dengan kemas.\n2. Masukkan syiling atau bayar dengan QR.\n3. Pilih Sejuk / Suam / Panas dan tekan START.\nJangan tambah sabun sendiri — sabun dimasukkan secara automatik.',
        zh: '1. 放入衣物并关紧机门。\n2. 投币或扫码付款。\n3. 选择冷水 / 温水 / 热水，按 START。\n请勿自行添加洗衣液——机器会自动投放。',
      }
    : {
        en: '1. Load clothes and add detergent to the drawer.\n2. Close the door firmly.\n3. Insert coins or pay by QR, choose Cold / Warm / Hot and press START.',
        ms: '1. Masukkan pakaian dan sabun ke dalam laci.\n2. Tutup pintu dengan kemas.\n3. Masukkan syiling atau bayar dengan QR, pilih Sejuk / Suam / Panas dan tekan START.',
        zh: '1. 放入衣物并把洗衣液加到投放盒。\n2. 关紧机门。\n3. 投币或扫码付款，选择冷水 / 温水 / 热水，按 START。',
      };
}

export const DRYER_INSTRUCTIONS: I18nText = {
  en: '1. Clean the lint filter if it looks full.\n2. Load clothes (no more than ¾ full for faster drying).\n3. Insert coins, choose the time and press START. Add time anytime.',
  ms: '1. Bersihkan penapis habuk jika penuh.\n2. Masukkan pakaian (tidak melebihi ¾ penuh supaya cepat kering).\n3. Masukkan syiling, pilih masa dan tekan START. Boleh tambah masa bila-bila.',
  zh: '1. 如滤网满了请先清理。\n2. 放入衣物（不超过四分之三，干得更快）。\n3. 投币，选择时间，按 START。可随时加时。',
};

export function recommendedLoad(kg: number, type: MachineType): I18nText {
  if (type === 'dryer') {
    const n = Math.max(1, Math.round(kg / 7));
    return { en: `Up to ${kg} kg dry weight — about ${n} washer loads`, ms: `Sehingga ${kg} kg — kira-kira ${n} muatan mesin basuh`, zh: `最多 ${kg} 公斤（约 ${n} 桶洗衣量）` };
  }
  if (kg >= 18) return { en: `${kg} kg — fits a king comforter or 3 full baskets`, ms: `${kg} kg — muat selimut king atau 3 bakul penuh`, zh: `${kg} 公斤——可洗特大被子或 3 满篮衣物` };
  if (kg >= 14) return { en: `${kg} kg — a queen comforter or 2 full baskets`, ms: `${kg} kg — selimut queen atau 2 bakul penuh`, zh: `${kg} 公斤——双人被或 2 满篮衣物` };
  return { en: `${kg} kg — about 1 full basket (a week of clothes for 2)`, ms: `${kg} kg — kira-kira 1 bakul penuh`, zh: `${kg} 公斤——约 1 满篮衣物` };
}

export interface MachinePreset {
  id: string;
  label: string;
  type: MachineType;
  capacityKg: number;
  programs: Program[];
}

/** The machine sizes most Malaysian dobi have, with typical prices. */
export const MACHINE_PRESETS: MachinePreset[] = [
  { id: 'washer-10', label: 'Washer 10 kg', type: 'washer', capacityKg: 10, programs: washerPrograms(500) },
  { id: 'washer-12', label: 'Washer 12 kg', type: 'washer', capacityKg: 12, programs: washerPrograms(600) },
  { id: 'washer-15', label: 'Washer 15 kg', type: 'washer', capacityKg: 15, programs: washerPrograms(700) },
  { id: 'washer-20', label: 'Washer 20 kg (comforter)', type: 'washer', capacityKg: 20, programs: washerPrograms(1000, 200, [40, 45, 50]) },
  { id: 'washer-25', label: 'Washer 25 kg (comforter)', type: 'washer', capacityKg: 25, programs: washerPrograms(1400, 200, [45, 50, 55]) },
  { id: 'dryer-15', label: 'Dryer 15 kg', type: 'dryer', capacityKg: 15, programs: dryerPrograms() },
  { id: 'dryer-25', label: 'Dryer 25 kg', type: 'dryer', capacityKg: 25, programs: dryerPrograms(500) },
];

/** Starter cleaning checklist for every new shop (lint filters are also a fire-safety item). */
export const DEFAULT_CHECKLIST = [
  { label: 'Empty all dryer lint filters' },
  { label: 'Sweep & mop floor' },
  { label: 'Empty rubbish bins' },
  { label: 'Wipe washer doors & gaskets' },
  { label: 'Check detergent / softener tanks' },
  { label: 'Check change machine has coins' },
];

/** Starter preventive-maintenance plans; owners adjust intervals to their machines' manuals. */
export const DEFAULT_MAINTENANCE = [
  { machineType: 'dryer' as const, title: 'Clean lint duct & check burner/heater', intervalDays: 30, intervalRunHours: 200 },
  { machineType: 'washer' as const, title: 'Descale & check door gasket', intervalDays: 90, intervalCycles: 500 },
];

/**
 * Personal-data retention (Malaysian PDPA: keep personal data no longer than the purpose needs).
 * The API's daily sweep enforces these; the privacy notice quotes them.
 */
export const PRIVACY_RETENTION = {
  /** Refund phone numbers on closed problem reports / settled refunds. */
  contactPhoneDays: 90,
  /** Photos attached to closed problem reports. */
  ticketPhotoDays: 180,
  /** WhatsApp numbers that haven't messaged us. */
  waContactDays: 180,
  /** WhatsApp message log. */
  waMessageDays: 30,
} as const;

/** Version of the privacy notice and terms; owners accept this version at sign-up. */
export const LEGAL_VERSION = '2026-10-05';
