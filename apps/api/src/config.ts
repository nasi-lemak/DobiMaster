import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Minimal .env loader (avoids a dependency). Existing env vars win.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

/**
 * TRUST_PROXY: a hop count ("1" = one reverse proxy such as Caddy), comma-separated proxy IPs/CIDRs, "true"
 * (trust any X-Forwarded-For: only safe if nothing can reach the app directly) or "false" (the default:
 * use the connection's address, so clients can't fake their IP to dodge rate limits).
 */
function trustProxy(raw: string | undefined): boolean | string[] | ((addr: string, hop: number) => boolean) {
  if (raw === undefined || raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    return (_addr: string, hop: number) => hop < hops; // trust only the nearest N proxies
  }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const signupMode = (process.env.SIGNUP_MODE ?? 'open') as 'open' | 'first' | 'closed';
if (!['open', 'first', 'closed'].includes(signupMode)) throw new Error('SIGNUP_MODE must be open, first or closed');

export const config = {
  isProd,
  isTest: process.env.NODE_ENV === 'test' || !!process.env.VITEST,
  port: Number(env('PORT', '3000')),
  host: env('HOST', '0.0.0.0'),
  databaseUrl: env('DATABASE_URL', 'postgres://dobi:dobi@localhost:5432/dobimaster'),
  /** Public base URL of the web app — used in QR codes and push notification links. */
  publicUrl: env('PUBLIC_URL', 'http://localhost:5173'),
  jwtSecret: env('JWT_SECRET', isProd ? undefined : 'dev-only-secret-change-me-dev-only-secret'),
  vapidSubject: env('VAPID_SUBJECT', 'mailto:ops@dobimaster.local'),
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
  /** "none" disables pay-in-app. The mock gateway lets anyone "pay" for free, so production defaults to none. */
  paymentProvider: env('PAYMENT_PROVIDER', isProd ? 'none' : 'mock'),
  allowMockPaymentsInProduction: process.env.ALLOW_MOCK_PAYMENTS === 'true',
  trustProxy: trustProxy(process.env.TRUST_PROXY),
  /** open = anyone can create a business; first = only while no business exists (private install); closed = never. */
  signupMode,
  /** Seconds to wait for sensor confirmation after a paid start before retry/refund. */
  startConfirmSec: Number(env('START_CONFIRM_SEC', '90')),
  jobPollMs: Number(env('JOB_POLL_MS', '1000')),
  webDist: process.env.WEB_DIST,
  /** Local directory for uploaded photos (swap the BlobStore for S3-compatible storage at scale). */
  uploadDir: env('UPLOAD_DIR', './data/uploads'),
  whatsapp: {
    /** Meta WhatsApp Cloud API. Without a token the mock transport is used (dev/tests). */
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    /** The business number customers message, digits only, e.g. 60123456789. */
    number: env('WHATSAPP_NUMBER', '60000000000'),
    apiVersion: env('WHATSAPP_API_VERSION', 'v21.0'),
    /** Approved template names for messages sent outside the 24 h window (optional; billed per message). */
    digestTemplate: process.env.WHATSAPP_DIGEST_TEMPLATE,
  },
  /**
   * Who operates this server, shown in the privacy notice and terms (PDPA: customers must be told who
   * holds their data and how to contact them). Set these on every real server.
   */
  legal: {
    operatorName: process.env.LEGAL_OPERATOR_NAME ?? (isProd ? null : 'DobiMaster (development server)'),
    registrationNo: process.env.LEGAL_REGISTRATION_NO ?? null,
    address: process.env.LEGAL_ADDRESS ?? null,
    contactEmail: process.env.LEGAL_CONTACT_EMAIL ?? (isProd ? null : 'privacy@example.my'),
    /** Where the server (and so the data) physically is, e.g. "Singapore". */
    dataLocation: process.env.LEGAL_DATA_LOCATION ?? 'Singapore',
  },
  /** SMTP connection URL for owner emails (weekly digest). Without it, emails are logged. */
  smtpUrl: process.env.SMTP_URL,
  mailFrom: env('MAIL_FROM', 'DobiMaster <no-reply@dobimaster.local>'),
};

/** Refuse to boot a production server with settings that are unsafe on the public internet. */
export function assertProductionConfig(c: typeof config = config): string[] {
  if (!c.isProd) return [];
  const errors: string[] = [];
  if (c.jwtSecret.length < 32) errors.push('JWT_SECRET must be at least 32 characters (use: openssl rand -hex 32)');
  if (/change-me|dev-only/i.test(c.jwtSecret)) errors.push('JWT_SECRET is still the example value');
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(c.publicUrl); // trying the image on your own computer
  if (!local && !/^https:\/\//.test(c.publicUrl)) errors.push(`PUBLIC_URL must be https:// in production (got ${c.publicUrl})`);
  if (c.paymentProvider === 'mock' && !c.allowMockPaymentsInProduction)
    errors.push('PAYMENT_PROVIDER=mock lets anyone start machines for free. Use PAYMENT_PROVIDER=none, or set ALLOW_MOCK_PAYMENTS=true for a demo server.');
  return errors;
}

/** Settings a real server should have but that don't make it unsafe to start (printed as warnings). */
export function productionWarnings(c: typeof config = config): string[] {
  if (!c.isProd) return [];
  const w: string[] = [];
  if (!c.legal.operatorName || !c.legal.contactEmail)
    w.push('LEGAL_OPERATOR_NAME and LEGAL_CONTACT_EMAIL are not set: the privacy notice will show "[not set]" (required under the PDPA).');
  if (!process.env.TRUST_PROXY) w.push('TRUST_PROXY is not set: behind a reverse proxy every visitor shares one IP for rate limits. Set TRUST_PROXY=1 behind Caddy (deploy/ does this).');
  if (!c.smtpUrl) w.push('SMTP_URL is not set: password-reset and weekly-summary emails are only logged, not sent.');
  return w;
}
