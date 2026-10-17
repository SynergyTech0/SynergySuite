/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals'
import { mailMode, suiteSender } from '@/lib/email'

describe('outgoing mail settings (lib/email)', () => {
  it('uses the suite mail server (Stalwart) when compose provides it', () => {
    expect(mailMode({ MAIL_SMTP_HOST: 'stalwart', MAIL_MASTER_USER: 'webmail@x.test', MAIL_MASTER_PASSWORD: 'p' } as any).kind).toBe('suite')
    expect(suiteSender({ MAIL_DOMAIN: 'x.test' } as any)).toBe('sign@x.test')
    expect(suiteSender({ SIGN_MAIL_FROM: 'contracts@x.test', MAIL_DOMAIN: 'x.test' } as any)).toBe('contracts@x.test')
  })

  it('prefers an outside mailbox when SIGN_SMTP_* is set', () => {
    expect(
      mailMode({ SIGN_SMTP_HOST: 'smtp.x.test', SIGN_SMTP_USER: 'u', SIGN_SMTP_PASSWORD: 'p', MAIL_SMTP_HOST: 'stalwart', MAIL_MASTER_USER: 'm', MAIL_MASTER_PASSWORD: 'p' } as any).kind,
    ).toBe('smtp')
  })

  it('keeps mail on disk with no server, in demo mode, or when disarmed', () => {
    expect(mailMode({} as any).kind).toBe('sink')
    expect(mailMode({ DEMO_MODE: '1', SIGN_SMTP_HOST: 'h', SIGN_SMTP_USER: 'u', SIGN_SMTP_PASSWORD: 'p' } as any).kind).toBe('sink')
    expect(mailMode({ EMAIL_SEND_ARMED: '0', SIGN_SMTP_HOST: 'h', SIGN_SMTP_USER: 'u', SIGN_SMTP_PASSWORD: 'p' } as any).kind).toBe('sink')
  })
})
