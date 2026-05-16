
import fs from 'fs';
import path from 'path';
import pool from '../config/database';
async function migrate() {
  console.log('Running migrations...');
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (id SERIAL PRIMARY KEY, filename VARCHAR(255) UNIQUE NOT NULL, applied_at TIMESTAMPTZ DEFAULT NOW())');
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f: string) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const { rows } = await pool.query('SELECT id FROM schema_migrations WHERE filename = $1', [file]);
    if (rows.length > 0) { console.log('Skipped: ' + file); continue; }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    console.log('Applied: ' + file);
  }
  console.log('All migrations complete!');
  await pool.end();
}
migrate().catch(console.error);
