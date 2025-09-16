import { Pool } from 'pg';
import * as path from 'path';
import * as fs from 'fs';

// Create PostgreSQL connection pool
export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'translator',
  user: process.env.DB_USER || 'translator',
  password: process.env.DB_PASSWORD,
  max: 20, // Maximum number of clients in pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return error after 2 seconds if connection cannot be established
});

// Test database connection
pool.on('connect', () => {
  console.log('Database pool: client connected');
});

pool.on('error', (err) => {
  console.error('Database pool error:', err);
});

// Run database migrations
export async function runMigrations() {
  const client = await pool.connect();
  
  try {
    // Create migrations table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get list of migration files
    const migrationsDir = path.join(__dirname, '../../migrations');
    
    // Create migrations directory if it doesn't exist
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
      console.log('Created migrations directory');
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    // Get already executed migrations
    const result = await client.query('SELECT filename FROM migrations');
    const executed = new Set(result.rows.map(r => r.filename));

    // Execute pending migrations
    for (const file of files) {
      if (!executed.has(file)) {
        console.log(`Running migration: ${file}`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO migrations (filename) VALUES ($1)', [file]);
          await client.query('COMMIT');
          console.log(`Migration ${file} completed`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    }

    console.log('All migrations completed');
  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Graceful shutdown
export async function closeDatabase() {
  await pool.end();
  console.log('Database pool closed');
}