import nodemailer from 'nodemailer';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { SMTP_HOST, SMTP_PORT, MAIL_FROM, DEMO_MODE } from './config';

/*
 * Mail delivery: SMTP via config (SMTP_HOST/SMTP_PORT), defaulting to the local
 * test sink on 127.0.0.1:8025. If SMTP is unreachable the message is written
 * to ./dev-mail/<ts>.eml instead so flows stay testable offline. In demo mode nothing is sent.
 */

const FROM = MAIL_FROM;
export const DEV_MAIL_DIR = path.join(process.cwd(), 'dev-mail');

export async function sendMail(to: string, subject: string, text: string): Promise<{ delivered: 'smtp' | 'file' | 'demo_skipped' }> {
  if (DEMO_MODE) return { delivered: 'demo_skipped' };
  const host = SMTP_HOST;
  const port = SMTP_PORT;
  try {
    const transport = nodemailer.createTransport({
      host, port, secure: false,
      connectionTimeout: 3000, greetingTimeout: 3000, socketTimeout: 5000,
      tls: { rejectUnauthorized: false },
    });
    await transport.sendMail({ from: FROM, to, subject, text });
    return { delivered: 'smtp' };
  } catch {
    await mkdir(DEV_MAIL_DIR, { recursive: true });
    const file = path.join(DEV_MAIL_DIR, `${Date.now()}-${to.replace(/[^a-z0-9@.]/gi, '_')}.eml`);
    await writeFile(file, `From: ${FROM}\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return { delivered: 'file' };
  }
}
