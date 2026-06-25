async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
}

function renderSummary(summary) {
  const container = document.getElementById("summary-cards");
  const items = [
    { label: "Messages (7d)", value: summary.messages || 0 },
    { label: "Joins (7d)", value: summary.joins || 0 },
    { label: "Leaves (7d)", value: summary.leaves || 0 },
    { label: "Active Members", value: summary.active_members || 0 },
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

  new Chart(ctx, {
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

  new Chart(ctx, {
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

async function init() {
  try {
    const [summary, volume, growth, rankings] = await Promise.all([
      getJson("/api/summary?days=7"),
      getJson("/api/message-volume?days=30"),
      getJson("/api/member-growth?days=30"),
      getJson("/api/channel-rankings?days=7&limit=10"),
    ]);

    renderSummary(summary);
    renderMessageVolume(volume);
    renderMemberGrowth(growth);
    renderChannelRanking(rankings);
  } catch (error) {
    console.error(error);
  }
}

init();
