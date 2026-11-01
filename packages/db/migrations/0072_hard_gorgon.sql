ALTER TABLE "chat_events" ADD COLUMN "space_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_events" ADD COLUMN "space_kind" text GENERATED ALWAYS AS ('personal'::text) STORED;--> statement-breakpoint
ALTER TABLE "chat_events" ADD COLUMN "audience" text GENERATED ALWAYS AS (NULL::text) STORED;--> statement-breakpoint
ALTER TABLE "chat_events" ADD COLUMN "author_id" uuid GENERATED ALWAYS AS (account_id) STORED;--> statement-breakpoint
ALTER TABLE "chat_events" ADD COLUMN "assignee_id" uuid GENERATED ALWAYS AS (account_id) STORED;--> statement-breakpoint
ALTER TABLE "chat_events" ADD COLUMN "deleted_at" timestamp with time zone GENERATED ALWAYS AS (NULL::timestamptz) STORED;--> statement-breakpoint
ALTER TABLE "chat_grants" ADD COLUMN "space_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_grants" ADD COLUMN "space_kind" text GENERATED ALWAYS AS ('personal'::text) STORED;--> statement-breakpoint
ALTER TABLE "chat_grants" ADD COLUMN "audience" text GENERATED ALWAYS AS (NULL::text) STORED;--> statement-breakpoint
ALTER TABLE "chat_grants" ADD COLUMN "author_id" uuid GENERATED ALWAYS AS (account_id) STORED;--> statement-breakpoint
ALTER TABLE "chat_grants" ADD COLUMN "assignee_id" uuid GENERATED ALWAYS AS (account_id) STORED;--> statement-breakpoint
ALTER TABLE "chat_grants" ADD COLUMN "deleted_at" timestamp with time zone GENERATED ALWAYS AS (NULL::timestamptz) STORED;--> statement-breakpoint
ALTER TABLE "chat_events" ADD CONSTRAINT "chat_events_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_grants" ADD CONSTRAINT "chat_grants_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;