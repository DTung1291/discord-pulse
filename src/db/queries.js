function createQueries(db) {
  const upsertMemberStmt = db.prepare(`
    INSERT INTO members (user_id, username, joined_at, left_at, inviter_id)
    VALUES (@user_id, @username, @joined_at, NULL, @inviter_id)
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      joined_at = excluded.joined_at,
      left_at = NULL,
      inviter_id = excluded.inviter_id
  `);

  const upsertMemberSnapshotStmt = db.prepare(`
    INSERT INTO members (user_id, username, joined_at, left_at, inviter_id)
    VALUES (@user_id, @username, @joined_at, NULL, NULL)
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      joined_at = COALESCE(members.joined_at, excluded.joined_at),
      left_at = NULL
  `);

  const selectMemberByIdStmt = db.prepare(`
    SELECT user_id, left_at
    FROM members
    WHERE user_id = ?
  `);

  const selectHasJoinEventStmt = db.prepare(`
    SELECT 1
    FROM join_events
    WHERE user_id = ?
    LIMIT 1
  `);

  const selectActiveMemberIdsStmt = db.prepare(`
    SELECT user_id
    FROM members
    WHERE left_at IS NULL
  `);

  const markMemberLeftStmt = db.prepare(`
    UPDATE members
    SET left_at = @left_at
    WHERE user_id = @user_id
  `);

  const insertJoinEventStmt = db.prepare(`
    INSERT INTO join_events (user_id, inviter_id, joined_at)
    VALUES (@user_id, @inviter_id, @joined_at)
  `);

  const insertLeaveEventStmt = db.prepare(`
    INSERT INTO leave_events (user_id, left_at)
    VALUES (@user_id, @left_at)
  `);

  const insertMessageStmt = db.prepare(`
    INSERT INTO message_events (user_id, channel_id, created_at)
    VALUES (@user_id, @channel_id, @created_at)
  `);

  const upsertInviteSnapshotStmt = db.prepare(`
    INSERT INTO invite_snapshots (code, inviter_id, uses, updated_at)
    VALUES (@code, @inviter_id, @uses, @updated_at)
    ON CONFLICT(code) DO UPDATE SET
      inviter_id = excluded.inviter_id,
      uses = excluded.uses,
      updated_at = excluded.updated_at
  `);

  const upsertAmbassadorInviteStmt = db.prepare(`
    INSERT INTO ambassador_invites (code, ambassador_id, ambassador_name, channel_id, active, created_at)
    VALUES (@code, @ambassador_id, @ambassador_name, @channel_id, 1, @created_at)
    ON CONFLICT(code) DO UPDATE SET
      ambassador_id = excluded.ambassador_id,
      ambassador_name = excluded.ambassador_name,
      channel_id = excluded.channel_id,
      active = 1,
      created_at = excluded.created_at
  `);

  const getAmbassadorByInviteCodeStmt = db.prepare(`
    SELECT ambassador_id, ambassador_name
    FROM ambassador_invites
    WHERE code = ? AND active = 1
    LIMIT 1
  `);

  const listAmbassadorInvitesStmt = db.prepare(`
    SELECT code, ambassador_id, ambassador_name, channel_id, active, created_at
    FROM ambassador_invites
    WHERE active = 1
  `);

  function trackMemberJoin({ userId, username, inviterId, joinedAt }) {
    const payload = {
      user_id: userId,
      username,
      joined_at: joinedAt,
      inviter_id: inviterId || null,
    };

    const tx = db.transaction(() => {
      upsertMemberStmt.run(payload);
      insertJoinEventStmt.run({
        user_id: userId,
        inviter_id: inviterId || null,
        joined_at: joinedAt,
      });
    });

    tx();
  }

  function trackMemberLeave({ userId, leftAt }) {
    const tx = db.transaction(() => {
      markMemberLeftStmt.run({ user_id: userId, left_at: leftAt });
      insertLeaveEventStmt.run({ user_id: userId, left_at: leftAt });
    });

    tx();
  }

  function trackMessage({ userId, channelId, createdAt }) {
    insertMessageStmt.run({
      user_id: userId,
      channel_id: channelId,
      created_at: createdAt,
    });
  }

  function syncActiveMembers(members) {
    const tx = db.transaction((rows) => {
      for (const member of rows) {
        upsertMemberSnapshotStmt.run({
          user_id: member.userId,
          username: member.username,
          joined_at: member.joinedAt,
        });
      }
    });

    tx(members);
  }

  function reconcileGuildMembers(members) {
    const now = new Date().toISOString();
    let joinsAdded = 0;
    let leavesAdded = 0;

    const tx = db.transaction((rows) => {
      const currentIds = new Set();

      for (const member of rows) {
        currentIds.add(member.userId);

        const existing = selectMemberByIdStmt.get(member.userId);
        const hasJoinEvent = !!selectHasJoinEventStmt.get(member.userId);

        upsertMemberSnapshotStmt.run({
          user_id: member.userId,
          username: member.username,
          joined_at: member.joinedAt,
        });

        if (!hasJoinEvent || (existing && existing.left_at)) {
          insertJoinEventStmt.run({
            user_id: member.userId,
            inviter_id: null,
            joined_at: member.joinedAt || now,
          });
          joinsAdded += 1;
        }
      }

      const activeRows = selectActiveMemberIdsStmt.all();
      for (const row of activeRows) {
        if (!currentIds.has(row.user_id)) {
          markMemberLeftStmt.run({ user_id: row.user_id, left_at: now });
          insertLeaveEventStmt.run({ user_id: row.user_id, left_at: now });
          leavesAdded += 1;
        }
      }
    });

    tx(members);

    return {
      synced: members.length,
      joinsAdded,
      leavesAdded,
    };
  }

  function updateInviteSnapshot(invites) {
    const now = new Date().toISOString();
    const tx = db.transaction((rows) => {
      for (const invite of rows) {
        upsertInviteSnapshotStmt.run({
          code: invite.code,
          inviter_id: invite.inviterId || null,
          uses: invite.uses || 0,
          updated_at: now,
        });
      }
    });

    tx(invites);
  }

  function upsertAmbassadorInvite({ code, ambassadorId, ambassadorName, channelId, createdAt }) {
    upsertAmbassadorInviteStmt.run({
      code,
      ambassador_id: ambassadorId,
      ambassador_name: ambassadorName,
      channel_id: channelId,
      created_at: createdAt || new Date().toISOString(),
    });
  }

  function getAmbassadorByInviteCode(code) {
    return getAmbassadorByInviteCodeStmt.get(code) || null;
  }

  function listAmbassadorInvites() {
    return listAmbassadorInvitesStmt.all();
  }

  function getSummary(days = 7) {
    const rows = db
      .prepare(
        `
        SELECT
          (SELECT COUNT(*) FROM message_events WHERE created_at >= datetime('now', ?)) AS messages,
          (SELECT COUNT(*) FROM join_events WHERE joined_at >= datetime('now', ?)) AS joins,
          (SELECT COUNT(*) FROM leave_events WHERE left_at >= datetime('now', ?)) AS leaves,
          (SELECT COUNT(*) FROM members WHERE left_at IS NULL) AS active_members
      `
      )
      .get(`-${days} days`, `-${days} days`, `-${days} days`);

    return rows;
  }

  function getMessageVolume(days = 30) {
    return db
      .prepare(
        `
        SELECT DATE(created_at) AS day, COUNT(*) AS count
        FROM message_events
        WHERE created_at >= datetime('now', ?)
        GROUP BY DATE(created_at)
        ORDER BY day ASC
      `
      )
      .all(`-${days} days`);
  }

  function getHourlyHeatmap(days = 30) {
    return db
      .prepare(
        `
        SELECT
          CAST(strftime('%w', created_at) AS INTEGER) AS weekday,
          CAST(strftime('%H', created_at) AS INTEGER) AS hour,
          COUNT(*) AS count
        FROM message_events
        WHERE created_at >= datetime('now', ?)
        GROUP BY weekday, hour
        ORDER BY weekday, hour
      `
      )
      .all(`-${days} days`);
  }

  function getChannelRankings(days = 7, limit = 10) {
    return db
      .prepare(
        `
        SELECT channel_id, COUNT(*) AS count
        FROM message_events
        WHERE created_at >= datetime('now', ?)
        GROUP BY channel_id
        ORDER BY count DESC
        LIMIT ?
      `
      )
      .all(`-${days} days`, limit);
  }

  function getActiveUsers(days = 7, limit = 10) {
    return db
      .prepare(
        `
        SELECT user_id, COUNT(*) AS count
        FROM message_events
        WHERE created_at >= datetime('now', ?)
        GROUP BY user_id
        ORDER BY count DESC
        LIMIT ?
      `
      )
      .all(`-${days} days`, limit);
  }

  function getGhostMembers(days = 30, limit = 10) {
    return db
      .prepare(
        `
        SELECT m.user_id, m.username
        FROM members m
        LEFT JOIN (
          SELECT DISTINCT user_id
          FROM message_events
          WHERE created_at >= datetime('now', ?)
        ) msg ON m.user_id = msg.user_id
        WHERE m.left_at IS NULL AND msg.user_id IS NULL
        ORDER BY m.joined_at ASC
        LIMIT ?
      `
      )
      .all(`-${days} days`, limit);
  }

  function getInviteLeaderboard(days = 30, limit = 10) {
    return db
      .prepare(
        `
        SELECT inviter_id, COUNT(*) AS invited_count
        FROM join_events
        WHERE inviter_id IS NOT NULL
          AND joined_at >= datetime('now', ?)
        GROUP BY inviter_id
        ORDER BY invited_count DESC
        LIMIT ?
      `
      )
      .all(`-${days} days`, limit);
  }

  function getInviteSnapshotLeaderboard(limit = 10) {
    return db
      .prepare(
        `
        SELECT
          s.inviter_id,
          MAX(m.username) AS inviter_name,
          SUM(s.uses) AS invited_count
        FROM invite_snapshots s
        LEFT JOIN members m ON m.user_id = s.inviter_id
        WHERE s.inviter_id IS NOT NULL
        GROUP BY s.inviter_id
        ORDER BY invited_count DESC
        LIMIT ?
      `
      )
      .all(limit);
  }

  function getAmbassadorPerformance(days = 7, limit = 20) {
    return db
      .prepare(
        `
        SELECT
          ai.ambassador_id,
          MAX(ai.ambassador_name) AS ambassador_name,
          COUNT(je.id) AS invited_count
        FROM ambassador_invites ai
        LEFT JOIN join_events je
          ON je.inviter_id = ai.ambassador_id
         AND je.joined_at >= datetime('now', ?)
        WHERE ai.active = 1
        GROUP BY ai.ambassador_id
        ORDER BY invited_count DESC, ambassador_name ASC
        LIMIT ?
      `
      )
      .all(`-${days} days`, limit);
  }

  function getMemberGrowth(days = 30) {
    const joins = db
      .prepare(
        `
        SELECT DATE(joined_at) AS day, COUNT(*) AS count
        FROM join_events
        WHERE joined_at >= datetime('now', ?)
        GROUP BY DATE(joined_at)
      `
      )
      .all(`-${days} days`);

    const leaves = db
      .prepare(
        `
        SELECT DATE(left_at) AS day, COUNT(*) AS count
        FROM leave_events
        WHERE left_at >= datetime('now', ?)
        GROUP BY DATE(left_at)
      `
      )
      .all(`-${days} days`);

    return { joins, leaves };
  }

  return {
    trackMemberJoin,
    trackMemberLeave,
    trackMessage,
    syncActiveMembers,
    reconcileGuildMembers,
    updateInviteSnapshot,
    upsertAmbassadorInvite,
    getAmbassadorByInviteCode,
    listAmbassadorInvites,
    getSummary,
    getMessageVolume,
    getHourlyHeatmap,
    getChannelRankings,
    getActiveUsers,
    getGhostMembers,
    getInviteLeaderboard,
    getInviteSnapshotLeaderboard,
    getAmbassadorPerformance,
    getMemberGrowth,
  };
}

module.exports = {
  createQueries,
};
