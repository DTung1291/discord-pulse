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
      inviter_id TEXT,
      is_bot INTEGER NOT NULL DEFAULT 0
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

    CREATE TABLE IF NOT EXISTS channels (
      channel_id TEXT PRIMARY KEY,
      channel_name TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS ambassador_posts (
      message_id TEXT PRIMARY KEY,
      ambassador_id TEXT NOT NULL,
      ambassador_name TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      content TEXT NOT NULL,
      posted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invite_tracker_sync (
      ambassador_id TEXT PRIMARY KEY,
      current_count INTEGER NOT NULL DEFAULT 0,
      regular_count INTEGER NOT NULL DEFAULT 0,
      left_count INTEGER NOT NULL DEFAULT 0,
      fake_count INTEGER NOT NULL DEFAULT 0,
      bonus_count INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT NOT NULL,
      source_text TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_message_events_created_at ON message_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_message_events_channel_id ON message_events(channel_id);
    CREATE INDEX IF NOT EXISTS idx_channels_name ON channels(channel_name);
    CREATE INDEX IF NOT EXISTS idx_join_events_joined_at ON join_events(joined_at);
    CREATE INDEX IF NOT EXISTS idx_leave_events_left_at ON leave_events(left_at);
    CREATE INDEX IF NOT EXISTS idx_ambassador_invites_ambassador_id ON ambassador_invites(ambassador_id);
    CREATE INDEX IF NOT EXISTS idx_ambassador_invites_active ON ambassador_invites(active);
    CREATE INDEX IF NOT EXISTS idx_ambassador_posts_channel_posted_at ON ambassador_posts(channel_id, posted_at);
    CREATE INDEX IF NOT EXISTS idx_ambassador_posts_ambassador_id ON ambassador_posts(ambassador_id);
    CREATE INDEX IF NOT EXISTS idx_invite_tracker_sync_synced_at ON invite_tracker_sync(synced_at);
  `);

  const memberColumns = db.prepare("PRAGMA table_info(members)").all();
  const hasIsBotColumn = memberColumns.some((col) => col.name === "is_bot");
  if (!hasIsBotColumn) {
    db.exec("ALTER TABLE members ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;");
  }

  return db;
}

module.exports = {
  initDatabase,
};
