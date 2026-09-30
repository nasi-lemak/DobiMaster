import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../../config.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailTransport {
  send(mail: Mail): Promise<void>;
}

export class SmtpMailTransport implements MailTransport {
  private transporter = nodemailer.createTransport(config.smtpUrl!);
  async send(mail: Mail) {
    await this.transporter.sendMail({ from: config.mailFrom, ...mail });
  }
}

/** Dev default: log instead of sending. */
export class LogMailTransport implements MailTransport {
  constructor(private log: FastifyBaseLogger) {}
  async send(mail: Mail) {
    this.log.info({ to: mail.to, subject: mail.subject }, `email (not sent — SMTP_URL unset)\n${mail.text}`);
  }
}

export class MemoryMailTransport implements MailTransport {
  sent: Mail[] = [];
  async send(mail: Mail) {
    this.sent.push(mail);
  }
}

export function createMailTransport(log: FastifyBaseLogger): MailTransport {
  return config.smtpUrl ? new SmtpMailTransport() : new LogMailTransport(log);
}
