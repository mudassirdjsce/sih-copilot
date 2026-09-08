/**
 * offscreen-src.js  — SIH Copilot Offscreen Document
 *
 * Runs inside offscreen/offscreen.html — a standard window context.
 *
 * ─── WHY THIS ARCHITECTURE ────────────────────────────────────────────────────
 * Transformers.js + ONNX Runtime cannot run in a MV3 Service Worker because:
 *   (a) dynamic import() is disallowed in ServiceWorkerGlobalScope (HTML spec)
 *   (b) even with a CDN import() allowed by connect-src, it is blocked by
 *       script-src — MV3 extensions cannot add external origins to script-src.
 *
 * ─── HOW WE LOAD THE WASM ─────────────────────────────────────────────────────
 * ONNX Runtime normally loads its WASM binary via one of:
 *   (A) dynamic import("cdn.../ort-wasm-simd-threaded.mjs")  ← BLOCKED by script-src
 *   (B) locateFile() returning a CDN/relative path           ← needs .mjs glue first
 *   (C) the caller provides a pre-fetched Uint8Array as      ← OUR APPROACH ✅
 *       ONNX_ENV.wasm.wasmBinary
 *
 * When wasmBinary is provided:
 *   • ONNX uses the JS factory already bundled into offscreen.js (os)
 *   • No CDN import() is triggered (script-src not involved)
 *   • The binary is supplied directly to WebAssembly.instantiate()
 *   • wasm-unsafe-eval in script-src covers WASM compilation
 *
 * The binary itself is fetched via fetch() which is governed by connect-src
 * (not script-src). cdn.jsdelivr.net is already in our connect-src CSP.
 *
 * We cache the WASM binary in the browser Cache API so the ~12 MB download
 * only happens on first use.
 *
 * Build: node scripts/build.js
 */

import { pipeline, env, cos_sim } from "@huggingface/transformers";

// ─── WASM binary config ───────────────────────────────────────────────────────
const ORT_VERSION = "1.26.0-dev.20260416-b7804b056c";
// The esbuild bundle includes the onnxruntime-web ASYNCIFY factory (ort-wasm-simd-threaded.asyncify.js).
// That factory's bt() function hardcodes "ort-wasm-simd-threaded.asyncify.wasm" as its expected binary.
// Providing the non-asyncify binary (ort-wasm-simd-threaded.wasm) would cause a WebAssembly format
// mismatch. We must provide the matching asyncify binary.
const WASM_BINARY_URL =
  `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.asyncify.wasm`;
// v2: cache name bumped to evict any previously cached wrong (non-asyncify) binary
const WASM_CACHE_NAME = "sih-copilot-ort-wasm-v2";

// Single-threaded: avoids spawning SharedWorkers (not available in offscreen docs).
// The bundled JS factory handles single-threaded execution correctly.
env.backends.onnx.wasm.numThreads = 1;

// Do NOT set wasmPaths — the bundled factory (already inside offscreen.js) is used.
// Setting wasmPaths to a CDN string would trigger an import() of the .mjs glue,
// which violates script-src 'self' (external origins banned in MV3 extension pages).

// Model weights from HuggingFace Hub, cached by browser Cache API.
env.useBrowserCache  = true;
env.allowLocalModels = false;

// ─── WASM pre-fetch with browser Cache API ────────────────────────────────────
let _wasmBinaryCache = null; // in-memory after first load within this document lifetime

async function loadWasmBinary() {
  if (_wasmBinaryCache) return _wasmBinaryCache;

  // Try browser Cache API (persists across SW restarts and offscreen reloads)
  try {
    const cache  = await caches.open(WASM_CACHE_NAME);
    const cached = await cache.match(WASM_BINARY_URL);
    if (cached) {
      console.log("[Offscreen] WASM binary: serving from Cache API");
      _wasmBinaryCache = new Uint8Array(await cached.arrayBuffer());
      return _wasmBinaryCache;
    }
  } catch (e) {
    // Cache API failure is non-fatal — fall through to network fetch
    console.warn("[Offscreen] Cache API unavailable:", e);
  }

  // Network fetch (CDN is in connect-src, so this is allowed)
  console.log("[Offscreen] WASM binary: fetching from CDN (~12 MB, first time only)...");
  const resp = await fetch(WASM_BINARY_URL);
  if (!resp.ok) throw new Error(`WASM fetch failed: HTTP ${resp.status} for ${WASM_BINARY_URL}`);

  const buf = await resp.arrayBuffer();
  _wasmBinaryCache = new Uint8Array(buf);

  // Store in Cache API for next time
  try {
    const cache = await caches.open(WASM_CACHE_NAME);
    await cache.put(WASM_BINARY_URL, new Response(buf.slice(0)));
    console.log("[Offscreen] WASM binary: saved to Cache API");
  } catch (e) {
    console.warn("[Offscreen] Could not cache WASM binary:", e);
  }

  return _wasmBinaryCache;
}

