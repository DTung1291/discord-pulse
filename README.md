# discord-pulse 📊

A self-hosted Discord server analytics bot with a realtime dashboard and scheduled reports.

## Features

- **Member Growth & Invite Tracking** — track who invited whom, join/leave events, retention rate
- **Message Activity** — heatmap by hour/day, message volume over time
- **Channel Popularity** — rank channels by activity, voice channel time tracking
- **User Engagement** — identify active members vs ghosts, per-user stats over 7/30 days
- **Discord Reports** — automated embed reports posted to a designated channel via cron
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
│   │       └── messageCreate.js
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
```

### Run

```bash
# Start bot + dashboard together
npm start

# Or separately
npm run bot
npm run dashboard
```

## Dashboard

Open `http://localhost:3000` in your browser after starting the app.

## Scheduled Reports

Reports are posted automatically to `REPORT_CHANNEL_ID`:

- **Daily** — message activity summary, new members
- **Weekly** — invite leaderboard, channel rankings, ghost member list

## License

MIT
