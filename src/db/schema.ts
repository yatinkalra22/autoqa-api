import { pgTable, uuid, text, timestamp, integer, jsonb, boolean } from 'drizzle-orm/pg-core'

export const testSuites = pgTable('test_suites', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  targetUrl: text('target_url').notNull(),
  userId: text('user_id'),
  createdAt: timestamp('created_at').defaultNow(),
})

export const tests = pgTable('tests', {
  id: uuid('id').primaryKey().defaultRandom(),
  suiteId: uuid('suite_id').references(() => testSuites.id),
  name: text('name').notNull(),
  prompt: text('prompt').notNull(),
  targetUrl: text('target_url').notNull(),
  maxSteps: integer('max_steps').default(20),
  tags: text('tags').array().default([]),
  createdAt: timestamp('created_at').defaultNow(),
})

export const testRuns = pgTable('test_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  testId: uuid('test_id').references(() => tests.id),
  prompt: text('prompt').notNull(),
  targetUrl: text('target_url').notNull(),
  status: text('status').notNull().default('QUEUED'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  steps: jsonb('steps').notNull().default([]),
  summary: text('summary'),
  reportUrl: text('report_url'),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  triggeredBy: text('triggered_by').notNull().default('manual'),
  geminiCalls: integer('gemini_calls').notNull().default(0),
})
