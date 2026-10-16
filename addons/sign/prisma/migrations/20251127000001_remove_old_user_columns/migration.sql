-- Clean up orphaned assignedToId values first
UPDATE document_fields 
SET "assignedToId" = NULL 
WHERE "assignedToId" IS NOT NULL 
  AND "assignedToId" NOT IN (SELECT id FROM document_signers);

-- Remove old columns that are no longer in the schema
ALTER TABLE "users" DROP COLUMN IF EXISTS "stripeCustomerId";
ALTER TABLE "users" DROP COLUMN IF EXISTS "tier";

-- Add foreign key for document_fields.assignedToId if missing
DO $$ BEGIN
  ALTER TABLE "document_fields" ADD CONSTRAINT "document_fields_assignedToId_fkey" 
    FOREIGN KEY ("assignedToId") REFERENCES "document_signers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Fix enterprise_invitations indexes
DROP INDEX IF EXISTS "enterprise_invitations_email_enterpriseId_idx";
DROP INDEX IF EXISTS "enterprise_invitations_token_idx";
CREATE INDEX IF NOT EXISTS "enterprise_invitations_email_enterpriseId_idx" ON "enterprise_invitations"("email", "enterpriseId");
CREATE INDEX IF NOT EXISTS "enterprise_invitations_token_idx" ON "enterprise_invitations"("token");
