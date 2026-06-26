const cron = require("node-cron");

function formatLeaderboard(rows) {
  if (!rows.length) {
    return "No invite data in this period.";
  }

  return rows
    .map((row, idx) => `${idx + 1}. <@${row.inviter_id}> - ${row.invited_count} invites`)
    .join("\n");
}

function formatChannelRanking(rows) {
  if (!rows.length) {
    return "No channel activity in this period.";
  }

  return rows
    .map((row, idx) => `${idx + 1}. <#${row.channel_id}> - ${row.count} messages`)
    .join("\n");
}

function formatAmbassadorPerformance(rows) {
  if (!rows.length) {
    return "No ambassador invite data in this period.";
  }

  return rows
    .map((row, idx) => {
      const name = row.ambassador_name || row.ambassador_id;
      return `${idx + 1}. ${name} (<@${row.ambassador_id}>) - ${row.invited_count} joins`;
    })
    .join("\n");
}

function buildDailyReportContent(queries, days = 1) {
  const summary = queries.getSummary(days);
  return [
    `**Daily Discord Pulse Report (${days}d)**`,
    `Messages: ${summary.messages}`,
    `New members: ${summary.joins}`,
    `Leaves: ${summary.leaves}`,
    `Active members: ${summary.active_members}`,
  ].join("\n");
}

function buildWeeklyReportContent(queries) {
  const inviteBoard = queries.getInviteLeaderboard(7, 10);
  const channelBoard = queries.getChannelRankings(7, 10);
  const ghosts = queries.getGhostMembers(30, 10);
  const ambassadorBoard = queries.getAmbassadorPerformance(7, 15);

  return [
    "**Weekly Discord Pulse Report**",
    "",
    "Invite Leaderboard:",
    formatLeaderboard(inviteBoard),
    "",
    "Channel Rankings:",
    formatChannelRanking(channelBoard),
    "",
    "Ambassador Performance (7d):",
    formatAmbassadorPerformance(ambassadorBoard),
    "",
    "Ghost Members (no messages in last 30 days):",
    ghosts.length
      ? ghosts.map((u) => `- ${u.username} (${u.user_id})`).join("\n")
      : "None",
  ].join("\n");
}

function buildGhostMembersContent(queries, days = 30, limit = 20) {
  const ghosts = queries.getGhostMembers(days, limit);
  if (!ghosts.length) {
    return `**Ghost Members (${days}d)**\nNone`;
  }

  return [
    `**Ghost Members (${days}d)**`,
    ghosts.map((u) => `- ${u.username} (${u.user_id})`).join("\n"),
  ].join("\n");
}

function buildAmbassadorPerformanceContent(queries, days = 7, limit = 20) {
  const rows = queries.getAmbassadorPerformance(days, limit);
  return [
    `**Ambassador Performance (${days}d)**`,
    formatAmbassadorPerformance(rows),
  ].join("\n");
}

function buildAmbassadorInviteesContent(queries, ambassadorId, days = 30, limit = 20) {
  const rows = queries.getAmbassadorInvitees(ambassadorId, days, limit);
  const title = `**Ambassador Invitees (${days}d) - <@${ambassadorId}>**`;

  if (!rows.length) {
    return [title, "No attributed joined users in this period."].join("\n");
  }

  return [
    title,
    rows
      .map((row, idx) => {
        const isGhost = Number(row.total_messages || 0) === 0;
        const status = isGhost ? "GHOST" : "ACTIVE";
        const membership = row.still_in_server ? "in-server" : "left";
        return `${idx + 1}. <@${row.user_id}> (${membership}) - ${status} - total messages: ${row.total_messages} - joined: ${row.joined_at}`;
      })
      .join("\n"),
  ].join("\n");
}

async function postDailyReport({ client, queries, reportChannelId }) {
  if (!reportChannelId) {
    return;
  }

  const channel = await client.channels.fetch(reportChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  const content = buildDailyReportContent(queries, 1);

  await channel.send({ content });
}

async function postWeeklyReport({ client, queries, reportChannelId }) {
  if (!reportChannelId) {
    return;
  }

  const channel = await client.channels.fetch(reportChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  const content = buildWeeklyReportContent(queries);

  await channel.send({ content });
}

function startReportScheduler({ client, queries, reportChannelId, timezone = "UTC" }) {
  cron.schedule(
    "0 8 * * *",
    async () => {
      await postDailyReport({ client, queries, reportChannelId });
    },
    { timezone }
  );

  cron.schedule(
    "0 9 * * 1",
    async () => {
      await postWeeklyReport({ client, queries, reportChannelId });
    },
    { timezone }
  );

  console.log(`Report scheduler running in timezone: ${timezone}`);
}

module.exports = {
  startReportScheduler,
  postDailyReport,
  postWeeklyReport,
  buildDailyReportContent,
  buildWeeklyReportContent,
  buildGhostMembersContent,
  buildAmbassadorPerformanceContent,
  buildAmbassadorInviteesContent,
};
