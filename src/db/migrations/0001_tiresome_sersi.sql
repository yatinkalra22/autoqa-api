CREATE TABLE "auth_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"login_url" text NOT NULL,
	"credentials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submit_button" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
