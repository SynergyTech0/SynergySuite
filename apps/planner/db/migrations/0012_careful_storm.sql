ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "storage_key" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "size_bytes" integer;