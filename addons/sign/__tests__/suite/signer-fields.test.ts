/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach } from '@jest/globals'

// An outside signer fills their own fields with only the token from their email link.
const signers: Record<string, any> = {}
const fields: Record<string, any> = {}
let earlierUnsigned = 0
jest.mock('@/lib/db', () => ({
  prisma: {
    documentSigner: {
      findUnique: jest.fn(async ({ where }: any) => signers[where.token] ?? null),
      count: jest.fn(async () => earlierUnsigned),
    },
    documentField: {
      findUnique: jest.fn(async ({ where }: any) => fields[where.id] ?? null),
      findMany: jest.fn(async ({ where }: any) => Object.values(fields).filter((f: any) => f.documentId === where.documentId)),
      update: jest.fn(async ({ where, data }: any) => Object.assign(fields[where.id], data)),
    },
  },
}))
jest.mock('@/lib/auth', () => ({ getServerSession: async () => null }))

import { PATCH } from '@/app/api/signers/fields/[fieldId]/route'
import { GET } from '@/app/api/signers/fields/route'

const patch = (fieldId: string, body: any) =>
  PATCH(new Request(`http://sign.test/api/signers/fields/${fieldId}`, { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ fieldId }),
  })

describe('signer field routes (token, no sign-in)', () => {
  beforeEach(() => {
    earlierUnsigned = 0
    for (const k of Object.keys(signers)) delete signers[k]
    for (const k of Object.keys(fields)) delete fields[k]
    signers.tok = { id: 's1', documentId: 'd1', order: 0, status: 'PENDING', tokenExpiresAt: null, document: { id: 'd1', signingOrder: 'PARALLEL', status: 'SENT' } }
    fields.f1 = { id: 'f1', documentId: 'd1', assignedToId: 's1', value: null, x: 10 }
    fields.f2 = { id: 'f2', documentId: 'd1', assignedToId: 's2', value: null }
    fields.f3 = { id: 'f3', documentId: 'd2', assignedToId: 's1', value: null }
  })

  it('reads the fields of the token’s document only', async () => {
    const res = await GET(new Request('http://sign.test/api/signers/fields?token=tok'))
    expect(res.status).toBe(200)
    expect((await res.json()).fields.map((f: any) => f.id).sort()).toEqual(['f1', 'f2'])
    expect((await GET(new Request('http://sign.test/api/signers/fields?token=nope'))).status).toBe(404)
  })

  it('fills the signer’s own field, and nothing but its value', async () => {
    const res = await patch('f1', { token: 'tok', value: 'Jane', x: 999 })
    expect(res.status).toBe(200)
    expect(fields.f1.value).toBe('Jane')
    expect(fields.f1.x).toBe(10)
  })

  it('refuses someone else’s field, another document’s field, and a missing token', async () => {
    expect((await patch('f2', { token: 'tok', value: 'x' })).status).toBe(404)
    expect((await patch('f3', { token: 'tok', value: 'x' })).status).toBe(404)
    expect((await patch('f1', { value: 'x' })).status).toBe(400)
    expect(fields.f2.value).toBeNull()
  })

  it('refuses after signing, after the link expires, and before the signer’s turn', async () => {
    signers.tok.status = 'COMPLETED'
    expect((await patch('f1', { token: 'tok', value: 'x' })).status).toBe(409)
    signers.tok.status = 'PENDING'
    signers.tok.tokenExpiresAt = new Date(Date.now() - 1000)
    expect((await patch('f1', { token: 'tok', value: 'x' })).status).toBe(403)
    signers.tok.tokenExpiresAt = null
    signers.tok.document.signingOrder = 'SEQUENTIAL'
    earlierUnsigned = 1
    expect((await patch('f1', { token: 'tok', value: 'x' })).status).toBe(403)
    expect(fields.f1.value).toBeNull()
  })
})
