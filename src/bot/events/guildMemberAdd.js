async function onGuildMemberAdd(member, context) {
  const { invitesCache, vanityCache, queries } = context;
  let inviterId = null;
  let usedInviteCode = null;
  const maxAttempts = 3;
  const retryDelayMs = 1500;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    const oldInvites = invitesCache.get(member.guild.id) || new Map();
    let newInvites = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      newInvites = await member.guild.invites.fetch();

      for (const invite of newInvites.values()) {
        const prevUses = oldInvites.get(invite.code) || 0;
        if ((invite.uses || 0) > prevUses) {
          usedInviteCode = invite.code;
          inviterId = invite.inviter ? invite.inviter.id : null;
          break;
        }
      }

      if (usedInviteCode || attempt === maxAttempts) {
        break;
      }

      await delay(retryDelayMs);
    }

    if (usedInviteCode) {
      const ambassador = queries.getAmbassadorByInviteCode(usedInviteCode);
      if (ambassador) {
        inviterId = ambassador.ambassador_id;
      }
    } else {
      try {
        const vanity = await member.guild.fetchVanityData();
        const prevVanityUses = vanityCache.get(member.guild.id) || 0;
        const nextVanityUses = Number(vanity?.uses || 0);

        if (nextVanityUses > prevVanityUses) {
          usedInviteCode = vanity?.code || null;
          if (usedInviteCode) {
            const ambassador = queries.getAmbassadorByInviteCode(usedInviteCode);
            if (ambassador) {
              inviterId = ambassador.ambassador_id;
            }
          }
        }

        vanityCache.set(member.guild.id, nextVanityUses);
      } catch (_error) {
        // Vanity data is optional and may not be available.
      }
    }

    const snapshot = [];
    if (!newInvites) {
      newInvites = await member.guild.invites.fetch();
    }

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
    avatarUrl: member.user.avatarURL() || null,
    inviterId,
    joinedAt: new Date().toISOString(),
    isBot: member.user.bot,
  });
}

module.exports = {
  onGuildMemberAdd,
};
