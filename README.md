# discord-pulse 📊

A self-hosted Discord server analytics bot with a real-time dashboard and scheduled reports.

## Features

- **Member Growth & Invite Tracking** — track who invited whom, join/leave events, retention rate
- **Message Activity** — heatmap by hour/day, message volume over time
- **Channel Popularity** — rank channels by activity, voice channel time tracking
- **User Engagement** — identify active members vs ghosts, per-user stats over 7/30 days
- **Leave Intelligence** — list recent leavers with trust signals (avatar, username pattern, username-change count, inviter, activity)
- **Discord Reports** — automated embed reports posted to a designated channel via cron
- **Ambassador Invite Tracking** — auto-provision unique ambassador invites and track weekly ambassador performance
- **Ambassador Invite History (Daily Snapshots)** — persist per-day invite uses for each ambassador code and compute daily deltas
- **Ambassador Post Tracking** — capture ambassador posts in a dedicated channel and show per-ambassador post history on dashboard
- **Slash Commands** — on-demand reports via `/pulse-summary`, `/pulse-daily`, `/pulse-weekly`, `/pulse-ghosts`, `/pulse-ambassadors`
- **Web Dashboard** — realtime charts and filters via a local web UI

## Tech Stack

| Layer | Technology |
|---|---|
| Bot | Node.js, discord.js v14 |
| Database | SQLite (via better-sqlite3) |
| Dashboard | Express + Chart.js |
| Scheduler | node-cron |

## Project Structure

```
discord-pulse/
├── src/
│   ├── bot/
│   │   ├── index.js          # Bot entry point
│   │   └── events/
│   │       ├── guildMemberAdd.js
│   │       ├── guildMemberRemove.js
│   │       ├── messageCreate.js
│   │       └── interactionCreate.js
│   ├── db/
│   │   ├── schema.js         # DB init & migrations
│   │   └── queries.js        # Reusable query helpers
│   ├── dashboard/
│   │   ├── server.js         # Express app
│   │   └── public/           # Frontend assets
│   └── scheduler/
│       └── reports.js        # Cron jobs for Discord reports
├── .env.example
├── package.json
└── README.md
```

## Getting Started

### Prerequisites

- Node.js >= 18
- A Discord bot token with the following intents enabled:
  - `GUILDS`
  - `GUILD_MEMBERS`
  - `GUILD_MESSAGES`
  - `MESSAGE_CONTENT`
  - `GUILD_INVITES`

### Installation

```bash
git clone https://github.com/yourname/discord-pulse.git
cd discord-pulse
npm install
cp .env.example .env
```

### Configuration

Edit `.env`:

```env
DISCORD_TOKEN=your_bot_token_here
GUILD_ID=your_server_id_here
REPORT_CHANNEL_ID=channel_id_for_scheduled_reports
DASHBOARD_PORT=3000
DB_PATH=./data/discord-pulse.db
TIMEZONE=UTC
ADMIN_ROLE_IDS=comma_separated_role_ids_for_weekly_command
AMBASSADOR_ROLE_IDS=comma_separated_role_ids_for_ambassador_group
AMBASSADOR_INVITE_CHANNEL_ID=channel_id_to_create_ambassador_invites
AMBASSADOR_POST_CHANNEL_ID=1518242290982719698
AMBASSADOR_POST_BACKFILL_LIMIT=2000
```

Notes:
- `ADMIN_ROLE_IDS` is optional. If set, only members with one of these role IDs can run `/pulse-weekly`.
- Leave `ADMIN_ROLE_IDS` empty to allow all members to run slash reports.
- `AMBASSADOR_ROLE_IDS` is optional. If empty, roles containing `ambassador` in name are auto-detected.
- `AMBASSADOR_INVITE_CHANNEL_ID` should be a text channel where the bot can create invites.
- `AMBASSADOR_POST_CHANNEL_ID` is the channel to track ambassador post content. Defaults to `1518242290982719698`.
- `AMBASSADOR_POST_BACKFILL_LIMIT` controls how many old messages are scanned on startup to backfill ambassador posts.

### Important: Railway / Render Auto-Deploy + SQLite

If your app auto-deploys on each git push, **do not keep SQLite at a relative path** like `./data/discord-pulse.db` unless that folder is on a persistent volume.

