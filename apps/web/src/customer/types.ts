import type { I18nText, MachineState, MachineType, Program, StateSource } from '@dobi/shared';

export type Confidence = 'live' | 'mixed' | 'checkins' | 'none';

export interface Availability {
  total: number;
  available: number;
  running: number;
  finished: number;
  outOfOrder: number;
  /** Sensor silent — machine may well be usable, we just can't see it. */
  unknown: number;
  confidence: Confidence;
  nextFreeAt: string | null;
}

export interface Busyness {
  enoughData: boolean;
  nowLabel: 'quiet' | 'moderate' | 'busy' | null;
  today: Array<number | null> | null;
  currentHour: number;
}

export interface ShopSummary {
  id: string;
  slug: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  distanceKm: number | null;
  openNow: boolean;
  open24h: boolean;
  closesAt: string | null;
  availability: { washers: Availability; dryers: Availability };
  busyness: Busyness;
  announcementCount: number;
  warning: Partial<I18nText> | null;
}

export interface PublicMachine {
  id: string;
  code: string;
  qrToken: string;
  type: MachineType;
  capacityKg: number;
  brand: string | null;
  programs: Program[];
  instructions: Partial<I18nText>;
  recommendedLoad: Partial<I18nText>;
  detergentAuto: boolean;
  softenerAuto: boolean;
  state: MachineState;
  stateSource: StateSource;
  stateSince: string;
  stateReason: string | null;
  observed: boolean;
  expectedEndAt: string | null;
  openIssues: number;
  payable: boolean;
}

export interface ShopDetail extends Omit<ShopSummary, 'distanceKm' | 'announcementCount' | 'warning'> {
  phone: string | null;
  whatsapp: string | null;
  openingHours: Record<string, { open: string; close: string } | null>;
  facilities: Record<string, boolean>;
  policy: Partial<I18nText>;
  announcements: Array<{ id: string; message: Partial<I18nText>; level: 'info' | 'warning'; endsAt: string | null }>;
  machines: PublicMachine[];
}

export interface MachineResponse {
  machine: PublicMachine;
  shop: { id: string; slug: string; name: string; whatsapp: string | null; policy: Partial<I18nText>; openNow: boolean; open24h: boolean; closesAt: string | null };
}

export interface Cycle {
  id: string;
  machineId: string;
  shopId: string;
  source: string;
  status: 'running' | 'finished' | 'collected' | 'cancelled' | 'aborted';
  programId: string | null;
  programName: string | null;
  durationMin: number;
  priceSen: number | null;
  startedAt: string;
  expectedEndAt: string;
  endedAt: string | null;
  collectedAt: string | null;
  sensorConfirmed: boolean;
  paymentId: string | null;
}

export interface MyCycle extends Cycle {
  programLabel: Partial<I18nText> | null;
  machineCode: string;
  machineType: MachineType;
  qrToken: string;
  shopName: string;
  shopSlug: string;
}

export interface Payment {
  id: string;
  machineId: string;
  shopId: string;
  cycleId: string | null;
  programId: string;
  amountSen: number;
  refundedSen: number;
  currency: string;
  provider: string;
  status: 'created' | 'pending' | 'succeeded' | 'failed' | 'expired' | 'refund_pending' | 'refunded';
  failureReason: string | null;
  createdAt: string;
  succeededAt: string | null;
}
