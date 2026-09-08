// SIH Copilot -- Popup Script  v0.3.0
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

document.getElementById("btn-smoke-test").addEventListener("click", async () => {
  const btn      = document.getElementById("btn-smoke-test");
  const resultEl = document.getElementById("smoke-result");
  btn.disabled   = true;
  btn.textContent = "Running... (first run downloads ~35 MB, please wait)";
  resultEl.style.display = "none";
  try {
    const resp = await chrome.runtime.sendMessage({ type: "SMOKE_TEST" });
    if (resp && resp.ok) {
      resultEl.style.display = "block";
      resultEl.className = "smoke-result smoke-result--pass";
      resultEl.innerHTML = "<b>PASS</b><br>Model: " + resp.model + "<br>ORT: " + (resp.ortVersion||"?") +
        "<br>Dim: " + resp.dim + "<br>Inference: " + resp.inferMs + " ms<br>Similarity: " + resp.similarity +
        "<br><small>First 5: [" + (resp.first5||[]).join(", ") + "]</small>";
    } else {
      const errMsg = resp ? resp.error : "No response";
      const stageMatch = errMsg && errMsg.match(/Stage (\d+) failed: (.+)/);
      resultEl.style.display = "block";
      resultEl.className = "smoke-result smoke-result--fail";
      resultEl.innerHTML = stageMatch
        ? "<b>FAIL</b><br>Stage " + stageMatch[1] + ": " + stageMatch[2]
        : "<b>FAIL</b><br>" + (errMsg || "Unknown error");
    }
  } catch (err) {
    resultEl.style.display = "block";
    resultEl.className = "smoke-result smoke-result--fail";
    resultEl.innerHTML = "<b>Error</b><br>" + String(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Run Embedding Smoke Test";
  }
});

updateStats();
checkActiveTab();
