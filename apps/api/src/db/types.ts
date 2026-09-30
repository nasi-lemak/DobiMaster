import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type {
  AdminState,
  ControlKind,
  CycleSource,
  CycleStatus,
  Facilities,
  I18nText,
  MachineState,
  MachineType,
  ObservationKind,
  OpeningHours,
  PaymentStatus,
  Program,
  RefundMethod,
  RefundStatus,
  Role,
  ShopSettings,
  StateSource,
  TicketSeverity,
  TicketStatus,
} from '@dobi/shared';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type TimestampReq = ColumnType<Date, Date | string, Date | string>;
type TimestampNull = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
/** jsonb columns: select as T, insert/update as JSON string (pg serialises objects fine, but arrays need JSON.stringify). */
type Json<T> = ColumnType<T, T | string, T | string>;
type JsonOpt<T> = ColumnType<T, T | string | undefined, T | string>;
/** numeric columns come back from pg as strings. */
type Numeric = ColumnType<string, number | string, number | string>;

export interface TenantsTable {
  id: Generated<string>;
  name: string;
  slug: string;
  plan: Generated<string>;
  created_at: Timestamp;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  name: string;
  password_hash: string;
  digest_opt_out: Generated<boolean>;
  password_changed_at: TimestampNull;
  created_at: Timestamp;
}

export interface MembershipsTable {
  id: Generated<string>;
  tenant_id: string;
  user_id: string;
  role: Role;
  shop_ids: string[] | null;
  created_at: Timestamp;
}

export interface ShopsTable {
  id: Generated<string>;
  tenant_id: string;
  slug: string;
  name: string;
  address: Generated<string>;
  lat: number | null;
  lng: number | null;
  timezone: Generated<string>;
  phone: string | null;
  whatsapp: string | null;
  opening_hours: Json<OpeningHours>;
  facilities: JsonOpt<Facilities>;
  policy: JsonOpt<Partial<I18nText>>;
  settings: JsonOpt<Partial<ShopSettings>>;
  is_published: Generated<boolean>;
  created_at: Timestamp;
}

export interface DevicesTable {
  id: Generated<string>;
  tenant_id: string;
  shop_id: string;
  kind: 'generic_power' | 'shelly' | 'esp32_ct' | 'simulator';
  label: Generated<string>;
  token_hash: string;
  config: JsonOpt<Record<string, number>>;
  detector: JsonOpt<Record<string, unknown>>;
  heartbeat_sec: Generated<number>;
  last_seen_at: TimestampNull;
  last_power_w: number | null;
  online: Generated<boolean>;
  created_at: Timestamp;
}

export interface MachinesTable {
  id: Generated<string>;
  tenant_id: string;
  shop_id: string;
  code: string;
  qr_token: string;
  type: MachineType;
  capacity_kg: Numeric;
  brand: string | null;
  model: string | null;
  programs: Json<Program[]>;
  instructions: JsonOpt<Partial<I18nText>>;
  recommended_load: JsonOpt<Partial<I18nText>>;
  detergent_auto: Generated<boolean>;
  softener_auto: Generated<boolean>;
  observation: ColumnType<ObservationKind, ObservationKind | undefined, ObservationKind>;
  control: ColumnType<ControlKind, ControlKind | undefined, ControlKind>;
  device_id: string | null;
  purchase_cost_sen: number | null;
  installed_at: ColumnType<string | null, string | null | undefined, string | null>;
  sort_order: Generated<number>;
  admin_state: ColumnType<AdminState, AdminState | undefined, AdminState>;
  admin_reason: string | null;
  staff_fault: Generated<boolean>;
  state: ColumnType<MachineState, MachineState | undefined, MachineState>;
  state_source: ColumnType<StateSource, StateSource | undefined, StateSource>;
  state_since: Timestamp;
  current_cycle_id: string | null;
  deleted_at: TimestampNull;
  created_at: Timestamp;
}

