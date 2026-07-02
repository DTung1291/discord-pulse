async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data && data.error ? data.error : `Request failed: ${res.status}`;
    throw new Error(message);
  }

  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

let messageVolumeChart;
let memberGrowthChart;
let ambassadorCompareChart;
let leaveExplorerChart;
const FULL_REFRESH_MS = 30000;
const CHANNEL_RANKING_REFRESH_MS = 5000;

function updateLastUpdated() {
  const el = document.getElementById("last-updated");
  if (!el) {
    return;
  }

  el.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
}

function renderSummary(summary) {
  const container = document.getElementById("summary-cards");
  const items = [
    { label: "Messages (7d)", value: summary.messages || 0 },
    { label: "Joins (7d)", value: summary.joins || 0 },
    { label: "Leaves (7d)", value: summary.leaves || 0 },
    { label: "Human Members", value: summary.human_members || 0 },
    { label: "Server Members", value: summary.server_members || summary.active_members || 0 },
  ];

  container.innerHTML = items
    .map(
      (item) => `
        <article class="card">
          <div class="label">${item.label}</div>
          <div class="value">${item.value}</div>
        </article>
      `
    )
    .join("");
}

function renderMessageVolume(rows) {
  const ctx = document.getElementById("messageVolumeChart");

  if (messageVolumeChart) {
    messageVolumeChart.destroy();
  }

  messageVolumeChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: rows.map((row) => row.day),
      datasets: [
        {
          label: "Messages",
          data: rows.map((row) => row.count),
          borderColor: "#2ec5b6",
          backgroundColor: "rgba(46, 197, 182, 0.2)",
          tension: 0.2,
          fill: true,
        },
      ],
    },
    options: {
      plugins: { legend: { labels: { color: "#e7ecf8" } } },
      scales: {
        x: { ticks: { color: "#a5b1ca" }, grid: { color: "#223052" } },
        y: { ticks: { color: "#a5b1ca" }, grid: { color: "#223052" } },
      },
    },
  });
}

function renderMemberGrowth(data) {
  const joinsMap = new Map(data.joins.map((r) => [r.day, r.count]));
  const leavesMap = new Map(data.leaves.map((r) => [r.day, r.count]));
  const labels = Array.from(new Set([...joinsMap.keys(), ...leavesMap.keys()])).sort();

  const ctx = document.getElementById("memberGrowthChart");

  if (memberGrowthChart) {
    memberGrowthChart.destroy();
  }

  memberGrowthChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Joins",
          data: labels.map((d) => joinsMap.get(d) || 0),
          backgroundColor: "rgba(46, 197, 182, 0.7)",
        },
        {
          label: "Leaves",
          data: labels.map((d) => leavesMap.get(d) || 0),
          backgroundColor: "rgba(239, 131, 84, 0.7)",
        },
      ],
    },
    options: {
      plugins: { legend: { labels: { color: "#e7ecf8" } } },
      scales: {
        x: { ticks: { color: "#a5b1ca" }, grid: { color: "#223052" } },
        y: { ticks: { color: "#a5b1ca" }, grid: { color: "#223052" } },
      },
    },
  });
}

function renderLeaverTrustRow(row) {
  const username = escapeHtml(row.username || row.user_id);
  const userId = escapeHtml(row.user_id);
  const inviter = row.inviter_id
    ? `<span>inviter: ${escapeHtml(row.inviter_id)}</span>`
    : "<span>inviter: unknown</span>";
  const leftAt = row.left_at ? new Date(row.left_at).toLocaleString() : "-";
  const activityClass = Number(row.messages_7d_before_leave || 0) > 0 ? "active" : "ghost";
  const activityLabel =
    Number(row.messages_7d_before_leave || 0) > 0 ? "ACTIVE BEFORE LEAVE" : "LOW-ACTIVITY";
  const hasAvatar = Number(row.has_avatar || 0) === 1;
  const usernameEqualsId = Number(row.username_equals_user_id || 0) === 1;
  const suspiciousPattern = Number(row.suspicious_username_pattern || 0) === 1;
  const riskLevel = String(row.trust_risk_level || "unknown").toUpperCase();
  const trustScore = Number(row.trust_score || 0);
  const riskClass = riskLevel === "HIGH" ? "ghost" : riskLevel === "MEDIUM" ? "warn" : "active";

  return `
    <li>
      <div class="invitee-header">
        <span>${username} (${userId})</span>
        <span class="badge ${activityClass}">${activityLabel}</span>
      </div>
      <div class="invitee-meta">
        <span class="badge ${riskClass}">RISK ${riskLevel} (${trustScore})</span>
        <span>avatar: ${hasAvatar ? "yes" : "no"}</span>
        <span>name=id: ${usernameEqualsId ? "yes" : "no"}</span>
        <span>name-pattern: ${suspiciousPattern ? "suspicious" : "normal"}</span>
        <span>username changes: ${Number(row.username_change_count || 0)}</span>
        <span>similar-name group: ${Number(row.similar_name_group_size || 1)}</span>
        <span>stay: ${Math.max(Number(row.stay_days || 0), 0)}d</span>
        <span>total msgs: ${Number(row.total_messages || 0)}</span>
        <span>7d msgs before leave: ${Number(row.messages_7d_before_leave || 0)}</span>
        ${inviter}
        <span>left: ${escapeHtml(leftAt)}</span>
      </div>
    </li>
  `;
}

