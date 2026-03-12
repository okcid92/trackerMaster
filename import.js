function setStatus(text, kind = "") {
  const status = document.getElementById("status");
  status.textContent = text;
  status.className = `status${kind ? ` ${kind}` : ""}`;
}

function normalizeCell(cell) {
  return cell.trim().replace(/^"|"$/g, "");
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      cells.push(normalizeCell(current));
      current = "";
      continue;
    }

    current += ch;
  }

  cells.push(normalizeCell(current));
  return cells;
}

function parseImportedCsv(csvText) {
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new Error("CSV vide");
  }

  const header = parseCsvLine(lines[0]);
  if (!header.length || header[0].toLowerCase() !== "domain") {
    throw new Error("Le CSV doit commencer par une colonne 'Domain'");
  }

  const dayKeys = header.slice(1);
  if (!dayKeys.length) {
    throw new Error("Aucune colonne date detectee");
  }

  dayKeys.forEach((dayKey) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
      throw new Error(`Date invalide dans le CSV: ${dayKey}`);
    }
  });

  const totalsByDay = {};

  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    if (!row.length) {
      continue;
    }

    const domain = row[0];
    if (!domain) {
      continue;
    }

    for (let col = 1; col <= dayKeys.length; col += 1) {
      const dayKey = dayKeys[col - 1];
      const raw = row[col] || "0";
      const seconds = Math.max(0, Math.floor(Number(raw) || 0));
      if (seconds <= 0) {
        continue;
      }

      if (!totalsByDay[dayKey]) {
        totalsByDay[dayKey] = {};
      }

      totalsByDay[dayKey][domain] =
        (totalsByDay[dayKey][domain] || 0) + seconds;
    }
  }

  return totalsByDay;
}

async function runImport() {
  const fileInput = document.getElementById("csvFile");
  const modeInput = document.getElementById("importMode");
  const runButton = document.getElementById("runImport");
  const file = fileInput.files?.[0];

  if (!file) {
    setStatus("Selectionne un fichier CSV d'abord.", "error");
    return;
  }

  runButton.disabled = true;
  setStatus("Import en cours...");

  try {
    const content = await file.text();
    const importedTotals = parseImportedCsv(content);
    const response = await chrome.runtime.sendMessage({
      type: "importTotalsByDay",
      payload: importedTotals,
      mode: modeInput.value === "replace" ? "replace" : "merge",
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Import impossible");
    }

    setStatus("Import termine avec succes.", "ok");
  } catch (error) {
    setStatus(`Erreur: ${error.message || String(error)}`, "error");
  } finally {
    runButton.disabled = false;
  }
}

function init() {
  document.getElementById("runImport").addEventListener("click", () => {
    runImport().catch((error) => {
      setStatus(`Erreur: ${error.message || String(error)}`, "error");
    });
  });
}

init();
