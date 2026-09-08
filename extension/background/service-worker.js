// extension/background/service-worker-src.js
var OFFSCREEN_DOCUMENT_PATH = "offscreen/offscreen.html";
var _creatingOffscreen = null;
async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });
  if (existing.length > 0) return;
  if (_creatingOffscreen) {
    await _creatingOffscreen;
    return;
  }
  _creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    // WORKERS: offscreen document will use workers / WASM-based computation
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Run Transformers.js + ONNX Runtime WASM inference for embedding generation"
  });
  try {
    await _creatingOffscreen;
  } finally {
    _creatingOffscreen = null;
  }
}
async function proxyToOffscreen(msg, sendResponse) {
  try {
    await ensureOffscreen();
    const response = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: msg.type,
      text: msg.text
    });
    sendResponse(response);
  } catch (err) {
    console.error("[SW] proxyToOffscreen error:", String(err));
    sendResponse({ ok: false, error: String(err) });
  }
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === "offscreen") return false;
  if (msg.type === "SMOKE_TEST" || msg.type === "EMBED") {
    proxyToOffscreen(msg, sendResponse);
    return true;
  }
});
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));
