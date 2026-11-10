import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { seedIfEmpty } from "../seed";
import { ADDED_RENTAL_COLUMNS, SCHEMA_SQL } from "./schema";

/**
 * Where the database and uploaded photos live. HANDBACK_DATA_DIR overrides the
 * default ./data (for example a writable temp dir on a host with no disk).
 */
export const DATA_DIR = process.env.HANDBACK_DATA_DIR?.trim()
  ? path.resolve(process.env.HANDBACK_DATA_DIR.trim())
  : path.join(process.cwd(), "data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

// One shared connection, kept on globalThis so Next dev hot reload reuses it.
const g = globalThis as unknown as { __handbackDb?: DatabaseSync };

/** Shared connection. Creates the data dir, schema and sample rentals on first use. */
export function getDb(): DatabaseSync {
  if (!g.__handbackDb) {
    const file = process.env.HANDBACK_DB_PATH ?? path.join(DATA_DIR, "handback.db");
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    mkdirSync(UPLOADS_DIR, { recursive: true });
    const db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    db.exec(SCHEMA_SQL);
    const have = new Set(db.prepare("PRAGMA table_info(rentals)").all().map((c) => String(c.name)));
    for (const col of ADDED_RENTAL_COLUMNS) {
      if (!have.has(col)) db.exec(`ALTER TABLE rentals ADD COLUMN ${col} TEXT`);
    }
    seedIfEmpty(db);
    g.__handbackDb = db;
  }
  return g.__handbackDb;
}
