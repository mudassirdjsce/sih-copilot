/**
 * service-worker-src.js  — SIH Copilot MV3 Service Worker
 *
 * Responsibility: lightweight message router + offscreen document lifecycle.
 * No Transformers.js / ONNX code lives here — all inference is in offscreen.js.
 *
 * Architecture:
 *   popup / content.js
 *       ↕  chrome.runtime.sendMessage
 *   Service Worker   ← this file
 *       ↕  chrome.runtime.sendMessage  (target:"offscreen")
 *   offscreen/offscreen.js
 *       ↓
 *   @huggingface/transformers + ONNX WASM
 *
 * Build: node scripts/build.js
 */

// NOTE: no leading slash — chrome.runtime.getURL needs a relative path
const OFFSCREEN_DOCUMENT_PATH = "offscreen/offscreen.html";

// Mutex: prevents duplicate creation when two messages arrive simultaneously
// while the document is still being created.
let _creatingOffscreen = null;

/**
 * Ensures the offscreen document exists.
 * Safe to call concurrently — only one creation in flight at a time.
 */
async function ensureOffscreen() {
  // chrome.runtime.getContexts is available in Chrome 116+
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });

  if (existing.length > 0) return; // already open

  if (_creatingOffscreen) {
    // Another call is already in flight — wait for it
    await _creatingOffscreen;
    return;
  }

  _creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    // WORKERS: offscreen document will use workers / WASM-based computation
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification:
      "Run Transformers.js + ONNX Runtime WASM inference for embedding generation",
  });

  try {
    await _creatingOffscreen;
  } finally {
    _creatingOffscreen = null;
  }
}

/**
 * Proxy a message to the offscreen document and relay the response back
 * to the original caller (popup or content script).
 */
async function proxyToOffscreen(msg, sendResponse) {
  try {
    await ensureOffscreen();
    const response = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: msg.type,
      text: msg.text,
    });
    sendResponse(response);
  } catch (err) {
    console.error("[SW] proxyToOffscreen error:", String(err));
    sendResponse({ ok: false, error: String(err) });
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Ignore messages that are already addressed to offscreen
  // (the offscreen doc sends its own responses; the SW must not intercept them)
  if (msg.target === "offscreen") return false;

  if (msg.type === "SMOKE_TEST" || msg.type === "EMBED") {
    proxyToOffscreen(msg, sendResponse);
    return true; // keep channel open for async response
  }
});

// ─── SW lifecycle ─────────────────────────────────────────────────────────────
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));