// SIH Copilot -- Popup Script  v1.0.0
"use strict";

const STORAGE_KEY_PREFIX = "sih_ps_";
const SIH_PORTAL_URL     = "https://www.sih.gov.in/";

async function loadAllRecords() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (items) => {
      const records = Object.entries(items)
        .filter(([k]) => k.startsWith(STORAGE_KEY_PREFIX))
        .map(([, v]) => v);
      resolve(records);
    });
  });
}

async function updateStats() {
  const records = await loadAllRecords();
  const counts = { unread: 0, revisit: 0, selected: 0, rejected: 0 };
  records.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
  document.getElementById("count-unread").textContent   = counts.unread;
  document.getElementById("count-revisit").textContent  = counts.revisit;
  document.getElementById("count-selected").textContent = counts.selected;
  document.getElementById("count-rejected").textContent = counts.rejected;
}

async function checkActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const dot  = document.getElementById("popup-status-dot") ?? document.querySelector(".popup-status-dot");
  const text = document.getElementById("popup-status-text");
  if (tab && tab.url && tab.url.startsWith(SIH_PORTAL_URL)) {
    dot.className  = "popup-status-dot popup-status-dot--active";
    text.textContent = "Active on SIH portal \u2713";
  } else {
    dot.className  = "popup-status-dot popup-status-dot--idle";
    text.textContent = "Not on SIH portal";
  }
}

document.getElementById("btn-clear-all").addEventListener("click", async () => {
  if (!confirm("Clear ALL SIH Copilot data (status, notes, history cache)?\nTeam skill matrix will be kept.\nThis cannot be undone.")) return;
  const records = await loadAllRecords();
  const keys = records.map(r => STORAGE_KEY_PREFIX + r.psId);
  keys.push("sih_hist_cache");
  await new Promise(r => chrome.storage.local.remove(keys, r));
  await updateStats();
});

document.getElementById("btn-open-portal").addEventListener("click", () => {
  chrome.tabs.create({ url: SIH_PORTAL_URL });
});



updateStats();
checkActiveTab();
