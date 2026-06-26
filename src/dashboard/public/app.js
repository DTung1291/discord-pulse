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

function renderChannelRanking(rows) {
  const list = document.getElementById("channel-ranking-list");

  if (!rows.length) {
    list.innerHTML = "<li>No data yet.</li>";
    return;
  }

  list.innerHTML = rows
    .map((row) => `<li>#${row.channel_id} - ${row.count} messages</li>`)
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
      map.set(invite.ambassador_id, invite.code);
    }
  }
  return map;
}

function buildAmbassadorCompareRows(rows, ambassadorPostsMap = new Map()) {
  const normalized = (rows || []).map((row) => {
    const postGroup = ambassadorPostsMap.get(row.ambassador_id) || null;
    const posts = Number(postGroup ? postGroup.post_count : 0);
    const joins = Number(row.invited_count || 0);
    const joinsPerPost = posts > 0 ? Number((joins / posts).toFixed(2)) : 0;
    return {
      id: row.ambassador_id,
      name: row.ambassador_name || `User ${row.ambassador_id}`,
      joins,
      posts,
      joinsPerPost,
    };
  });

  return normalized.sort((a, b) => b.joins - a.joins);
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
          label: "Joins (7d)",
          data: dataRows.map((row) => row.joins),
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
          label: "Joins/Post",
          data: dataRows.map((row) => row.joinsPerPost),
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
          title: { display: true, text: "Joins/Post", color: "#a5b1ca" },
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
    const isActive = Number(row.total_messages || 0) > 0;
    const status = isActive ? "active" : "ghost";

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

  listWrap.innerHTML = `
    <ul class="invitee-list">
      ${filteredRows
        .map((row) => {
          const username = escapeHtml(row.username || row.user_id);
          const userId = escapeHtml(row.user_id);
          const status = Number(row.total_messages || 0) > 0 ? "ACTIVE" : "GHOST";
          const statusClass = status === "ACTIVE" ? "active" : "ghost";
          const membership = row.still_in_server ? "in-server" : "left";
          const joinedAt = row.joined_at ? new Date(row.joined_at).toLocaleString() : "-";
          return `
            <li>
              <div class="invitee-header">
                <span>${username} (${userId})</span>
                <span class="badge ${statusClass}">${status}</span>
              </div>
              <div class="invitee-meta">
                <span>${membership}</span>
                <span>messages: ${row.total_messages || 0}</span>
                <span>joined: ${escapeHtml(joinedAt)}</span>
              </div>
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

async function loadAmbassadorInvitees(ambassadorId, container) {
  try {
    const rows = await getJson(
      `/api/ambassador-invitees?ambassadorId=${encodeURIComponent(ambassadorId)}&days=90&limit=30`
    );

    container.innerHTML = `
      <div class="invitee-controls">
        <label>
          Status
          <select class="invitee-filter-status">
            <option value="all">All</option>
            <option value="ghost">Ghost</option>
            <option value="active">Active</option>
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
      const inviteCode = ambassadorInviteMap.get(row.ambassador_id);
      const inviteLink = inviteCode ? `https://discord.gg/${encodeURIComponent(inviteCode)}` : null;
      const postCount = Number(postGroup ? postGroup.post_count : 0);
      const postRows = Array.isArray(postGroup?.posts) ? postGroup.posts : [];
      const regularCount = Number(row.regular_count || 0);
      const currentCount = Number(row.current_count || 0);
      const leftCount = Number(row.left_count || 0);
      const fakeCount = Number(row.fake_count || 0);
      const bonusCount = Number(row.bonus_count || 0);
      const unattributedCount = Number(row.unattributed_count || 0);
      const inviteHtml = inviteLink
        ? `<div class="invitee-meta"><span>invite: <a href="${inviteLink}" target="_blank" rel="noreferrer noopener">${escapeHtml(inviteCode)}</a></span></div>`
        : '<div class="invitee-meta"><span>invite: none</span></div>';
      const breakdownHtml = `
        <div class="invitee-meta">
          <span>current: <strong>${currentCount}</strong></span>
          <span>regular: <strong>${regularCount}</strong></span>
          <span>left: <strong>${leftCount}</strong></span>
          <span>fake: <strong>${fakeCount}</strong></span>
          <span>bonus: <strong>${bonusCount}</strong></span>
          ${
            unattributedCount > 0
              ? `<span class="breakdown-note">unattributed: ${unattributedCount}</span>`
              : ""
          }
        </div>
      `;
      const postHtml = postRows.length
        ? `
            <ul class="invitee-list">
              ${postRows
                .map((post) => {
                  const postedAt = post.posted_at ? new Date(post.posted_at).toLocaleString() : "-";
                  const rawContent = (post.content || "").trim();
                  const preview = rawContent.length > 180 ? `${rawContent.slice(0, 180)}...` : rawContent;
                  return `
                    <li>
                      <div class="invitee-header">
                        <span>${escapeHtml(postedAt)}</span>
                        <span class="badge active">POST</span>
                      </div>
                      <div class="invitee-meta">
                        <span>${escapeHtml(preview || "(no text content)")}</span>
                      </div>
                    </li>
                  `;
                })
                .join("")}
            </ul>
          `
        : '<div class="invitee-empty">No posts in tracked channel.</div>';

      const summaryMetrics = `
        <div class="ambassador-summary-metrics">
          <span class="metric-chip joins">joins: ${row.invited_count}</span>
          <span class="metric-chip posts">posts: ${postCount}</span>
          <span class="metric-chip current">current: ${currentCount}</span>
          <span class="metric-chip regular">regular: ${regularCount}</span>
          <span class="metric-chip left">left: ${leftCount}</span>
          <span class="metric-chip">fake: ${fakeCount}</span>
          <span class="metric-chip">bonus: ${bonusCount}</span>
          ${
            unattributedCount > 0
              ? `<span class="metric-chip unattributed">unattributed: ${unattributedCount}</span>`
              : ""
          }
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
            <div class="invitee-container">
              <div class="invitee-loading">Loading invitees...</div>
            </div>
            <div class="invitee-container">
              ${postHtml}
            </div>
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

      const container = node.querySelector(".invitee-container");
      if (!container || container.dataset.loaded === "1") {
        return;
      }

      loadAmbassadorInvitees(ambassadorId, container);
    });
  });
}

async function loadDashboard() {
  try {
    const [summary, volume, growth, rankings, inviteRankings, ambassadorPerformance, ambassadorPosts, ambassadorInvites] =
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
  await loadDashboard();
  setInterval(loadDashboard, FULL_REFRESH_MS);
  setInterval(refreshChannelRankingLive, CHANNEL_RANKING_REFRESH_MS);
}

init();
