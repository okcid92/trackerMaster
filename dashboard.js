const state = {
  snapshot: null,
  allDayKeys: [],
  spanDayKeys: [],
  siteStats: [],
  selectedSite: null,
  dayFilter: null,
  search: "",
};

function dayKeyToDate(dayKey) {
  return new Date(`${dayKey}T00:00:00`);
}

function dateToDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDay(dayKey) {
  return dayKeyToDate(dayKey).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDuration(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function faviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

function sortDayKeys(dayKeys) {
  return [...dayKeys].sort();
}

function daySequence(startKey, endKey) {
  const result = [];
  let cursor = dayKeyToDate(startKey);
  const endTs = dayKeyToDate(endKey).getTime();

  while (cursor.getTime() <= endTs) {
    result.push(dateToDayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

function getSiteAggregates(snapshot) {
  const totalsByDay = snapshot.totalsByDay || {};
  const dayKeys = sortDayKeys(Object.keys(totalsByDay));
  const first = dayKeys[0] || snapshot.todayKey;
  const last = snapshot.todayKey;
  const spanDayKeys = daySequence(first, last);
  const spanDays = spanDayKeys.length;

  const bySite = {};
  const dayTotals = {};

  spanDayKeys.forEach((dayKey) => {
    dayTotals[dayKey] = 0;
  });

  for (const dayKey of spanDayKeys) {
    const domains = totalsByDay[dayKey] || {};
    for (const [domain, seconds] of Object.entries(domains)) {
      if (!bySite[domain]) {
        bySite[domain] = {
          domain,
          totalSeconds: 0,
          activeDays: 0,
          firstDay: dayKey,
          lastDay: dayKey,
          bestDay: dayKey,
          bestDaySeconds: 0,
          perDay: {},
        };
      }

      const site = bySite[domain];
      site.totalSeconds += seconds;
      site.perDay[dayKey] = seconds;

      if (seconds > 0) {
        site.activeDays += 1;
        if (dayKey < site.firstDay) {
          site.firstDay = dayKey;
        }
        if (dayKey > site.lastDay) {
          site.lastDay = dayKey;
        }
      }

      if (seconds > site.bestDaySeconds) {
        site.bestDay = dayKey;
        site.bestDaySeconds = seconds;
      }

      dayTotals[dayKey] += seconds;
    }
  }

  const siteStats = Object.values(bySite)
    .map((site) => ({
      ...site,
      averagePerSpanDay: Math.floor(site.totalSeconds / Math.max(1, spanDays)),
      averagePerActiveDay:
        site.activeDays > 0
          ? Math.floor(site.totalSeconds / site.activeDays)
          : 0,
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);

  return {
    siteStats,
    dayTotals,
    spanDayKeys,
  };
}

function renderKpis(siteStats, dayTotals, spanDayKeys) {
  const totalSeconds = siteStats.reduce(
    (acc, site) => acc + site.totalSeconds,
    0,
  );
  const activeDays = spanDayKeys.filter(
    (day) => (dayTotals[day] || 0) > 0,
  ).length;
  const topSite = siteStats[0] || null;

  const dayEntries = Object.entries(dayTotals).sort((a, b) => b[1] - a[1]);
  const bestDay = dayEntries[0] || [spanDayKeys[spanDayKeys.length - 1], 0];

  const kpis = [
    { label: "Temps total", value: formatDuration(totalSeconds) },
    { label: "Sites suivis", value: String(siteStats.length) },
    { label: "Jours actifs", value: String(activeDays) },
    {
      label: "Moyenne / jour",
      value: formatDuration(
        Math.floor(totalSeconds / Math.max(1, spanDayKeys.length)),
      ),
    },
    {
      label: "Top site",
      value: topSite ? topSite.domain : "-",
    },
    {
      label: "Jour record",
      value: `${formatDay(bestDay[0])} (${formatDuration(bestDay[1])})`,
    },
  ];

  const wrapper = document.getElementById("kpis");
  wrapper.innerHTML = "";

  kpis.forEach((item) => {
    const block = document.createElement("div");
    block.className = "kpi";
    block.innerHTML = `<div class="label">${item.label}</div><div class="value">${item.value}</div>`;
    wrapper.appendChild(block);
  });
}

function renderPeriodLabel(spanDayKeys) {
  const label = document.getElementById("periodLabel");
  const start = spanDayKeys[0];
  const end = spanDayKeys[spanDayKeys.length - 1];
  label.textContent = `Periode: ${formatDay(start)} -> ${formatDay(end)} (${spanDayKeys.length} jours)`;
}

function renderDaySelect(spanDayKeys) {
  const select = document.getElementById("daySelect");
  const previousValue = state.dayFilter;
  select.innerHTML = "";

  [...spanDayKeys].reverse().forEach((dayKey) => {
    const option = document.createElement("option");
    option.value = dayKey;
    option.textContent = formatDay(dayKey);
    select.appendChild(option);
  });

  if (previousValue && spanDayKeys.includes(previousValue)) {
    select.value = previousValue;
    state.dayFilter = previousValue;
  } else {
    state.dayFilter = spanDayKeys[spanDayKeys.length - 1];
    select.value = state.dayFilter;
  }
}

function renderSiteRows(siteStats) {
  const tbody = document.getElementById("siteRows");
  tbody.innerHTML = "";

  const filtered = siteStats.filter((site) =>
    site.domain.toLowerCase().includes(state.search.toLowerCase()),
  );

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Aucun site</td></tr>`;
    return;
  }

  if (
    !state.selectedSite ||
    !filtered.some((site) => site.domain === state.selectedSite)
  ) {
    state.selectedSite = filtered[0].domain;
  }

  filtered.forEach((site) => {
    const tr = document.createElement("tr");
    if (site.domain === state.selectedSite) {
      tr.classList.add("row-selected");
    }

    const favicon = `<img class="favicon" src="${faviconUrl(site.domain)}" alt="" />`;

    tr.innerHTML = `
      <td>
        <button class="row-btn" data-site="${site.domain}">
          <span class="site-cell">${favicon}<span>${site.domain}</span></span>
        </button>
      </td>
      <td>${formatDuration(site.totalSeconds)}</td>
      <td>${site.activeDays}</td>
      <td>${formatDuration(site.averagePerSpanDay)}</td>
      <td>${formatDay(site.bestDay)} (${formatDuration(site.bestDaySeconds)})</td>
    `;

    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".row-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedSite = btn.dataset.site;
      renderSiteRows(siteStats);
      renderSiteDetail();
    });
  });
}

function renderSiteDetail() {
  const wrapper = document.getElementById("siteDetail");
  const site = state.siteStats.find(
    (entry) => entry.domain === state.selectedSite,
  );

  if (!site) {
    wrapper.innerHTML = `<p class="empty">Selectionne un site</p>`;
    return;
  }

  const max = Math.max(
    1,
    ...state.spanDayKeys.map((dayKey) => Number(site.perDay[dayKey] || 0)),
  );

  const rows = state.spanDayKeys
    .map((dayKey) => {
      const seconds = Number(site.perDay[dayKey] || 0);
      const width = Math.round((seconds / max) * 100);
      return `
        <div class="spark-row">
          <span>${formatDay(dayKey)}</span>
          <div class="spark-bar"><div class="spark-fill" style="width:${width}%"></div></div>
          <strong>${formatDuration(seconds)}</strong>
        </div>
      `;
    })
    .join("");

  wrapper.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="s-label">Site</div><div class="s-value">${site.domain}</div></div>
      <div class="stat-card"><div class="s-label">Temps total</div><div class="s-value">${formatDuration(site.totalSeconds)}</div></div>
      <div class="stat-card"><div class="s-label">Jours actifs</div><div class="s-value">${site.activeDays}</div></div>
      <div class="stat-card"><div class="s-label">Moyenne / jour actif</div><div class="s-value">${formatDuration(site.averagePerActiveDay)}</div></div>
      <div class="stat-card"><div class="s-label">Premier jour</div><div class="s-value">${formatDay(site.firstDay)}</div></div>
      <div class="stat-card"><div class="s-label">Dernier jour</div><div class="s-value">${formatDay(site.lastDay)}</div></div>
    </div>
    <div class="spark">${rows}</div>
  `;
}

function renderDayDetail() {
  const tbody = document.getElementById("dayRows");
  tbody.innerHTML = "";

  const dayKey = state.dayFilter;
  const daySites = state.siteStats
    .map((site) => ({
      domain: site.domain,
      seconds: Number(site.perDay[dayKey] || 0),
    }))
    .filter((row) => row.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

  const total = daySites.reduce((sum, row) => sum + row.seconds, 0);

  if (!daySites.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty">Aucune activite ce jour</td></tr>`;
    return;
  }

  daySites.forEach((row) => {
    const tr = document.createElement("tr");
    const share =
      total > 0 ? `${((row.seconds / total) * 100).toFixed(2)}%` : "0.00%";
    tr.innerHTML = `
      <td><span class="site-cell"><img class="favicon" src="${faviconUrl(row.domain)}" alt="" /><span>${row.domain}</span></span></td>
      <td>${formatDuration(row.seconds)}</td>
      <td>${share}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderTopDays(dayTotals) {
  const tbody = document.getElementById("topDayRows");
  tbody.innerHTML = "";

  const rows = Object.entries(dayTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  rows.forEach(([dayKey, seconds]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${formatDay(dayKey)}</td><td>${formatDuration(seconds)}</td>`;
    tbody.appendChild(tr);
  });
}

function heatColor(value, max) {
  if (value <= 0 || max <= 0) {
    return "hsl(150 18% 94%)";
  }

  const ratio = value / max;
  const lightness = 95 - ratio * 55;
  return `hsl(164 75% ${lightness}%)`;
}

function renderHeatmap() {
  const container = document.getElementById("heatmap");
  container.innerHTML = "";

  const windowDays = Number(
    document.getElementById("heatmapWindow").value || 30,
  );
  const daySlice = state.spanDayKeys.slice(-windowDays);
  const topSites = state.siteStats.slice(0, 12);

  if (!daySlice.length || !topSites.length) {
    container.innerHTML = `<p class="empty">Pas assez de donnees pour la matrice</p>`;
    return;
  }

  let maxCell = 0;
  topSites.forEach((site) => {
    daySlice.forEach((dayKey) => {
      maxCell = Math.max(maxCell, Number(site.perDay[dayKey] || 0));
    });
  });

  const table = document.createElement("table");
  table.className = "hm-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.innerHTML = `<th class="hm-site">Site</th>`;
  daySlice.forEach((dayKey) => {
    const th = document.createElement("th");
    th.textContent = dayKey.slice(5);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  topSites.forEach((site) => {
    const tr = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.className = "hm-site";
    nameCell.innerHTML = `<span class="site-cell"><img class="favicon" src="${faviconUrl(site.domain)}" alt="" /><span>${site.domain}</span></span>`;
    tr.appendChild(nameCell);

    daySlice.forEach((dayKey) => {
      const seconds = Number(site.perDay[dayKey] || 0);
      const td = document.createElement("td");
      const chip = document.createElement("span");
      chip.className = "hm-cell";
      chip.style.background = heatColor(seconds, maxCell);
      chip.title = `${site.domain} | ${formatDay(dayKey)} | ${formatDuration(seconds)}`;
      td.appendChild(chip);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  container.appendChild(table);
}

async function fetchSnapshot() {
  const response = await chrome.runtime.sendMessage({ type: "getSnapshot" });
  if (!response?.ok) {
    throw new Error(response?.error || "Impossible de charger les donnees");
  }
  state.snapshot = response.snapshot;
}

function recomputeAndRender() {
  const { siteStats, dayTotals, spanDayKeys } = getSiteAggregates(
    state.snapshot,
  );

  state.siteStats = siteStats;
  state.spanDayKeys = spanDayKeys;

  renderPeriodLabel(spanDayKeys);
  renderKpis(siteStats, dayTotals, spanDayKeys);
  renderDaySelect(spanDayKeys);
  renderSiteRows(siteStats);
  renderSiteDetail();
  renderDayDetail();
  renderTopDays(dayTotals);
  renderHeatmap();
}

async function refreshDashboard() {
  await fetchSnapshot();
  recomputeAndRender();
}

function bindEvents() {
  document.getElementById("refreshBtn").addEventListener("click", async () => {
    await refreshDashboard();
  });

  document.getElementById("siteSearch").addEventListener("input", (event) => {
    state.search = event.target.value || "";
    renderSiteRows(state.siteStats);
    renderSiteDetail();
  });

  document.getElementById("daySelect").addEventListener("change", (event) => {
    state.dayFilter = event.target.value;
    renderDayDetail();
  });

  document.getElementById("heatmapWindow").addEventListener("change", () => {
    renderHeatmap();
  });
}

async function init() {
  bindEvents();
  await refreshDashboard();

  setInterval(() => {
    refreshDashboard().catch(() => {});
  }, 30000);
}

init().catch((error) => {
  console.error("dashboard:init:error", error);
});
