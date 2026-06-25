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
