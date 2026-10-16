ALTER TYPE "public"."activity_type" ADD VALUE IF NOT EXISTS 'card_deleted';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE IF NOT EXISTS 'card_restored';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE IF NOT EXISTS 'comment_edited';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE IF NOT EXISTS 'comment_deleted';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE IF NOT EXISTS 'label_removed';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE IF NOT EXISTS 'member_removed';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE IF NOT EXISTS 'checklist_added';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE IF NOT EXISTS 'list_created';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE IF NOT EXISTS 'list_updated';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE IF NOT EXISTS 'list_archived';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE IF NOT EXISTS 'sprint_started';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE IF NOT EXISTS 'sprint_completed';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE IF NOT EXISTS 'attachment_added';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE IF NOT EXISTS 'attachment_removed';--> statement-breakpoint
DROP INDEX IF EXISTS "activities_board_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_card_idx" ON "activities" USING btree ("card_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_board_idx" ON "activities" USING btree ("board_id","created_at");