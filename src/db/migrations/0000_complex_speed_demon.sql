CREATE TABLE "test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid,
	"prompt" text NOT NULL,
	"target_url" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"report_url" text,
	"error_message" text,
	"duration_ms" integer,
	"triggered_by" text DEFAULT 'manual' NOT NULL,
	"gemini_calls" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_suites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"target_url" text NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_id" uuid,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"target_url" text NOT NULL,
	"max_steps" integer DEFAULT 20,
	"tags" text[] DEFAULT '{}',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_suite_id_test_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."test_suites"("id") ON DELETE no action ON UPDATE no action;