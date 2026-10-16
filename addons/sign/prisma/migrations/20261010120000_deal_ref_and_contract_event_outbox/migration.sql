-- Additive only (production DB is drift-prone): two nullable columns, one new table, indexes.
-- IF NOT EXISTS so a re-run, or a DB that was db-pushed ahead of this migration, is a no-op.

-- CRM deal id on pipeline-created contracts.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "dealRef" TEXT;
CREATE INDEX IF NOT EXISTS "documents_dealRef_idx" ON "documents"("dealRef");

-- The CRM's idempotency key for POST /api/deal/contract. One draft per (dealRef, requestKey); rows
-- without a key (every non-pipeline document) are outside the index entirely.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "requestKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "documents_dealRef_requestKey_key"
  ON "documents"("dealRef", "requestKey") WHERE "requestKey" IS NOT NULL;

-- contract.event outbox (lib/deal/events.ts).
CREATE TABLE IF NOT EXISTS "contract_event_outbox" (
  "id" TEXT NOT NULL,
  "ref" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "lastStatus" INTEGER,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contract_event_outbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "contract_event_outbox_ref_key" ON "contract_event_outbox"("ref");
CREATE INDEX IF NOT EXISTS "contract_event_outbox_deliveredAt_failedAt_nextAttemptAt_idx" ON "contract_event_outbox"("deliveredAt", "failedAt", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "contract_event_outbox_documentId_idx" ON "contract_event_outbox"("documentId");
