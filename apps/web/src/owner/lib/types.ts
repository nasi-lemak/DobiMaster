/**
 * Response shapes of the owner API (apps/api/src/routes/owner/*). List endpoints that select DB columns
 * directly return snake_case rows; service-computed payloads are camelCase.
 */
import type {
  AdminState,
  ControlKind,
  I18nText,
  MachineState,
  MachineType,
  ObservationKind,
  OpeningHours,
  Permission,
  Program,
  RefundMethod,
  RefundStatus,
  Role,
  ShopSettings,
  StateSource,
  TicketSeverity,
  TicketStatus,
} from '@dobi/shared';

export type Severity = TicketSeverity;

export interface Me {
  user: { id: string; name: string; email: string };
  role: Role;
  permissions: Permission[];
  tenant: { id: string; name: string; plan: string };
  shops: Array<{ id: string; name: string; slug: string }>;
  preferences: { digestOptOut: boolean; whatsappLinked: boolean; whatsappMode: 'cloud' | 'mock' | 'disabled' };
}

export interface Branch {
  id: string;
  name: string;
  slug: string;
  machines: number;
  sensorCoverage: number;
  running: number;
  finished: number;
  available: number;
  offline: number;
  fault: number;
  maintenance: number;
  openTickets: number;
  utilisationToday: number;
  cyclesToday: number;
  estRevenueTodaySen?: number;
  appRevenueTodaySen?: number;
}

export interface AttentionItem {
  kind: string;
  severity: Severity;
  title: string;
  shopId: string | null;
  shopName: string | null;
  link: string;
  at: string;
}

export interface Overview {
  branches: Branch[];
  totals: {
    machines: number;
    running: number;
    offline: number;
    fault: number;
    openTickets: number;
    pendingRefunds: number;
    cyclesToday: number;
    utilisationToday: number;
    estRevenueTodaySen?: number;
    appRevenueTodaySen?: number;
  } | null;
  attention: AttentionItem[];
}

export interface ShopRow {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  timezone: string;
  phone: string | null;
  whatsapp: string | null;
  opening_hours: OpeningHours;
  facilities: Record<string, boolean> | null;
  policy: Partial<I18nText> | null;
  settings: Partial<ShopSettings> | null;
  is_published: boolean;
  created_at: string;
}

export interface OwnerMachine {
  id: string;
  shopId: string;
  code: string;
  qrToken: string;
  qrUrl: string;
  type: MachineType;
  capacityKg: number;
  brand: string | null;
  model: string | null;
  programs: Program[];
  instructions: Partial<I18nText> | null;
  recommendedLoad: Partial<I18nText> | null;
  detergentAuto: boolean;
  softenerAuto: boolean;
  observation: ObservationKind;
  control: ControlKind;
  deviceId: string | null;
  purchaseCostSen: number | null;
  installedAt: string | null;
  sortOrder: number;
  adminState: AdminState;
  adminReason: string | null;
  staffFault: boolean;
  state: MachineState;
  stateSource: StateSource;
  stateSince: string;
  currentCycleId: string | null;
}

export interface LiveMachine extends OwnerMachine {
  cycle: { expectedEndAt: string; endedAt: string | null; source: string; hasCustomer: boolean; status: string } | null;
}

export interface ShopLive {
  shop: ShopRow;
  machines: LiveMachine[];
}

