function createQueries(db) {
  const upsertMemberStmt = db.prepare(`
    INSERT INTO members (user_id, username, joined_at, left_at, inviter_id, is_bot)
    VALUES (@user_id, @username, @joined_at, NULL, @inviter_id, @is_bot)
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      joined_at = excluded.joined_at,
      left_at = NULL,
      inviter_id = excluded.inviter_id,
      is_bot = excluded.is_bot
  `);

  const upsertMemberSnapshotStmt = db.prepare(`
    INSERT INTO members (user_id, username, joined_at, left_at, inviter_id, is_bot)
    VALUES (@user_id, @username, @joined_at, NULL, NULL, @is_bot)
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      joined_at = COALESCE(members.joined_at, excluded.joined_at),
      left_at = NULL,
      is_bot = excluded.is_bot
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

  const upsertChannelStmt = db.prepare(`
    INSERT INTO channels (channel_id, channel_name, updated_at)
    VALUES (@channel_id, @channel_name, @updated_at)
    ON CONFLICT(channel_id) DO UPDATE SET
      channel_name = excluded.channel_name,
      updated_at = excluded.updated_at
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

  const getAmbassadorByIdStmt = db.prepare(`
    SELECT ambassador_id, ambassador_name
    FROM ambassador_invites
    WHERE ambassador_id = ? AND active = 1
    LIMIT 1
  `);

  const insertAmbassadorPostStmt = db.prepare(`
    INSERT INTO ambassador_posts (message_id, ambassador_id, ambassador_name, channel_id, content, posted_at)
    VALUES (@message_id, @ambassador_id, @ambassador_name, @channel_id, @content, @posted_at)
    ON CONFLICT(message_id) DO UPDATE SET
      ambassador_id = excluded.ambassador_id,
      ambassador_name = excluded.ambassador_name,
      channel_id = excluded.channel_id,
      content = excluded.content,
      posted_at = excluded.posted_at
  `);

  const upsertInviteTrackerSyncStmt = db.prepare(`
    INSERT INTO invite_tracker_sync (
      ambassador_id,
      current_count,
      regular_count,
      left_count,
      fake_count,
      bonus_count,
      synced_at,
      source_text
    )
    VALUES (
      @ambassador_id,
      @current_count,
      @regular_count,
      @left_count,
      @fake_count,
      @bonus_count,
      @synced_at,
      @source_text
    )
    ON CONFLICT(ambassador_id) DO UPDATE SET
      current_count = excluded.current_count,
      regular_count = excluded.regular_count,
      left_count = excluded.left_count,
      fake_count = excluded.fake_count,
      bonus_count = excluded.bonus_count,
      synced_at = excluded.synced_at,
      source_text = excluded.source_text
  `);

  const getInviteTrackerSyncStmt = db.prepare(`
    SELECT
      ambassador_id,
      current_count,
      regular_count,
      left_count,
      fake_count,
      bonus_count,
      synced_at,
      source_text
    FROM invite_tracker_sync
    WHERE ambassador_id = ?
    LIMIT 1
  `);

  function trackMemberJoin({ userId, username, inviterId, joinedAt, isBot }) {
    const payload = {
      user_id: userId,
      username,
      joined_at: joinedAt,
      inviter_id: inviterId || null,
      is_bot: isBot ? 1 : 0,
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

  function trackMessage({ userId, channelId, channelName, createdAt }) {
    insertMessageStmt.run({
      user_id: userId,
      channel_id: channelId,
      created_at: createdAt,
    });

    if (channelName) {
      upsertChannelStmt.run({
        channel_id: channelId,
        channel_name: channelName,
        updated_at: createdAt,
      });
    }
  }

  function syncChannels(channels) {
    const now = new Date().toISOString();
    const tx = db.transaction((rows) => {
      for (const channel of rows) {
        if (!channel.channelId || !channel.channelName) {
          continue;
        }

        upsertChannelStmt.run({
          channel_id: channel.channelId,
          channel_name: channel.channelName,
          updated_at: now,
        });
      }
    });

    tx(channels || []);
  }

  function syncActiveMembers(members) {
    const tx = db.transaction((rows) => {
      for (const member of rows) {
        upsertMemberSnapshotStmt.run({
          user_id: member.userId,
          username: member.username,
          joined_at: member.joinedAt,
          is_bot: member.isBot ? 1 : 0,
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
          is_bot: member.isBot ? 1 : 0,
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

  function getAmbassadorById(ambassadorId) {
    return getAmbassadorByIdStmt.get(ambassadorId) || null;
  }

  function trackAmbassadorPost({ messageId, ambassadorId, ambassadorName, channelId, content, postedAt }) {
    insertAmbassadorPostStmt.run({
      message_id: messageId,
      ambassador_id: ambassadorId,
      ambassador_name: ambassadorName,
      channel_id: channelId,
      content: content || "",
      posted_at: postedAt,
    });
  }

  function upsertInviteTrackerSync({
    ambassadorId,
    currentCount,
    regularCount,
    leftCount,
    fakeCount,
    bonusCount,
    sourceText,
    syncedAt,
  }) {
    upsertInviteTrackerSyncStmt.run({
      ambassador_id: ambassadorId,
      current_count: Number(currentCount || 0),
      regular_count: Number(regularCount || 0),
      left_count: Number(leftCount || 0),
      fake_count: Number(fakeCount || 0),
      bonus_count: Number(bonusCount || 0),
      synced_at: syncedAt || new Date().toISOString(),
      source_text: sourceText || null,
    });
  }

  function getInviteTrackerSync(ambassadorId) {
    return getInviteTrackerSyncStmt.get(ambassadorId) || null;
  }

  function getSummary(days = 7) {
    const rows = db
      .prepare(
        `
        SELECT
          (SELECT COUNT(*) FROM message_events WHERE created_at >= datetime('now', ?)) AS messages,
          (SELECT COUNT(*) FROM join_events WHERE joined_at >= datetime('now', ?)) AS joins,
          (SELECT COUNT(*) FROM leave_events WHERE left_at >= datetime('now', ?)) AS leaves,
          (SELECT COUNT(*) FROM members WHERE left_at IS NULL) AS active_members,
          (SELECT COUNT(*) FROM members WHERE left_at IS NULL) AS server_members,
          (SELECT COUNT(*) FROM members WHERE left_at IS NULL AND is_bot = 0) AS human_members
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
        SELECT
          me.channel_id,
          COALESCE(c.channel_name, me.channel_id) AS channel_name,
          COUNT(*) AS count
        FROM message_events me
        LEFT JOIN channels c ON c.channel_id = me.channel_id
        WHERE me.created_at >= datetime('now', ?)
        GROUP BY me.channel_id
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
        WHERE m.left_at IS NULL AND m.is_bot = 0 AND msg.user_id IS NULL
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
        WITH perf AS (
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
        ),
        snapshot AS (
          SELECT
            inviter_id AS ambassador_id,
            COALESCE(SUM(uses), 0) AS regular_count
          FROM invite_snapshots
          WHERE inviter_id IS NOT NULL
          GROUP BY inviter_id
        ),
        member_map AS (
          SELECT
            inviter_id AS ambassador_id,
            SUM(CASE WHEN left_at IS NULL THEN 1 ELSE 0 END) AS current_count,
            SUM(CASE WHEN left_at IS NOT NULL THEN 1 ELSE 0 END) AS left_count
          FROM members
          WHERE inviter_id IS NOT NULL
            AND COALESCE(is_bot, 0) = 0
          GROUP BY inviter_id
        ),
        tracker_sync AS (
          SELECT
            ambassador_id,
            current_count,
            regular_count,
            left_count,
            fake_count,
            bonus_count
          FROM invite_tracker_sync
        )
        SELECT
          p.ambassador_id,
          p.ambassador_name,
          p.invited_count,
          COALESCE(ts.regular_count, s.regular_count, 0) AS regular_count,
          COALESCE(ts.current_count, m.current_count, 0) AS current_count,
          COALESCE(ts.left_count, m.left_count, 0) AS left_count,
          COALESCE(ts.fake_count, 0) AS fake_count,
          COALESCE(ts.bonus_count, 0) AS bonus_count,
          MAX(
            COALESCE(ts.regular_count, s.regular_count, 0) -
              (
                COALESCE(ts.current_count, m.current_count, 0) +
                COALESCE(ts.left_count, m.left_count, 0) +
                COALESCE(ts.fake_count, 0) +
                COALESCE(ts.bonus_count, 0)
              ),
            0
          ) AS unattributed_count
        FROM perf p
        LEFT JOIN snapshot s ON s.ambassador_id = p.ambassador_id
        LEFT JOIN member_map m ON m.ambassador_id = p.ambassador_id
        LEFT JOIN tracker_sync ts ON ts.ambassador_id = p.ambassador_id
        ORDER BY invited_count DESC, ambassador_name ASC
        LIMIT ?
      `
      )
      .all(`-${days} days`, limit);
  }

  function getAmbassadorInviteBreakdown(ambassadorId, days = 0) {
    const tracker = getInviteTrackerSync(ambassadorId);
    if (tracker) {
      const regular = Number(tracker.regular_count || 0);
      const current = Number(tracker.current_count || 0);
      const left = Number(tracker.left_count || 0);
      const fake = Number(tracker.fake_count || 0);
      const bonus = Number(tracker.bonus_count || 0);

      return {
        regular_count: regular,
        current_count: current,
        left_count: left,
        fake_count: fake,
        bonus_count: bonus,
        member_regular_count: current + left,
        unattributed_count: Math.max(regular - (current + left + fake + bonus), 0),
      };
    }

    const hasDaysFilter = Number(days) > 0;

    const snapshotRegular = db
      .prepare(
        `
        SELECT COALESCE(SUM(s.uses), 0) AS regular_count
        FROM invite_snapshots s
        WHERE s.inviter_id = ?
      `
      )
      .get(ambassadorId);

    const memberBased = db
      .prepare(
        `
        WITH invited_users AS (
          SELECT DISTINCT je.user_id
          FROM join_events je
          WHERE je.inviter_id = ?
            AND (? = 0 OR je.joined_at >= datetime('now', ?))
        )
        SELECT
          COUNT(*) AS member_regular_count,
          SUM(CASE WHEN m.left_at IS NULL THEN 1 ELSE 0 END) AS current_count,
          SUM(CASE WHEN m.left_at IS NOT NULL THEN 1 ELSE 0 END) AS left_count
        FROM invited_users iu
        LEFT JOIN members m ON m.user_id = iu.user_id
        WHERE COALESCE(m.is_bot, 0) = 0
      `
      )
      .get(ambassadorId, hasDaysFilter ? 1 : 0, `-${days} days`);

    const regular = Number(snapshotRegular?.regular_count || 0);
    const current = Number(memberBased?.current_count || 0);
    const left = Number(memberBased?.left_count || 0);
    const mapped = current + left;

    return {
      regular_count: regular,
      current_count: current,
      left_count: left,
      fake_count: 0,
      bonus_count: 0,
      member_regular_count: Number(memberBased?.member_regular_count || 0),
      unattributed_count: Math.max(regular - mapped, 0),
    };
  }

  function getAmbassadorInvitees(ambassadorId, days = 30, limit = 20) {
    return db
      .prepare(
        `
        SELECT
          je.user_id,
          COALESCE(m.username, je.user_id) AS username,
          je.joined_at,
          CASE WHEN m.left_at IS NULL THEN 1 ELSE 0 END AS still_in_server,
          COALESCE((SELECT COUNT(*) FROM message_events me WHERE me.user_id = je.user_id), 0) AS total_messages,
          COALESCE((SELECT MAX(me.created_at) FROM message_events me WHERE me.user_id = je.user_id), '') AS last_message_at
        FROM join_events je
        LEFT JOIN members m ON m.user_id = je.user_id
        WHERE je.inviter_id = ?
          AND je.joined_at >= datetime('now', ?)
          AND COALESCE(m.is_bot, 0) = 0
        ORDER BY je.joined_at DESC
        LIMIT ?
      `
      )
      .all(ambassadorId, `-${days} days`, limit);
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

  function getAmbassadorPostsByChannel(channelId, days = 30, ambassadorLimit = 20, postsPerAmbassador = 5) {
    const ambassadors = db
      .prepare(
        `
        SELECT
          ambassador_id,
          MAX(ambassador_name) AS ambassador_name,
          COUNT(*) AS post_count,
          MAX(posted_at) AS last_posted_at
        FROM ambassador_posts
        WHERE channel_id = ?
          AND posted_at >= datetime('now', ?)
        GROUP BY ambassador_id
        ORDER BY post_count DESC, last_posted_at DESC
        LIMIT ?
      `
      )
      .all(channelId, `-${days} days`, ambassadorLimit);

    if (!ambassadors.length) {
      return [];
    }

    const details = db
      .prepare(
        `
        WITH ranked_posts AS (
          SELECT
            message_id,
            ambassador_id,
            ambassador_name,
            channel_id,
            content,
            posted_at,
            ROW_NUMBER() OVER (PARTITION BY ambassador_id ORDER BY posted_at DESC) AS rn
          FROM ambassador_posts
          WHERE channel_id = ?
            AND posted_at >= datetime('now', ?)
        )
        SELECT
          message_id,
          ambassador_id,
          ambassador_name,
          channel_id,
          content,
          posted_at
        FROM ranked_posts
        WHERE rn <= ?
        ORDER BY ambassador_name ASC, posted_at DESC
      `
      )
      .all(channelId, `-${days} days`, postsPerAmbassador);

    const detailMap = new Map();
    for (const row of details) {
      if (!detailMap.has(row.ambassador_id)) {
        detailMap.set(row.ambassador_id, []);
      }
      detailMap.get(row.ambassador_id).push(row);
    }

    return ambassadors.map((ambassador) => ({
      ...ambassador,
      posts: detailMap.get(ambassador.ambassador_id) || [],
    }));
  }

  return {
    trackMemberJoin,
    trackMemberLeave,
    trackMessage,
    syncChannels,
    syncActiveMembers,
    reconcileGuildMembers,
    updateInviteSnapshot,
    upsertAmbassadorInvite,
    getAmbassadorByInviteCode,
    getAmbassadorById,
    listAmbassadorInvites,
    trackAmbassadorPost,
    upsertInviteTrackerSync,
    getInviteTrackerSync,
    getSummary,
    getMessageVolume,
    getHourlyHeatmap,
    getChannelRankings,
    getActiveUsers,
    getGhostMembers,
    getInviteLeaderboard,
    getInviteSnapshotLeaderboard,
    getAmbassadorPerformance,
    getAmbassadorInviteBreakdown,
    getAmbassadorInvitees,
    getAmbassadorPostsByChannel,
    getMemberGrowth,
  };
}

module.exports = {
  createQueries,
};
