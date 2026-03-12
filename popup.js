const RANGE_DAY = "day";
const RANGE_AVERAGE = "average";
const RANGE_ALLTIME = "alltime";

let state = {
  snapshot: null,
  selectedRange: RANGE_DAY,
  selectedDayKey: null,
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

function formatDayLabel(dayKey) {
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

function toPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function getSortedDayKeys(totalsByDay) {
  return Object.keys(totalsByDay).sort();
}

function getDaysSpan(dayKeys, fallbackDay) {
  if (!dayKeys.length) {
    return {
      start: fallbackDay,
      end: fallbackDay,
      count: 1,
    };
  }

  const start = dayKeys[0];
  const end = dayKeys[dayKeys.length - 1];
  const days = Math.max(
    1,
    Math.floor((dayKeyToDate(end).getTime() - dayKeyToDate(start).getTime()) / 86400000) + 1
  );

  return { start, end, count: days };
}

function collectRangeData(snapshot, selectedRange, selectedDayKey) {
  const totalsByDay = snapshot.totalsByDay || {};
  const dayKeys = getSortedDayKeys(totalsByDay);
  const span = getDaysSpan(dayKeys, snapshot.todayKey);

  let domainSeconds = {};
  let totalSeconds = 0;
  let label = "";
  let subtitle = "";

  if (selectedRange === RANGE_DAY) {
    const dayTotals = totalsByDay[selectedDayKey] || {};
    domainSeconds = { ...dayTotals };
    totalSeconds = Object.values(dayTotals).reduce((a, b) => a + b, 0);
    label = "Jour";
    subtitle = `Distribution du ${formatDayLabel(selectedDayKey)}`;
  }

  if (selectedRange === RANGE_ALLTIME) {
    for (const dayKey of dayKeys) {
      const dayTotals = totalsByDay[dayKey] || {};
      for (const [domain, seconds] of Object.entries(dayTotals)) {
        domainSeconds[domain] = (domainSeconds[domain] || 0) + seconds;
        totalSeconds += seconds;
      }
    }

    label = "All-time";
    subtitle = `Depuis le ${formatDayLabel(span.start)}`;
  }

  if (selectedRange === RANGE_AVERAGE) {
    const aggregate = {};
    for (const dayKey of dayKeys) {
      const dayTotals = totalsByDay[dayKey] || {};
      for (const [domain, seconds] of Object.entries(dayTotals)) {
        aggregate[domain] = (aggregate[domain] || 0) + seconds;
      }
    }

    for (const [domain, seconds] of Object.entries(aggregate)) {
      domainSeconds[domain] = Math.floor(seconds / span.count);
      totalSeconds += domainSeconds[domain];
    }

    label = "Moyenne";
    subtitle = `Moyenne journaliere depuis le ${formatDayLabel(span.start)}`;
  }

  const domains = Object.entries(domainSeconds)
    .map(([name, seconds]) => ({
      name,
      seconds,
      share: totalSeconds > 0 ? seconds / totalSeconds : 0,
    }))
    .sort((a, b) => b.seconds - a.seconds);

  return {
    domains,
    totalSeconds,
    label,
    subtitle,
  };
}

function paletteColor(index) {
  const hues = [156, 26, 205, 338, 48, 188, 271, 120, 12];
  const hue = hues[index % hues.length];
  return `hsl(${hue} 78% 46%)`;
}

function buildConicGradient(domains) {
  if (!domains.length) {
    return "conic-gradient(#cbd5e1 0turn, #cbd5e1 1turn)";
  }

  let cursor = 0;
  const parts = [];

  domains.forEach((domain, index) => {
    const start = cursor;
    cursor += domain.share;
    const end = cursor;
    const color = paletteColor(index);
    domain.color = color;
    parts.push(`${color} ${start}turn ${end}turn`);
  });

  if (cursor < 1) {
    parts.push(`#e2e8f0 ${cursor}turn 1turn`);
  }

  return `conic-gradient(${parts.join(",")})`;
}

function renderTable(domains) {
  const tbody = document.getElementById("rows");
  tbody.innerHTML = "";

  if (!domains.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.className = "empty";
    td.textContent = "Aucune donnee pour cette periode";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  domains.forEach((domain) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    const wrap = document.createElement("span");
    wrap.className = "domain-name";
    const dot = document.createElement("span");
    dot.className = "domain-dot";
    dot.style.background = domain.color;
    const label = document.createElement("span");
    label.textContent = domain.name;
    wrap.append(dot, label);
    nameTd.appendChild(wrap);

    const pctTd = document.createElement("td");
    pctTd.textContent = toPercent(domain.share);

    const timeTd = document.createElement("td");
    timeTd.textContent = formatDuration(domain.seconds);

    tr.append(nameTd, pctTd, timeTd);
    tbody.appendChild(tr);
  });
}

function renderLive(snapshot) {
  const liveSite = document.getElementById("liveSite");
  const liveTime = document.getElementById("liveTime");

  if (!snapshot.active) {
    liveSite.textContent = "Aucun site actif";
    liveTime.textContent = "00:00:00";
    return;
  }

  liveSite.textContent = snapshot.active.domain;
  liveTime.textContent = formatDuration(
    Math.max(0, Math.floor((snapshot.nowTs - snapshot.active.startedAt) / 1000))
  );
}

function renderDayNavigation(snapshot) {
  const dayNav = document.getElementById("dayNav");
  dayNav.style.display = state.selectedRange === RANGE_DAY ? "flex" : "none";

  if (state.selectedRange !== RANGE_DAY) {
    return;
  }

  const allKeys = getSortedDayKeys(snapshot.totalsByDay || {});
  const currentDay = state.selectedDayKey || snapshot.todayKey;
  document.getElementById("currentDay").textContent = formatDayLabel(currentDay);

  const idx = allKeys.indexOf(currentDay);
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < allKeys.length - 1;

  document.getElementById("prevDay").disabled = !hasPrev;
  document.getElementById("nextDay").disabled = !hasNext;
}

function renderRange(snapshot) {
  const rangeData = collectRangeData(snapshot, state.selectedRange, state.selectedDayKey);
  const ring = document.getElementById("ringChart");

  ring.style.background = buildConicGradient(rangeData.domains);
  document.getElementById("ringLabel").textContent = rangeData.label;
  document.getElementById("rangeTotal").textContent = formatDuration(rangeData.totalSeconds);
  document.getElementById("rangeSubtitle").textContent = rangeData.subtitle;

  renderTable(rangeData.domains);
}

function renderTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.range === state.selectedRange);
  });
}

