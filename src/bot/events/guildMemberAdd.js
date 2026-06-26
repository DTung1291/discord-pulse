async function onGuildMemberAdd(member, context) {
  const { invitesCache, queries } = context;
  let inviterId = null;
  let usedInviteCode = null;

  try {
    const newInvites = await member.guild.invites.fetch();
    const oldInvites = invitesCache.get(member.guild.id) || new Map();

    for (const invite of newInvites.values()) {
      const prevUses = oldInvites.get(invite.code) || 0;
      if ((invite.uses || 0) > prevUses) {
        usedInviteCode = invite.code;
        inviterId = invite.inviter ? invite.inviter.id : null;
        break;
      }
    }

    if (usedInviteCode) {
      const ambassador = queries.getAmbassadorByInviteCode(usedInviteCode);
      if (ambassador) {
        inviterId = ambassador.ambassador_id;
      }
    }

    const snapshot = [];
    for (const invite of newInvites.values()) {
      snapshot.push({
        code: invite.code,
        inviterId: invite.inviter ? invite.inviter.id : null,
        uses: invite.uses || 0,
      });
    }

    queries.updateInviteSnapshot(snapshot);

    const newCache = new Map();
    for (const invite of newInvites.values()) {
      newCache.set(invite.code, invite.uses || 0);
    }
    invitesCache.set(member.guild.id, newCache);
  } catch (error) {
    console.error("Failed to resolve inviter:", error.message);
  }

  queries.trackMemberJoin({
    userId: member.id,
    username: member.user.tag,
    inviterId,
    joinedAt: new Date().toISOString(),
  });
}

module.exports = {
  onGuildMemberAdd,
};
