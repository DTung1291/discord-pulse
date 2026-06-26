require("dotenv").config();

const path = require("path");
const express = require("express");
const { initDatabase } = require("../db/schema");
const { createQueries } = require("../db/queries");

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function startDashboard(options = {}) {
  const app = express();

  const port = toInt(options.port || process.env.DASHBOARD_PORT, 3000);
  const db = options.db || initDatabase(process.env.DB_PATH);
  const queries = options.queries || createQueries(db);

  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/api/summary", (req, res) => {
    const days = toInt(req.query.days, 7);
    res.json(queries.getSummary(days));
  });

  app.get("/api/message-volume", (req, res) => {
    const days = toInt(req.query.days, 30);
    res.json(queries.getMessageVolume(days));
  });

  app.get("/api/heatmap", (req, res) => {
    const days = toInt(req.query.days, 30);
    res.json(queries.getHourlyHeatmap(days));
  });

  app.get("/api/channel-rankings", (req, res) => {
    const days = toInt(req.query.days, 7);
    const limit = toInt(req.query.limit, 10);
    res.json(queries.getChannelRankings(days, limit));
  });

  app.get("/api/member-growth", (req, res) => {
    const days = toInt(req.query.days, 30);
    res.json(queries.getMemberGrowth(days));
  });

  app.get("/api/active-users", (req, res) => {
    const days = toInt(req.query.days, 7);
    const limit = toInt(req.query.limit, 10);
    res.json(queries.getActiveUsers(days, limit));
  });

  app.get("/api/ghost-members", (req, res) => {
    const days = toInt(req.query.days, 30);
    const limit = toInt(req.query.limit, 10);
    res.json(queries.getGhostMembers(days, limit));
  });

  app.get("/api/invite-leaderboard", (req, res) => {
    const limit = toInt(req.query.limit, 10);
    res.json(queries.getInviteSnapshotLeaderboard(limit));
  });

  app.get("/api/ambassador-performance", (req, res) => {
    const days = toInt(req.query.days, 7);
    const limit = toInt(req.query.limit, 20);
    res.json(queries.getAmbassadorPerformance(days, limit));
  });

  app.get("/api/ambassador-invites", (_req, res) => {
    res.json(queries.listAmbassadorInvites());
  });

  app.get("/api/ambassador-invitees", (req, res) => {
    const ambassadorId = (req.query.ambassadorId || "").toString().trim();
    if (!ambassadorId) {
      res.status(400).json({ error: "ambassadorId is required" });
      return;
    }

    const days = toInt(req.query.days, 30);
    const limit = toInt(req.query.limit, 20);
    res.json(queries.getAmbassadorInvitees(ambassadorId, days, limit));
  });

  app.get("/api/ambassador-posts", (req, res) => {
    const channelId =
      (req.query.channelId || process.env.AMBASSADOR_POST_CHANNEL_ID || "1518242290982719698")
        .toString()
        .trim();

    if (!channelId) {
      res.status(400).json({ error: "channelId is required" });
      return;
    }

    const days = toInt(req.query.days, 30);
    const ambassadorLimit = toInt(req.query.ambassadorLimit, 20);
    const postsPerAmbassador = toInt(req.query.postsPerAmbassador, 5);
    res.json(queries.getAmbassadorPostsByChannel(channelId, days, ambassadorLimit, postsPerAmbassador));
  });

  app.listen(port, () => {
    console.log(`Dashboard running on http://localhost:${port}`);
  });

  return { app, queries, db };
}

if (require.main === module) {
  startDashboard();
}

module.exports = {
  startDashboard,
};
