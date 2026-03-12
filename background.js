const ACTIVE_SESSION_KEY = "activeSession";
const TOTALS_BY_DAY_KEY = "totalsByDay";
const SETTINGS_KEY = "trackerSettings";
const HEARTBEAT_ALARM = "heartbeat";

const USER_PROFILE_KEY = "cloudUserProfile";
const DEVICE_INFO_KEY = "deviceInfo";
const DIRTY_DAYS_KEY = "dirtyDays";
const LAST_SYNC_AT_KEY = "lastSyncAt";
const SYNC_STATE_KEY = "syncState";
const SYNC_ALARM = "cloud-sync";

const SYNC_INTERVAL_MINUTES = 5;
const FIREBASE_PROJECT_ID = "YOUR_FIREBASE_PROJECT_ID";

const DEFAULT_SETTINGS = {
  idleSeconds: 60,
  showBadge: true,
};

const DEFAULT_SYNC_STATE = {
  status: "idle",
  message: "",
  pendingDays: 0,
  lastAttemptAt: null,
  lastSuccessAt: null,
};

let idleState = "active";
let syncInProgress = false;

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

function authToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(token || null);
    });
  });
}

function removeCachedAuthToken(token) {
  return new Promise((resolve, reject) => {
    if (!token) {
      resolve();
      return;
    }

    chrome.identity.removeCachedAuthToken({ token }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function fetchGoogleUserProfile(token) {
  const response = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Google profile fetch failed (${response.status})`);
  }

  const raw = await response.json();
  return {
    uid: raw.sub,
    email: raw.email || "",
    name: raw.name || raw.email || "",
    picture: raw.picture || "",
  };
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

async function getDirtyDays() {
  const data = await chrome.storage.local.get(DIRTY_DAYS_KEY);
  return data[DIRTY_DAYS_KEY] || {};
}

async function markDirtyDays(dayKeys) {
  if (!Array.isArray(dayKeys) || !dayKeys.length) {
    return;
  }

  const dirty = await getDirtyDays();
  dayKeys.forEach((dayKey) => {
    dirty[dayKey] = true;
  });

  await chrome.storage.local.set({ [DIRTY_DAYS_KEY]: dirty });
}

async function setSyncState(partialState) {
  const data = await chrome.storage.local.get(SYNC_STATE_KEY);
  const current = data[SYNC_STATE_KEY] || DEFAULT_SYNC_STATE;
  const next = {
    ...DEFAULT_SYNC_STATE,
    ...current,
    ...partialState,
  };

  await chrome.storage.local.set({ [SYNC_STATE_KEY]: next });
}

async function getOrCreateDeviceInfo() {
  const data = await chrome.storage.local.get(DEVICE_INFO_KEY);
  if (data[DEVICE_INFO_KEY]?.deviceId) {
    return data[DEVICE_INFO_KEY];
  }

  const info = {
    deviceId: crypto.randomUUID(),
    deviceName: "",
    platform: navigator.platform || "unknown",
    createdAt: new Date().toISOString(),
  };

  await chrome.storage.local.set({ [DEVICE_INFO_KEY]: info });
  return info;
}

async function setDeviceName(deviceName) {
  const info = await getOrCreateDeviceInfo();
  const next = {
    ...info,
    deviceName: String(deviceName || "").trim(),
  };

  await chrome.storage.local.set({ [DEVICE_INFO_KEY]: next });
  return next;
}

async function ensureSignedIn(interactive) {
  let token = null;

  try {
    token = await authToken(false);
  } catch (_) {
    token = null;
  }

  if (!token && interactive) {
    token = await authToken(true);
  }

  if (!token) {
    return null;
  }

  const profile = await fetchGoogleUserProfile(token);
  await chrome.storage.local.set({ [USER_PROFILE_KEY]: profile });

  return { token, profile };
}

async function signOutGoogle() {
  let token = null;
  try {
    token = await authToken(false);
  } catch (_) {
    token = null;
  }

  try {
    await removeCachedAuthToken(token);
  } catch (_) {
    // Ignore cache clear failures.
  }

  await chrome.storage.local.remove(USER_PROFILE_KEY);
  await setSyncState({ status: "signed_out", message: "Disconnected" });
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
    return [];
  }

  const totalsByDay = await getTotalsByDay();
  const touchedDays = new Set();
  let cursor = startTs;

  // Split sessions by day to keep day-level analytics accurate.
  while (cursor < endTs) {
    const chunkEnd = Math.min(nextMidnightTs(cursor), endTs);
    const seconds = Math.floor((chunkEnd - cursor) / 1000);

    if (seconds > 0) {
      const dayKey = getDayKeyFromTs(cursor);
      addSecondsInPlace(totalsByDay, dayKey, domain, seconds);
      touchedDays.add(dayKey);
    }

    cursor = chunkEnd;
  }

  await setTotalsByDay(totalsByDay);
  const changedDays = Array.from(touchedDays);
  await markDirtyDays(changedDays);

  return changedDays;
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

function firestoreBaseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

function firestoreInt(value) {
  return { integerValue: String(Math.max(0, Math.floor(value || 0))) };
}

function firestoreString(value) {
  return { stringValue: String(value || "") };
}

function firestoreBool(value) {
  return { booleanValue: Boolean(value) };
}

function firestoreTimestamp(iso) {
  return { timestampValue: iso || new Date().toISOString() };
}

function firestoreDomainsMap(domains) {
  const fields = {};
  Object.entries(domains || {}).forEach(([domain, seconds]) => {
    fields[domain] = firestoreInt(seconds);
  });
  return { mapValue: { fields } };
}

async function firestorePatchDocument(token, documentPath, fields) {
  const url = `${firestoreBaseUrl()}/${documentPath}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Firestore PATCH failed (${response.status}) ${details.slice(0, 180)}`,
    );
  }
}

async function syncDirtyDaysToCloud(options = {}) {
  if (syncInProgress) {
    return { ok: false, skipped: true, reason: "sync-in-progress" };
  }

  if (!FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID.startsWith("YOUR_")) {
    await setSyncState({
      status: "error",
      message: "Firebase project is not configured",
      lastAttemptAt: new Date().toISOString(),
    });
    return { ok: false, reason: "firebase-not-configured" };
  }

  syncInProgress = true;

  try {
    const dirtyDays = await getDirtyDays();
    const dayKeys = Object.keys(dirtyDays).sort();

    await setSyncState({
      status: "syncing",
      message: "Sync in progress",
      pendingDays: dayKeys.length,
      lastAttemptAt: new Date().toISOString(),
    });

    if (!dayKeys.length) {
      await setSyncState({
        status: "idle",
        message: "No pending changes",
        pendingDays: 0,
      });
      return { ok: true, syncedDays: 0 };
    }

    const auth = await ensureSignedIn(Boolean(options.interactiveAuth));
    if (!auth) {
      await setSyncState({
        status: "signed_out",
        message: "Google sign-in required",
        pendingDays: dayKeys.length,
      });
      return { ok: false, reason: "signed-out" };
    }

    const { token, profile } = auth;
    const deviceInfo = await getOrCreateDeviceInfo();
    const totalsByDay = await getTotalsByDay();

    const devicePath = `users/${encodeURIComponent(profile.uid)}/devices/${encodeURIComponent(
      deviceInfo.deviceId,
    )}`;

    await firestorePatchDocument(token, devicePath, {
      deviceId: firestoreString(deviceInfo.deviceId),
      deviceName: firestoreString(deviceInfo.deviceName || ""),
      platform: firestoreString(deviceInfo.platform || "unknown"),
      extension: firestoreString(chrome.runtime.getManifest().version || ""),
      lastSeenAt: firestoreTimestamp(new Date().toISOString()),
      active: firestoreBool(true),
    });

    for (const dayKey of dayKeys) {
      const domains = totalsByDay[dayKey] || {};
      const totalSeconds = Object.values(domains).reduce(
        (sum, v) => sum + v,
        0,
      );

      const dayPath = `${devicePath}/days/${encodeURIComponent(dayKey)}`;
      await firestorePatchDocument(token, dayPath, {
        dayKey: firestoreString(dayKey),
        totalSeconds: firestoreInt(totalSeconds),
        domains: firestoreDomainsMap(domains),
        updatedAt: firestoreTimestamp(new Date().toISOString()),
      });

      delete dirtyDays[dayKey];
    }

    const successAt = new Date().toISOString();
    await chrome.storage.local.set({
      [DIRTY_DAYS_KEY]: dirtyDays,
      [LAST_SYNC_AT_KEY]: successAt,
    });

    await setSyncState({
      status: "ok",
      message: `Synced ${dayKeys.length} day(s)`,
      pendingDays: Object.keys(dirtyDays).length,
      lastSuccessAt: successAt,
    });

    return { ok: true, syncedDays: dayKeys.length };
  } catch (error) {
    const dirtyDays = await getDirtyDays();
    await setSyncState({
      status: "error",
      message: String(error.message || error),
      pendingDays: Object.keys(dirtyDays).length,
    });

    return { ok: false, reason: String(error) };
  } finally {
    syncInProgress = false;
  }
}

async function getSnapshot() {
  // Keep popup live section accurate even if no tab event fired recently.
  await syncWithCurrentActiveTab();

  const [totalsByDay, active, settings, cloudData] = await Promise.all([
    getTotalsByDay(),
    getActiveSession(),
    getSettings(),
    chrome.storage.local.get([
      USER_PROFILE_KEY,
      DEVICE_INFO_KEY,
      LAST_SYNC_AT_KEY,
      SYNC_STATE_KEY,
      DIRTY_DAYS_KEY,
    ]),
  ]);

  const dirtyDays = cloudData[DIRTY_DAYS_KEY] || {};

  return {
    totalsByDay,
    active,
    settings,
    todayKey: getTodayKey(),
    nowTs: Date.now(),
    cloud: {
      profile: cloudData[USER_PROFILE_KEY] || null,
      deviceInfo: cloudData[DEVICE_INFO_KEY] || null,
      lastSyncAt: cloudData[LAST_SYNC_AT_KEY] || null,
      syncState: cloudData[SYNC_STATE_KEY] || DEFAULT_SYNC_STATE,
      pendingDays: Object.keys(dirtyDays).length,
      firebaseConfigured: !FIREBASE_PROJECT_ID.startsWith("YOUR_"),
    },
  };
}

async function initialize() {
  const settings = await getSettings();
  chrome.idle.setDetectionInterval(settings.idleSeconds);

  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_INTERVAL_MINUTES });

  await getOrCreateDeviceInfo();
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
  if (alarm.name === HEARTBEAT_ALARM) {
    await syncWithCurrentActiveTab();
    await refreshBadgeForCurrentTab();
    return;
  }

  if (alarm.name === SYNC_ALARM) {
    // Keep sync infrequent and incremental to avoid battery drain.
    await syncDirtyDaysToCloud({ interactiveAuth: false });
  }
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
          [DIRTY_DAYS_KEY]: { [getTodayKey()]: true },
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
        await markDirtyDays(Object.keys(nextTotals));
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

  if (message?.type === "googleSignIn") {
    ensureSignedIn(true)
      .then(async (auth) => {
        if (!auth) {
          sendResponse({ ok: false, error: "Sign-in failed" });
          return;
        }

        const deviceInfo = await getOrCreateDeviceInfo();
        await setSyncState({ status: "idle", message: "Signed in" });

        sendResponse({
          ok: true,
          profile: auth.profile,
          deviceInfo,
          needsDeviceName: !deviceInfo.deviceName,
        });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "googleSignOut") {
    signOutGoogle()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "setDeviceName") {
    setDeviceName(message?.deviceName || "")
      .then((deviceInfo) => sendResponse({ ok: true, deviceInfo }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "syncNow") {
    syncDirtyDaysToCloud({ interactiveAuth: false })
      .then((result) => sendResponse({ ok: result.ok, result }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return false;
});
