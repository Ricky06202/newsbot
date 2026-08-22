import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";

const DB_PATH = process.env.NEWSBOT_DB || `${process.env.HOME}/.local/share/newsbot/news.db`;

mkdirSync(dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL");

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,          -- hash único de url+tipo
    type TEXT NOT NULL,           -- 'news' | 'cve'
    title TEXT NOT NULL,
    url TEXT,
    summary TEXT,
    image TEXT,
    author TEXT,
    source TEXT,
    severity TEXT,
    published INTEGER,
    fetched_at INTEGER NOT NULL
  );
`);

// Migración: agregar columnas nuevas si faltan
try { sqlite.exec("ALTER TABLE items ADD COLUMN image TEXT"); } catch {}
try { sqlite.exec("ALTER TABLE items ADD COLUMN author TEXT"); } catch {}

export { sqlite, DB_PATH };
