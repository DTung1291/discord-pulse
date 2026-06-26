const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function initDatabase(dbPath) {
  const resolvedPath = path.resolve(dbPath || "./data/discord-pulse.db");
  const dir = path.dirname(resolvedPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      joined_at TEXT,
      left_at TEXT,
      inviter_id TEXT
    );

    CREATE TABLE IF NOT EXISTS join_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      inviter_id TEXT,
      joined_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leave_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      left_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invite_snapshots (
      code TEXT PRIMARY KEY,
      inviter_id TEXT,
      uses INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ambassador_invites (
      code TEXT PRIMARY KEY,
      ambassador_id TEXT NOT NULL,
      ambassador_name TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_message_events_created_at ON message_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_message_events_channel_id ON message_events(channel_id);
    CREATE INDEX IF NOT EXISTS idx_join_events_joined_at ON join_events(joined_at);
    CREATE INDEX IF NOT EXISTS idx_leave_events_left_at ON leave_events(left_at);
    CREATE INDEX IF NOT EXISTS idx_ambassador_invites_ambassador_id ON ambassador_invites(ambassador_id);
    CREATE INDEX IF NOT EXISTS idx_ambassador_invites_active ON ambassador_invites(active);
  `);

  return db;
}

module.exports = {
  initDatabase,
};
