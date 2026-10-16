DO $$ BEGIN
 CREATE TYPE "public"."resolution" AS ENUM('done', 'wont_do', 'duplicate', 'cannot_reproduce');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."status_category" AS ENUM('todo', 'in_progress', 'done');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "resolution" "resolution";--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN IF NOT EXISTS "status_category" "status_category" DEFAULT 'todo' NOT NULL;
--> statement-breakpoint
-- Existing lists: infer the category from the title (same rules as lib/workflow inferCategory).
UPDATE "lists" SET "status_category" = CASE
  WHEN lower("title") ~ '(^|[^a-z])(done|complete|completed|closed|shipped|released|resolved|finished|archive)([^a-z]|$)' THEN 'done'::status_category
  WHEN lower("title") ~ '(^|[^a-z])(doing|in progress|progress|review|qa|test|testing|wip|active|started|blocked|ready for)' THEN 'in_progress'::status_category
  ELSE 'todo'::status_category END
WHERE "status_category" = 'todo';
--> statement-breakpoint
-- Existing completed cards: resolved as done.
UPDATE "cards" SET "resolution" = 'done' WHERE "is_complete" = true AND "resolution" IS NULL;