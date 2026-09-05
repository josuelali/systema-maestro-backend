import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface Sql { query(sql: string, params?: any[]): Promise<{ rows: any[] }> }
export interface Database extends Sql {
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function openDatabase(): Promise<Database> {
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    return {
      query: (sql, params) => pool.query(sql, params),
      async transaction(fn) {
        const client = await pool.connect();
        try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      },
      close: () => pool.end(),
    };
  }
  if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL required in production');
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite(process.env.LOCAL_DATABASE_PATH || './.local-data');
  return {
    query: (sql, params) => pg.query(sql, params),
    transaction: fn => pg.transaction(tx => fn(tx)),
    close: () => pg.close(),
  };
}
export async function migrate(db: Database) {
  const sql = await readFile(path.join(__dirname, '../migrations/001.sql'), 'utf8');
  await db.transaction(async tx => {
    for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) await tx.query(statement);
  });
}
