import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prismaBase: PrismaClient | undefined
}

const base = globalForPrisma.prismaBase ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prismaBase = base

/** Reads that would otherwise see documents deleted under a legal hold (see lib/compliance). */
const HIDES_HELD = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy', 'updateMany',
])

/**
 * The app's database client. A document its sender deleted while under a legal hold is kept for
 * the Admin center's eDiscovery but is gone for everyone else: every document query here skips it
 * unless the query asks about heldDeletedAt itself. eDiscovery reads with raw SQL and sees it.
 */
export const prisma = base.$extends({
  query: {
    document: {
      async $allOperations({ operation, args, query }) {
        if (HIDES_HELD.has(operation)) {
          const a = (args ?? {}) as { where?: Record<string, unknown> }
          if (!a.where || !('heldDeletedAt' in a.where)) a.where = { ...(a.where ?? {}), heldDeletedAt: null }
          return query(a as typeof args)
        }
        return query(args)
      },
    },
  },
})

export type Db = typeof prisma
