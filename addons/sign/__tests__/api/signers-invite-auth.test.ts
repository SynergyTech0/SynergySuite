/**
 * @jest-environment node
 */
/**
 * Regression test for the unauthenticated-invite vulnerability.
 *
 * POST /api/signers/invite used to take a documentId and a list of signers from ANYONE and
 * email each of them a tokenised /sign/<token> link. An unauthenticated caller could inject
 * themselves as a signer on a document they had nothing to do with, then read and sign it.
 *
 * Note the tests that already existed for this route never invoked the handler at all — they
 * mocked a signer object and asserted on the mock. They passed the entire time the hole was
 * open. These tests CALL THE ROUTE.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals'


// The suite gateway's session (lib/auth), as the route sees it.
const mockGetServerSession = jest.fn<(...args: any[]) => Promise<any>>()
jest.mock('@/lib/auth', () => ({
  authOptions: {},
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}))

const mockFindUnique = jest.fn<(...args: any[]) => Promise<any>>()
const mockUpdate = jest.fn<(...args: any[]) => Promise<any>>()
jest.mock('@/lib/db', () => ({
  prisma: {
    document: {
      findUnique: (...a: any[]) => mockFindUnique(...a),
      update: (...a: any[]) => mockUpdate(...a),
    },
    documentSigner: { create: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
  },
}))
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn() }))
jest.mock('@/lib/email-templates', () => ({ renderSignatureRequest: jest.fn(() => '<p/>') }))
jest.mock('@/lib/notifications', () => ({ createNotification: jest.fn() }))

const post = async (body: any, headers: Record<string, string> = {}) => {
  const { POST } = await import('@/app/api/signers/invite/route')
  return POST(
    new Request('http://localhost/api/signers/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }) as any
  )
}

const BODY = {
  documentId: 'doc-owned-by-alice',
  signers: [{ email: 'attacker@evil.example', name: 'Mallory' }],
}

describe('POST /api/signers/invite — authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue(null)
    mockFindUnique.mockResolvedValue({
      id: 'doc-owned-by-alice',
      senderId: 'alice',
      sender: { name: 'Alice', email: 'alice@example.com' },
    })
  })

  it('REJECTS an unauthenticated caller (the vulnerability)', async () => {
    const res: any = await post(BODY)
    expect(res.status).toBe(401)
    // and it must not have touched the document at all
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('REJECTS a logged-in user who does not own the document', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mallory' } })
    const res: any = await post(BODY)
    expect(res.status).toBe(404) // not 403 — don't confirm the id exists to a stranger
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('ALLOWS the document owner', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'alice' } })
    const res: any = await post(BODY)
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(404)
  })
})