// ─── Lazy pipeline with concurrent-init guard ─────────────────────────────────
const MODEL_ID   = "Xenova/all-MiniLM-L6-v2";
let _embedder    = null;
let _initPromise = null;

async function getEmbedder() {
  if (_embedder) return _embedder;
  if (_initPromise) { await _initPromise; return _embedder; }

  _initPromise = (async () => {
    // Step 1: Pre-fetch the WASM binary via fetch() (governed by connect-src).
    // We pass it as wasmBinary so ONNX uses the bundled JS factory without
    // triggering any import() of a CDN .mjs file (which would violate script-src).
    const wasmBinary = await loadWasmBinary();

    // Step 2: CRITICAL — set wasmPaths to a non-null object BEFORE pipeline().
    //
    // @huggingface/transformers@4.2.0 auto-sets ONNX_ENV.wasm.wasmPaths to CDN
    // asyncify URLs when all of these are true:
    //   • not in a ServiceWorker  (true for offscreen docs)
    //   • ONNX_ENV.versions.web is set  (true, set by onnxruntime-web)
    //   • !ONNX_ENV.wasm.wasmPaths  (true if we leave it unset)
    //
    // If the library sets wasmPaths.mjs = "cdn.../ort-wasm-simd-threaded.asyncify.mjs",
    // then initializeWebAssembly() calls import(that URL), which violates
    // script-src 'self' (external origins forbidden in MV3 extension pages).
    //
    // Setting wasmPaths to {} (truthy, no .mjs key) blocks the auto-set.
    // With no .mjs key, the fs() function falls through to the bundled
    // JS factory (os) path and never calls import() at all.
    env.backends.onnx.wasm.wasmPaths  = {}; // block auto-CDN-set
    env.backends.onnx.wasm.wasmBinary = wasmBinary;
    console.log("[Offscreen] wasmBinary injected:", wasmBinary.byteLength, "bytes — no CDN import() will fire");

    // Step 3: initialise pipeline (model weights from HuggingFace Hub, cached)
    console.log("[Offscreen] Initializing pipeline:", MODEL_ID);
    _embedder = await pipeline("feature-extraction", MODEL_ID, {});
    console.log("[Offscreen] Pipeline ready.");
  })().catch((err) => {
    console.error("[Offscreen] Init failed:", err);
    _initPromise = null; // allow retry
    throw err;
  });

  await _initPromise;
  return _embedder;
}


async function embed(text) {
  const embedder = await getEmbedder();
  const output   = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

// ─── Smoke test ───────────────────────────────────────────────────────────────
async function handleSmokeTest() {
  const TEXT_A = "AI based monitoring system for railway infrastructure";
  const TEXT_B = "Artificial intelligence system for railway infrastructure monitoring";

  console.log("[Offscreen] Smoke test START");
  const t0   = Date.now();
  const vecA = await embed(TEXT_A);
  const t1   = Date.now();
  const vecB = await embed(TEXT_B);

  const dim        = vecA.length;
  const inferMs    = t1 - t0;
  const similarity = cos_sim(vecA, vecB);

  console.log("[Offscreen] Smoke test PASS — dim:", dim, "| inferMs:", inferMs, "| cosine:", similarity.toFixed(6));

  return {
    ok:         true,
    model:      MODEL_ID,
    ortVersion: ORT_VERSION,
    dim,
    inferMs,
    similarity: parseFloat(similarity.toFixed(6)),
    first5:     vecA.slice(0, 5).map((v) => parseFloat(v.toFixed(6))),
  };
}

// ─── Message listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "offscreen") return false;

  if (msg.type === "SMOKE_TEST") {
    handleSmokeTest()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "EMBED") {
    embed(msg.text)
      .then((vector) => sendResponse({ ok: true, vector }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});

console.log("[Offscreen] Listener registered.");