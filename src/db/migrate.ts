import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://autoqa:autoqa@localhost:5432/autoqa',
  })
  const db = drizzle(pool)

  console.log('Running migrations...')
  await migrate(db, { migrationsFolder: './src/db/migrations' })
  console.log('Migrations complete!')

  await pool.end()
}

main().catch(console.error)