export interface StateLogRow {
  id: string;
  state: MachineState;
  source: StateSource;
  reason: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface CycleRow {
  id: string;
  source: string;
  status: string;
  program_name: string | null;
  duration_min: number;
  price_sen: number | null;
  started_at: string;
  expected_end_at: string;
  ended_at: string | null;
  collected_at: string | null;
  sensor_confirmed: boolean;
  payment_id: string | null;
}

export interface DueItem {
  planId: string;
  title: string;
  machineId: string;
  machineCode: string;
  shopId: string;
  lastDoneAt: string | null;
  daysSince: number;
  cyclesSince: number;
  runHoursSince: number;
  intervalDays: number | null;
  intervalCycles: number | null;
  intervalRunHours: number | null;
  progress: number;
  status: 'ok' | 'due_soon' | 'due';
  cycleSource: 'cycles' | 'counter';
}

export interface MachineDetail {
  machine: OwnerMachine;
  device: { id: string; kind: string; label: string; last_seen_at: string | null; last_power_w: number | null; online: boolean; heartbeat_sec: number } | null;
  stats30d: { cycles: number; utilisation: number; estimatedRevenueSen: number | null; downtimeHours: Record<string, number> };
  stateLog: StateLogRow[];
  cycles: CycleRow[];
  tickets: Array<{ id: string; ref: string; title: string; status: TicketStatus; severity: Severity; created_at: string; source: string }>;
  maintenance: Array<{ id: string; performed_at: string; notes: string | null; cost_sen: number | null; plan_title: string | null; by_name: string | null }>;
  due: DueItem[];
}

export interface TicketListRow {
  id: string;
  ref: string;
  title: string;
  category: string;
  severity: Severity;
  status: TicketStatus;
  source: 'customer' | 'staff' | 'system';
  created_at: string;
  updated_at: string;
  amount_claimed_sen: number | null;
  machine_id: string | null;
  shop_id: string;
  shop_name: string;
  machine_code: string | null;
  assignee_name: string | null;
}

export interface TicketRow {
  id: string;
  ref: string;
  shop_id: string;
  machine_id: string | null;
  category: string;
  severity: Severity;
  status: TicketStatus;
  source: 'customer' | 'staff' | 'system';
  title: string;
  details: string | null;
  contact_phone: string | null;
  amount_claimed_sen: number | null;
  cycle_id: string | null;
  payment_id: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface TicketEvent {
  id: string;
  kind: string;
  body: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
  actor_name: string | null;
}

export interface RefundRow {
  id: string;
  shop_id: string;
  ticket_id: string | null;
  payment_id: string | null;
  amount_sen: number;
  method: RefundMethod;
  status: RefundStatus;
  payout_phone: string | null;
  reference: string | null;
  note: string | null;
  automatic: boolean;
  decided_at: string | null;
  paid_at: string | null;
  created_at: string;
  shop_name?: string;
  ticket_ref?: string | null;
  ticket_title?: string | null;
  decided_by_name?: string | null;
}

export interface TicketDetail {
  ticket: TicketRow;
  events: TicketEvent[];
  shop: { id: string; name: string };
  machine: { id: string; code: string; type: MachineType; state: MachineState; observation: ObservationKind } | null;
  payment: { id: string; amount_sen: number; status: string; refunded_sen: number; created_at: string } | null;
  refunds: RefundRow[];
  cycle: { id: string; status: string; started_at: string; ended_at: string | null; source: string; sensor_confirmed: boolean; program_name: string | null } | null;
  photos: Array<{ id: string; url: string; createdAt: string }>;
}

export interface AlertRow {
  id: string;
  kind: string;
  severity: Severity;
  message: string;
  status: 'open' | 'acknowledged' | 'resolved';
  created_at: string;
  resolved_at: string | null;
  shop_id: string | null;
  machine_id: string | null;
  shop_name: string | null;
  machine_code: string | null;
}

export interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  shop_ids: string[] | null;
}

export interface AuditEntry {
  id: string;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  created_at: string;
}

export interface Announcement {
  id: string;
  shop_id: string;
  message: I18nText;
  level: 'info' | 'warning';
  starts_at: string;
  ends_at: string | null;
  created_at: string;
}

export interface DeviceRow {
  id: string;
  shop_id: string;
  kind: string;
  label: string;
  last_seen_at: string | null;
  last_power_w: number | null;
  online: boolean;
  heartbeat_sec: number;
  machine_id: string | null;
  machine_code: string | null;
}

export interface CollectionRow {
  id: string;
  shop_id: string;
  collected_at: string;
  note: string | null;
  shop_name: string;
  collected_by_name: string | null;
  totalSen: number | null;
  lines: Array<{ machine_id: string; amount_sen: number | null; counter_reading: number | null; code: string }>;
}

export interface ReconRow {
  collectionId: string;
  shopId: string;
  shopName: string;
  machineId: string;
  code: string;
  periodStart: string;
  periodEnd: string;
  collectedSen: number;
  expectedCycles: number | null;
  expectedSen: number | null;
  basis: 'counter' | 'sensor' | null;
  varianceSen: number | null;
  flag: boolean;
}

export interface PlanRow {
  id: string;
  shop_id: string;
  machine_id: string | null;
  machine_type: MachineType | null;
  title: string;
  interval_days: number | null;
  interval_cycles: number | null;
  interval_run_hours: number | null;
  active: boolean;
  shop_name: string;
  machine_code: string | null;
}

export interface ChecklistRun {
  runId: string;
  templateId: string;
  shopId: string;
  shopName: string;
  name: string;
  date: string;
  items: Array<{ id: string; label: string; photoRequired?: boolean; done: { by: string; byName: string; at: string; photoUrl: string | null } | null }>;
  done: number;
  total: number;
  completedAt: string | null;
}

export interface ChecklistTemplate {
  id: string;
  shop_id: string;
  name: string;
  items: Array<{ id: string; label: string; photoRequired?: boolean }>;
  active: boolean;
}

// ---- analytics ----

export interface RevenueRow {
  key: string;
  label: string;
  cashSen: number;
  appSen: number;
  estimatedSen: number;
  recordedSen: number;
  cycles: number;
}

export interface RevenueResp {
  groupBy: string;
  rows: RevenueRow[];
  totals: { cashSen: number; appSen: number; recordedSen: number; estimatedSen: number; cycles: number };
  note: string;
}

export interface UtilMachine {
  machineId: string;
  shopId: string;
  shopName: string;
  code: string;
  type: MachineType;
  capacityKg: number;
  observed: boolean;
  cycles: number;
  busyMin: number;
  openMin: number;
  utilisation: number;
  estimatedRevenueSen: number;
}

export interface UtilGroup {
  key: string;
  machines: number;
  cycles: number;
  busyMin: number;
  openMin: number;
  estimatedRevenueSen: number;
  utilisation: number;
}

export interface UtilResp {
  from: string;
  to: string;
  machines: UtilMachine[];
  byType: UtilGroup[];
  byCapacity: UtilGroup[];
  byShop: UtilGroup[];
  sources: Record<string, number>;
}

export interface PeakResp {
  matrix: Array<Array<number | null>>;
  cycles: number;
}

export type Recommendation = 'consider_adding' | 'balanced' | 'over_capacity' | 'insufficient_data';

export interface CapacityClass {
  key: string;
  type: MachineType;
  capacityKg: number;
  machines: number;
  cycles: number;
  utilisation: number;
  peakHourUtilisation: number;
  saturatedHours: number;
  saturationShare: number;
  saturatedHoursPerWeek: number;
  estRevenuePerMachineMonthSen: number;
  estExtraRevenuePerMonthSen: number;
  assumedMachineCostSen: number;
  paybackMonths: number | null;
  recommendation: Recommendation;
}

export interface CapacityResp {
  classes: CapacityClass[];
  openHours?: number;
  assumptions?: { saturationThreshold: number; captureRate: number; saturatedHoursPerWeek: number };
}

export interface LowUsageResp {
  days: number;
  flagged: Array<UtilMachine & { peerAvgCycles: number; reason: 'far_below_peers' | 'silent_24h' }>;
}
