import type { MachineState, RefundMethod, RefundStatus, StateSource, TicketCategory, TicketStatus } from '@dobi/shared';
import type { Recommendation, Severity } from './types';

export const STATE_LABEL: Record<MachineState, string> = {
  available: 'Available',
  running: 'Running',
  finished: 'Finished',
  offline: 'Sensor offline',
  fault: 'Fault',
  maintenance: 'Maintenance',
  disabled: 'Disabled',
};

export const SOURCE_LABEL: Record<StateSource, string> = {
  sensor: 'sensor',
  customer: 'customer check-in',
  staff: 'staff',
  payment: 'app payment',
  system: 'system',
  none: 'no data',
};

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  not_starting: 'Machine not starting',
  payment_no_start: 'Paid, not running',
  coin_jammed: 'Coin jammed',
  dirty_machine: 'Dirty machine',
  water_leak: 'Water leak',
  not_drying: 'Not drying',
  damaged: 'Damaged',
  abandoned_clothing: 'Abandoned clothing',
  cleanliness: 'Cleanliness',
  other: 'Other',
};

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  rejected: 'Rejected',
};

export const REFUND_METHOD_LABEL: Record<RefundMethod, string> = {
  original: 'Original app payment',
  duitnow: 'DuitNow transfer',
  cash: 'Cash',
  other: 'Other',
};

export const REFUND_STATUS_LABEL: Record<RefundStatus, string> = {
  requested: 'Awaiting decision',
  approved: 'Approved',
  rejected: 'Rejected',
  paid: 'Paid',
  failed: 'Failed',
};

export const SEVERITY_LABEL: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low' };

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  consider_adding: 'Consider adding one',
  balanced: 'Balanced',
  over_capacity: 'Over capacity',
  insufficient_data: 'Not enough data',
};

export const ALERT_KIND_LABEL: Record<string, string> = {
  repeat_fault: 'Repeat fault',
  low_usage: 'Low usage',
  maintenance_due: 'Maintenance due',
  device_offline: 'Sensor offline',
  start_failed: 'Start failed',
  uncollected: 'Uncollected laundry',
  stuck_cycle: 'Stuck cycle',
  short_cycle: 'Short cycle',
};

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const typeLabel = (t: string) => (t === 'washer' ? 'Washer' : t === 'dryer' ? 'Dryer' : t);

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