function renderLeaveExplorer(rows, days) {
  const titleEl = document.getElementById("leave-explorer-title");
  const wrap = document.getElementById("leave-explorer-wrap");
  const chartEl = document.getElementById("leaveExplorerChart");

  if (titleEl) {
    titleEl.textContent = `Leave Explorer (${days} days)`;
  }

  const chartRows = [...(rows || [])].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  if (leaveExplorerChart) {
    leaveExplorerChart.destroy();
  }

  if (chartEl) {
    leaveExplorerChart = new Chart(chartEl, {
      type: "bar",
      data: {
        labels: chartRows.map((row) => row.day),
        datasets: [
          {
            label: "Leaves",
            data: chartRows.map((row) => Number(row.count || 0)),
            backgroundColor: "rgba(239, 131, 84, 0.7)",
            borderRadius: 6,
          },
        ],
      },
      options: {
        plugins: { legend: { labels: { color: "#e7ecf8" } } },
        scales: {
          x: { ticks: { color: "#a5b1ca" }, grid: { color: "#223052" } },
          y: { ticks: { color: "#a5b1ca" }, grid: { color: "#223052" }, beginAtZero: true },
        },
      },
    });
  }

  if (!wrap) {
    return;
  }

  if (!rows || !rows.length) {
    wrap.innerHTML = '<div class="invitee-empty">No leave events in this period.</div>';
    return;
  }

  wrap.innerHTML = rows
    .map((dayRow) => {
      const day = escapeHtml(dayRow.day || "-");
      const count = Number(dayRow.count || 0);
      const leavers = Array.isArray(dayRow.leavers) ? dayRow.leavers : [];
      const detailHtml = leavers.length
        ? `<ul class="invitee-list leavers-list">${leavers.map((row) => renderLeaverTrustRow(row)).join("")}</ul>`
        : '<div class="invitee-empty">No detailed rows stored for this day window.</div>';

      return `
        <details class="leave-day-details">
          <summary>
            <span>${day}</span>
            <strong>${count} leaves</strong>
          </summary>
          <div class="leave-day-content">${detailHtml}</div>
        </details>
      `;
    })
    .join("");
}

function getLeaveExplorerFilters() {
  const daysEl = document.getElementById("leave-explorer-days");
  const perDayLimitEl = document.getElementById("leave-explorer-per-day-limit");

  const days = Number(daysEl ? daysEl.value : 30);
  const perDayLimit = Number(perDayLimitEl ? perDayLimitEl.value : 30);

  return {
    days: Number.isFinite(days) && days > 0 ? days : 30,
    perDayLimit: Number.isFinite(perDayLimit) && perDayLimit > 0 ? perDayLimit : 30,
  };
}

async function loadLeaveExplorer() {
  const { days, perDayLimit } = getLeaveExplorerFilters();
  const data = await getJson(
    `/api/leavers-by-day?days=${encodeURIComponent(days)}&perDayLimit=${encodeURIComponent(perDayLimit)}`
  );
  renderLeaveExplorer(data?.rows || [], days);
}

function setupLeaveExplorerControls() {
  const daysEl = document.getElementById("leave-explorer-days");
  const perDayLimitEl = document.getElementById("leave-explorer-per-day-limit");

  if (daysEl) {
    daysEl.addEventListener("change", () => {
      loadLeaveExplorer().catch((error) => {
        console.error(error);
      });
    });
  }

  if (perDayLimitEl) {
    perDayLimitEl.addEventListener("change", () => {
      loadLeaveExplorer().catch((error) => {
        console.error(error);
      });
    });
  }
}

