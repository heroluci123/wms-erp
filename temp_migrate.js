import { db } from './src/lib/db.js';
import { runMigrations } from './electron/database/migrations.js';

async function migrate() {
  try {
    console.log('Running migrations...');
    await runMigrations(db);
    console.log('Migrations completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  }
}

migrate();
