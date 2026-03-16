-- Store reports and screenshots in DB instead of ephemeral Cloud Run filesystem
ALTER TABLE "test_runs" ADD COLUMN IF NOT EXISTS "report_html" text;
ALTER TABLE "test_runs" ADD COLUMN IF NOT EXISTS "screenshot_base64" text;
