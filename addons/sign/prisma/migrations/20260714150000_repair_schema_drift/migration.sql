-- REPAIR: the committed migrations had drifted from schema.prisma.
--
-- Deploying from migrations alone produced a database the application could not run against:
-- no DetectionMethod enum, none of the OCR/AI columns on document_fields, and no field_corrections
-- table at all. Those objects only ever existed on machines where someone had run `prisma db push`.
--
-- This migration is written to be safe in BOTH worlds:
--   * a fresh database built from migrations  -> it creates the missing objects
--   * a database already `db push`ed to schema -> every step is a no-op
-- Hence the IF NOT EXISTS / catch-duplicate guards rather than the raw `migrate diff` output.
--
-- It is also DATA-PRESERVING. The generated diff wanted to DROP affiliate_earnings.weekStart/weekEnd
-- and ADD monthStart/monthEnd as NOT NULL with no default — which both destroys the existing payout
-- periods and fails outright on a populated table. We add, backfill, then drop.

-- ---------------------------------------------------------------------------
-- 1. DetectionMethod enum (incl. AI, for fields placed by the document model)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE "DetectionMethod" AS ENUM ('MANUAL', 'OCR_GPU', 'OCR_LOCAL', 'AI');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

-- Enum may pre-exist without 'AI' (added later than the others).
ALTER TYPE "DetectionMethod" ADD VALUE IF NOT EXISTS 'AI';

-- ---------------------------------------------------------------------------
-- 2. document_fields: OCR/AI provenance columns
-- ---------------------------------------------------------------------------
ALTER TABLE "document_fields"
  ADD COLUMN IF NOT EXISTS "detectionMethod" "DetectionMethod" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "confidence"      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "ocrSourceText"   TEXT,
  ADD COLUMN IF NOT EXISTS "originalX"       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "originalY"       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "originalWidth"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "originalHeight"  DOUBLE PRECISION;

-- ---------------------------------------------------------------------------
-- 3. field_corrections — the field-placement training table (was missing entirely)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "field_corrections" (
    "id"                 TEXT NOT NULL,
    "fieldId"            TEXT NOT NULL,
    "documentId"         TEXT NOT NULL,
    "originalFieldType"  "FieldType" NOT NULL,
    "originalLabel"      TEXT NOT NULL,
    "originalX"          DOUBLE PRECISION NOT NULL,
    "originalY"          DOUBLE PRECISION NOT NULL,
    "originalWidth"      DOUBLE PRECISION NOT NULL,
    "originalHeight"     DOUBLE PRECISION NOT NULL,
    "ocrConfidence"      DOUBLE PRECISION,
    "ocrSourceText"      TEXT,
    "correctedFieldType" "FieldType" NOT NULL,
    "correctedLabel"     TEXT NOT NULL,
    "correctedX"         DOUBLE PRECISION NOT NULL,
    "correctedY"         DOUBLE PRECISION NOT NULL,
    "correctedWidth"     DOUBLE PRECISION NOT NULL,
    "correctedHeight"    DOUBLE PRECISION NOT NULL,
    "correctedBy"        TEXT,
    "correctedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_corrections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "field_corrections_documentId_idx" ON "field_corrections"("documentId");
CREATE INDEX IF NOT EXISTS "field_corrections_fieldId_idx"    ON "field_corrections"("fieldId");

DO $$
BEGIN
  ALTER TABLE "field_corrections"
    ADD CONSTRAINT "field_corrections_fieldId_fkey"
    FOREIGN KEY ("fieldId") REFERENCES "document_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  ALTER TABLE "field_corrections"
    ADD CONSTRAINT "field_corrections_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

-- ---------------------------------------------------------------------------
-- 4. enterprise_requests: payment token
-- ---------------------------------------------------------------------------
ALTER TABLE "enterprise_requests"
  ADD COLUMN IF NOT EXISTS "paymentToken"          TEXT,
  ADD COLUMN IF NOT EXISTS "paymentTokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_requests_paymentToken_key"
  ON "enterprise_requests"("paymentToken");

-- ---------------------------------------------------------------------------
-- 5. subscriptions: pendingTier
-- ---------------------------------------------------------------------------
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "pendingTier" "SubscriptionTier";

-- ---------------------------------------------------------------------------
-- 6. affiliate_earnings: weekly -> monthly periods, WITHOUT losing the existing rows.
--    Add nullable, backfill from the week columns, enforce NOT NULL, then drop the old ones.
-- ---------------------------------------------------------------------------
ALTER TABLE "affiliate_earnings"
  ADD COLUMN IF NOT EXISTS "monthStart" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "monthEnd"   TIMESTAMP(3);

DO $$
BEGIN
  -- Carry the old period over where it exists; otherwise fall back to the current month so that
  -- pre-existing rows survive the NOT NULL constraint instead of blocking the migration.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'affiliate_earnings' AND column_name = 'weekStart'
  ) THEN
    EXECUTE '
      UPDATE "affiliate_earnings"
         SET "monthStart" = COALESCE("monthStart", date_trunc(''month'', "weekStart")),
             "monthEnd"   = COALESCE("monthEnd",
                              date_trunc(''month'', "weekStart") + INTERVAL ''1 month'' - INTERVAL ''1 day'')
       WHERE "monthStart" IS NULL OR "monthEnd" IS NULL';
  END IF;

  UPDATE "affiliate_earnings"
     SET "monthStart" = COALESCE("monthStart", date_trunc('month', CURRENT_DATE)),
         "monthEnd"   = COALESCE("monthEnd",
                          date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')
   WHERE "monthStart" IS NULL OR "monthEnd" IS NULL;
END$$;

ALTER TABLE "affiliate_earnings" ALTER COLUMN "monthStart" SET NOT NULL;
ALTER TABLE "affiliate_earnings" ALTER COLUMN "monthEnd"   SET NOT NULL;

DROP INDEX IF EXISTS "affiliate_earnings_affiliateId_referredUserId_weekStart_key";

ALTER TABLE "affiliate_earnings"
  DROP COLUMN IF EXISTS "weekStart",
  DROP COLUMN IF EXISTS "weekEnd";

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_earnings_affiliateId_referredUserId_monthStart_key"
  ON "affiliate_earnings"("affiliateId", "referredUserId", "monthStart");
