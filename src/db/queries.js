function createQueries(db) {
  const upsertMemberStmt = db.prepare(`
    INSERT INTO members (user_id, username, avatar_url, joined_at, left_at, inviter_id, is_bot)
    VALUES (@user_id, @username, @avatar_url, @joined_at, NULL, @inviter_id, @is_bot)
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      avatar_url = excluded.avatar_url,
      joined_at = excluded.joined_at,
      left_at = NULL,
      inviter_id = excluded.inviter_id,
      is_bot = excluded.is_bot
  `);

  const upsertMemberSnapshotStmt = db.prepare(`
    INSERT INTO members (user_id, username, avatar_url, joined_at, left_at, inviter_id, is_bot)
    VALUES (@user_id, @username, @avatar_url, @joined_at, NULL, NULL, @is_bot)
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      avatar_url = COALESCE(excluded.avatar_url, members.avatar_url),
      joined_at = COALESCE(members.joined_at, excluded.joined_at),
      left_at = NULL,
      is_bot = excluded.is_bot
  `);

  const selectMemberByIdStmt = db.prepare(`
    SELECT user_id, username, avatar_url, left_at
    FROM members
    WHERE user_id = ?
  `);

  const updateMemberIdentityStmt = db.prepare(`
    UPDATE members
    SET
      username = COALESCE(@username, username),
      avatar_url = COALESCE(@avatar_url, avatar_url)
    WHERE user_id = @user_id
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

  const selectLatestProfileStmt = db.prepare(`
    SELECT username, avatar_url
    FROM member_profile_history
    WHERE user_id = ?
    ORDER BY captured_at DESC
    LIMIT 1
  `);

  const insertMemberProfileStmt = db.prepare(`
    INSERT INTO member_profile_history (user_id, username, avatar_url, captured_at, source)
    VALUES (@user_id, @username, @avatar_url, @captured_at, @source)
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

  const upsertInviteSnapshotDailyStmt = db.prepare(`
    INSERT INTO invite_snapshot_daily (code, snapshot_day, inviter_id, uses, updated_at)
    VALUES (@code, @snapshot_day, @inviter_id, @uses, @updated_at)
    ON CONFLICT(code, snapshot_day) DO UPDATE SET
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

  function trackMemberProfile({ userId, username, avatarUrl, capturedAt, source }) {
    if (!userId || !username) {
      return;
    }

    const latest = selectLatestProfileStmt.get(userId);
    const latestUsername = latest ? String(latest.username || "") : "";
    const latestAvatar = latest ? String(latest.avatar_url || "") : "";
    const nextUsername = String(username || "");
    const nextAvatar = String(avatarUrl || "");

    if (latest && latestUsername === nextUsername && latestAvatar === nextAvatar) {
      return;
    }

    insertMemberProfileStmt.run({
      user_id: userId,
      username: nextUsername,
      avatar_url: avatarUrl || null,
      captured_at: capturedAt || new Date().toISOString(),
      source: source || null,
    });
  }

  function trackMemberJoin({ userId, username, avatarUrl, inviterId, joinedAt, isBot }) {
    const payload = {
      user_id: userId,
      username,
      avatar_url: avatarUrl || null,
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
      trackMemberProfile({
        userId,
        username,
        avatarUrl,
        capturedAt: joinedAt,
        source: "join",
      });
    });

    tx();
  }

  function trackMemberLeave({ userId, leftAt, username, avatarUrl }) {
    const tx = db.transaction(() => {
      updateMemberIdentityStmt.run({
        user_id: userId,
        username: username || null,
        avatar_url: avatarUrl || null,
      });
      markMemberLeftStmt.run({ user_id: userId, left_at: leftAt });
      insertLeaveEventStmt.run({ user_id: userId, left_at: leftAt });
      if (username) {
        trackMemberProfile({
          userId,
          username,
          avatarUrl,
          capturedAt: leftAt,
          source: "leave",
        });
      }
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
          avatar_url: member.avatarUrl || null,
          joined_at: member.joinedAt,
          is_bot: member.isBot ? 1 : 0,
        });

        trackMemberProfile({
          userId: member.userId,
          username: member.username,
          avatarUrl: member.avatarUrl || null,
          source: "sync",
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
          avatar_url: member.avatarUrl || null,
          joined_at: member.joinedAt,
          is_bot: member.isBot ? 1 : 0,
        });

        trackMemberProfile({
          userId: member.userId,
          username: member.username,
          avatarUrl: member.avatarUrl || null,
          source: "sync",
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
    const snapshotDay = now.slice(0, 10);
    const tx = db.transaction((rows) => {
      for (const invite of rows) {
        upsertInviteSnapshotStmt.run({
          code: invite.code,
          inviter_id: invite.inviterId || null,
          uses: invite.uses || 0,
          updated_at: now,
        });

        upsertInviteSnapshotDailyStmt.run({
          code: invite.code,
          snapshot_day: snapshotDay,
          inviter_id: invite.inviterId || null,
          uses: invite.uses || 0,
          updated_at: now,
        });
      }
    });

    tx(invites);
  }

  function getAmbassadorInviteDailyHistory(ambassadorId = "", days = 30) {
    const hasAmbassadorFilter = !!String(ambassadorId || "").trim();
    const safeDays = Number(days) > 0 ? Number(days) : 30;

    return db
      .prepare(
        `
        WITH base AS (
          SELECT ambassador_id, ambassador_name, code
          FROM ambassador_invites
          WHERE active = 1
            AND (? = 0 OR ambassador_id = ?)
        ),
        daily AS (
          SELECT
            b.ambassador_id,
            MAX(b.ambassador_name) AS ambassador_name,
            d.snapshot_day,
            SUM(d.uses) AS total_uses,
            COUNT(DISTINCT b.code) AS code_count
          FROM base b
          JOIN invite_snapshot_daily d ON d.code = b.code
          WHERE d.snapshot_day >= DATE('now', ?)
          GROUP BY b.ambassador_id, d.snapshot_day
        ),
        ranked AS (
          SELECT
            ambassador_id,
            ambassador_name,
            snapshot_day,
            total_uses,
            code_count,
            total_uses - LAG(total_uses) OVER (
              PARTITION BY ambassador_id
              ORDER BY snapshot_day
            ) AS daily_delta
          FROM daily
        )
        SELECT
          ambassador_id,
          ambassador_name,
          snapshot_day,
          total_uses,
          COALESCE(daily_delta, total_uses) AS daily_delta,
          code_count
        FROM ranked
        ORDER BY ambassador_name ASC, snapshot_day ASC
      `
      )
      .all(hasAmbassadorFilter ? 1 : 0, ambassadorId || "", `-${safeDays} days`);
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
            COUNT(
              DISTINCT CASE
                WHEN COALESCE(jm.is_bot, 0) = 0 AND jm.left_at IS NULL THEN je.user_id
                ELSE NULL
              END
            ) AS invited_count
          FROM ambassador_invites ai
          LEFT JOIN join_events je
            ON je.inviter_id = ai.ambassador_id
           AND je.joined_at >= datetime('now', ?)
          LEFT JOIN members jm ON jm.user_id = je.user_id
          WHERE ai.active = 1
          GROUP BY ai.ambassador_id
        ),
        snapshot AS (
          SELECT
            ai.ambassador_id,
            COALESCE(SUM(s.uses), 0) AS regular_count
          FROM ambassador_invites ai
          LEFT JOIN invite_snapshots s
            ON s.code = ai.code
            OR s.inviter_id = ai.ambassador_id
          WHERE ai.active = 1
          GROUP BY ai.ambassador_id
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
        WITH ambassador_codes AS (
          SELECT code
          FROM ambassador_invites
          WHERE ambassador_id = ?
            AND active = 1
        )
        SELECT COALESCE(SUM(s.uses), 0) AS regular_count
        FROM invite_snapshots s
        WHERE s.inviter_id = ?
           OR s.code IN (SELECT code FROM ambassador_codes)
      `
      )
      .get(ambassadorId, ambassadorId);

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
    const hasDaysFilter = Number(days) > 0;
    return db
      .prepare(
        `
        WITH invite_window AS (
          SELECT
            ambassador_id,
            MIN(created_at) AS first_invite_created_at,
            MAX(created_at) AS latest_invite_created_at,
            COUNT(*) AS invite_code_count,
            GROUP_CONCAT(code, '|') AS invite_codes
          FROM ambassador_invites
          WHERE active = 1
          GROUP BY ambassador_id
        )
        SELECT
          m.user_id,
          COALESCE(m.username, m.user_id) AS username,
          m.joined_at,
          CASE WHEN m.left_at IS NULL THEN 1 ELSE 0 END AS still_in_server,
          COALESCE((SELECT COUNT(*) FROM message_events me WHERE me.user_id = m.user_id), 0) AS total_messages,
          COALESCE((SELECT MAX(me.created_at) FROM message_events me WHERE me.user_id = m.user_id), '') AS last_message_at,
          iw.invite_codes,
          iw.first_invite_created_at,
          iw.latest_invite_created_at,
          iw.invite_code_count,
          CASE
            WHEN iw.first_invite_created_at IS NULL THEN 'invite_khong_xac_dinh'
            WHEN iw.invite_code_count > 1 AND m.joined_at < iw.latest_invite_created_at THEN 'invite_cu'
            ELSE 'invite_code_moi'
          END AS invite_source_type
        FROM members m
        LEFT JOIN invite_window iw ON iw.ambassador_id = m.inviter_id
        WHERE m.inviter_id = ?
          AND COALESCE(m.is_bot, 0) = 0
          AND (? = 0 OR m.joined_at >= datetime('now', ?))
        ORDER BY m.joined_at DESC
        LIMIT ?
      `
      )
      .all(ambassadorId, hasDaysFilter ? 1 : 0, `-${days} days`, limit);
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

  function enrichLeaversTrust(rows) {
    function normalizedUsernameKey(value) {
      return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .replace(/[0-9]/g, "#")
        .replace(/(.)\1+/g, "$1")
        .slice(0, 16);
    }

    function hasSuspiciousUsernamePattern(value) {
      const v = String(value || "").toLowerCase();
      if (!v) {
        return false;
      }

      return /(.)\1{3,}/.test(v) || /\d{5,}/.test(v) || /^[a-z]{1,3}\d{6,}$/.test(v);
    }

    const keyCounts = new Map();
    for (const row of rows) {
      const key = normalizedUsernameKey(row.username);
      keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    }

    return rows.map((row) => {
      const hasAvatar = !!String(row.avatar_url || "").trim();
      const usernameEqualsUserId =
        String(row.username || "").toLowerCase() === String(row.user_id || "").toLowerCase();
      const suspiciousUsernamePattern = hasSuspiciousUsernamePattern(row.username);
      const similarNameGroupSize = keyCounts.get(normalizedUsernameKey(row.username)) || 1;
      const usernameChangeCount = Number(row.username_change_count || 0);

      let trustScore = 100;
      if (!hasAvatar) trustScore -= 25;
      if (usernameEqualsUserId) trustScore -= 25;
      if (suspiciousUsernamePattern) trustScore -= 20;
      if (similarNameGroupSize >= 3) trustScore -= 15;
      if (Number(row.messages_7d_before_leave || 0) === 0) trustScore -= 10;
      if (usernameChangeCount >= 3) trustScore -= 10;
      trustScore = Math.max(0, trustScore);

      const riskLevel = trustScore <= 40 ? "high" : trustScore <= 70 ? "medium" : "low";

      return {
        ...row,
        has_avatar: hasAvatar ? 1 : 0,
        username_equals_user_id: usernameEqualsUserId ? 1 : 0,
        suspicious_username_pattern: suspiciousUsernamePattern ? 1 : 0,
        similar_name_group_size: similarNameGroupSize,
        username_change_count: usernameChangeCount,
        trust_score: trustScore,
        trust_risk_level: riskLevel,
      };
    });
  }

  function getLeaversByDayDetails(days = 30, perDayLimit = 30) {
    const rows = db
      .prepare(
        `
        WITH ranked AS (
          SELECT
            DATE(le.left_at) AS day,
            le.user_id,
            COALESCE(
              (
                SELECT mph.username
                FROM member_profile_history mph
                WHERE mph.user_id = le.user_id
                  AND mph.captured_at <= le.left_at
                ORDER BY mph.captured_at DESC
                LIMIT 1
              ),
              m.username,
              le.user_id
            ) AS username,
            COALESCE(
              (
                SELECT mph.avatar_url
                FROM member_profile_history mph
                WHERE mph.user_id = le.user_id
                  AND mph.captured_at <= le.left_at
                ORDER BY mph.captured_at DESC
                LIMIT 1
              ),
              m.avatar_url,
              ''
            ) AS avatar_url,
            m.inviter_id,
            COALESCE(
              (
                SELECT MIN(je.joined_at)
                FROM join_events je
                WHERE je.user_id = le.user_id
                  AND je.joined_at <= le.left_at
              ),
              m.joined_at
            ) AS joined_at,
            le.left_at,
            CAST(
              (
                julianday(COALESCE(le.left_at, datetime('now'))) -
                julianday(
                  COALESCE(
                    (
                      SELECT MIN(je.joined_at)
                      FROM join_events je
                      WHERE je.user_id = le.user_id
                        AND je.joined_at <= le.left_at
                    ),
                    m.joined_at,
                    le.left_at
                  )
                )
              ) AS INTEGER
            ) AS stay_days,
            COALESCE((SELECT COUNT(*) FROM message_events me WHERE me.user_id = le.user_id), 0) AS total_messages,
            COALESCE(
              (
                SELECT COUNT(*)
                FROM message_events me
                WHERE me.user_id = le.user_id
                  AND me.created_at >= datetime(COALESCE(le.left_at, datetime('now')), '-7 days')
                  AND me.created_at <= COALESCE(le.left_at, datetime('now'))
              ),
              0
            ) AS messages_7d_before_leave,
            COALESCE((SELECT MAX(me.created_at) FROM message_events me WHERE me.user_id = le.user_id), '') AS last_message_at,
            COALESCE(
              (
                SELECT COUNT(DISTINCT mph.username)
                FROM member_profile_history mph
                WHERE mph.user_id = le.user_id
                  AND mph.captured_at <= le.left_at
              ),
              0
            ) AS username_change_count,
            ROW_NUMBER() OVER (PARTITION BY DATE(le.left_at) ORDER BY le.left_at DESC) AS rn
          FROM leave_events le
          LEFT JOIN members m ON m.user_id = le.user_id
          WHERE le.left_at >= datetime('now', ?)
            AND COALESCE(m.is_bot, 0) = 0
        )
        SELECT
          day,
          user_id,
          username,
          avatar_url,
          inviter_id,
          joined_at,
          left_at,
          stay_days,
          total_messages,
          messages_7d_before_leave,
          last_message_at,
          username_change_count
        FROM ranked
        WHERE rn <= ?
        ORDER BY day DESC, left_at DESC
      `
      )
      .all(`-${days} days`, perDayLimit);

    return enrichLeaversTrust(rows);
  }

  function getRecentLeavers(days = 7, limit = 20) {
    const rows = db
      .prepare(
        `
        SELECT
          m.user_id,
          COALESCE(m.username, m.user_id) AS username,
          COALESCE(m.avatar_url, '') AS avatar_url,
          m.inviter_id,
          m.joined_at,
          m.left_at,
          CAST((julianday(COALESCE(m.left_at, datetime('now'))) - julianday(m.joined_at)) AS INTEGER) AS stay_days,
          COALESCE((SELECT COUNT(*) FROM message_events me WHERE me.user_id = m.user_id), 0) AS total_messages,
          COALESCE(
            (
              SELECT COUNT(*)
              FROM message_events me
              WHERE me.user_id = m.user_id
                AND me.created_at >= datetime(COALESCE(m.left_at, datetime('now')), '-7 days')
                AND me.created_at <= COALESCE(m.left_at, datetime('now'))
            ),
            0
          ) AS messages_7d_before_leave,
          COALESCE((SELECT MAX(me.created_at) FROM message_events me WHERE me.user_id = m.user_id), '') AS last_message_at,
          COALESCE(
            (
              SELECT COUNT(DISTINCT mph.username)
              FROM member_profile_history mph
              WHERE mph.user_id = m.user_id
            ),
            0
          ) AS username_change_count
        FROM members m
        WHERE m.left_at IS NOT NULL
          AND m.left_at >= datetime('now', ?)
          AND COALESCE(m.is_bot, 0) = 0
        ORDER BY m.left_at DESC
        LIMIT ?
      `
      )
      .all(`-${days} days`, limit);

    return enrichLeaversTrust(rows);
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
    trackMemberProfile,
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
    getAmbassadorInviteDailyHistory,
    getAmbassadorPerformance,
    getAmbassadorInviteBreakdown,
    getAmbassadorInvitees,
    getAmbassadorPostsByChannel,
    getMemberGrowth,
    getRecentLeavers,
    getLeaversByDayDetails,
  };
}

module.exports = {
  createQueries,
};
