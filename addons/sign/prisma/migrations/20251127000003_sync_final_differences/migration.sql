-- Add tokenExpiresAt to document_signers
ALTER TABLE "document_signers" ADD COLUMN IF NOT EXISTS "tokenExpiresAt" TIMESTAMP(3);

-- Remove unique constraint from enterprise_accounts.domain if it exists
ALTER TABLE "enterprise_accounts" DROP CONSTRAINT IF EXISTS "enterprise_accounts_domain_key";

-- Ensure foreign key exists for subscriptionId
ALTER TABLE "enterprise_accounts" DROP CONSTRAINT IF EXISTS "enterprise_accounts_subscriptionId_fkey";
ALTER TABLE "enterprise_accounts" ADD CONSTRAINT "enterprise_accounts_subscriptionId_fkey" 
    FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
