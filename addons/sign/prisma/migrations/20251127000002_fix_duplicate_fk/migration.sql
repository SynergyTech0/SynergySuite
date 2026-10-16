-- Drop any duplicate foreign keys on enterprise_accounts.subscriptionId
-- Keep only one constraint
DO $$ 
DECLARE
    constraint_count INTEGER;
BEGIN
    -- Count how many foreign key constraints exist for subscriptionId
    SELECT COUNT(*) INTO constraint_count
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE conrelid = 'enterprise_accounts'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE '%subscriptionId%';
    
    -- If there are duplicates, drop all and recreate just one
    IF constraint_count > 1 THEN
        -- Drop all foreign keys on subscriptionId
        ALTER TABLE "enterprise_accounts" DROP CONSTRAINT IF EXISTS "enterprise_accounts_subscriptionId_fkey";
        ALTER TABLE "enterprise_accounts" DROP CONSTRAINT IF EXISTS "enterprise_accounts_subscriptionId_fkey1";
        
        -- Recreate the correct one
        ALTER TABLE "enterprise_accounts" ADD CONSTRAINT "enterprise_accounts_subscriptionId_fkey" 
            FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