export interface MachineStateLogTable {
  id: Generated<string>;
  tenant_id: string;
  shop_id: string;
  machine_id: string;
  state: MachineState;
  source: StateSource;
  reason: string | null;
  started_at: TimestampReq;
  ended_at: TimestampNull;
}

export interface CustomersTable {
  id: Generated<string>;
  kind: Generated<'guest' | 'registered'>;
  locale: Generated<string>;
  phone: string | null;
  created_at: Timestamp;
  last_seen_at: Timestamp;
}

export interface PushSubscriptionsTable {
  id: Generated<string>;
  customer_id: string | null;
  user_id: string | null;
  endpoint: string;
  keys: Json<{ p256dh: string; auth: string }>;
  locale: Generated<string>;
  failed_count: Generated<number>;
  created_at: Timestamp;
}

export interface PaymentsTable {
  id: Generated<string>;
  tenant_id: string;
  shop_id: string;
  machine_id: string;
  customer_id: string;
  cycle_id: string | null;
  program_id: string;
  amount_sen: number;
  currency: Generated<string>;
  provider: string;
  provider_ref: string | null;
  status: ColumnType<PaymentStatus, PaymentStatus | undefined, PaymentStatus>;
  idempotency_key: string;
  failure_reason: string | null;
  refunded_sen: Generated<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
  succeeded_at: TimestampNull;
}

export interface PaymentEventsTable {
  id: Generated<string>;
  provider: string;
  provider_event_id: string;
  payment_id: string | null;
  type: string;
  payload: Json<unknown>;
  received_at: Timestamp;
}

export interface CyclesTable {
  id: string;
  tenant_id: string;
  shop_id: string;
  machine_id: string;
  source: CycleSource;
  status: CycleStatus;
  program_id: string | null;
  program_name: string | null;
  duration_min: number;
  price_sen: number | null;
  started_at: TimestampReq;
  expected_end_at: TimestampReq;
  ended_at: TimestampNull;
  collected_at: TimestampNull;
  customer_id: string | null;
  payment_id: string | null;
  sensor_confirmed: Generated<boolean>;
  energy_wh: number | null;
  avg_power_w: number | null;
  created_at: Timestamp;
}

