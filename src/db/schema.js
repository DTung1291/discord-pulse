const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function isTruthyEnv(value) {
  if (!value) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function getDbRuntimeInfo(rawDbPath) {
  const runningOnRender = Boolean(process.env.RENDER);
  const runningOnRailway = Boolean(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_ID);
  const platform = runningOnRender ? "render" : runningOnRailway ? "railway" : "other";
  const configuredPath = rawDbPath || "./data/discord-pulse.db";
  const resolvedPath = path.resolve(configuredPath);
  const isAbsoluteConfiguredPath = Boolean(rawDbPath && path.isAbsolute(rawDbPath));
  const looksLikeEphemeralAbsolutePath = runningOnRender
    ? resolvedPath.startsWith("/opt/render/project")
    : runningOnRailway
      ? resolvedPath.startsWith("/app/") || resolvedPath === "/app"
      : false;
  const recommendedPath = runningOnRender ? "/var/data/discord-pulse.db" : "/data/discord-pulse.db";

  return {
    platform,
    runningOnRender,
    runningOnRailway,
    configuredPath,
    resolvedPath,
    isAbsoluteConfiguredPath,
    looksLikeEphemeralAbsolutePath,
    recommendedPath,
    potentiallyEphemeral: !isAbsoluteConfiguredPath || looksLikeEphemeralAbsolutePath,
  };
}

function warnIfPotentiallyEphemeralDbPath(info) {
  const runningOnRender = Boolean(process.env.RENDER);
  const runningOnRailway = Boolean(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_ID);
  const disableWarning = isTruthyEnv(process.env.DISABLE_EPHEMERAL_DB_WARNING);

  if (disableWarning || (!runningOnRender && !runningOnRailway)) {
    return;
  }

  if (!info.potentiallyEphemeral) {
    return;
  }

  const platformName = runningOnRender ? "Render" : "Railway";
  console.warn(
    [
      `[db] Warning: DB_PATH may be on ephemeral storage (${info.resolvedPath}).`,
      `[db] On ${platformName}, set DB_PATH to a persistent disk path, for example: ${info.recommendedPath}`,
      "[db] Otherwise each auto-deploy can reset or overwrite SQLite data.",
    ].join(" ")
  );
}

function enforcePersistentDbPathIfNeeded(info) {
  const strictMode = isTruthyEnv(process.env.STRICT_PERSISTENT_DB_PATH);
  const allowEphemeralDb = isTruthyEnv(process.env.ALLOW_EPHEMERAL_DB);
  const onManagedPlatform = info.runningOnRender || info.runningOnRailway;
  const mustEnforce = strictMode || (onManagedPlatform && !allowEphemeralDb);

  if (!mustEnforce || !info.potentiallyEphemeral) {
    return;
  }

  const platformName = info.runningOnRender ? "Render" : "Railway";
  throw new Error(
    [
      `[db] Refusing to start with potentially ephemeral DB_PATH on ${platformName}: ${info.resolvedPath}`,
      `[db] Set DB_PATH to a persistent disk path (example: ${info.recommendedPath}).`,
      "[db] If you really want this for non-production/testing, set ALLOW_EPHEMERAL_DB=1.",
    ].join(" ")
  );
}

function initDatabase(dbPath) {
  const info = getDbRuntimeInfo(dbPath);
  warnIfPotentiallyEphemeralDbPath(info);
  enforcePersistentDbPathIfNeeded(info);
  const resolvedPath = info.resolvedPath;
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
      avatar_url TEXT,
      joined_at TEXT,
      left_at TEXT,
      inviter_id TEXT,
      is_bot INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS member_profile_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar_url TEXT,
      captured_at TEXT NOT NULL,
      source TEXT
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

    CREATE TABLE IF NOT EXISTS invite_snapshot_daily (
      code TEXT NOT NULL,
      snapshot_day TEXT NOT NULL,
      inviter_id TEXT,
      uses INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (code, snapshot_day)
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
    CREATE INDEX IF NOT EXISTS idx_member_profile_history_user_time ON member_profile_history(user_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_invite_snapshot_daily_day ON invite_snapshot_daily(snapshot_day);
    CREATE INDEX IF NOT EXISTS idx_invite_snapshot_daily_inviter ON invite_snapshot_daily(inviter_id);
  `);

  const memberColumns = db.prepare("PRAGMA table_info(members)").all();
  const hasIsBotColumn = memberColumns.some((col) => col.name === "is_bot");
  if (!hasIsBotColumn) {
    db.exec("ALTER TABLE members ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;");
  }

  const hasAvatarUrlColumn = memberColumns.some((col) => col.name === "avatar_url");
  if (!hasAvatarUrlColumn) {
    db.exec("ALTER TABLE members ADD COLUMN avatar_url TEXT;");
  }

  return db;
}

module.exports = {
  initDatabase,
  getDbRuntimeInfo,
};
