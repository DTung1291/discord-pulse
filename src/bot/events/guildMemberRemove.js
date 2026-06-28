function onGuildMemberRemove(member, context) {
  const { queries } = context;

  queries.trackMemberLeave({
    userId: member.id,
    leftAt: new Date().toISOString(),
    username: member.user ? member.user.tag : null,
    avatarUrl: member.user ? member.user.avatarURL() || null : null,
  });
}

module.exports = {
  onGuildMemberRemove,
};
