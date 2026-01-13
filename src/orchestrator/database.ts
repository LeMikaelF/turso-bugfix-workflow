// Turso database client wrapper

import { connect, type Database } from "@tursodatabase/database";
import type { Config } from "./config.js";

export type PanicStatus =
  | "pending"
  | "repo_setup"
  | "reproducing"
  | "fixing"
  | "shipping"
  | "pr_open"
  | "needs_human_review";

export interface PanicFix {
  panic_location: string; // Primary key, e.g., "src/vdbe.c:1234"
  status: PanicStatus;
  panic_message: string;
  sql_statements: string; // One SQL statement per line
  branch_name: string | null;
  pr_url: string | null;
  retry_count: number;
  workflow_error: string | null; // JSON error info
  created_at: string;
  updated_at: string;
}

export interface WorkflowError {
  phase: string;
  error: string;
  timestamp: string;
}

export class DatabaseClient {
  private db: Database | null = null;
  private readonly dbPath: string;

  constructor(config: Pick<Config, "tursoUrl">) {
    this.dbPath = config.tursoUrl;
  }

  async connect(): Promise<void> {
    this.db = await connect(this.dbPath);
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  private getDb(): Database {
    if (!this.db) {
      throw new Error("Database not connected. Call connect() first.");
    }
    return this.db;
  }

  // Initialize database schema
  async initSchema(): Promise<void> {
    const db = this.getDb();
    await db.exec(`
      CREATE TABLE IF NOT EXISTS panic_fixes (
        panic_location TEXT PRIMARY KEY,
        status TEXT DEFAULT 'pending',
        panic_message TEXT NOT NULL,
        sql_statements TEXT NOT NULL,
        branch_name TEXT,
        pr_url TEXT,
        retry_count INTEGER DEFAULT 0,
        workflow_error TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  // Panic Fixes CRUD operations

  async createPanicFix(
    panicLocation: string,
    panicMessage: string,
    sqlStatements: string[]
  ): Promise<void> {
    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT INTO panic_fixes (panic_location, panic_message, sql_statements)
      VALUES (?, ?, ?)
    `);
    await stmt.run(panicLocation, panicMessage, sqlStatements.join("\n"));
  }

  async getPanicFix(panicLocation: string): Promise<PanicFix | undefined> {
    const db = this.getDb();
    const stmt = db.prepare(`SELECT * FROM panic_fixes WHERE panic_location = ?`);
    const row = await stmt.get(panicLocation);
    return row as PanicFix | undefined;
  }

  async getPendingPanics(limit: number = 10): Promise<PanicFix[]> {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT * FROM panic_fixes
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `);
    const rows = await stmt.all(limit);
    return rows as PanicFix[];
  }

  async updatePanicStatus(
    panicLocation: string,
    status: PanicStatus,
    additionalFields?: {
      branch_name?: string;
      pr_url?: string;
      workflow_error?: WorkflowError;
    }
  ): Promise<void> {
    const db = this.getDb();

    let sql = `UPDATE panic_fixes SET status = ?, updated_at = CURRENT_TIMESTAMP`;
    const params: (string | null)[] = [status];

    if (additionalFields?.branch_name !== undefined) {
      sql += `, branch_name = ?`;
      params.push(additionalFields.branch_name);
    }

    if (additionalFields?.pr_url !== undefined) {
      sql += `, pr_url = ?`;
      params.push(additionalFields.pr_url);
    }

    if (additionalFields?.workflow_error !== undefined) {
      sql += `, workflow_error = ?`;
      params.push(JSON.stringify(additionalFields.workflow_error));
    }

    sql += ` WHERE panic_location = ?`;
    params.push(panicLocation);

    const stmt = db.prepare(sql);
    await stmt.run(...params);
  }

  async incrementRetryCount(panicLocation: string): Promise<void> {
    const db = this.getDb();
    const stmt = db.prepare(`
      UPDATE panic_fixes
      SET retry_count = retry_count + 1, updated_at = CURRENT_TIMESTAMP
      WHERE panic_location = ?
    `);
    await stmt.run(panicLocation);
  }

  async resetRetryCount(panicLocation: string): Promise<void> {
    const db = this.getDb();
    const stmt = db.prepare(`
      UPDATE panic_fixes
      SET retry_count = 0, updated_at = CURRENT_TIMESTAMP
      WHERE panic_location = ?
    `);
    await stmt.run(panicLocation);
  }

  async markNeedsHumanReview(panicLocation: string, error: WorkflowError): Promise<void> {
    await this.updatePanicStatus(panicLocation, "needs_human_review", {
      workflow_error: error,
    });
  }

  // Logs operations

  async insertLog(payload: object): Promise<void> {
    const db = this.getDb();
    const stmt = db.prepare(`INSERT INTO logs (payload) VALUES (?)`);
    await stmt.run(JSON.stringify(payload));
  }

  async getLogs(limit: number = 100): Promise<object[]> {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT payload FROM logs
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = await stmt.all(limit);
    return (rows as { payload: string }[]).map((row) => JSON.parse(row.payload) as object);
  }

  async getLogsByPanicLocation(panicLocation: string, limit: number = 100): Promise<object[]> {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT payload FROM logs
      WHERE json_extract(payload, '$.panic_location') = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = await stmt.all(panicLocation, limit);
    return (rows as { payload: string }[]).map((row) => JSON.parse(row.payload) as object);
  }
}

// Factory function for creating a connected database client
export async function createDatabaseClient(
  config: Pick<Config, "tursoUrl">
): Promise<DatabaseClient> {
  const client = new DatabaseClient(config);
  await client.connect();
  return client;
}
