import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from 'node:sqlite';

class TestPreparedStatement {
  readonly database: TestD1Database;
  readonly query: string;
  readonly values: SQLInputValue[];

  constructor(
    database: TestD1Database,
    query: string,
    values: SQLInputValue[] = [],
  ) {
    this.database = database;
    this.query = query;
    this.values = values;
  }

  bind(...values: unknown[]) {
    const normalized = values.map((value): SQLInputValue => {
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (value === undefined) return null;
      return value as SQLInputValue;
    });
    return new TestPreparedStatement(this.database, this.query, normalized);
  }

  private statement(): StatementSync {
    return this.database.sqlite.prepare(this.query);
  }

  async run() {
    this.database.queries.push(this.query);
    const result = this.statement().run(...this.values);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  async first<T>(columnName?: string): Promise<T | null> {
    this.database.queries.push(this.query);
    const row = this.statement().get(...this.values) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return (columnName ? row[columnName] : row) as T;
  }

  async all<T>() {
    this.database.queries.push(this.query);
    return {
      success: true,
      results: this.statement().all(...this.values) as T[],
      meta: {},
    };
  }
}

export class TestD1Database {
  readonly sqlite = new DatabaseSync(':memory:');
  readonly queries: string[] = [];

  prepare(query: string) {
    return new TestPreparedStatement(this, query);
  }

  async batch(statements: TestPreparedStatement[]) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  exec(sql: string) {
    this.sqlite.exec(sql);
  }

  close() {
    this.sqlite.close();
  }
}

export function applyMigrations(database: TestD1Database) {
  const files = readdirSync(join(process.cwd(), 'drizzle'))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
  for (const [index, file] of files.entries()) {
    const prefix = String(index).padStart(4, '0');
    if (!file.startsWith(prefix))
      throw new Error(`Migration order mismatch: ${file}`);
    const sql = readFileSync(join(process.cwd(), 'drizzle', file), 'utf8');
    for (const statement of sql
      .split('--> statement-breakpoint')
      .map((value) => value.trim())
      .filter(Boolean)) {
      database.exec(statement);
    }
  }
}

export function createMigratedDatabase() {
  const database = new TestD1Database();
  applyMigrations(database);
  return database;
}
