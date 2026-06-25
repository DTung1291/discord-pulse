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
    updateInviteSnapshot,
    getSummary,
    getMessageVolume,
    getHourlyHeatmap,
    getChannelRankings,
    getActiveUsers,
    getGhostMembers,
    getInviteLeaderboard,
    getMemberGrowth,
  };
}

module.exports = {
  createQueries,
};