function renderSettings(snapshot) {
  const idleInput = document.getElementById("idleSeconds");
  const idleValue = document.getElementById("idleSecondsValue");
  const showBadge = document.getElementById("showBadge");

  idleInput.value = String(snapshot.settings.idleSeconds);
  idleValue.textContent = String(snapshot.settings.idleSeconds);
  showBadge.checked = Boolean(snapshot.settings.showBadge);
}

async function fetchSnapshot() {
  const response = await chrome.runtime.sendMessage({ type: "getSnapshot" });
  if (!response?.ok) {
    throw new Error(response?.error || "Unable to load snapshot");
  }

  state.snapshot = response.snapshot;

  if (!state.selectedDayKey) {
    state.selectedDayKey = response.snapshot.todayKey;
  }

  // If selected day is missing after clear/reset, fall back to today.
  if (!response.snapshot.totalsByDay[state.selectedDayKey]) {
    state.selectedDayKey = response.snapshot.todayKey;
  }
}

async function refreshUI() {
  await fetchSnapshot();
  renderTabs();
  renderLive(state.snapshot);
  renderDayNavigation(state.snapshot);
  renderRange(state.snapshot);
  renderSettings(state.snapshot);
}

function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildCsv(totalsByDay) {
  const dayKeys = getSortedDayKeys(totalsByDay);
  const domainSet = new Set();

  for (const dayKey of dayKeys) {
    for (const domain of Object.keys(totalsByDay[dayKey] || {})) {
      domainSet.add(domain);
    }
  }

  const domains = Array.from(domainSet).sort();
  const rows = ["domain," + dayKeys.join(",")];

  domains.forEach((domain) => {
    const line = [domain];
    dayKeys.forEach((day) => {
      line.push(String((totalsByDay[day] || {})[domain] || 0));
    });
    rows.push(line.join(","));
  });

  return rows.join("\n");
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      state.selectedRange = tab.dataset.range;
      await refreshUI();
    });
  });

  document.getElementById("prevDay").addEventListener("click", async () => {
    const keys = getSortedDayKeys(state.snapshot.totalsByDay || {});
    const idx = keys.indexOf(state.selectedDayKey);
    if (idx > 0) {
      state.selectedDayKey = keys[idx - 1];
      await refreshUI();
    }
  });

  document.getElementById("nextDay").addEventListener("click", async () => {
    const keys = getSortedDayKeys(state.snapshot.totalsByDay || {});
    const idx = keys.indexOf(state.selectedDayKey);
    if (idx >= 0 && idx < keys.length - 1) {
      state.selectedDayKey = keys[idx + 1];
      await refreshUI();
    }
  });

  const idleInput = document.getElementById("idleSeconds");
  const idleValue = document.getElementById("idleSecondsValue");
  idleInput.addEventListener("input", () => {
    idleValue.textContent = idleInput.value;
  });

  idleInput.addEventListener("change", async () => {
    await chrome.runtime.sendMessage({
      type: "setSettings",
      payload: { idleSeconds: Number(idleInput.value) },
    });
    await refreshUI();
  });

  document.getElementById("showBadge").addEventListener("change", async (event) => {
    await chrome.runtime.sendMessage({
      type: "setSettings",
      payload: { showBadge: Boolean(event.target.checked) },
    });
    await refreshUI();
  });

  document.getElementById("exportCsv").addEventListener("click", () => {
    const csv = buildCsv(state.snapshot.totalsByDay || {});
    const day = state.snapshot.todayKey;
    downloadCsv(`web-focus-tracker-${day}.csv`, csv);
  });

  document.getElementById("clearAll").addEventListener("click", async () => {
    const confirmed = confirm("Supprimer toutes les donnees de tracking ?");
    if (!confirmed) {
      return;
    }

    await chrome.runtime.sendMessage({ type: "clearAllData" });
    state.selectedDayKey = null;
    await refreshUI();
  });
}

async function init() {
  bindEvents();
  await refreshUI();

  // Keep live timer and chart data fresh while popup is open.
  setInterval(() => {
    refreshUI().catch(() => {});
  }, 1000);
}

init().catch((error) => {
  console.error("popup:init:error", error);
});
