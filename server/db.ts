import knex, { type Knex } from 'knex';
import { DB_PATH, ensureDataDirectories } from './config.js';

ensureDataDirectories();

interface SqliteDatabaseLike {
  pragma: (sql: string) => unknown;
}

export const db: Knex = knex({
  client: 'better-sqlite3',
  connection: {
    filename: DB_PATH,
  },
  useNullAsDefault: true,
  pool: {
    min: 1,
    max: 1,
    afterCreate: (conn: SqliteDatabaseLike, done: (err: Error | null, conn: SqliteDatabaseLike) => void) => {
      try {
        conn.pragma('foreign_keys = ON');
        conn.pragma('journal_mode = WAL');
        conn.pragma('busy_timeout = 5000');
        done(null, conn);
      } catch (err) {
        done(err as Error, conn);
      }
    },
  },
});
