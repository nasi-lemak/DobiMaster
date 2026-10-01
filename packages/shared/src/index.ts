// Domain vocabulary shared by the API and the web app.

export const MACHINE_TYPES = ['washer', 'dryer'] as const;
export type MachineType = (typeof MACHINE_TYPES)[number];

/** Derived, customer-visible machine state (see docs/03-architecture.md, "Machine state reducer"). */
export const MACHINE_STATES = [
  'available',
  'running',
  'finished',
  'offline',
  'fault',
  'maintenance',
  'disabled',
] as const;
export type MachineState = (typeof MACHINE_STATES)[number];

export const ADMIN_STATES = ['active', 'maintenance', 'disabled'] as const;
export type AdminState = (typeof ADMIN_STATES)[number];

/** Where the current state came from — shown to users so they can judge confidence. */
export const STATE_SOURCES = ['sensor', 'customer', 'staff', 'payment', 'system', 'none'] as const;
export type StateSource = (typeof STATE_SOURCES)[number];

export const OBSERVATION_KINDS = ['none', 'power_monitor', 'vendor'] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

export const CONTROL_KINDS = ['none', 'simulated', 'pulse', 'vendor'] as const;
export type ControlKind = (typeof CONTROL_KINDS)[number];

export const CYCLE_SOURCES = ['customer', 'staff', 'sensor', 'payment'] as const;
export type CycleSource = (typeof CYCLE_SOURCES)[number];

export const CYCLE_STATUSES = ['running', 'finished', 'collected', 'cancelled', 'aborted'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const TICKET_CATEGORIES = [
  'not_starting',
  'payment_no_start',
  'coin_jammed',
  'dirty_machine',
  'water_leak',
  'not_drying',
  'damaged',
  'abandoned_clothing',
  'cleanliness',
  'other',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

/** Categories where the customer may have lost money and can ask for a refund. */
export const MONEY_CATEGORIES: readonly TicketCategory[] = ['not_starting', 'payment_no_start', 'coin_jammed', 'not_drying'];

/** Categories that indicate the machine itself is not usable (count towards auto-fault). */
export const FAULT_CATEGORIES: readonly TicketCategory[] = [
  'not_starting',
  'payment_no_start',
  'coin_jammed',
  'water_leak',
  'not_drying',
  'damaged',
];

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'rejected'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_SEVERITIES = ['low', 'medium', 'high'] as const;
export type TicketSeverity = (typeof TICKET_SEVERITIES)[number];

export const REFUND_METHODS = ['original', 'duitnow', 'cash', 'other'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export const REFUND_STATUSES = ['requested', 'approved', 'rejected', 'paid', 'failed'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'created',
  'pending',
  'succeeded',
  'failed',
  'expired',
  'refund_pending',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ROLES = ['owner', 'manager', 'staff'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'revenue.view',
  'collections.create',
  'machines.manage',
  'machines.state',
  'tickets.manage',
  'refunds.decide',
  'staff.manage',
  'shops.manage',
  'checklists.manage',
  'checklists.complete',
  'maintenance.manage',
  'maintenance.log',
  'announcements.manage',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const STAFF_PERMISSIONS: Permission[] = [
  'machines.state',
  'tickets.manage',
  'checklists.complete',
  'maintenance.log',
  'collections.create',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => p !== 'staff.manage'),
  // Staff can record cash but cannot see revenue analytics.
  staff: STAFF_PERMISSIONS,
};

export const ALERT_KINDS = [
  'repeat_fault',
  'low_usage',
  'maintenance_due',
  'device_offline',
  'start_failed',
  'uncollected',
  'stuck_cycle',
  'short_cycle',
  'shop_offline',
  'weak_heating',
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const LOCALES = ['en', 'ms', 'zh', 'ta'] as const;
export type Locale = (typeof LOCALES)[number];

/** Per-language text. English is the required fallback. */
export type I18nText = { en: string } & Partial<Record<Exclude<Locale, 'en'>, string>>;

export function pickText(text: Partial<Record<Locale, string>> | null | undefined, locale: Locale): string {
  if (!text) return '';
  return text[locale] || text.en || Object.values(text).find(Boolean) || '';
}

export interface Program {
  id: string;
  name: I18nText;
  durationMin: number;
  priceSen: number;
}

/** Opening hours per ISO weekday (1 = Monday … 7 = Sunday). `null` = closed that day. "24h" shops use 00:00–24:00. */
export type OpeningHours = Record<'1' | '2' | '3' | '4' | '5' | '6' | '7', { open: string; close: string } | null>;

export interface Facilities {
  detergentVending?: boolean;
  changeMachine?: boolean;
  wifi?: boolean;
  parking?: boolean;
  cctv?: boolean;
  aircon?: boolean;
  seating?: boolean;
  foldingTable?: boolean;
  qrPayment?: boolean;
}

export interface ShopSettings {
  /** Distinct customer reports within 2 h that mark a machine as faulty. */
  faultReportThreshold: number;
  /** Minutes before the end of a cycle to send the "almost done" push. */
  remindBeforeMin: number;
  /** Minutes after finishing that a machine is shown as "finished, laundry inside". */
  finishedHoldMin: number;
  /** Minutes after finishing to send the uncollected reminder. */
  uncollectedReminderMin: number;
  /** Electricity price in sen per kWh (all-in: energy + surcharges), for cost-per-cycle figures. */
  electricitySenPerKwh: number;
}

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  faultReportThreshold: 2,
  remindBeforeMin: 5,
  finishedHoldMin: 20,
  uncollectedReminderMin: 10,
  // Roughly a Malaysian commercial tariff incl. surcharges; every shop should set its own.
  electricitySenPerKwh: 50,
};

export function formatRM(sen: number): string {
  return `RM ${(sen / 100).toFixed(2)}`;
}

/** Real-time envelope sent over /ws. */
export interface WsEvent<T = unknown> {
  op: 'evt';
  channel: string;
  type: string;
  data: T;
  ts: string;
}

export interface MachineStateEvent {
  machineId: string;
  shopId: string;
  state: MachineState;
  source: StateSource;
  since: string;
  expectedEndAt: string | null;
}

export * from './defaults.js';
