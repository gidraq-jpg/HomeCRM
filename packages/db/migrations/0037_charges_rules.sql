ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_account_kind_key";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_utility_source";--> statement-breakpoint
ALTER TABLE "utility_charges" ALTER COLUMN "period" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "utility_charges" ALTER COLUMN "total_cents" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "utility_charges" ALTER COLUMN "due_on" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "utility_payments" ALTER COLUMN "paid_on" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "utility_payments" ALTER COLUMN "amount_cents" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "utility_payments" ALTER COLUMN "payer" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "utility_payments" ALTER COLUMN "method" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX "deadlines_account_kind_key" ON "deadlines" USING btree ("utility_account_id","source_kind") WHERE charge_id IS NULL;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_utility_source" CHECK ((source_kind='record' AND utility_account_id IS NULL AND meter_id IS NULL AND charge_id IS NULL) OR (object_id IS NOT NULL AND note_id IS NULL AND ((source_kind IN ('readings','payment') AND utility_account_id IS NOT NULL AND meter_id IS NULL AND (charge_id IS NULL OR source_kind='payment')) OR (source_kind='verification' AND meter_id IS NOT NULL AND utility_account_id IS NULL AND charge_id IS NULL))));--> statement-breakpoint
CREATE POLICY "utility_accounts_charges_worker" ON "utility_accounts" AS PERMISSIVE FOR SELECT TO "homecrm_worker" USING (EXISTS (SELECT 1 FROM deadlines d WHERE d.object_id=utility_accounts.parent_id));
--> statement-breakpoint
GRANT UPDATE(label) ON deadlines TO homecrm_app;
