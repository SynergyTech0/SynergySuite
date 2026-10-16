/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach } from '@jest/globals'

// Suite sign-in: who the gateway vouches for, and how that maps onto Sign's users.
const users: any[] = []
jest.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findFirst: jest.fn(async ({ where }: any) =>
        users.filter((u) => u.email.toLowerCase() === where.email.equals.toLowerCase())[0] ?? null),
      create: jest.fn(async ({ data }: any) => {
        const u = { id: `u${users.length + 1}`, name: null, role: 'SENDER', enterpriseId: null, enterprise: null, subscription: null, createdAt: new Date(), ...data }
        users.push(u)
        return u
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(users.find((u) => u.id === where.id), data)),
      findUniqueOrThrow: jest.fn(),
    },
  },
}))
jest.mock('next/headers', () => ({ headers: () => new Headers() }))

import { sessionFrom, signInUrl, safePath, signOutUrl } from '@/lib/auth'

const h = (o: Record<string, string>) => new Headers(o)

describe('suite sign-in (lib/auth)', () => {
  beforeEach(() => {
    users.length = 0
    delete process.env.PROXY_SHARED_SECRET
    delete process.env.SIGN_ADMIN_EMAILS
    delete process.env.DEV_USER_EMAIL
    delete process.env.SUITE_DOMAIN
    delete process.env.SIGN_PUBLIC_URL
  })

  it('nobody is signed in without gateway headers (an outside signer)', async () => {
    expect(await sessionFrom(h({}))).toBeNull()
    expect(users).toHaveLength(0)
  })

  it('creates a Sign user the first time a suite person opens Sign', async () => {
    const s = await sessionFrom(h({ 'x-auth-request-email': 'Jane.Doe@Example.com', 'x-auth-request-preferred-username': 'Jane Doe' }))
    expect(s?.user.email).toBe('jane.doe@example.com')
    expect(s?.user.name).toBe('Jane Doe')
    expect(s?.user.role).toBe('SENDER')
    expect(s?.user.verified).toBe(true)
    expect(users).toHaveLength(1)
  })

  it('maps an existing account by email, whatever its letter case, keeping its id', async () => {
    users.push({ id: 'old', email: 'Pat@Example.com', name: 'Pat', role: 'SENDER', emailVerified: null, enterprise: null, subscription: null, enterpriseId: null, createdAt: new Date() })
    const s = await sessionFrom(h({ 'x-auth-request-email': 'pat@example.com' }))
    expect(s?.user.id).toBe('old')
    expect(users).toHaveLength(1)
    expect(users[0].emailVerified).toBeInstanceOf(Date)
  })

  it('refuses identity headers that did not come through the gateway', async () => {
    process.env.PROXY_SHARED_SECRET = 'gateway-secret'
    expect(await sessionFrom(h({ 'x-auth-request-email': 'eve@example.com' }))).toBeNull()
    expect(await sessionFrom(h({ 'x-auth-request-email': 'eve@example.com', 'x-proxy-auth-secret': 'wrong' }))).toBeNull()
    const ok = await sessionFrom(h({ 'x-auth-request-email': 'eve@example.com', 'x-proxy-auth-secret': 'gateway-secret' }))
    expect(ok?.user.email).toBe('eve@example.com')
  })

  it('SIGN_ADMIN_EMAILS makes someone a Sign admin', async () => {
    process.env.SIGN_ADMIN_EMAILS = 'boss@example.com, other@example.com'
    const s = await sessionFrom(h({ 'x-auth-request-email': 'BOSS@example.com' }))
    expect(s?.user.role).toBe('ADMIN')
  })

  it('sends people to the suite sign-in and back, only to paths on Sign', () => {
    process.env.SUITE_DOMAIN = 'suite.test'
    expect(signInUrl('/dashboard/documents')).toBe(
      'https://sso.suite.test/oauth2/start?rd=' + encodeURIComponent('https://sign.suite.test/dashboard/documents'),
    )
    expect(safePath('//evil.example/x')).toBe('/dashboard')
    expect(safePath('https://evil.example')).toBe('/dashboard')
    expect(signOutUrl()).toBe('https://sso.suite.test/oauth2/sign_out?rd=' + encodeURIComponent('https://suite.test'))
  })
})