export interface MachineCommandsTable {
  id: Generated<string>;
  machine_id: string;
  payment_id: string | null;
  kind: Generated<string>;
  status: ColumnType<'pending' | 'sent' | 'acked' | 'confirmed' | 'failed', 'pending' | undefined, 'pending' | 'sent' | 'acked' | 'confirmed' | 'failed'>;
  attempts: Generated<number>;
  payload: JsonOpt<Record<string, unknown>>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TicketsTable {
  id: string;
  ref: Generated<string>;
  tenant_id: string;
  shop_id: string;
  machine_id: string | null;
  category: string;
  severity: ColumnType<TicketSeverity, TicketSeverity | undefined, TicketSeverity>;
  status: ColumnType<TicketStatus, TicketStatus | undefined, TicketStatus>;
  source: 'customer' | 'staff' | 'system';
  title: string;
  details: string | null;
  customer_id: string | null;
  created_by: string | null;
  contact_phone: string | null;
  amount_claimed_sen: number | null;
  cycle_id: string | null;
  payment_id: string | null;
  assigned_to: string | null;
  counts_as_fault: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
  resolved_at: TimestampNull;
}

export interface TicketEventsTable {
  id: Generated<string>;
  ticket_id: string;
  actor_id: string | null;
  kind: string;
  body: string | null;
  data: JsonOpt<Record<string, unknown>>;
  created_at: Timestamp;
}

export interface RefundsTable {
  id: Generated<string>;
  tenant_id: string;
  shop_id: string;
  ticket_id: string | null;
  payment_id: string | null;
  amount_sen: number;
  method: RefundMethod;
  status: ColumnType<RefundStatus, RefundStatus | undefined, RefundStatus>;
  payout_phone: string | null;
  reference: string | null;
  note: string | null;
  automatic: Generated<boolean>;
  decided_by: string | null;
  decided_at: TimestampNull;
  paid_at: TimestampNull;
  created_at: Timestamp;
}

export interface CollectionsTable {
  id: Generated<string>;
  tenant_id: string;
  shop_id: string;
  collected_at: TimestampReq;
  collected_by: string | null;
  note: string | null;
  created_at: Timestamp;
}

export interface CollectionLinesTable {
  id: Generated<string>;
  collection_id: string;
  machine_id: string;
  amount_sen: number;
  counter_reading: number | null;
}

export interface MaintenancePlansTable {
  id: Generated<string>;
  tenant_id: string;
  shop_id: string;
  machine_id: string | null;
  machine_type: MachineType | null;
  title: string;
  interval_days: number | null;
  interval_cycles: number | null;
  interval_run_hours: number | null;
  active: Generated<boolean>;
  created_at: Timestamp;
}

export interface MaintenanceLogsTable {
  id: Generated<string>;
  tenant_id: string;
  shop_id: string;
  machine_id: string;
  plan_id: string | null;
  performed_at: TimestampReq;
  performed_by: string | null;
  notes: string | null;
  cost_sen: number | null;
  created_at: Timestamp;
}

export interface ChecklistItem {
  id: string;
  label: string;
  /** Staff must attach a photo to tick this item (proof of cleaning). */
  photoRequired?: boolean;
}
export interface ChecklistCompletion {
  by: string;
  byName: string;
  at: string;
  photoId?: string;
}

export interface ChecklistTemplatesTable {
  id: Generated<string>;
  tenant_id: string;
  shop_id: string;
  name: string;
  items: Json<ChecklistItem[]>;
  active: Generated<boolean>;
  created_at: Timestamp;
}

export interface ChecklistRunsTable {
  id: Generated<string>;
  tenant_id: string;
  shop_id: string;
  template_id: string;
  run_date: ColumnType<string, string, string>;
  completed: JsonOpt<Record<string, ChecklistCompletion>>;
  completed_at: TimestampNull;
}

export interface AnnouncementsTable {
  id: Generated<string>;
  tenant_id: string;
  shop_id: string;
  message: Json<I18nText>;
  level: ColumnType<'info' | 'warning', 'info' | 'warning' | undefined, 'info' | 'warning'>;
  starts_at: Timestamp;
  ends_at: TimestampNull;
  created_by: string | null;
  created_at: Timestamp;
}

export interface AlertsTable {
  id: Generated<string>;
  tenant_id: string;
  shop_id: string | null;
  machine_id: string | null;
  kind: string;
  severity: ColumnType<TicketSeverity, TicketSeverity | undefined, TicketSeverity>;
  message: string;
  dedupe_key: string;
  status: ColumnType<'open' | 'acknowledged' | 'resolved', 'open' | undefined, 'open' | 'acknowledged' | 'resolved'>;
  created_at: Timestamp;
  resolved_at: TimestampNull;
}

export interface AuditLogTable {
  id: Generated<string>;
  tenant_id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: Json<unknown> | null;
  after: Json<unknown> | null;
  ip: string | null;
  created_at: Timestamp;
}

export interface JobsTable {
  id: Generated<string>;
  kind: string;
  run_at: TimestampReq;
  payload: JsonOpt<Record<string, unknown>>;
  status: ColumnType<'queued' | 'running' | 'done' | 'failed' | 'cancelled', 'queued' | undefined, 'queued' | 'running' | 'done' | 'failed' | 'cancelled'>;
  attempts: Generated<number>;
  last_error: string | null;
  dedupe_key: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface WaContactsTable {
  id: Generated<string>;
  wa_id: string;
  customer_id: string | null;
  user_id: string | null;
  locale: Generated<string>;
  last_inbound_at: TimestampReq;
  opted_out: Generated<boolean>;
  created_at: Timestamp;
}

export interface WaLinkCodesTable {
  code: string;
  customer_id: string | null;
  user_id: string | null;
  cycle_id: string | null;
  locale: Generated<string>;
  expires_at: TimestampReq;
  used_at: TimestampNull;
  created_at: Timestamp;
}

export interface WaMessagesTable {
  id: Generated<string>;
  direction: 'in' | 'out';
  wa_id: string;
  kind: string;
  template: string | null;
  body: string | null;
  provider_message_id: string | null;
  error: string | null;
  created_at: Timestamp;
}

export interface AttachmentsTable {
  id: Generated<string>;
  tenant_id: string | null;
  uploader_customer_id: string | null;
  uploader_user_id: string | null;
  content_type: string;
  size_bytes: number;
  sha256: string;
  storage_key: string;
  ticket_id: string | null;
  checklist_run_id: string | null;
  checklist_item_id: string | null;
  linked_at: TimestampNull;
  created_at: Timestamp;
}

export interface DigestLogTable {
  tenant_id: string;
  week_start: ColumnType<string, string, string>;
  sent_at: Timestamp;
  recipients: Generated<number>;
}

export interface OwnerSessionsTable {
  id: Generated<string>;
  user_id: string;
  tenant_id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: Timestamp;
  last_seen_at: Timestamp;
  expires_at: TimestampReq;
  revoked_at: TimestampNull;
}

export interface PasswordResetsTable {
  token_hash: string;
  user_id: string;
  expires_at: TimestampReq;
  used_at: TimestampNull;
  created_at: Timestamp;
}

export interface MachineWatchesTable {
  id: Generated<string>;
  customer_id: string;
  shop_id: string;
  machine_type: MachineType;
  capacity_kg: Numeric;
  created_at: Timestamp;
  expires_at: TimestampReq;
  notified_at: TimestampNull;
  notified_machine_id: string | null;
  cancelled_at: TimestampNull;
}

export interface AppSettingsTable {
  key: string;
  value: Json<unknown>;
}

export interface Database {
  tenants: TenantsTable;
  users: UsersTable;
  memberships: MembershipsTable;
  shops: ShopsTable;
  devices: DevicesTable;
  machines: MachinesTable;
  machine_state_log: MachineStateLogTable;
  customers: CustomersTable;
  push_subscriptions: PushSubscriptionsTable;
  payments: PaymentsTable;
  payment_events: PaymentEventsTable;
  cycles: CyclesTable;
  machine_commands: MachineCommandsTable;
  tickets: TicketsTable;
  ticket_events: TicketEventsTable;
  refunds: RefundsTable;
  collections: CollectionsTable;
  collection_lines: CollectionLinesTable;
  maintenance_plans: MaintenancePlansTable;
  maintenance_logs: MaintenanceLogsTable;
  checklist_templates: ChecklistTemplatesTable;
  checklist_runs: ChecklistRunsTable;
  announcements: AnnouncementsTable;
  alerts: AlertsTable;
  audit_log: AuditLogTable;
  jobs: JobsTable;
  app_settings: AppSettingsTable;
  wa_contacts: WaContactsTable;
  wa_link_codes: WaLinkCodesTable;
  wa_messages: WaMessagesTable;
  attachments: AttachmentsTable;
  digest_log: DigestLogTable;
  owner_sessions: OwnerSessionsTable;
  password_resets: PasswordResetsTable;
  machine_watches: MachineWatchesTable;
}

export type Shop = Selectable<ShopsTable>;
export type Machine = Selectable<MachinesTable>;
export type Cycle = Selectable<CyclesTable>;
export type Device = Selectable<DevicesTable>;
export type Payment = Selectable<PaymentsTable>;
export type Ticket = Selectable<TicketsTable>;
export type NewCycle = Insertable<CyclesTable>;
export type MachineUpdate = Updateable<MachinesTable>;
