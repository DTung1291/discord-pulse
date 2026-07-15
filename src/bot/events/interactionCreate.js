const {
  buildDailyReportContent,
  buildWeeklyReportContent,
  buildGhostMembersContent,
  buildAmbassadorPerformanceContent,
  buildAmbassadorInviteesContent,
  buildRecentLeaversContent,
  buildLeavesByDayContent,
} = require("../../scheduler/reports");

function isInConfiguredGuild(interaction, guildId) {
  if (!guildId) {
    return true;
  }

  return interaction.guildId === guildId;
}

function hasAnyAdminRole(interaction, adminRoleIds) {
  if (!adminRoleIds || !adminRoleIds.length) {
    return true;
  }

  if (!interaction.member || !interaction.member.roles || !interaction.member.roles.cache) {
    return false;
  }

  return adminRoleIds.some((roleId) => interaction.member.roles.cache.has(roleId));
}

async function onInteractionCreate(interaction, context) {
  const { queries, guildId, adminRoleIds } = context;

  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (!isInConfiguredGuild(interaction, guildId)) {
    await interaction.reply({
      content: "This bot is restricted to another guild.",
      flags: 64,
    });
    return;
  }

  // Acknowledge quickly to avoid Discord's 3-second timeout for slower commands.
  if (!interaction.deferred && !interaction.replied) {
    try {
      await interaction.deferReply({ flags: 64 });
    } catch (error) {
      const code = Number(error && error.code);
      if (code === 40060 || code === 10062) {
        // 40060: already acknowledged, 10062: unknown/expired interaction.
        return;
      }
      throw error;
    }
  }

  if (interaction.commandName === "pulse-summary") {
    const days = interaction.options.getInteger("days") || 7;
    const content = buildDailyReportContent(queries, days);
    await interaction.editReply({ content });
    return;
  }

  if (interaction.commandName === "pulse-daily") {
    const content = buildDailyReportContent(queries, 1);
    await interaction.editReply({ content });
    return;
  }

  if (interaction.commandName === "pulse-weekly") {
    if (!hasAnyAdminRole(interaction, adminRoleIds)) {
      await interaction.editReply({
        content: "You do not have permission to run this command.",
      });
      return;
    }

    const content = buildWeeklyReportContent(queries);
    await interaction.editReply({ content });
    return;
  }

  if (interaction.commandName === "pulse-ghosts") {
    const days = interaction.options.getInteger("days") || 30;
    const content = buildGhostMembersContent(queries, days, 20);
    await interaction.editReply({ content });
    return;
  }

  if (interaction.commandName === "pulse-ambassadors") {
    const days = interaction.options.getInteger("days") || 7;
    const content = buildAmbassadorPerformanceContent(queries, days, 20);
    await interaction.editReply({ content });
    return;
  }

  if (interaction.commandName === "pulse-ambassador-users") {
    const selectedUser = interaction.options.getUser("member");
    const days = interaction.options.getInteger("days") || 30;
    const limit = interaction.options.getInteger("limit") || 20;
    if (!selectedUser) {
      await interaction.editReply({
        content: "Please provide member to search invitees.",
      });
      return;
    }

    const ambassadorId = selectedUser.id;
    const matchedAmbassadorLine = `Matched ambassador: ${selectedUser.username} (<@${selectedUser.id}>)`;

    const contentBody = buildAmbassadorInviteesContent(queries, ambassadorId, days, limit);
    const content = matchedAmbassadorLine ? `${matchedAmbassadorLine}\n${contentBody}` : contentBody;
    await interaction.editReply({ content });
    return;
  }

  if (interaction.commandName === "pulse-leavers") {
    const days = interaction.options.getInteger("days") || 7;
    const limit = interaction.options.getInteger("limit") || 20;
    const content = buildRecentLeaversContent(queries, days, limit);
    await interaction.editReply({ content });
    return;
  }

  if (interaction.commandName === "pulse-leaves-daily") {
    const days = interaction.options.getInteger("days") || 14;
    const content = buildLeavesByDayContent(queries, days);
    await interaction.editReply({ content });
    return;
  }

  await interaction.editReply({
    content: "This command is not supported by the current bot version yet.",
  });
}

module.exports = {
  onInteractionCreate,
};
