CREATE TABLE IF NOT EXISTS "sprint_reports" (
	"sprint_id" uuid PRIMARY KEY NOT NULL,
	"board_id" uuid NOT NULL,
	"committed_points" integer DEFAULT 0 NOT NULL,
	"completed_points" integer DEFAULT 0 NOT NULL,
	"committed_cards" integer DEFAULT 0 NOT NULL,
	"completed_cards" integer DEFAULT 0 NOT NULL,
	"returned_cards" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sprint_reports" ADD CONSTRAINT "sprint_reports_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sprint_reports" ADD CONSTRAINT "sprint_reports_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