function renderChannelRanking(rows) {
  const list = document.getElementById("channel-ranking-list");

  if (!rows.length) {
    list.innerHTML = "<li>No data yet.</li>";
    return;
  }

  list.innerHTML = rows
    .map((row) => {
      const channelName = escapeHtml(row.channel_name || row.channel_id);
      const channelId = escapeHtml(row.channel_id);
      return `<li>#${channelName} <span class="subtle">(${channelId})</span> - ${row.count} messages</li>`;
    })
    .join("");
}

function renderInviteRanking(rows) {
  const list = document.getElementById("invite-ranking-list");

  if (!rows.length) {
    list.innerHTML = "<li>No invite data yet.</li>";
    return;
  }

  list.innerHTML = rows
    .map((row) => {
      const label = row.inviter_name || `User ${row.inviter_id}`;
      return `<li>${label} (${row.inviter_id}) - ${row.invited_count} uses</li>`;
    })
    .join("");
}

function mapAmbassadorPostsById(groups) {
  const map = new Map();
  for (const group of groups || []) {
    map.set(group.ambassador_id, group);
  }
  return map;
}

function mapAmbassadorInviteById(invites) {
  const map = new Map();
  for (const invite of invites || []) {
    if (!map.has(invite.ambassador_id)) {
      map.set(invite.ambassador_id, []);
    }
    map.get(invite.ambassador_id).push(invite.code);
  }
  return map;
}

function buildAmbassadorCompareRows(rows, ambassadorPostsMap = new Map()) {
  const normalized = (rows || []).map((row) => {
    const postGroup = ambassadorPostsMap.get(row.ambassador_id) || null;
    const posts = Number(postGroup ? postGroup.post_count : 0);
    const activeCurrent = Number(row.current_count || 0);
    const activePerPost = posts > 0 ? Number((activeCurrent / posts).toFixed(2)) : 0;
    return {
      id: row.ambassador_id,
      name: row.ambassador_name || `User ${row.ambassador_id}`,
      activeCurrent,
      posts,
      activePerPost,
    };
  });

  return normalized.sort((a, b) => b.activeCurrent - a.activeCurrent);
}

