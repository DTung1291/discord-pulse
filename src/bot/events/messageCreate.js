function onMessageCreate(message, context) {
  const { queries, guildId } = context;

  if (message.author.bot) {
    return;
  }

  if (guildId && message.guild && message.guild.id !== guildId) {
    return;
  }

  if (!message.guild) {
    return;
  }

  queries.trackMessage({
    userId: message.author.id,
    channelId: message.channel.id,
    createdAt: message.createdAt.toISOString(),
  });
}

module.exports = {
  onMessageCreate,
};