- Railway: attach a Volume, mount it (for example `/data`), then set:

```env
DB_PATH=/data/discord-pulse.db
```

- Render: create a Disk, mount it (for example `/var/data`), then set:

```env
DB_PATH=/var/data/discord-pulse.db
```

Without a persistent mount, each redeploy can reset/overwrite SQLite data.

Safety controls:
- On Railway/Render, app now refuses to start if `DB_PATH` looks ephemeral (relative path or app root path).
- Override only for testing: `ALLOW_EPHEMERAL_DB=1`
- Force strict mode on any platform: `STRICT_PERSISTENT_DB_PATH=1`
- Health check: `GET /api/health/db-storage`

### Run

```bash
# Start bot + dashboard together
npm start

# Or separately
npm run bot
npm run dashboard
```

`npm start` now auto-cleans port `3000` before boot, so you do not need to manually kill previous dashboard processes.

## Deploy-Safe Backup/Restore

Use the built-in deploy-safe script to back up SQLite before deploy, then auto-restore DB if deploy fails.

```bash
# default: backup DB, then run "git pull --ff-only && npm ci"
npm run deploy:safe

# custom deploy command
DEPLOY_CMD="git pull --ff-only && npm ci && npm start" npm run deploy:safe

# restore latest DB backup manually
bash scripts/deploy-safe.sh --restore latest
```

Optional environment variables:
- `DB_PATH` (or `DB_PATH` in `.env`) — source DB location
- `BACKUP_BASE_DIR` — where backups are stored (default `./backups/db`)
- `KEEP_BACKUPS` — number of backup folders retained (default `20`)
- `MESSAGE_BACKFILL_ON_STARTUP`, `MESSAGE_BACKFILL_CHANNEL_IDS`, `MESSAGE_BACKFILL_MAX_CHANNELS`, `MESSAGE_BACKFILL_LIMIT_PER_CHANNEL` — startup message backfill tuning

## Dashboard

Open `http://localhost:3000` in your browser after starting the app.

Dashboard includes:

- Summary cards (messages, joins, leaves, active members)
- Message volume and member growth charts
- Channel rankings
- Invite leaderboard (current snapshot)
- Leave Explorer (grouped by day, click each day to expand leaver details with trust signals)
- Ambassador performance (7-day leaderboard)
- Ambassador performance + recent ambassador posts in channel `1518242290982719698` (integrated in one section)
- Ambassador invite trend chart with filters (ambassador + day window)

## API Endpoints (Dashboard)

Common endpoints used by the web dashboard:

- `GET /api/summary?days=7`
- `GET /api/message-volume?days=30`
- `GET /api/member-growth?days=30`
- `GET /api/channel-rankings?days=7&limit=10`
- `GET /api/invite-leaderboard?limit=10`
- `GET /api/ambassador-performance?days=7&limit=20`
- `GET /api/ambassador-invite-history?days=30`
- `GET /api/ambassador-invite-history?ambassadorId=<id>&days=30`

Notes:
- `ambassador-invite-history` is backed by daily snapshots stored in `invite_snapshot_daily`.
- Historical rows are available from the date this feature was deployed onward.

## Scheduled Reports

Reports are posted automatically to `REPORT_CHANNEL_ID`:

- **Daily** — message activity summary, new members
- **Weekly** — invite leaderboard, channel rankings, ambassador performance, ghost member list

## Slash Commands

The bot registers guild slash commands automatically on startup:

- `/pulse-summary [days]` — activity summary for 1-30 days
- `/pulse-daily` — quick daily summary
- `/pulse-weekly` — weekly report with invite/channel/ghost stats
- `/pulse-ghosts [days]` — inactive members list
- `/pulse-ambassadors [days]` — ambassador invite performance leaderboard
- `/pulse-ambassador-users [member] [days] [limit]` — list users invited by an ambassador with ghost/active status
- `/pulse-leavers [days] [limit]` — list members who left recently with trust signals (risk score, avatar, name/id match, username-change count, inviter)
- `/pulse-leaves-daily [days]` — show leave counts grouped by day

## Security Note

- Exported CSV files under `exports/` are ignored by git (sensitive operational data should not be committed).

## License

MIT
