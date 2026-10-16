/**
 * @jest-environment node
 */
/**
 * contract.event (lib/contract-events.ts): the payload the CRM receives, and the outbox that keeps
 * events alive through a CRM outage. The outbox table is an in-memory fake that honours the same
 * where-clauses the module relies on (claim lease, deliveredAt/failedAt/nextAttemptAt), so the
 * retry schedule is exercised for real; only the clock is passed in explicitly.
 */
import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals'
import crypto from 'crypto'

type Row = {
  id: string; ref: string; documentId: string; payload: any; attempts: number; nextAttemptAt: Date
  deliveredAt: Date | null; failedAt: Date | null; lastStatus: number | null; lastError: string | null; createdAt: Date
}
const mockRows: Row[] = []
const rows = mockRows
let seq = 0
const matches = (r: Row, w: any) =>
  (w.id === undefined || r.id === w.id) &&
  (w.deliveredAt === undefined || r.deliveredAt === w.deliveredAt) &&
  (w.failedAt === undefined || r.failedAt === w.failedAt) &&
  (w.nextAttemptAt?.lte === undefined || r.nextAttemptAt.getTime() <= w.nextAttemptAt.lte.getTime())

const mockOutbox = {
  upsert: jest.fn(async ({ where, create }: any) => {
    const hit = rows.find((r) => r.ref === where.ref)
    if (hit) return hit
    const r: Row = {
      id: `row${++seq}`, attempts: 0, nextAttemptAt: new Date(0), deliveredAt: null, failedAt: null,
      lastStatus: null, lastError: null, createdAt: new Date(), ...create,
    }
    rows.push(r)
    return r
  }),
  updateMany: jest.fn(async ({ where, data }: any) => {
    const hits = rows.filter((r) => matches(r, where))
    hits.forEach((r) => Object.assign(r, data))
    return { count: hits.length }
  }),
  update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id)!, data)),
  findMany: jest.fn(async ({ where, take }: any) => rows.filter((r) => matches(r, where)).slice(0, take)),
}
jest.mock('@/lib/db', () => ({ prisma: { contractEventOutbox: mockOutbox } }))

const fetchMock = jest.fn<any>()
const res = (status: number, body: any = { ok: true }) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) })

// Loaded after the mock above is initialised (a static import is hoisted above it).
let ev: typeof import('@/lib/contract-events')
beforeAll(async () => { ev = await import('@/lib/contract-events') })
const buildContractEvent: typeof ev.buildContractEvent = (...a) => ev.buildContractEvent(...a)
const contractEventRef: typeof ev.contractEventRef = (...a) => ev.contractEventRef(...a)
const enqueueContractEvent: typeof ev.enqueueContractEvent = (...a) => ev.enqueueContractEvent(...a)
const deliverOutboxRow: typeof ev.deliverOutboxRow = (...a) => ev.deliverOutboxRow(...a)
const sweepOutbox: typeof ev.sweepOutbox = (...a) => ev.sweepOutbox(...a)
const backoffMs: typeof ev.backoffMs = (...a) => ev.backoffMs(...a)

const T0 = new Date('2026-10-10T12:00:00Z')
const later = (ms: number) => new Date(T0.getTime() + ms)

