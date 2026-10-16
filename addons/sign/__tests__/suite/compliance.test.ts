/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach } from '@jest/globals'

// Legal hold: a sender deleting a document someone on hold is on keeps it for eDiscovery.
const docs: Record<string, any> = {}
const calls: string[] = []
jest.mock('@/lib/db', () => ({
  prisma: {
    document: {
      findUnique: jest.fn(async ({ where }: any) => docs[where.id] ?? null),
      update: jest.fn(async ({ where, data }: any) => { calls.push(`held:${where.id}`); return Object.assign(docs[where.id], data) }),
      delete: jest.fn(async ({ where }: any) => { calls.push(`deleted:${where.id}`); delete docs[where.id] }),
      count: jest.fn(async () => 0),
    },
    template: { count: jest.fn(async () => 0) },
    documentSigner: { updateMany: jest.fn(async ({ where }: any) => { calls.push(`links-off:${where.documentId}`) }) },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  },
}))
jest.mock('@/lib/storage', () => ({ deleteFile: jest.fn(async (p: string) => { calls.push(`file:${p}`) }), getFileBuffer: jest.fn() }))

import { deleteDocument } from '@/lib/ediscovery'
import { POST as complianceSearch } from '@/app/api/compliance/search/route'

describe('legal hold and eDiscovery', () => {
  beforeEach(() => {
    calls.length = 0
    docs.d1 = { id: 'd1', cloudStoragePath: 'documents/d1.pdf', signedDocumentPath: 'signed/d1.pdf', cloudProvider: 'LOCAL', sender: { email: 'a@x.test' }, signers: [{ email: 'outside@y.test' }] }
  })

  it('deletes the document and its files when nobody on it is on hold', async () => {
    expect(await deleteDocument('d1', async () => false)).toBe('deleted')
    expect(calls).toEqual(['file:documents/d1.pdf', 'file:signed/d1.pdf', 'deleted:d1'])
  })

  it('keeps it, files and all, and turns its signing links off when a signer is on hold', async () => {
    expect(await deleteDocument('d1', async (e) => e === 'outside@y.test')).toBe('held')
    expect(calls.sort()).toEqual(['held:d1', 'links-off:d1'])
    expect(docs.d1.heldDeletedAt).toBeInstanceOf(Date)
  })

  it('answers the Admin center only with COMPLIANCE_TOKEN', async () => {
    process.env.COMPLIANCE_TOKEN = 'ct'
    const res = await complianceSearch(new Request('http://sign/api/compliance/search', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(401)
    const bad = await complianceSearch(new Request('http://sign/api/compliance/search', { method: 'POST', body: '{"limit":0}', headers: { authorization: 'Bearer ct' } }))
    expect(bad.status).toBe(400)
  })
})
