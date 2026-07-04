require("dotenv").config();

const path = require("path");
const express = require("express");
const { initDatabase } = require("../db/schema");
const { createQueries } = require("../db/queries");

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function extractInt(text, pattern) {
  const m = text.match(pattern);
  if (!m) {
    return null;
  }

  const parsed = Number(m[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInviteTrackerText(rawText) {
  const text = String(rawText || "").replace(/\*\*/g, " ");

  const current = extractInt(text, /(?:have|has)\s+(\d+)\s+invites?\.?/i);
  const regular = extractInt(text, /(\d+)\s+regular/i);
  const left = extractInt(text, /(\d+)\s+left/i);
  const fake = extractInt(text, /(\d+)\s+fake/i);
  const bonus = extractInt(text, /(\d+)\s+bonus/i);

  if (
    current === null ||
    regular === null ||
    left === null ||
    fake === null ||
    bonus === null
  ) {
    return null;
  }

  return {
    current,
    regular,
    left,
    fake,
    bonus,
  };
}

function startDashboard(options = {}) {
  const app = express();

  const port = toInt(options.port || process.env.DASHBOARD_PORT, 3000);
  const db = options.db || initDatabase(process.env.DB_PATH);
  const queries = options.queries || createQueries(db);

  app.use(express.json());
  app.use((req, res, next) => {
    if (
      req.path === "/" ||
      req.path === "/index.html" ||
      req.path === "/app.js" ||
      req.path === "/style.css"
    ) {
      res.setHeader("Cache-Control", "no-store");
    }
    next();
  });
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

  app.get("/api/leavers", (req, res) => {
    const days = toInt(req.query.days, 7);
    const limit = toInt(req.query.limit, 20);
    res.json(queries.getRecentLeavers(days, limit));
  });

  app.get("/api/leavers-by-day", (req, res) => {
    const days = toInt(req.query.days, 30);
    const perDayLimit = toInt(req.query.perDayLimit, 30);
    const growth = queries.getMemberGrowth(days);
    const dayCounts = new Map((growth?.leaves || []).map((row) => [row.day, Number(row.count || 0)]));
    const detailRows = queries.getLeaversByDayDetails(days, perDayLimit);

    const detailMap = new Map();
    for (const row of detailRows) {
      const day = String(row.day || "");
      if (!detailMap.has(day)) {
        detailMap.set(day, []);
      }
      detailMap.get(day).push(row);
    }

    const rows = Array.from(dayCounts.entries())
      .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
      .map(([day, count]) => ({
        day,
        count,
        leavers: detailMap.get(day) || [],
      }));

    res.json({
      days,
      per_day_limit: perDayLimit,
      rows,
    });
  });

  app.get("/api/invites-by-day", (req, res) => {
    const days = toInt(req.query.days, 30);
    const perDayLimit = toInt(req.query.perDayLimit, 30);
    const dayCounts = new Map((queries.getInvitesByDay(days) || []).map((row) => [row.day, Number(row.count || 0)]));
    const detailRows = queries.getInvitesByDayDetails(days, perDayLimit);

    const detailMap = new Map();
    for (const row of detailRows) {
      const day = String(row.day || "");
      if (!detailMap.has(day)) {
        detailMap.set(day, []);
      }
      detailMap.get(day).push(row);
    }

    const rows = Array.from(dayCounts.entries())
      .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
      .map(([day, count]) => ({
        day,
        count,
        invites: detailMap.get(day) || [],
      }));

    res.json({
      days,
      per_day_limit: perDayLimit,
      rows,
    });
  });

  app.get("/api/invite-leaderboard", (req, res) => {
    const limit = toInt(req.query.limit, 10);
    res.json(queries.getInviteSnapshotLeaderboard(limit));
  });

  app.get("/api/ambassador-invite-history", (req, res) => {
    const days = toInt(req.query.days, 30);
    const ambassadorId = (req.query.ambassadorId || "").toString().trim();
    res.json(queries.getAmbassadorInviteDailyHistory(ambassadorId, days));
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

  app.get("/api/ambassador-invite-breakdown", (req, res) => {
    const ambassadorId = (req.query.ambassadorId || "").toString().trim();
    if (!ambassadorId) {
      res.status(400).json({ error: "ambassadorId is required" });
      return;
    }

    const days = toInt(req.query.days, 0);
    const breakdown = queries.getAmbassadorInviteBreakdown(ambassadorId, days) || {};

    const regular = Number(breakdown.regular_count || 0);
    const left = Number(breakdown.left_count || 0);
    const current = Number(breakdown.current_count || 0);
    const unattributed = Number(breakdown.unattributed_count || 0);

    res.json({
      ambassador_id: ambassadorId,
      days,
      current_invites: current,
      regular_count: regular,
      left_count: left,
      fake_count: Number(breakdown.fake_count || 0),
      bonus_count: Number(breakdown.bonus_count || 0),
      unattributed_count: unattributed,
    });
  });

  app.get("/api/invite-tracker-sync", (req, res) => {
    const ambassadorId = (req.query.ambassadorId || "").toString().trim();
    if (!ambassadorId) {
      res.status(400).json({ error: "ambassadorId is required" });
      return;
    }

    const row = queries.getInviteTrackerSync(ambassadorId);
    res.json(row || null);
  });

  app.post("/api/invite-tracker-sync", (req, res) => {
    const ambassadorId = (req.body?.ambassadorId || "").toString().trim();
    if (!ambassadorId) {
      res.status(400).json({ error: "ambassadorId is required" });
      return;
    }

    let payload = null;
    const text = (req.body?.text || "").toString().trim();

    if (text) {
      payload = parseInviteTrackerText(text);
      if (!payload) {
        res.status(400).json({
          error:
            "Unable to parse text. Expected format like: You currently have 15 invites. (18 regular, 3 left, 0 fake, 0 bonus)",
        });
        return;
      }
    } else {
      payload = {
        current: toInt(req.body?.current, 0),
        regular: toInt(req.body?.regular, 0),
        left: toInt(req.body?.left, 0),
        fake: toInt(req.body?.fake, 0),
        bonus: toInt(req.body?.bonus, 0),
      };
    }

    queries.upsertInviteTrackerSync({
      ambassadorId,
      currentCount: payload.current,
      regularCount: payload.regular,
      leftCount: payload.left,
      fakeCount: payload.fake,
      bonusCount: payload.bonus,
      sourceText: text || null,
      syncedAt: new Date().toISOString(),
    });

    res.json({
      ok: true,
      ambassador_id: ambassadorId,
      current_count: payload.current,
      regular_count: payload.regular,
      left_count: payload.left,
      fake_count: payload.fake,
      bonus_count: payload.bonus,
    });
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
