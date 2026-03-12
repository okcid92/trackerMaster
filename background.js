const ACTIVE_SESSION_KEY = "activeSession";
const TOTALS_BY_DAY_KEY = "totalsByDay";
const SETTINGS_KEY = "trackerSettings";
const HEARTBEAT_ALARM = "heartbeat";

const DEFAULT_SETTINGS = {
  idleSeconds: 60,
  showBadge: true,
};

let idleState = "active";

function isTrackableUrl(url) {
  return (
    typeof url === "string" &&
    (url.startsWith("http://") || url.startsWith("https://"))
  );
}

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch (_) {
    return null;
  }
}

function getDayKeyFromTs(ts) {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayKey() {
  return getDayKeyFromTs(Date.now());
}

function nextMidnightTs(ts) {
  const d = new Date(ts);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

function badgeTextFromSeconds(seconds) {
  if (!seconds || seconds <= 0) {
    return "";
  }

  if (seconds < 3600) {
    return `${Math.max(1, Math.floor(seconds / 60))}m`;
  }

  return `${Math.floor(seconds / 3600)}h`;
}

async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(data[SETTINGS_KEY] || {}),
  };
}

async function saveSettings(partialSettings) {
  const current = await getSettings();
  const next = {
    ...current,
    ...partialSettings,
  };

  if (typeof next.idleSeconds !== "number" || Number.isNaN(next.idleSeconds)) {
    next.idleSeconds = DEFAULT_SETTINGS.idleSeconds;
  }
  next.idleSeconds = Math.max(30, Math.min(1800, Math.floor(next.idleSeconds)));
  next.showBadge = Boolean(next.showBadge);

  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  chrome.idle.setDetectionInterval(next.idleSeconds);

  return next;
}

async function getActiveSession() {
  const data = await chrome.storage.local.get(ACTIVE_SESSION_KEY);
  return data[ACTIVE_SESSION_KEY] || null;
}

async function setActiveSession(session) {
  await chrome.storage.local.set({ [ACTIVE_SESSION_KEY]: session });
}

async function clearActiveSession() {
  await chrome.storage.local.remove(ACTIVE_SESSION_KEY);
}

async function getTotalsByDay() {
  const data = await chrome.storage.local.get(TOTALS_BY_DAY_KEY);
  return data[TOTALS_BY_DAY_KEY] || {};
}

async function setTotalsByDay(totalsByDay) {
  await chrome.storage.local.set({ [TOTALS_BY_DAY_KEY]: totalsByDay });
}

function sanitizeTotalsByDay(candidate) {
  const sanitized = {};
  if (!candidate || typeof candidate !== "object") {
    return sanitized;
  }

  for (const [dayKey, domains] of Object.entries(candidate)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
      continue;
    }

    if (!domains || typeof domains !== "object") {
      continue;
    }

    for (const [domain, rawSeconds] of Object.entries(domains)) {
      if (!domain || typeof domain !== "string") {
        continue;
      }

      const seconds = Math.max(0, Math.floor(Number(rawSeconds) || 0));
      if (seconds <= 0) {
        continue;
      }

      if (!sanitized[dayKey]) {
        sanitized[dayKey] = {};
      }

      sanitized[dayKey][domain] = seconds;
    }
  }

  return sanitized;
}

function mergeTotalsByDay(base, incoming) {
  const merged = { ...(base || {}) };

  for (const [dayKey, domains] of Object.entries(incoming || {})) {
    if (!merged[dayKey]) {
      merged[dayKey] = {};
    }

    for (const [domain, seconds] of Object.entries(domains)) {
      const current = merged[dayKey][domain] || 0;
      merged[dayKey][domain] = current + seconds;
    }
  }

  return merged;
}

function addSecondsInPlace(totalsByDay, dayKey, domain, seconds) {
  if (!totalsByDay[dayKey]) {
    totalsByDay[dayKey] = {};
  }

  const current = totalsByDay[dayKey][domain] || 0;
  totalsByDay[dayKey][domain] = current + seconds;
}

async function addSessionDuration(domain, startTs, endTs) {
  if (!domain || endTs <= startTs) {
    return;
  }

  const totalsByDay = await getTotalsByDay();
  let cursor = startTs;

  // Split sessions by day so late-night browsing is assigned to the correct date.
  while (cursor < endTs) {
    const chunkEnd = Math.min(nextMidnightTs(cursor), endTs);
    const seconds = Math.floor((chunkEnd - cursor) / 1000);

    if (seconds > 0) {
      addSecondsInPlace(totalsByDay, getDayKeyFromTs(cursor), domain, seconds);
    }

    cursor = chunkEnd;
  }

  await setTotalsByDay(totalsByDay);
}

async function closeCurrentSession(reason) {
  const active = await getActiveSession();
  if (!active) {
    return;
  }

  const endTs = Date.now();
  await addSessionDuration(active.domain, active.startedAt, endTs);
  await clearActiveSession();

  await refreshBadgeForCurrentTab();
  console.debug("session:closed", reason, active.domain);
}

