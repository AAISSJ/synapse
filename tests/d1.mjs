import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** A small D1-compatible adapter backed by real SQLite, for tests and local dev. */
export class SQLiteD1 {
  constructor(filename = ':memory:') {
    this.sqlite = new DatabaseSync(filename);
    this.sqlite.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql) { return new Prepared(this, sql); }

  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => statement.execute('all'));
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  async exec(sql) {
    const started = performance.now();
    this.sqlite.exec(sql);
    return { count: 1, duration: performance.now() - started };
  }

  migrate(directory = new URL('../drizzle/', import.meta.url)) {
    this.sqlite.exec('CREATE TABLE IF NOT EXISTS _atlas_local_migrations (name TEXT PRIMARY KEY)');
    for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
      if (this.sqlite.prepare('SELECT name FROM _atlas_local_migrations WHERE name=?').get(name)) continue;
      this.sqlite.exec('BEGIN IMMEDIATE');
      try {
        this.sqlite.exec(readFileSync(join(String(directory instanceof URL ? directory.pathname : directory), name), 'utf8'));
        this.sqlite.prepare('INSERT INTO _atlas_local_migrations (name) VALUES (?)').run(name);
        this.sqlite.exec('COMMIT');
      } catch (error) {
        this.sqlite.exec('ROLLBACK');
        throw error;
      }
    }
    return this;
  }

  close() { this.sqlite.close(); }
}

class Prepared {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Prepared(this.db, this.sql, values.map(value => value === undefined ? null : value)); }

  execute(mode = 'all', options) {
    const started = performance.now();
    const before = this.db.sqlite.prepare('SELECT total_changes() AS n').get().n;
    const statement = this.db.sqlite.prepare(this.sql);
    let results;
    if (mode === 'raw') {
      statement.setReturnArrays(true);
      results = statement.all(...this.values);
      if (options?.columnNames) results.unshift(statement.columns().map(column => column.name));
    } else if (mode === 'run') {
      statement.run(...this.values);
      results = [];
    } else {
      results = statement.all(...this.values).map(row => ({ ...row }));
    }
    const changes = this.db.sqlite.prepare('SELECT total_changes() AS n').get().n - before;
    const lastRowId = this.db.sqlite.prepare('SELECT last_insert_rowid() AS id').get().id;
    return {
      results,
      success: true,
      meta: { changed_db: changes > 0, changes, duration: performance.now() - started, last_row_id: Number(lastRowId), rows_read: results.length, rows_written: changes, size_after: 0 },
    };
  }

  async all() { return this.execute(); }
  async run() { return this.execute('run'); }
  async first(column) {
    const row = this.execute().results[0];
    return row ? column ? row[column] ?? null : row : null;
  }
  async raw(options) { return this.execute('raw', options).results; }
}

export function createD1(filename) { return new SQLiteD1(filename).migrate(); }
