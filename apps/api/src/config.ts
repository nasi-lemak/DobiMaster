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
  paymentProvider: env('PAYMENT_PROVIDER', 'mock'),
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
  /** SMTP connection URL for owner emails (weekly digest). Without it, emails are logged. */
  smtpUrl: process.env.SMTP_URL,
  mailFrom: env('MAIL_FROM', 'DobiMaster <no-reply@dobimaster.local>'),
};