async function openSessionFromTab(tab) {
  if (!tab || !isTrackableUrl(tab.url)) {
    await closeCurrentSession("non-trackable-tab");
    return;
  }

  const domain = extractDomain(tab.url);
  if (!domain) {
    await closeCurrentSession("no-domain");
    return;
  }

  const active = await getActiveSession();
  if (active && active.domain === domain && active.tabId === tab.id) {
    return;
  }

  await closeCurrentSession("switch-tab");

  await setActiveSession({
    tabId: tab.id,
    domain,
    startedAt: Date.now(),
  });

  await refreshBadgeForCurrentTab();
}

async function syncWithCurrentActiveTab() {
  if (idleState === "idle" || idleState === "locked") {
    await closeCurrentSession("idle");
    return;
  }

  const windows = await chrome.windows.getAll({ populate: false });
  const hasFocusedWindow = windows.some((w) => w.focused);

  if (!hasFocusedWindow) {
    await closeCurrentSession("window-unfocused");
    return;
  }

  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const activeTab = tabs[0];

  if (!activeTab) {
    await closeCurrentSession("no-active-tab");
    return;
  }

  await openSessionFromTab(activeTab);
}

async function getTodaySecondsForDomain(domain) {
  const totalsByDay = await getTotalsByDay();
  const today = totalsByDay[getTodayKey()] || {};
  return today[domain] || 0;
}

async function refreshBadgeForCurrentTab() {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const tab = tabs[0];

  if (!tab || typeof tab.id !== "number") {
    return;
  }

  if (!settings.showBadge) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    return;
  }

  const active = await getActiveSession();
  if (!active || active.tabId !== tab.id) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    return;
  }

  const todaySeconds = await getTodaySecondsForDomain(active.domain);
  const liveSeconds = Math.floor((Date.now() - active.startedAt) / 1000);
  const total = todaySeconds + Math.max(0, liveSeconds);

  await chrome.action.setBadgeBackgroundColor({ color: "#0f766e" });
  await chrome.action.setBadgeText({
    tabId: tab.id,
    text: badgeTextFromSeconds(total),
  });
}

async function getSnapshot() {
  const [totalsByDay, active, settings] = await Promise.all([
    getTotalsByDay(),
    getActiveSession(),
    getSettings(),
  ]);

  return {
    totalsByDay,
    active,
    settings,
    todayKey: getTodayKey(),
    nowTs: Date.now(),
  };
}

async function initialize() {
  const settings = await getSettings();
  chrome.idle.setDetectionInterval(settings.idleSeconds);
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  await syncWithCurrentActiveTab();
}

chrome.runtime.onInstalled.addListener(async () => {
  await initialize();
});

chrome.runtime.onStartup.addListener(async () => {
  await initialize();
});

chrome.tabs.onActivated.addListener(async () => {
  await syncWithCurrentActiveTab();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "complete") {
    return;
  }

  const active = await getActiveSession();
  if (active && active.tabId === tabId) {
    await syncWithCurrentActiveTab();
    return;
  }

  if (tab.active) {
    await syncWithCurrentActiveTab();
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const active = await getActiveSession();
  if (active && active.tabId === tabId) {
    await closeCurrentSession("tab-closed");
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await closeCurrentSession("focus-lost");
    return;
  }

  await syncWithCurrentActiveTab();
});

chrome.idle.onStateChanged.addListener(async (newState) => {
  idleState = newState;
  if (newState === "active") {
    await syncWithCurrentActiveTab();
  } else {
    await closeCurrentSession("idle-state");
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== HEARTBEAT_ALARM) {
    return;
  }

  await syncWithCurrentActiveTab();
  await refreshBadgeForCurrentTab();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "getSnapshot") {
    getSnapshot()
      .then((snapshot) => sendResponse({ ok: true, snapshot }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "setSettings") {
    saveSettings(message.payload || {})
      .then(async (settings) => {
        await refreshBadgeForCurrentTab();
        sendResponse({ ok: true, settings });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "clearAllData") {
    closeCurrentSession("clear-all")
      .then(async () => {
        await chrome.storage.local.set({
          [TOTALS_BY_DAY_KEY]: {},
        });
        await refreshBadgeForCurrentTab();
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "importTotalsByDay") {
    const mode = message?.mode === "replace" ? "replace" : "merge";
    const imported = sanitizeTotalsByDay(message?.payload || {});

    closeCurrentSession("import-csv")
      .then(async () => {
        const current = await getTotalsByDay();
        const nextTotals =
          mode === "replace" ? imported : mergeTotalsByDay(current, imported);

        await setTotalsByDay(nextTotals);
        await refreshBadgeForCurrentTab();
        sendResponse({
          ok: true,
          importedDays: Object.keys(imported).length,
          mode,
        });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  }

  return false;
});
