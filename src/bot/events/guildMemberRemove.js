function onGuildMemberRemove(member, context) {
  const { queries } = context;

  queries.trackMemberLeave({
    userId: member.id,
    leftAt: new Date().toISOString(),
  });
}

module.exports = {
  onGuildMemberRemove,
};