function renderAmbassadorCompareChart(rows, ambassadorPostsMap = new Map()) {
  const ctx = document.getElementById("ambassadorCompareChart");
  const emptyEl = document.getElementById("ambassador-chart-empty");
  const dataRows = buildAmbassadorCompareRows(rows, ambassadorPostsMap);

  if (ambassadorCompareChart) {
    ambassadorCompareChart.destroy();
  }

  if (!ctx || !dataRows.length) {
    if (emptyEl) {
      emptyEl.hidden = false;
    }
    return;
  }

  if (emptyEl) {
    emptyEl.hidden = true;
  }

  ambassadorCompareChart = new Chart(ctx, {
    data: {
      labels: dataRows.map((row) => row.name),
      datasets: [
        {
          type: "bar",
          label: "Active Invites (current)",
          data: dataRows.map((row) => row.activeCurrent),
          backgroundColor: "rgba(46, 197, 182, 0.75)",
          borderRadius: 6,
          yAxisID: "y",
        },
        {
          type: "bar",
          label: "Posts (30d channel)",
          data: dataRows.map((row) => row.posts),
          backgroundColor: "rgba(239, 131, 84, 0.75)",
          borderRadius: 6,
          yAxisID: "y",
        },
        {
          type: "line",
          label: "Active/Post",
          data: dataRows.map((row) => row.activePerPost),
          borderColor: "#79b8ff",
          backgroundColor: "rgba(121, 184, 255, 0.2)",
          tension: 0.2,
          fill: false,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#e7ecf8" } },
        tooltip: { mode: "index", intersect: false },
      },
      scales: {
        x: { ticks: { color: "#a5b1ca" }, grid: { color: "#223052" } },
        y: {
          title: { display: true, text: "Count", color: "#a5b1ca" },
          ticks: { color: "#a5b1ca" },
          grid: { color: "#223052" },
          beginAtZero: true,
        },
        y1: {
          position: "right",
          title: { display: true, text: "Active/Post", color: "#a5b1ca" },
          ticks: { color: "#a5b1ca" },
          grid: { drawOnChartArea: false },
          beginAtZero: true,
        },
      },
    },
  });
}

function renderInviteeList(listWrap, rows, statusFilter = "all", query = "") {
  const normalizedQuery = (query || "").trim().toLowerCase();

  const filteredRows = rows.filter((row) => {
    const status = row.still_in_server ? "in-server" : "left";

    if (statusFilter !== "all" && status !== statusFilter) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const username = String(row.username || "").toLowerCase();
    const userId = String(row.user_id || "").toLowerCase();
    return username.includes(normalizedQuery) || userId.includes(normalizedQuery);
  });

  if (!filteredRows.length) {
    listWrap.innerHTML = '<div class="invitee-empty">No users match this filter.</div>';
    return;
  }

  const sourceLabelMap = {
    invite_cu: "Invite cũ",
    invite_code_moi: "Invite qua code mới",
    invite_khong_xac_dinh: "Không xác định",
  };

  const bySource = {
    invite_cu: filteredRows.filter((row) => row.invite_source_type === "invite_cu"),
    invite_code_moi: filteredRows.filter((row) => row.invite_source_type === "invite_code_moi"),
    invite_khong_xac_dinh: filteredRows.filter(
      (row) => !row.invite_source_type || row.invite_source_type === "invite_khong_xac_dinh"
    ),
  };

  function renderSourceTable(title, sourceKey, sourceRows) {
    if (!sourceRows.length) {
      return `
        <section class="invite-source-group">
          <h5>${title} (0)</h5>
          <div class="invitee-empty">No users in this group.</div>
        </section>
      `;
    }

    return `
      <section class="invite-source-group">
        <h5>${title} (${sourceRows.length})</h5>
        <div class="invitee-table-wrap">
          <table class="invitee-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Membership</th>
                <th>Activity</th>
                <th>Messages</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              ${sourceRows
                .map((row) => {
                  const username = escapeHtml(row.username || row.user_id);
                  const userId = escapeHtml(row.user_id);
                  const status = Number(row.total_messages || 0) > 0 ? "ACTIVE" : "GHOST";
                  const statusClass = status === "ACTIVE" ? "active" : "ghost";
                  const membership = row.still_in_server ? "in-server" : "left";
                  const joinedAt = row.joined_at ? new Date(row.joined_at).toLocaleString() : "-";
                  const sourceBadge = sourceKey === "invite_code_moi" ? "active" : sourceKey === "invite_cu" ? "warn" : "ghost";

                  return `
                    <tr>
                      <td>
                        <div class="invitee-cell-user">${username}</div>
                        <div class="invitee-cell-sub">${userId}</div>
                      </td>
                      <td>${membership}</td>
                      <td>
                        <span class="badge ${statusClass}">${status}</span>
                        <span class="badge ${sourceBadge}">${escapeHtml(sourceLabelMap[sourceKey] || sourceLabelMap.invite_khong_xac_dinh)}</span>
                      </td>
                      <td>${row.total_messages || 0}</td>
                      <td>${escapeHtml(joinedAt)}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  listWrap.innerHTML = `
    <div class="invite-source-sections">
      ${renderSourceTable(sourceLabelMap.invite_code_moi, "invite_code_moi", bySource.invite_code_moi)}
      ${renderSourceTable(sourceLabelMap.invite_cu, "invite_cu", bySource.invite_cu)}
      ${renderSourceTable(sourceLabelMap.invite_khong_xac_dinh, "invite_khong_xac_dinh", bySource.invite_khong_xac_dinh)}
    </div>
  `;
}

async function loadAmbassadorInvitees(ambassadorId, container) {
  try {
    const rows = await getJson(
      `/api/ambassador-invitees?ambassadorId=${encodeURIComponent(ambassadorId)}&days=0&limit=2000`
    );

    container.innerHTML = `
      <div class="invitee-controls">
        <label>
          Membership
          <select class="invitee-filter-status">
            <option value="in-server" selected>In server</option>
            <option value="left">Left</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>
          Search
          <input class="invitee-filter-search" type="search" placeholder="name or user id" />
        </label>
      </div>
      <div class="invitee-list-wrap"></div>
    `;

    const statusSelect = container.querySelector(".invitee-filter-status");
    const searchInput = container.querySelector(".invitee-filter-search");
    const listWrap = container.querySelector(".invitee-list-wrap");

    const rerender = () => {
      if (!listWrap) {
        return;
      }

      const status = statusSelect ? statusSelect.value : "all";
      const query = searchInput ? searchInput.value : "";
      renderInviteeList(listWrap, rows, status, query);
    };

    if (statusSelect) {
      statusSelect.addEventListener("change", rerender);
    }

    if (searchInput) {
      searchInput.addEventListener("input", rerender);
    }

    rerender();
    container.dataset.loaded = "1";
  } catch (error) {
    container.innerHTML = '<div class="invitee-empty">Failed to load invitees.</div>';
  }
}

function renderAmbassadorPerformance(rows, ambassadorPostsMap = new Map(), ambassadorInviteMap = new Map()) {
  const list = document.getElementById("ambassador-performance-list");

  if (!rows.length) {
    list.innerHTML = "<li>No ambassador data yet.</li>";
    return;
  }

  const countLabel = document.getElementById("ambassador-count-label");
  if (countLabel) {
    countLabel.textContent = `Showing ${rows.length} ambassadors`;
  }

  list.innerHTML = rows
    .map((row) => {
      const name = escapeHtml(row.ambassador_name || `User ${row.ambassador_id}`);
      const ambassadorId = escapeHtml(row.ambassador_id);
      const postGroup = ambassadorPostsMap.get(row.ambassador_id) || null;
      const inviteCodes = ambassadorInviteMap.get(row.ambassador_id) || [];
      const postCount = Number(postGroup ? postGroup.post_count : 0);
      const postRows = Array.isArray(postGroup?.posts) ? postGroup.posts : [];
      const regularCount = Number(row.regular_count || 0);
      const currentCount = Number(row.current_count || 0);
      const leftCount = Number(row.left_count || 0);
      const fakeCount = Number(row.fake_count || 0);
      const inviteHtml = inviteCodes.length
        ? `<div class="invitee-meta"><span>invite codes: ${inviteCodes
            .map((code) => {
              const link = `https://discord.gg/${encodeURIComponent(code)}`;
              return `<a href="${link}" target="_blank" rel="noreferrer noopener">${escapeHtml(code)}</a>`;
            })
            .join(" | ")}</span></div>`
        : '<div class="invitee-meta"><span>invite: none</span></div>';
      const breakdownHtml = `
        <div class="invitee-meta">
          <span>current: <strong>${currentCount}</strong></span>
          <span>regular: <strong>${regularCount}</strong></span>
          <span>left: <strong>${leftCount}</strong></span>
          <span>fake: <strong>${fakeCount}</strong></span>
        </div>
      `;
      const postHtml = postRows.length
        ? `
            <div class="invitee-table-wrap">
              <table class="invitee-table posts-table">
                <thead>
                  <tr>
                    <th>Posted At</th>
                    <th>Type</th>
                    <th>Content</th>
                  </tr>
                </thead>
                <tbody>
                  ${postRows
                    .map((post) => {
                      const postedAt = post.posted_at ? new Date(post.posted_at).toLocaleString() : "-";
                      const rawContent = (post.content || "").trim();
                      const preview = rawContent.length > 220 ? `${rawContent.slice(0, 220)}...` : rawContent;
                      return `
                        <tr>
                          <td>${escapeHtml(postedAt)}</td>
                          <td><span class="badge active">POST</span></td>
                          <td>${escapeHtml(preview || "(no text content)")}</td>
                        </tr>
                      `;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>
          `
        : '<div class="invitee-empty">No posts in tracked channel.</div>';

      const summaryMetrics = `
        <div class="ambassador-summary-metrics">
          <span class="metric-chip current">active_current: ${currentCount}</span>
          <span class="metric-chip joins">joins_7d_active: ${row.invited_count}</span>
          <span class="metric-chip posts">posts: ${postCount}</span>
          <span class="metric-chip regular">regular_total: ${regularCount}</span>
          <span class="metric-chip left">left: ${leftCount}</span>
          <span class="metric-chip">fake: ${fakeCount}</span>
        </div>
      `;

      return `
        <li class="ambassador-item">
          <details class="ambassador-details" data-ambassador-id="${ambassadorId}">
            <summary>
              <span>
                ${name} (${ambassadorId})
                ${summaryMetrics}
              </span>
              <strong>View details</strong>
            </summary>
            ${inviteHtml}
            ${breakdownHtml}
            <section class="ambassador-detail-block invitees-block">
              <h4>Invitees</h4>
              <div class="invitee-container invitees-container">
                <div class="invitee-loading">Loading invitees...</div>
              </div>
            </section>
            <section class="ambassador-detail-block posts-block">
              <h4>Posts</h4>
              <div class="invitee-container posts-container">
                ${postHtml}
              </div>
            </section>
          </details>
        </li>
      `;
    })
    .join("");

  const detailsNodes = list.querySelectorAll(".ambassador-details");
  detailsNodes.forEach((node) => {
    node.addEventListener("toggle", () => {
      if (!node.open) {
        return;
      }

      const ambassadorId = node.dataset.ambassadorId;
      if (!ambassadorId) {
        return;
      }

      const container = node.querySelector(".invitees-container");
      if (!container || container.dataset.loaded === "1") {
        return;
      }

      loadAmbassadorInvitees(ambassadorId, container);
    });
  });
}

async function loadDashboard() {
  try {
    const [
      summary,
      volume,
      growth,
      rankings,
      inviteRankings,
      ambassadorPerformance,
      ambassadorPosts,
      ambassadorInvites,
    ] =
      await Promise.all([
        getJson("/api/summary?days=7"),
        getJson("/api/message-volume?days=30"),
        getJson("/api/member-growth?days=30"),
        getJson("/api/channel-rankings?days=7&limit=10"),
        getJson("/api/invite-leaderboard?limit=10"),
        getJson("/api/ambassador-performance?days=7&limit=1000"),
        getJson(
          "/api/ambassador-posts?channelId=1518242290982719698&days=30&ambassadorLimit=1000&postsPerAmbassador=5"
        ),
        getJson("/api/ambassador-invites"),
      ]);

    renderSummary(summary);
    renderMessageVolume(volume);
    renderMemberGrowth(growth);
    renderChannelRanking(rankings);
    renderInviteRanking(inviteRankings);
    await loadLeaveExplorer();
    const ambassadorPostsMap = mapAmbassadorPostsById(ambassadorPosts);
    const ambassadorInviteMap = mapAmbassadorInviteById(ambassadorInvites);
    renderAmbassadorCompareChart(ambassadorPerformance, ambassadorPostsMap);
    renderAmbassadorPerformance(ambassadorPerformance, ambassadorPostsMap, ambassadorInviteMap);
    updateLastUpdated();
  } catch (error) {
    console.error(error);
  }
}

async function refreshChannelRankingLive() {
  try {
    const rankings = await getJson("/api/channel-rankings?days=7&limit=10");
    renderChannelRanking(rankings);
  } catch (error) {
    console.error(error);
  }
}

function setupInviteTrackerSyncForm() {
  const form = document.getElementById("invite-tracker-sync-form");
  const ambassadorIdInput = document.getElementById("sync-ambassador-id");
  const inviteTextInput = document.getElementById("sync-invite-text");
  const submitBtn = document.getElementById("sync-submit");
  const statusEl = document.getElementById("sync-status");

  if (!form || !ambassadorIdInput || !inviteTextInput || !submitBtn || !statusEl) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const ambassadorId = ambassadorIdInput.value.trim();
    const text = inviteTextInput.value.trim();

    if (!ambassadorId || !text) {
      statusEl.textContent = "Ambassador ID và Invite Tracker text là bắt buộc.";
      statusEl.classList.remove("ok");
      statusEl.classList.add("error");
      return;
    }

    submitBtn.disabled = true;
    statusEl.textContent = "Syncing...";
    statusEl.classList.remove("ok", "error");

    try {
      const result = await postJson("/api/invite-tracker-sync", { ambassadorId, text });
      statusEl.textContent = `Synced ${result.ambassador_id}: current ${result.current_count}, regular ${result.regular_count}, left ${result.left_count}, fake ${result.fake_count}, bonus ${result.bonus_count}.`;
      statusEl.classList.remove("error");
      statusEl.classList.add("ok");
      await loadDashboard();
    } catch (error) {
      statusEl.textContent = `Sync failed: ${error.message}`;
      statusEl.classList.remove("ok");
      statusEl.classList.add("error");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function init() {
  setupInviteTrackerSyncForm();
  setupLeaveExplorerControls();
  await loadDashboard();
  setInterval(loadDashboard, FULL_REFRESH_MS);
  setInterval(refreshChannelRankingLive, CHANNEL_RANKING_REFRESH_MS);
}

init();
