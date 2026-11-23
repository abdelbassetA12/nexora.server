import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** DEV ONLY: logs the message. Nothing is delivered. Disallowed in production by config validation. */
class DevConsoleEmailProvider implements EmailProvider {
  readonly name = 'dev-console (NOT DELIVERED)';
  async send(message: EmailMessage) {
    logger.warn({ to: message.to, subject: message.subject, body: message.text }, '[DEV EMAIL - not delivered]');
  }
}

class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  async send(message: EmailMessage) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Email provider responded with ${res.status}`);
  }
}

/** Test double that records messages so tests can read verification/reset tokens. */
export class MemoryEmailProvider implements EmailProvider {
  readonly name = 'memory (tests)';
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
  }
}

let provider: EmailProvider =
  env.isTest ? new MemoryEmailProvider() : env.EMAIL_PROVIDER === 'resend' ? new ResendEmailProvider() : new DevConsoleEmailProvider();

export const getEmailProvider = () => provider;
export const setEmailProvider = (p: EmailProvider) => {
  provider = p;
};
