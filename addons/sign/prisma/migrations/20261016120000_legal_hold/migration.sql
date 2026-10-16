-- A document its sender deleted while someone on it was under a legal hold (Admin center). It is
-- kept, out of sight, for eDiscovery until the hold is lifted.
ALTER TABLE "documents" ADD COLUMN "heldDeletedAt" TIMESTAMP(3);
CREATE INDEX "documents_heldDeletedAt_idx" ON "documents"("heldDeletedAt");
