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

async function postDailyReport({ client, queries, reportChannelId }) {
  if (!reportChannelId) {
    return;
  }

  const channel = await client.channels.fetch(reportChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  const summary = queries.getSummary(1);
  const content = [
    "**Daily Discord Pulse Report**",
    `Messages: ${summary.messages}`,
    `New members: ${summary.joins}`,
    `Leaves: ${summary.leaves}`,
    `Active members: ${summary.active_members}`,
  ].join("\n");

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

  const inviteBoard = queries.getInviteLeaderboard(7, 10);
  const channelBoard = queries.getChannelRankings(7, 10);
  const ghosts = queries.getGhostMembers(30, 10);

  const content = [
    "**Weekly Discord Pulse Report**",
    "",
    "Invite Leaderboard:",
    formatLeaderboard(inviteBoard),
    "",
    "Channel Rankings:",
    formatChannelRanking(channelBoard),
    "",
    "Ghost Members (no messages in last 30 days):",
    ghosts.length
      ? ghosts.map((u) => `- ${u.username} (${u.user_id})`).join("\n")
      : "None",
  ].join("\n");

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
};
