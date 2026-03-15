-- Add userId columns for per-user data scoping
ALTER TABLE "tests" ADD COLUMN IF NOT EXISTS "user_id" text;
ALTER TABLE "test_runs" ADD COLUMN IF NOT EXISTS "user_id" text;
ALTER TABLE "auth_profiles" ADD COLUMN IF NOT EXISTS "user_id" text;

-- Create shared_reports table for public report sharing
CREATE TABLE IF NOT EXISTS "shared_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "test_runs"("id"),
  "user_id" text NOT NULL,
  "created_at" timestamp DEFAULT now()
);

-- Create user_webhooks table (replaces in-memory webhook storage)
CREATE TABLE IF NOT EXISTS "user_webhooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL,
  "url" text NOT NULL,
  "type" text NOT NULL DEFAULT 'slack',
  "created_at" timestamp DEFAULT now()
);

-- Create indexes for userId lookups
CREATE INDEX IF NOT EXISTS "idx_tests_user_id" ON "tests"("user_id");
CREATE INDEX IF NOT EXISTS "idx_test_runs_user_id" ON "test_runs"("user_id");
CREATE INDEX IF NOT EXISTS "idx_auth_profiles_user_id" ON "auth_profiles"("user_id");
CREATE INDEX IF NOT EXISTS "idx_shared_reports_run_id" ON "shared_reports"("run_id");
CREATE INDEX IF NOT EXISTS "idx_user_webhooks_user_id" ON "user_webhooks"("user_id");
