require("dotenv").config();

const { initDatabase } = require("./db/schema");
const { createQueries } = require("./db/queries");
const { startBot } = require("./bot/index");
const { startDashboard } = require("./dashboard/server");
const { startReportScheduler } = require("./scheduler/reports");

function resolveDashboardPort() {
  const candidates = [process.env.PORT, process.env.DASHBOARD_PORT, "3000"];

  for (const raw of candidates) {
    const port = Number(raw);
    if (Number.isFinite(port) && port > 0) {
      return Math.floor(port);
    }
  }

  return 3000;
}

async function main() {
  const db = initDatabase(process.env.DB_PATH);
  const queries = createQueries(db);

  startDashboard({
    port: resolveDashboardPort(),
    queries,
  });

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.warn("DISCORD_TOKEN is not set. Dashboard is running without bot ingestion.");
    return;
  }

  const { client } = await startBot({
    token,
    guildId: process.env.GUILD_ID,
    db,
    queries,
  });

  startReportScheduler({
    client,
    queries,
    reportChannelId: process.env.REPORT_CHANNEL_ID,
    timezone: process.env.TIMEZONE || "UTC",
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
