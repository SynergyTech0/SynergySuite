-- Add missing columns to users table (these were removed from schema but exist in DB)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tier" TEXT;

-- Add unique constraint for stripeCustomerId if it doesn't exist
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_stripeCustomerId_key" UNIQUE ("stripeCustomerId");
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- Add foreign key for document_fields.assignedToId if it doesn't exist
DO $$ BEGIN
  ALTER TABLE "document_fields" ADD CONSTRAINT "document_fields_assignedToId_fkey" 
    FOREIGN KEY ("assignedToId") REFERENCES "document_signers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Rename indexes for enterprise_invitations to match database naming
DROP INDEX IF EXISTS "enterprise_invitations_email_enterpriseId_idx";
DROP INDEX IF EXISTS "enterprise_invitations_token_idx";

CREATE INDEX IF NOT EXISTS "enterprise_inv_email_idx" ON "enterprise_invitations"("email", "enterpriseId");
CREATE INDEX IF NOT EXISTS "enterprise_inv_token_idx" ON "enterprise_invitations"("token");
