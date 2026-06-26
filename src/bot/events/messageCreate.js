function onMessageCreate(message, context) {
  const { queries, guildId, ambassadorPostChannelId } = context;

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

  if (!ambassadorPostChannelId || message.channel.id !== ambassadorPostChannelId) {
    return;
  }

  const ambassador = queries.getAmbassadorById(message.author.id);
  if (!ambassador) {
    return;
  }

  queries.trackAmbassadorPost({
    messageId: message.id,
    ambassadorId: message.author.id,
    ambassadorName: ambassador.ambassador_name || message.author.username,
    channelId: message.channel.id,
    content: message.content || "",
    postedAt: message.createdAt.toISOString(),
  });
}

module.exports = {
  onMessageCreate,
};
