-- Add missing columns to documents table
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "documentHash" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "signedAt" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "signedDocumentPath" TEXT;

-- Add missing column to enterprise_accounts
ALTER TABLE "enterprise_accounts" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT;

-- Add unique constraint if it doesn't exist
DO $$ BEGIN
  ALTER TABLE "enterprise_accounts" ADD CONSTRAINT "enterprise_accounts_subscriptionId_key" UNIQUE ("subscriptionId");
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add foreign key if it doesn't exist
DO $$ BEGIN
  ALTER TABLE "enterprise_accounts" ADD CONSTRAINT "enterprise_accounts_subscriptionId_fkey" 
    FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add missing enum values if they don't exist
DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FILE_ACCESSED';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_ACCESS_DENIED';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Create enterprise_invitations table if it doesn't exist
CREATE TABLE IF NOT EXISTS "enterprise_invitations" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "enterprise_invitations_pkey" PRIMARY KEY ("id")
);

-- Add indexes if they don't exist
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_invitations_token_key" ON "enterprise_invitations"("token");
CREATE INDEX IF NOT EXISTS "enterprise_invitations_token_idx" ON "enterprise_invitations"("token");
CREATE INDEX IF NOT EXISTS "enterprise_invitations_email_enterpriseId_idx" ON "enterprise_invitations"("email", "enterpriseId");

-- Add foreign key for enterprise_invitations
DO $$ BEGIN
  ALTER TABLE "enterprise_invitations" ADD CONSTRAINT "enterprise_invitations_enterpriseId_fkey" 
    FOREIGN KEY ("enterpriseId") REFERENCES "enterprise_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