/** Generated per run; not a real credential. */
const fake = `fake-${crypto.randomBytes(12).toString('hex')}`
const setEnv = (vars: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

beforeEach(() => {
  rows.length = 0
  jest.clearAllMocks()
  global.fetch = fetchMock as any
  setEnv({ CRM_EVENTS_URL: 'https://crm.test/api/pipeline/events', SIGN_CRM_TOKEN: fake })
})

describe('contract.event payload', () => {
  it('matches the pipeline spec shape', () => {
    const at = new Date('2026-10-10T12:00:00Z')
    const e = buildContractEvent({
      documentId: 'doc1', dealRef: 'deal_42', event: 'signer_signed', signerId: 'sg1',
      signerEmail: 'dana@example.com', signerRole: 'customer', at,
    })
    expect(e).toEqual({
      type: 'contract.event',
      ref: 'sign:doc1:signer_signed:sg1',
      at: '2026-10-10T12:00:00.000Z',
      data: { documentId: 'doc1', dealRef: 'deal_42', event: 'signer_signed', signerEmail: 'dana@example.com', signerRole: 'customer' },
    })
  })

  it('completed carries completedAt and a document-level ref; absent optionals are omitted, not null', () => {
    const e = buildContractEvent({ documentId: 'doc1', dealRef: 'deal_42', event: 'completed', completedAt: '2026-10-11T09:30:00Z' })
    expect(e.ref).toBe('sign:doc1:completed:document')
    expect(e.data).toEqual({ documentId: 'doc1', dealRef: 'deal_42', event: 'completed', completedAt: '2026-10-11T09:30:00.000Z' })
    expect(Object.keys(e.data)).not.toContain('signerEmail')
  })

  it('refs are unique per (document, event, signer)', () => {
    const refs = new Set([
      contractEventRef('d', 'signer_signed', 'a'), contractEventRef('d', 'signer_signed', 'b'),
      contractEventRef('d', 'sent', 'a'), contractEventRef('d', 'completed'),
    ])
    expect(refs.size).toBe(4)
  })
})

describe('outbox', () => {
  it('is a no-op for documents with no dealRef (non-pipeline documents)', async () => {
    expect(await enqueueContractEvent({ documentId: 'd', dealRef: null, event: 'completed' })).toEqual({ queued: false })
    expect(mockOutbox.upsert).not.toHaveBeenCalled()
  })

  it('enqueue is idempotent on ref', async () => {
    fetchMock.mockResolvedValue(res(200))
    await enqueueContractEvent({ documentId: 'd', dealRef: 'deal', event: 'signer_signed', signerId: 's1' })
    await enqueueContractEvent({ documentId: 'd', dealRef: 'deal', event: 'signer_signed', signerId: 's1' })
    expect(rows).toHaveLength(1)
    expect(rows[0].ref).toBe('sign:d:signer_signed:s1')
  })

  it('survives a CRM outage: retries with backoff, then delivers the same payload with the sign token', async () => {
    await mockOutbox.upsert({ where: { ref: 'r' }, create: { ref: 'r', documentId: 'd', payload: { type: 'contract.event', ref: 'r' } } })
    const row = rows[0]

    // outage 1: connection refused
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await sweepOutbox({ now: T0 })).toMatchObject({ retry: 1, delivered: 0 })
    expect(row).toMatchObject({ attempts: 1, deliveredAt: null, failedAt: null })
    expect(row.lastError).toMatch(/fetch failed/)
    expect(row.nextAttemptAt.getTime()).toBe(T0.getTime() + backoffMs(1))

    // not due yet: a sweep 1s later does nothing
    expect(await sweepOutbox({ now: later(1000) })).toEqual({ delivered: 0, retry: 0, failed: 0, skipped: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // outage 2: CRM up but erroring
    fetchMock.mockResolvedValueOnce(res(503, { error: 'down' }))
    const t2 = later(backoffMs(1))
    expect(await sweepOutbox({ now: t2 })).toMatchObject({ retry: 1 })
    expect(row).toMatchObject({ attempts: 2, lastStatus: 503 })
    expect(row.nextAttemptAt.getTime()).toBe(t2.getTime() + backoffMs(2))

    // CRM back
    fetchMock.mockResolvedValueOnce(res(200))
    expect(await sweepOutbox({ now: new Date(row.nextAttemptAt) })).toMatchObject({ delivered: 1 })
    expect(row.deliveredAt).toBeInstanceOf(Date)
    expect(row.attempts).toBe(3)

    const [url, init] = fetchMock.mock.calls[2] as [string, any]
    expect(url).toBe('https://crm.test/api/pipeline/events')
    expect(init.method).toBe('POST')
    expect(init.headers['x-service-token']).toBe(fake)
    expect(JSON.parse(init.body)).toEqual({ type: 'contract.event', ref: 'r' })

    // delivered rows are never sent again
    expect(await sweepOutbox({ now: later(10 * 86400_000) })).toEqual({ delivered: 0, retry: 0, failed: 0, skipped: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('backoff grows exponentially and is capped', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000])
    expect(backoffMs(50)).toBe(6 * 3600_000)
  })

  it('treats 202 {unmatched:true} as delivered (spec: do not retry forever)', async () => {
    await mockOutbox.upsert({ where: { ref: 'u' }, create: { ref: 'u', documentId: 'd', payload: {} } })
    fetchMock.mockResolvedValueOnce(res(202, { ok: true, unmatched: true }))
    expect(await sweepOutbox({ now: T0 })).toMatchObject({ delivered: 1 })
  })

  it('gives up after MAX_ATTEMPTS and keeps the row for inspection', async () => {
    await mockOutbox.upsert({ where: { ref: 'f' }, create: { ref: 'f', documentId: 'd', payload: {} } })
    rows[0].attempts = ev.MAX_ATTEMPTS - 1
    fetchMock.mockResolvedValueOnce(res(500))
    expect(await sweepOutbox({ now: T0 })).toMatchObject({ failed: 1 })
    expect(rows[0].failedAt).toBeInstanceOf(Date)
    fetchMock.mockResolvedValue(res(200))
    expect(await sweepOutbox({ now: later(86400_000) })).toEqual({ delivered: 0, retry: 0, failed: 0, skipped: 0 })
  })

  it('does not burn attempts while the CRM endpoint is unconfigured', async () => {
    setEnv({ CRM_EVENTS_URL: undefined })
    await mockOutbox.upsert({ where: { ref: 'n' }, create: { ref: 'n', documentId: 'd', payload: {} } })
    expect(await sweepOutbox({ now: T0 })).toMatchObject({ skipped: 1 })
    expect(rows[0].attempts).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a row claimed by another sweeper is skipped, not double-sent', async () => {
    await mockOutbox.upsert({ where: { ref: 'c' }, create: { ref: 'c', documentId: 'd', payload: {} } })
    const snapshot = { ...rows[0] }
    fetchMock.mockResolvedValue(res(200))
    expect(await deliverOutboxRow(snapshot, T0)).toBe('delivered')
    expect(await deliverOutboxRow(snapshot, T0)).toBe('skipped') // stale copy of the same row
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
