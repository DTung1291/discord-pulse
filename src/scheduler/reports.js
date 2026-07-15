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
      const regular = Number(row.regular_count || 0);
      const left = Number(row.left_count || 0);
      const current = Number(row.current_count || 0);
      const fake = Number(row.fake_count || 0);
      const bonus = Number(row.bonus_count || 0);
      return `${idx + 1}. ${name} (<@${row.ambassador_id}>) - ${row.invited_count} joins (current ${current} | regular ${regular} | left ${left} | fake ${fake} | bonus ${bonus})`;
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
  const breakdown = queries.getAmbassadorInviteBreakdown(ambassadorId, days) || {};
  const regular = Number(breakdown.regular_count || 0);
  const left = Number(breakdown.left_count || 0);
  const current = Number(breakdown.current_count || 0);
  const unattributed = Number(breakdown.unattributed_count || 0);
  const breakdownLine = `Breakdown (${days}d): **${current}** current, **${left}** left, **${regular}** regular uses, **0** fake, **0** bonus`;
  const inviteCodes = queries.listAmbassadorInviteCodes(ambassadorId, 20);
  const inviteCodeLine = inviteCodes.length
    ? `Invite codes: ${inviteCodes.map((row) => `${row.code} (${row.uses})`).join(", ")}`
    : "Invite codes: none";
  const attributionLine =
    unattributed > 0
      ? `Note: **${unattributed}** regular invites are historical and not yet mapped into left/current split in this bot DB.`
      : null;

  const rows = queries.getAmbassadorInvitees(ambassadorId, days, limit);
  const title = `**Ambassador Invitees (${days}d) - <@${ambassadorId}>**`;

  if (!rows.length) {
    return [title, breakdownLine, inviteCodeLine, attributionLine, "No attributed joined users in this period."]
      .filter(Boolean)
      .join("\n");
  }

  return [
    title,
    breakdownLine,
    inviteCodeLine,
    attributionLine,
    rows
      .map((row, idx) => {
        const totalMessages = Number(row.total_messages || 0);
        const isVerifiedMember = totalMessages >= 3;
        const status = isVerifiedMember ? "Verified member" : "Unverified member";
        const membership = row.still_in_server ? "in-server" : "left";
        return `${idx + 1}. <@${row.user_id}> (${membership}) - ${status} - total messages: ${row.total_messages} - joined: ${row.joined_at}`;
      })
      .join("\n"),
  ].join("\n");
}

function buildRecentLeaversContent(queries, days = 7, limit = 20) {
  const rows = queries.getRecentLeavers(days, limit);
  if (!rows.length) {
    return `**Recent Leavers (${days}d)**\nNo leave events in this period.`;
  }

  return [
    `**Recent Leavers (${days}d)**`,
    rows
      .map((row, idx) => {
        const activityTag = Number(row.messages_7d_before_leave || 0) === 0 ? "LOW-ACTIVITY" : "ACTIVE";
        const inviterPart = row.inviter_id ? `inviter: <@${row.inviter_id}>` : "inviter: unknown";
        const avatarPart = Number(row.has_avatar || 0) === 1 ? "avatar: yes" : "avatar: no";
        const idNamePart = Number(row.username_equals_user_id || 0) === 1 ? "name=id" : "name!=id";
        const suspiciousPart = Number(row.suspicious_username_pattern || 0) === 1 ? "pattern: suspicious" : "pattern: normal";
        return `${idx + 1}. <@${row.user_id}> - risk:${String(row.trust_risk_level || "unknown").toUpperCase()} (${row.trust_score}) - ${activityTag} - ${avatarPart} - ${idNamePart} - ${suspiciousPart} - username changes: ${row.username_change_count} - similar-group: ${row.similar_name_group_size} - stay ${Math.max(Number(row.stay_days || 0), 0)}d - total msgs ${row.total_messages} - 7d msgs ${row.messages_7d_before_leave} - ${inviterPart} - left: ${row.left_at}`;
      })
      .join("\n"),
  ].join("\n");
}

function buildLeavesByDayContent(queries, days = 14) {
  const growth = queries.getMemberGrowth(days);
  const leaves = Array.isArray(growth?.leaves) ? growth.leaves : [];

  if (!leaves.length) {
    return `**Leaves By Day (${days}d)**\nNo leave events in this period.`;
  }

  const rows = [...leaves].sort((a, b) => String(b.day).localeCompare(String(a.day)));
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);

  return [
    `**Leaves By Day (${days}d)**`,
    `Total leaves: ${total}`,
    rows.map((row) => `- ${row.day}: ${row.count}`).join("\n"),
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
  buildRecentLeaversContent,
  buildLeavesByDayContent,
};
